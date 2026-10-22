import type { DrawingDocument } from "./types";
import { describe, it, expect } from "vitest";
import {
  newDrawing,
  defaultStyle,
  type DrawingSolid,
  type DrawingCurve,
  type Vec3,
  type DrawingPoint,
} from "./types";
import {
  circumsphere,
  insphere,
  polygonGeometry,
  coordinateOnCurve,
  implicitIntersections,
  roots,
} from "./constructions";
import { parseExpression, evaluate, equation } from "./expression";
import {
  resolveGeometry as cachedGeometry,
  invalidateGeometry,
  pointObject,
  solidMesh,
  project,
  viewRay,
  add,
  mul,
  validateDrawing,
  affectedObjects,
  norm,
  sub,
} from "./geometry";
import { arrowData, sceneFor, exportSvg } from "./scene";
import { presetEquation, sampleCurve } from "./curves";
// These numeric fixtures mutate in place. The UI uses immutable revisions.
const resolveGeometry=(d:DrawingDocument)=>{invalidateGeometry(d);return cachedGeometry(d);};
const solid = (): DrawingSolid => ({
  id: "box",
  kind: "solid",
  name: "B",
  shape: "cube",
  origin: [0, 0, 0],
  rotation: [0, 0, 0],
  width: 2,
  depth: 2,
  height: 2,
  radius: 1,
  topRadius: 1,
  sides: 4,
  style: defaultStyle(),
});
const curve = (source = "x^2+y^2=4"): DrawingCurve => ({
  id: "curve",
  name: "c",
  kind: "curve",
  equation: source,
  planeId: "xy",
  range: [-5, 5, -5, 5],
  style: defaultStyle(),
});
const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
describe("numeric LaTeX", () => {
  for (const [source, value] of [
    [String.raw`\frac{1+\sqrt{9}}{2}`, 2],
    [String.raw`\sqrt[3]{8}`, 2],
    [String.raw`\sin{\frac{\pi}{2}}`, 1],
    [String.raw`\cos^2{0}`, 1],
    [String.raw`\left| -3 \right|`, 3],
    [String.raw`2^{3}+\ln{e}`, 9],
  ] as const)
    it(source, () =>
      expect(evaluate(parseExpression(source))).toBeCloseTo(value),
    );
  it("parses complete equations", () =>
    expect(equation(String.raw`\frac{x^2}{9}+\frac{y^2}{4}=1`).type).toBe(
      "implicit",
    ));
  it("rejects unknown commands", () =>
    expect(() => parseExpression(String.raw`\input{secret}`)).toThrow());
  it("keeps legacy equations readable", () =>
    expect(evaluate(parseExpression("sqrt(3)^2+sin(pi/2)"))).toBeCloseTo(4));
  for (const type of ["circle", "ellipse", "hyperbola", "parabola"] as const)
    it(`samples ${type} in LaTeX`, () =>
      expect(
        sampleCurve(
          {
            ...curve(),
            equation: presetEquation({
              type,
              h: 0,
              k: 0,
              a: 3,
              b: 2,
              angle: 15,
            }),
          },
          undefined,
          60,
        ).paths.length,
      ).toBeGreaterThan(0));
});
describe("projection and ink", () => {
  it("defaults to orthographic with equal initial axis lengths", () => {
    const d = newDrawing();
    d.view.mode = "space";
    expect(d.view.projection).toBe("orthographic");
    const lengths = (
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec3[]
    ).map((p) => Math.hypot(...project(p, d)));
    lengths.forEach((x) => expect(x).toBeCloseTo(Math.sqrt(2 / 3)));
  });
  it("has orthonormal rows during all rotations", () => {
    const d = newDrawing();
    d.view.mode = "space";
    for (const angle of [0, 15, 45, 90, 170]) {
      d.view.angle = angle;
      const cols = (
        [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ] as Vec3[]
      ).map((p) => project(p, d));
      expect(cols.reduce((s, p) => s + p[0] * p[0], 0)).toBeCloseTo(1);
      expect(cols.reduce((s, p) => s + p[1] * p[1], 0)).toBeCloseTo(1);
      expect(cols.reduce((s, p) => s + p[0] * p[1], 0)).toBeCloseTo(0);
      close(
        project(add([1, 2, 3], mul(viewRay(d), 50)), d),
        project([1, 2, 3], d),
      );
    }
  });
  it("uses one stroke width for curves, axes, lines and projections", () => {
    const d = newDrawing();
    const p = { ...pointObject("A", [1, 1, 0]), coordinates: "axes" as const };
    d.lineWidth = 2;
    d.objects = [p, curve()];
    expect(
      sceneFor(d, [
        {
          id: "curve",
          paths: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
        },
      ]).paths.every((p) => p.width === 2),
    ).toBe(true);
  });
  it("uses closed, concave filled arrowheads in exports", () => {
    expect(
      arrowData([
        [0, 0],
        [20, 0],
      ]),
    ).toMatch(/Z$/);
    const d = newDrawing();
    expect(exportSvg(sceneFor(d, []), d, [1000, 700])).toContain(
      'fill="#161b22" stroke="none"',
    );
  });
  it("positions custom axes at their chosen origin", () => {
    const d = newDrawing();
    d.view.mode = "space";
    d.coordinateFrame = {
      origin: [1, 2, 3],
      x: [0, 1, 0],
      y: [-1, 0, 0],
      zSign: -1,
    };
    expect(validateDrawing(d)).toBe(d);
    const scene = sceneFor(d, []);
    const originPoint = d.objects.find(o=>o.kind==="point"&&o.construction.type==="origin")!;
    const origin = scene.texts.find((t) => t.owner === originPoint.id)!;
    expect(origin).toBeDefined();
    const projected=project(d.coordinateFrame.origin,d);
    expect(origin.p[0]).toBeCloseTo((projected[0]-d.view.center[0])*d.view.scale+500-17);
    expect(origin.p[1]).toBeCloseTo((projected[1]-d.view.center[1])*d.view.scale+350+19);
  });
});
describe("polygon and linked polyhedra", () => {
  const base = (): Vec3[] => [
    [0, 0, 0],
    [3, 0, 0],
    [3, 2, 0],
    [0, 2, 0],
  ];
  it("triangulates a concave simple polygon", () =>
    expect(
      polygonGeometry([
        [0, 0, 0],
        [3, 0, 0],
        [1, 1, 0],
        [3, 3, 0],
        [0, 3, 0],
      ]).triangles.length,
    ).toBe(3));
  it("rejects self intersecting outlines", () =>
    expect(() =>
      polygonGeometry([
        [0, 0, 0],
        [2, 2, 0],
        [0, 2, 0],
        [2, 0, 0],
      ]),
    ).toThrow());
  it("rejects non planar polygons", () =>
    expect(() =>
      polygonGeometry([
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 1],
        [0, 2, 0],
      ]),
    ).toThrow());
  it("links an oblique prism to a base and vector", () => {
    const d = newDrawing(),
      ps = base().map((p, i) => pointObject(String(i), p));
    const polygon = {
      id: "poly",
      kind: "polygon" as const,
      name: "P",
      points: ps.map((p) => p.id),
      style: defaultStyle(),
    };
    const prism = {
      ...solid(),
      construction: {
        type: "extrusion" as const,
        base: "poly",
        direction: [1, 0, 3] as Vec3,
      },
    };
    d.objects = [...ps, polygon, prism];
    validateDrawing(d);
    let result = resolveGeometry(d);
    expect(result.errors.size).toBe(0);
    close(result.meshes[0].vertices[4], [1, 0, 3]);
    ps[0].construction = { type: "free", position: [-1, 0, 0] };
    result = resolveGeometry(d);
    close(result.meshes[0].vertices[4], [0, 0, 3]);
    expect(affectedObjects(d, ps[0].id).has(prism.id)).toBe(true);
  });
  it("creates a non regular pyramid from a polygon and apex", () => {
    const d = newDrawing(),
      ps = base().map((p, i) => pointObject(String(i), p)),
      apex = pointObject("S", [1, 1, 3]);
    d.objects = [
      ...ps,
      apex,
      {
        id: "base",
        kind: "polygon",
        name: "base",
        points: ps.map((p) => p.id),
        style: defaultStyle(),
      },
      {
        ...solid(),
        construction: { type: "apex", base: "base", apex: apex.id },
      },
    ];
    expect(resolveGeometry(d).meshes[0].vertices.length).toBe(5);
  });
  it("hides and recovers an invalid coplanar apex", () => {
    const d = newDrawing(),
      ps = base().map((p, i) => pointObject(String(i), p)),
      apex = pointObject("S", [1, 1, 0]);
    d.objects = [
      ...ps,
      apex,
      {
        id: "base",
        kind: "polygon",
        name: "base",
        points: ps.map((p) => p.id),
        style: defaultStyle(),
      },
      {
        ...solid(),
        construction: { type: "apex", base: "base", apex: apex.id },
      },
    ];
    expect(resolveGeometry(d).errors.has("box")).toBe(true);
    apex.construction = { type: "free", position: [0, 0, 3] };
    expect(resolveGeometry(d).errors.has("box")).toBe(false);
  });
  it("rejects dependency cycles through virtual solid vertices", () => {
    const d = newDrawing(),
      p = pointObject("A", [0, 0, 0]);
    p.construction = { type: "alias", point: "box:v:0" };
    d.objects = [
      p,
      {
        ...solid(),
        construction: {
          type: "circumsphere",
          vertices: [p.id, p.id, p.id, p.id],
        },
      },
    ];
    expect(() => validateDrawing(d)).toThrow(/循环/);
  });
});
describe("spheres", () => {
  it("finds a cube circumsphere", () => {
    const m = solidMesh(solid()),
      s = circumsphere(m.vertices);
    close(s.center, [0, 0, 1]);
    expect(s.radius).toBeCloseTo(Math.sqrt(3));
  });
  it("finds a cube insphere", () => {
    const m = solidMesh(solid()),
      s = insphere(m.vertices, m.faces);
    close(s.center, [0, 0, 1]);
    expect(s.radius).toBeCloseTo(1);
  });
  it("finds a tetrahedron insphere", () => {
    const s = insphere(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 1, 2],
        [0, 1, 3],
        [0, 2, 3],
        [1, 2, 3],
      ],
    );
    expect(s.radius).toBeCloseTo(1 / (3 + Math.sqrt(3)));
    close(s.center, [s.radius, s.radius, s.radius]);
  });
  it("rejects fewer than four points", () =>
    expect(() =>
      circumsphere([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ).toThrow(/无法唯一/));
  it("rejects coplanar points", () =>
    expect(() =>
      circumsphere([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ]),
    ).toThrow(/无法唯一/));
  it("rejects non cospherical points", () =>
    expect(() =>
      circumsphere([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [2, 2, 2],
      ]),
    ).toThrow(/不共球/));
  it("rejects an unequal cuboid insphere", () => {
    const m = solidMesh({ ...solid(), shape: "cuboid", height: 3 });
    expect(() => insphere(m.vertices, m.faces)).toThrow(/不存在/);
  });
  it("recomputes a linked sphere after changing source", () => {
    const d = newDrawing(),
      box = solid();
    d.objects = [
      box,
      {
        ...solid(),
        id: "sphere",
        shape: "sphere",
        construction: { type: "circumsphere", source: box.id, vertices: [] },
      },
    ];
    let result = resolveGeometry(d);
    expect(result.errors.size).toBe(0);
    const radius = result.meshes.find((m) => m.id === "sphere")!.solid!.radius;
    expect(radius).toBeCloseTo(Math.sqrt(3));
    box.width = 4;
    result = resolveGeometry(d);
    expect(
      result.meshes.find((m) => m.id === "sphere")!.solid!.radius,
    ).toBeCloseTo(2 * Math.sqrt(3));
  });
});
describe("curve constraints and intersections", () => {
  it("finds both coordinates on a circle", () => {
    const d = newDrawing(),
      p = coordinateOnCurve(curve(), "x", 1, d);
    expect(p.length).toBe(2);
    close(p[0], [1, -Math.sqrt(3), 0]);
    close(p[1], [1, Math.sqrt(3), 0]);
  });
  it("finds tangent coordinate solutions", () =>
    expect(coordinateOnCurve(curve(), "x", 2, newDrawing()).length).toBe(1));
  it("rejects underdetermined coordinate constraints", () =>
    expect(() => coordinateOnCurve(curve("x=1"), "x", 1, newDrawing())).toThrow(
      /无穷/,
    ));
  it("evaluates explicit curves outside the display rectangle", () =>
    close(
      coordinateOnCurve(curve("y=x^2"), "x", 10, newDrawing())[0],
      [10, 100, 0],
    ));
  it("rejects coincident curves", () =>
    expect(() =>
      implicitIntersections(
        (x, y) => x * x + y * y - 4,
        (x, y) => 2 * (x * x + y * y - 4),
        [-3, 3, -3, 3],
      ),
    ).toThrow(/重合/));
  it("does not invent roots across poles", () =>
    expect(roots((x) => 1 / x, -1, 1)).toEqual([]));
  it("solves curve intersections including tangency", () => {
    expect(
      implicitIntersections(
        (x, y) => x * x + y * y - 4,
        (_x, y) => y,
        [-3, 3, -3, 3],
        250, // Numeric accuracy fixture; interaction deadlines are tested separately.
      ).length,
    ).toBe(2);
    expect(
      implicitIntersections(
        (x, y) => x * x + y * y - 4,
        (_x, y) => y - 2,
        [-3, 3, -3, 3],
        250,
      ).length,
    ).toBe(1);
  });
  it("links curve coordinate points and keeps a dot on a single curve", () => {
    const d = newDrawing(),
      c = curve("y=x^2");
    const p: DrawingPoint = {
      ...pointObject("A", [0, 0, 0]),
      construction: {
        type: "curveCoordinate",
        curve: c.id,
        axis: "x",
        value: 2,
        branch: 0,
      },
    };
    d.objects = [c, p];
    validateDrawing(d);
    let r = resolveGeometry(d);
    close(r.points.get(p.id)!.p, [2, 4, 0]);
    expect(r.connected.has(p.id)).toBe(false);
    c.equation = "y=x^2-1";
    r = resolveGeometry(d);
    close(r.points.get(p.id)!.p, [2, 3, 0]);
  });
  it("intersects infinite lines outside their defining segments", () => {
    const d = newDrawing(),
      ps = [
        [0, 0, 0],
        [1, 0, 0],
        [2, 1, 0],
        [2, 2, 0],
      ].map((p, i) => pointObject(String(i), p as Vec3));
    d.objects = [
      ...ps,
      {
        id: "l1",
        kind: "line",
        name: "l1",
        points: [ps[0].id, ps[1].id],
        style: defaultStyle(),
      },
      {
        id: "l2",
        kind: "line",
        name: "l2",
        points: [ps[2].id, ps[3].id],
        style: defaultStyle(),
      },
      {
        ...pointObject("I", [0, 0, 0]),
        id: "intersection",
        construction: {
          type: "intersection",
          first: "l1",
          second: "l2",
          branch: 0,
        },
      },
    ];
    validateDrawing(d);
    close(resolveGeometry(d).points.get("intersection")!.p, [2, 0, 0]);
    const paths = sceneFor(d, []).paths.filter((p) => p.owner === "l1");
    expect(
      norm(sub([...paths[0].points[0], 0], [...paths[0].points[1], 0])),
    ).toBeGreaterThan(900);
  });
});

it("rejects references past the actual constructed polyhedron vertex count", () => {
  const d = newDrawing(),
    ps = (
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ] as Vec3[]
    ).map((p, i) => pointObject(String(i), p));
  d.objects = [
    ...ps,
    {
      id: "base",
      kind: "polygon",
      name: "base",
      points: ps.map((p) => p.id),
      style: defaultStyle(),
    },
    {
      ...solid(),
      construction: { type: "extrusion", base: "base", direction: [0, 0, 1] },
    },
    {
      ...pointObject("invalid", [0, 0, 0]),
      construction: { type: "alias", point: "box:v:100" },
    },
  ];
  expect(() => validateDrawing(d)).toThrow(/引用/);
});
it("rejects a point construction referring to a curve as an endpoint", () => {
  const d = newDrawing();
  d.objects = [
    curve(),
    {
      ...pointObject("invalid", [0, 0, 0]),
      construction: { type: "alias", point: "curve" },
    },
  ];
  expect(() => validateDrawing(d)).toThrow(/引用/);
});
