import { describe, it, expect } from "vitest";
import { newDrawing, type DrawingDocument } from "./types";
import {
  applyDefinition,
  normalizeDrawing,
  definition,
  resolveReference,
  splitArguments,
} from "./model";
import {
  resolveGeometry as cachedGeometry,
  invalidateGeometry,
  validateDrawing,
  pointObject,
  sub,
  norm,
} from "./geometry";
import {
  acceptPoint,
  rejectLastPoint,
  initialTool,
  toolStep,
  snapPoint,
  screenPoint,
  canvasPoint,
  hitTest,
  selectRectangle,
  meshFaces,
  planeForHit,
  pointOnPath,
} from "./interaction";
import { pointOnImplicit } from "./pathProjection";
import { sampleCurve } from "./curves";
import { sceneFor } from "./scene";
// These numeric fixtures mutate in place. The UI uses immutable revisions.
const resolveGeometry=(d:DrawingDocument)=>{invalidateGeometry(d);return cachedGeometry(d);};
const fixture = () =>
  ["A=(0,0)", "B=(4,0)", "C=(1,3)"].reduce(
    (d, s) => applyDefinition(d, s),
    newDrawing(),
  );
const add = (d: DrawingDocument, ...sources: string[]) =>
  sources.reduce((d, s) => applyDefinition(d, s), d);
const by = (d: DrawingDocument, s: string) =>
  d.objects.find((o) => o.symbol === s)!;
const p = (d: DrawingDocument, s: string) =>
  resolveGeometry(d).points.get(by(d, s).id)!.p;
const close = (a: number[], b: number[]) =>
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 6));
describe("definitions and identity", () => {
  it("keeps a draft curve out of the saved export scene", () => {
    const d = fixture(), before = JSON.stringify(d), preview = add(d, "c: y=x^2");
    const curve = by(preview,"c");
    if (curve.kind !== "curve") throw new Error("expected curve");
    const samples = [sampleCurve(curve)];
    expect(sceneFor(preview,samples,[800,600]).paths.some(p => p.owner === curve.id)).toBe(true);
    expect(sceneFor(d,samples,[800,600]).paths.some(p => p.owner === curve.id)).toBe(false);
    expect(JSON.stringify(d)).toBe(before);
  });
  it("upgrades v1 without changing IDs or labels", () => {
    const d = newDrawing();
    d.schemaVersion = 1;
    d.objects = [pointObject("原来的中文名称", [0, 0, 0])];
    const n = normalizeDrawing(d);
    expect(n.schemaVersion).toBe(3);
    expect(n.objects.find(o=>o.id===d.objects[0].id)?.id).toBe(d.objects[0].id);
    expect(n.objects.find(o=>o.id===d.objects[0].id)?.name).toBe("原来的中文名称");
    expect(n.objects.find(o=>o.id===d.objects[0].id)?.symbol).toBe("A");
  });
  it("handles repeated labels with unique symbols", () => {
    const d = newDrawing();
    d.objects = [pointObject("P", [0, 0, 0]), pointObject("P", [1, 0, 0])];
    const n = normalizeDrawing(d);
    expect(new Set(n.objects.map((o) => o.symbol)).size).toBe(n.objects.length);
    expect(n.objects.filter(o=>o.name=== "P")).toHaveLength(2);
  });
  it("keeps references valid after symbol rename", () => {
    let d = add(fixture(), "s=Segment(A,B)");
    const a = by(d, "A");
    d = applyDefinition(d, "D=(2,2)", a.id);
    expect(by(d, "D").id).toBe(a.id);
    expect(definition(d, by(d, "s"))).toContain("D, B");
    close(p(d, "D"), [2, 2, 0]);
  });
  it("rejects duplicate symbols atomically", () => {
    const d = fixture(),
      before = JSON.stringify(d);
    expect(() => applyDefinition(d, "A=(3,4)")).toThrow(/符号/);
    expect(JSON.stringify(d)).toBe(before);
  });
  it("keeps a last valid graph after invalid source", () => {
    const d = add(fixture(), "c: y=x^2");
    expect(() =>
      applyDefinition(d, String.raw`c: y=\frac{`, by(d, "c").id),
    ).toThrow();
    expect(by(d, "c").kind).toBe("curve");
  });
  it("rejects cycles through a circle", () => {
    const d = add(fixture(), "c=Circle(A,B)");
    expect(() => applyDefinition(d, "A=On(c,0)", by(d, "A").id)).toThrow(
      /循环/,
    );
  });
  it("splits nested LaTeX and quoted commas", () =>
    expect(splitArguments(String.raw`"a,b", (\frac{1}{2},3), C`)).toEqual([
      '"a,b"',
      String.raw`(\frac{1}{2},3)`,
      "C",
    ]));
  it("supports text definitions with commas", () => {
    const d = add(fixture(), 't=Text("a,b",(2,3))');
    expect(by(d, "t").kind === "label" && by(d, "t")).toBeTruthy();
  });
  it("reopens a complete v2 document", () => {
    const d = add(fixture(), "s=线段(A,B)", "M=Midpoint(s)");
    expect(normalizeDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  for (const [cmd, kind] of [
    ["Segment", "segment"],
    ["Line", "line"],
    ["Vector", "vector"],
    ["Triangle", "triangle"],
    ["Polygon", "polygon"],
  ])
    it(cmd, () => {
      const d = add(
        fixture(),
        `g=${cmd}(${cmd === "Triangle" || cmd === "Polygon" ? "A,B,C" : "A,B"})`,
      );
      expect(by(d, "g").kind).toBe(kind);
    });
  it("formats aliases as editable definitions", () => {
    const d = add(fixture(), "D=Point(A)");
    expect(definition(d, by(d, "D"))).toBe("D = Point(A)");
  });
});
describe("linked constructions", () => {
  it("hides the source apex dot of a visible pyramid", () => {
    const start = fixture(); start.dimension = "3d";
    const d = add(start, "P=(1,1,4)", "p=Polygon(A,B,C)", "S=Pyramid(p,P)");
    expect(resolveGeometry(d).connected.has(by(d, "P").id)).toBe(true);
    by(d, "S").hidden = true;
    expect(resolveGeometry(d).connected.has(by(d, "P").id)).toBe(false);
  });
  it("hides base vertex dots when only the prism is visible", () => {
    const start = fixture(); start.dimension = "3d";
    const d = add(start, "p=Polygon(A,B,C)", "S=Prism(p,(1,0,3))");
    by(d, "p").hidden = true;
    expect(resolveGeometry(d).connected.has(by(d, "A").id)).toBe(true);
  });
  it("follows connection state through an alias chain in either direction", () => {
    const d = add(fixture(), "D=Point(A)", "H=Point(D)", "s=Segment(H,B)");
    const connected = resolveGeometry(d).connected;
    for (const s of ["A", "D", "H"]) expect(connected.has(by(d,s).id)).toBe(true);
    expect(connected.has(by(d, "C").id)).toBe(false);
  });
  it("updates a two point circle", () => {
    let d = add(fixture(), "c=Circle(A,B)", "P=PointX(c,0,2)");
    close(p(d, "P"), [0, 4, 0]);
    d = applyDefinition(d, "B=(2,0)", by(d, "B").id);
    close(p(d, "P"), [0, 2, 0]);
  });
  it("supports three point circle and radius", () => {
    const d = add(fixture(), "c=Circle3(A,B,C)", "d=Circle(A,2)");
    expect(resolveGeometry(d).curves.size).toBe(2);
  });
  for (const center of ["Centroid", "Circumcenter", "Orthocenter", "Incenter"])
    it(center, () => {
      const d = add(fixture(), `P=${center}(A,B,C)`);
      expect(p(d, "P").every(Number.isFinite)).toBe(true);
    });
  it("moves midpoint with its original endpoints", () => {
    let d = add(fixture(), "s=Segment(A,B)", "M=Midpoint(s)");
    d = applyDefinition(d, "B=(8,0)", by(d, "B").id);
    close(p(d, "M"), [4, 0, 0]);
  });
  it("creates every division point", () => {
    const d = add(fixture(), "s=Segment(A,B)", "Divide(s,4)");
    expect(
      d.objects.filter(
        (o) => o.kind === "point" && o.construction.type === "division",
      ).length,
    ).toBe(3);
  });
  it("computes parallel and perpendicular directions", () => {
    const d = add(
      fixture(),
      "l=Line(A,B)",
      "parallel=Parallel(l,C)",
      "perp=Perpendicular(l,C)",
      "bis=PerpendicularBisector(A,B)",
    );
    const r = resolveGeometry(d);
    const ends = (s: string) => {
      const e = r.edges.find((e) => e.owner === by(d, s).id)!;
      return sub(r.points.get(e.b)!.p, r.points.get(e.a)!.p);
    };
    close(ends("parallel"), [1, 0, 0]);
    close(ends("perp"), [0, 1, 0]);
    close(ends("bis"), [0, 1, 0]);
  });
  it("updates a line relation after source redefinition", () => {
    let d = add(fixture(), "l=Line(A,B)", "perp=Perpendicular(l,C)");
    d = applyDefinition(d, "B=(0,4)", by(d, "B").id);
    const r = resolveGeometry(d),
      e = r.edges.find((e) => e.owner === by(d, "perp").id)!;
    close(sub(r.points.get(e.b)!.p, r.points.get(e.a)!.p), [-1, 0, 0]);
  });
  it("supports points along bounded and unbounded lines", () => {
    const d = add(
      fixture(),
      "s=Segment(A,B)",
      "l=Line(A,B)",
      "P=On(s,2)",
      "Q=On(l,2)",
    );
    close(p(d, "P"), [4, 0, 0]);
    close(p(d, "Q"), [8, 0, 0]);
  });
  it("keeps points on explicit and implicit curves", () => {
    const d = add(
      fixture(),
      "c: y=x^2",
      "P=On(c,2)",
      "d: x^2+y^2=4",
      "Q=On(d,(1.4,1.4))",
    );
    close(p(d, "P"), [2, 4, 0]);
    expect(norm(p(d, "Q"))).toBeCloseTo(2, 7);
  });
  it("keeps the implicit branch near its original seed", () => {
    const d = add(fixture(), "c: x^2=1");
    const c = resolveGeometry(d).curves.get(by(d, "c").id)!;
    const q = pointOnImplicit(c, [0.99, 1]);
    expect(q[0]).toBeCloseTo(1);
    expect(() =>
      pointOnImplicit({ ...c, equation: "x^2=10000" }, [1, 1]),
    ).toThrow(/分支/);
  });
  it("constructs intersections from dependent lines", () => {
    const d = add(
      fixture(),
      "l=Line(A,B)",
      "perp=Perpendicular(l,C)",
      "I=Intersect(l,perp,1)",
    );
    close(p(d, "I"), [1, 0, 0]);
  });
  it("creates selectable real cube faces without tessellation diagonals", () => {
    const d = add(fixture(), "S=Cube()");
    const mesh = resolveGeometry(d).meshes[0],
      faces = meshFaces(mesh);
    expect(faces.length).toBe(6);
    expect(faces.every((f) => f.vertices.length === 4)).toBe(true);
    const plane = planeForHit(d, {
      kind: "face",
      id: faces[0].id,
      owner: mesh.id,
      distance: 0,
      vertices: faces[0].vertices,
    });
    expect(plane.u.every(Number.isFinite)).toBe(true);
  });
  it("links a prism direction to an existing vector", () => {
    let d = add(
      fixture(),
      "p=Polygon(A,B,C)",
      "D=(0,0,3)",
      "vec=Vector(A,D)",
      "S=Prism(p,vec)",
    );
    let r = resolveGeometry(d);
    close(r.meshes[0].vertices[3], [0, 0, 3]);
    d = applyDefinition(d, "D=(1,0,4)", by(d, "D").id);
    r = resolveGeometry(d);
    close(r.meshes[0].vertices[3], [1, 0, 4]);
  });
  it("keeps virtual vertex references in definitions", () => {
    const d = add(fixture(), "S=Cube()", "P=Point(S.vertex(1))");
    expect(resolveReference(d, "S.edge(1)")).toBe(`${by(d, "S").id}:e:0`);
    expect(definition(d, by(d, "P"))).toContain("S.vertex(1)");
  });
});
describe("tools, picking and snapping", () => {
  it("drops the rejected endpoint from a failed preview", () => {
    const points = [pointObject("A", [0,0,0]), pointObject("B", [1,0,0]), pointObject("C", [2,0,0])];
    const state = { ...initialTool("circle3"), staged: points, points: points.map(p => p.id) };
    const corrected = rejectLastPoint(state);
    expect(corrected.points).toEqual(points.slice(0,2).map(p => p.id));
    expect(corrected.staged).toEqual(points.slice(0,2));
    expect(state.staged.length).toBe(3);
  });
  it("rejects midpoint operations on infinite lines", () => {
    const d = add(fixture(), "l=Line(A,B)");
    for (const command of ["Midpoint(l)", "Divide(l,3)", "PerpendicularBisector(l)"])
      expect(() => applyDefinition(d, command)).toThrow(/直线没有端点/);
  });
  it("uses a cancellable preview state until a gesture completes", () => {
    let s = initialTool("triangle");
    s = acceptPoint(s, "A").state;
    expect(acceptPoint(s, "B").ready).toBe(false);
    s = acceptPoint(s, "B").state;
    expect(acceptPoint(s, "C").ready).toBe(true);
    expect(initialTool(s.tool).points).toEqual([]);
  });
  it("closes polygons by clicking the first vertex", () => {
    let s = initialTool("polygon");
    for (const id of ["A", "B", "C"]) s = acceptPoint(s, id).state;
    expect(acceptPoint(s, "A").ready).toBe(true);
    expect(toolStep(s)).toContain("闭合");
  });
  it("rejects premature closure or repeated endpoints", () => {
    const s = acceptPoint(initialTool("segment"), "A").state;
    expect(() => acceptPoint(s, "A")).toThrow();
  });
  it("prioritizes existing points independent of zoom", () => {
    const d = fixture();
    for (const scale of [15, 48, 180]) {
      d.view.scale = scale;
      const q = screenPoint(d, [800, 600], p(d, "A"));
      const s = snapPoint(d, [], [800, 600], [q[0] + 6, q[1]], false, false);
      expect([by(d,"A").id,by(d,"O").id]).toContain(s.existing);
    }
  });
  it("Alt bypasses all snapping", () => {
    const d = fixture(),
      q = screenPoint(d, [800, 600], p(d, "A"));
    expect(snapPoint(d, [], [800, 600], q, true).existing).toBeUndefined();
  });
  it("projects a snapped point to a segment", () => {
    const d = add(fixture(), "s=Segment(A,B)"),
      q = screenPoint(d, [800, 600], [2, 0, 0]);
    const s = snapPoint(d, [], [800, 600], [q[0], q[1] + 3]);
    expect(s.construction?.type).toBe("onPath");
    expect(s.hint).toContain("关联");
  });
  it("prioritizes an intersection over a nearby path", () => {
    const d = add(fixture(), "l=Line(A,B)", "m=Line(C,A)"),
      q = screenPoint(d, [800, 600], [0, 0, 0]);
    expect([by(d,"A").id,by(d,"O").id]).toContain(snapPoint(d, [], [800, 600], q).existing);
    const c = add(d, "c: x=2");
    const q2 = screenPoint(c, [800, 600], [2, 0, 0]),
      curve = resolveGeometry(c).curves.get(by(c, "c").id)!;
    expect(
      snapPoint(c, [sampleCurve(curve)], [800, 600], q2).construction?.type,
    ).toBe("intersection");
  });
  it("returns overlapping candidates rather than an arbitrary choice", () => {
    const d = add(fixture(), "s=Segment(A,B)", "l=Line(A,B)");
    expect(
      hitTest(d, [], [800, 600], screenPoint(d, [800, 600], [2, 0, 0])).filter(
        (h) => h.kind === "edge" && !h.id.startsWith("@axis:"),
      ).length,
    ).toBe(2);
  });
  it("box selects fully enclosed objects", () => {
    const d = add(fixture(), "s=Segment(A,B)");
    expect(selectRectangle(d, [800, 600], [390, 590], [610, 290])).toContain(
      by(d, "s").id,
    );
  });
  it("maps canvas coordinates into the active plane", () => {
    const d = fixture();
    d.planes[0].origin = [0, 0, 5];
    close(canvasPoint(d, [800, 600], [448, 252]), [1, 1, 5]);
  });
  it("does not snap to a different depth plane", () => {
    const d = fixture();
    d.objects = [{ ...pointObject("D", [0, 0, 3]), symbol: "D" }];
    invalidateGeometry(d);
    const q = screenPoint(d, [800, 600], [0, 0, 3]);
    expect(snapPoint(d, [], [800, 600], q).existing).toBeUndefined();
  });
  it("clamps points on segments while preserving infinite lines", () => {
    const d = add(fixture(), "s=Segment(A,B)", "l=Line(A,B)");
    const a = pointOnPath(d, by(d, "s").id, [8, 0, 0]),
      b = pointOnPath(d, by(d, "l").id, [8, 0, 0]);
    expect(a.type === "onPath" && a.parameter).toBe(1);
    expect(b.type === "onPath" && b.parameter).toBe(2);
  });
  it("restores all constructions through JSON", () => {
    const d = add(
      fixture(),
      "s=Segment(A,B)",
      "P=On(s,.4)",
      "l=Perpendicular(s,C)",
      "c=Circle(A,B)",
    );
    expect(validateDrawing(JSON.parse(JSON.stringify(d))).objects.length).toBe(
      d.objects.length,
    );
  });
});
