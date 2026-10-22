import { describe, it, expect } from "vitest";
import {
  newDrawing,
  defaultStyle,
  type DrawingDocument,
  type DrawingSolid,
  type DrawingCurve,
  type DrawingPoint,
} from "./types";
import { scalar, evaluate, parseExpression, equation } from "./expression";
import {
  add,
  mul,
  norm,
  sub,
  fromPlane,
  toPlane,
  planeFromPoints,
  planeFromEquation,
  project,
  viewRay,
  unprojectOnPlane,
  pointObject,
  triangleCenter,
  resolveGeometry as cachedGeometry,
  invalidateGeometry,
  solidMesh,
  validateDrawing,
  affectedObjects,
} from "./geometry";
import { presetEquation, sampleCurve } from "./curves";
import {
  sceneFor,
  exportSvg,
  rayTriangle,
  isOccluded,
  splitVisibility,
  labelRuns,
  labelPlainText,
} from "./scene";

// These numeric fixtures mutate in place. The UI uses immutable revisions.
const resolveGeometry=(d:DrawingDocument)=>{invalidateGeometry(d);return cachedGeometry(d);};
const close = (a: number[], b: number[]) => {
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 6));
};
const solid = (shape: DrawingSolid["shape"] = "cube"): DrawingSolid => ({
  id: "solid",
  name: "S",
  kind: "solid",
  shape,
  origin: [0, 0, 0],
  rotation: [0, 0, 0],
  width: 2,
  depth: 3,
  height: 4,
  radius: 2,
  topRadius: 1,
  sides: 4,
  style: defaultStyle(),
});
const triangle = () => {
  const d = newDrawing(),
    a = pointObject("A", [0, 0, 0]),
    b = pointObject("B", [4, 0, 0]),
    c = pointObject("C", [0, 3, 0]);
  a.id = "a";
  b.id = "b";
  c.id = "c";
  d.objects = [
    a,
    b,
    c,
    {
      id: "tri",
      kind: "triangle",
      name: "ABC",
      points: [a.id, b.id, c.id],
      style: defaultStyle(),
    },
  ];
  return d;
};
const curve = (source: string): DrawingCurve => ({
  id: "curve",
  kind: "curve",
  name: "C",
  equation: source,
  planeId: "xy",
  range: [-5, 5, -5, 5],
  style: defaultStyle(),
});

describe("numeric-only expression parser", () => {
  it("evaluates powers, unary signs and implicit multiplication", () => {
    expect(scalar("-2^2")).toBe(-4);
    expect(scalar("2^3^2")).toBe(512);
    expect(scalar("2sqrt(3)/2")).toBeCloseTo(Math.sqrt(3));
    expect(evaluate(parseExpression("2x+3(x-1)"), { x: 2 })).toBe(7);
  });
  it("supports real elementary functions and constants", () => {
    expect(scalar("sin(pi/2)+ln(e)+abs(-2)")).toBeCloseTo(4);
    expect(scalar("min(1,2)+max(3,4)")).toBe(5);
  });
  it.each([
    "window.alert(1)",
    "x=2",
    "constructor(1)",
    "[1,2]",
    "foo",
    "sqrt()",
    "sin(1,2)",
    "",
    "((((1)",
  ])("rejects unsupported syntax: %s", (source) =>
    expect(() => scalar(source)).toThrow(),
  );
  it("bounds expression complexity and finite coordinates", () => {
    expect(() =>
      parseExpression("(".repeat(100) + "1" + ")".repeat(100)),
    ).toThrow();
    expect(() => scalar("1/0")).toThrow();
    expect(() => scalar("1e100")).toThrow();
    expect(() => equation("x=y=z")).toThrow();
  });
});
describe("workplanes, projection and constructions", () => {
  it("maps local coordinates through arbitrary planes", () => {
    const p = planeFromPoints([1, 2, 3], [2, 2, 4], [1, 3, 3], "P");
    close(toPlane(p, fromPlane(p, 2, -3)), [2, -3]);
    const q = planeFromEquation(1, 2, 3, -6);
    const v = fromPlane(q, 3, 4);
    expect(v[0] + 2 * v[1] + 3 * v[2]).toBeCloseTo(6);
    expect(() => planeFromEquation(0, 0, 0, 1)).toThrow();
    expect(() =>
      planeFromPoints([0, 0, 0], [1, 0, 0], [2, 0, 0], "bad"),
    ).toThrow();
  });
  it("uses the half-length 45-degree depth axis without perspective", () => {
    const d = newDrawing(); d.view.projection="oblique";
    d.dimension = "3d";
    d.view.mode = "space";
    close(project([1, 0, 0], d), [1, 0]);
    close(project([0, 1, 0], d), [Math.SQRT2 / 4, -Math.SQRT2 / 4]);
    close(project([0, 0, 1], d), [0, -1]);
    expect(Math.hypot(...project([0, 1, 0], d))).toBeCloseTo(0.5);
    const p: [number, number, number] = [2, 3, 4];
    close(project(add(p, mul(viewRay(d), 20)), d), project(p, d));
  });
  it("inverts drags in the workplane and preserves the point's plane offset", () => {
    const d = newDrawing();
    d.dimension = "3d";
    d.view.mode = "space";
    d.view.angle = 35;
    const original: [number, number, number] = [2, 3, 4],
      wanted: [number, number, number] = [3, -1, 4];
    close(unprojectOnPlane(project(wanted, d), original, d), wanted);
  });
  it("calculates all four centers in 2D and rotated 3D triangles", () => {
    const a: [number, number, number] = [0, 0, 0],
      b: [number, number, number] = [4, 0, 0],
      c: [number, number, number] = [0, 3, 0];
    close(triangleCenter(a, b, c, "centroid"), [4 / 3, 1, 0]);
    close(triangleCenter(a, b, c, "circumcenter"), [2, 1.5, 0]);
    close(triangleCenter(a, b, c, "orthocenter"), [0, 0, 0]);
    close(triangleCenter(a, b, c, "incenter"), [1, 1, 0]);
    close(
      triangleCenter([0, 0, 0], [0, 4, 0], [0, 0, 3], "incenter"),
      [0, 1, 1],
    );
  });
  it("keeps midpoint and center dependencies live and recovers degeneracy", () => {
    const d = triangle();
    const m: DrawingPoint = {
        ...pointObject("M", [0, 0, 0]),
        id: "mid",
        construction: { type: "division", a: "a", b: "b", t: 0.25 },
      },
      g: DrawingPoint = {
        ...pointObject("G", [0, 0, 0]),
        id: "center",
        construction: {
          type: "center",
          points: ["a", "b", "c"],
          center: "centroid",
        },
      };
    d.objects.push(m, g);
    close(resolveGeometry(d).points.get("mid")!.p, [1, 0, 0]);
    const b = d.objects[1] as DrawingPoint;
    b.construction = { type: "free", position: [8, 0, 0] };
    close(resolveGeometry(d).points.get("mid")!.p, [2, 0, 0]);
    const c = d.objects[2] as DrawingPoint;
    c.construction = { type: "free", position: [1, 0, 0] };
    expect(resolveGeometry(d).errors.has("center")).toBe(true);
    expect(resolveGeometry(d).errors.has("tri")).toBe(true);
    c.construction = { type: "free", position: [0, 3, 0] };
    expect(resolveGeometry(d).errors.size).toBe(0);
  });
  it("exposes independent triangle and solid edges with stable vertex IDs", () => {
    const d = triangle();
    d.objects.push(solid());
    const r = resolveGeometry(d);
    expect(r.edges.filter((e) => e.owner === "tri")).toHaveLength(3);
    expect(r.edges.filter((e) => e.owner === "solid")).toHaveLength(12);
    expect(r.points.has("solid:v:7")).toBe(true);
  });
  it("finds transitive deletion dependents", () => {
    const d = triangle();
    d.objects.push({
      ...pointObject("M", [0, 0, 0]),
      id: "m",
      construction: { type: "division", a: "a", b: "b", t: 0.5 },
    });
    expect([...affectedObjects(d, "a")].sort()).toEqual(["a", "m", "tri"]);
  });
  it("validates saved source, missing references, cycles, styles and planes", () => {
    const d = triangle();
    expect(validateDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const broken = structuredClone(d);
    (broken.objects[0] as DrawingPoint).construction = {
      type: "division",
      a: "a",
      b: "b",
      t: 0.5,
    };
    expect(() => validateDrawing(broken)).toThrow(/循环/);
    const missing = structuredClone(d);
    (missing.objects[3] as { points: string[] }).points[0] = "missing";
    expect(() => validateDrawing(missing)).toThrow(/不存在/);
    const invalid = structuredClone(d);
    invalid.view.scale = 0;
    expect(() => validateDrawing(invalid)).toThrow();
    invalid.view.scale = 48;
    invalid.planes[0].u = [2, 0, 0];
    expect(() => validateDrawing(invalid)).toThrow();
  });
});
describe("curves", () => {
  it("joins a circle into one closed contour, without cell seams", () => {
    for (const range of [
      [-8.49, 8.49, -7.17, 7.17],
      [-5, 5, -5, 5],
    ] as DrawingCurve["range"][]) {
      const c = curve("x^2+y^2=4"),
        paths = sampleCurve(c, range, 180).paths;
      expect(paths).toHaveLength(1);
      close(paths[0][0], paths[0].at(-1)!);
    }
  });
  it.each(["circle", "ellipse", "hyperbola", "parabola"] as const)(
    "samples the %s preset",
    (type) => {
      const p = { type, h: 0, k: 0, a: 2, b: 1, angle: 30 };
      const c = curve(presetEquation(p));
      c.preset = p;
      const paths = sampleCurve(c, c.range, 96).paths;
      expect(paths.flat().length).toBeGreaterThan(20);
      expect(paths.flat().every((p) => p.every(Number.isFinite))).toBe(true);
    },
  );
  it("satisfies an implicit circle to numerical tolerance", () => {
    const c = curve("x^2+y^2=4"),
      paths = sampleCurve(c, c.range, 100).paths;
    for (const p of paths.flat())
      expect(Math.abs(p[0] ** 2 + p[1] ** 2 - 4)).toBeLessThan(0.0001);
  });
  it("does not connect explicit curves across poles or invalid domains", () => {
    for (const eq of ["y=1/x", "y=tan(x)", "y=sqrt(x)"]) {
      const paths = sampleCurve(curve(eq)).paths;
      expect(paths.length).toBeGreaterThan(0);
      if (eq === "y=1/x")
        expect(
          paths.every(
            (p) => p.every((q) => q[0] < 0) || p.every((q) => q[0] > 0),
          ),
        ).toBe(true);
      if (eq === "y=sqrt(x)")
        expect(paths.flat().every((p) => p[0] >= 0)).toBe(true);
    }
  });
  it("does not mistake an implicit discontinuity for a zero contour", () => {
    const c = curve("1/x=0");
    expect(sampleCurve(c, c.range, 80).paths).toHaveLength(0);
  });
  it("supports x as a function of y and localized variables", () => {
    expect(
      sampleCurve(curve("x=y^2"))
        .paths.flat()
        .every((p) => Math.abs(p[0] - p[1] ** 2) < 0.0001 || Math.abs(p[0]-5)<1e-7),
    ).toBe(true);
    expect(sampleCurve(curve("v=u^2")).paths.length).toBeGreaterThan(0);
  });
});
describe("solid visibility and figure output", () => {
  it.each(
    Object.keys({
      cube: 1,
      cuboid: 1,
      prism: 1,
      pyramid: 1,
      frustum: 1,
      cylinder: 1,
      cone: 1,
      coneFrustum: 1,
      sphere: 1,
    }) as DrawingSolid["shape"][],
  )("creates finite %s geometry", (shape) => {
    const m = solidMesh(solid(shape));
    expect(m.faces.length).toBeGreaterThan(0);
    expect(m.vertices.every((p) => p.every(Number.isFinite))).toBe(true);
    expect(m.faces.every((f) => f.every((i) => i < m.vertices.length))).toBe(
      true,
    );
  });
  it("tests front-only ray intersections", () => {
    expect(
      rayTriangle([0.2, 0.2, -1], [0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ).toBeCloseTo(1);
    expect(
      rayTriangle([0.2, 0.2, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ).toBeNull();
  });
  it("classifies and splits hidden edges on a cube", () => {
    const d = newDrawing();
    d.dimension = "3d";
    d.view.mode = "space";
    const mesh = solidMesh(solid());
    const dir = viewRay(d);
    expect(isOccluded([0, 0, 1], dir, [mesh])).toBe(true);
    expect(isOccluded([0, -2, 3], dir, [mesh])).toBe(false);
    const spans = splitVisibility([-3, 0, 1], [3, 0, 1], dir, [mesh], 24);
    expect(spans.some((s) => s.hidden)).toBe(true);
    expect(spans.some((s) => !s.hidden)).toBe(true);
  });
  it("automatically draws dashed hidden edges and honors overrides", () => {
    const d = newDrawing();
    d.dimension = "3d";
    d.view.mode = "space";
    d.view.axes = false;
    d.objects = [solid()];
    const s = sceneFor(d, []);
    expect(s.paths.some((p) => p.dashed)).toBe(true);
    d.edgeStyles["solid:e:0"] = "hidden";
    expect(sceneFor(d, []).paths.some((p) => p.id === "solid:e:0")).toBe(false);
    d.edgeStyles["solid:e:0"] = "solid";
    expect(
      sceneFor(d, [])
        .paths.filter((p) => p.id === "solid:e:0")
        .every((p) => !p.dashed),
    ).toBe(true);
  });
  it("produces curved-body silhouettes including a welded cone apex", () => {
    for (const shape of ["cylinder", "cone", "sphere"] as const) {
      const d = newDrawing();
      d.dimension = "3d";
      d.view.mode = "space";
      d.view.axes = false;
      d.objects = [solid(shape)];
      expect(
        sceneFor(d, []).paths.some((p) => p.id.endsWith(":silhouette")),
      ).toBe(true);
    }
  });
  it("suppresses connected dots and keeps labels, with no editing overlays in SVG", () => {
    const d = triangle();
    d.view.axes = false;
    const s = sceneFor(d, []);
    expect(s.dots).toHaveLength(0);
    expect(s.texts.map((t) => t.text)).toEqual(["A", "B", "C"]);
    d.objects.push(pointObject("P", [1, 1, 0]));
    invalidateGeometry(d);
    expect(sceneFor(d, []).dots).toHaveLength(1);
    const xml = exportSvg(s, d, [1000, 700]);
    expect(xml).toContain('font-family="Times New Roman"');
    expect(xml).not.toContain("draw-handle");
    expect(xml).not.toContain("katex");
    expect(xml).not.toContain('fill="white"');
  });
  it("formats script labels using the same font and escapes XML", () => {
    expect(labelRuns("A_{12}x^2")).toEqual([
      { text: "A", script: "normal" },
      { text: "12", script: "sub" },
      { text: "x", script: "normal" },
      { text: "2", script: "super" },
    ]);
    expect(labelPlainText("A_1+α^2")).toBe("A1+α2");
    const d = newDrawing();
    d.objects = [
      {
        id: "text",
        name: "L",
        kind: "label",
        position: [0, 0, 0],
        text: "A_1<&",
        style: defaultStyle(),
      },
    ];
    const xml = exportSvg(sceneFor(d, []), d, [1000, 700]);
    expect(xml).toContain("&lt;&amp;");
    expect(xml).toContain('baseline-shift="sub"');
  });
  it("preserves geometry when the view rotates", () => {
    const d: DrawingDocument = newDrawing(); d.view.projection="oblique";
    d.dimension = "3d";
    d.view.mode = "space";
    d.objects = [solid()];
    const original = JSON.stringify(resolveGeometry(d).meshes);
    d.view.angle = 90;
    sceneFor(d, []);
    expect(JSON.stringify(resolveGeometry(d).meshes)).toBe(original);
    expect(
      norm(
        sub(
          project([1, 0, 0], d).concat(0) as [number, number, number],
          [0, 0, 0],
        ),
      ),
    ).toBeCloseTo(0.5);
  });
});
