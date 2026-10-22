import { describe, expect, it } from "vitest";
import { newDrawing, type Vec3 } from "./types";
import { add, cross, mul, unit, viewRay, type Mesh } from "./geometry";
import { solidObject } from "./model";
import { axisId } from "./axes";
import { exportSvg, isOccluded, sceneFor, splitVisibilityExact } from "./scene";

const spatial = () => {
  const d = newDrawing(); d.dimension = "3d"; d.view.mode = "space";
  return d;
};
const wall = (x0: number, x1: number, z = 1): Mesh => ({
  id: "wall", vertices: [[x0,-1,z],[x1,-1,z],[x1,1,z],[x0,1,z]],
  faces: [[0,1,2],[0,2,3]], edges: [], round: false,
});

describe("exact axis occlusion intervals", () => {
  it("detects a narrow occluder between sample positions and merges its triangles", () => {
    const spans = splitVisibilityExact([0,0,0],[100,0,0],[0,0,1],[wall(3,3.01)]);
    expect(spans.map(s => s.hidden)).toEqual([false,true,false]);
    expect(spans[1].a[0]).toBeCloseTo(3,6);
    expect(spans[1].b[0]).toBeCloseTo(3.01,6);
    expect(spans.at(-1)!.b).toEqual([100,0,0]);
  });
  it("unions overlapping occluders and preserves disjoint hidden intervals", () => {
    const spans = splitVisibilityExact([0,0,0],[10,0,0],[0,0,1],
      [wall(1,3),wall(2,4),wall(6,7)]);
    expect(spans.map(s => s.hidden)).toEqual([false,true,false,true,false]);
    expect(spans[1].a[0]).toBeCloseTo(1,6);
    expect(spans[1].b[0]).toBeCloseTo(4,6);
  });
  it("does not hide coplanar lines, behind-viewer faces or edge-on faces", () => {
    for (const z of [-1,0])
      expect(splitVisibilityExact([0,0,0],[10,0,0],[0,0,1],[wall(1,3,z)])
        .map(s => s.hidden)).toEqual([false]);
    expect(splitVisibilityExact([0,0,0],[10,0,0],[0,1,0],[wall(1,3)])
      .map(s => s.hidden)).toEqual([false]);
  });
  it("handles an axis crossing a face in depth", () => {
    const mesh = wall(-10,10);
    const spans = splitVisibilityExact([0,0,0],[2,0,2],[0,0,1],[mesh]);
    expect(spans.map(s => s.hidden)).toEqual([true,false]);
    expect(spans[0].b[2]).toBeCloseTo(1,5);
    for (const s of spans) {
      const middle = mul(add(s.a,s.b),.5);
      expect(isOccluded(middle,[0,0,1],[mesh])).toBe(s.hidden);
    }
  });
});

describe("coordinate axes share scene occlusion and style handling", () => {
  for (const projection of ["orthographic","oblique"] as const)
    for (const manual of [false,true])
      it(`${projection}, ${manual ? "manual" : "default"} frame at different rotations`, () => {
        for (const angle of [-135,-40,0,80,170]) {
          const d = spatial(); d.view.projection = projection; d.view.angle = angle;
          if (manual) d.coordinateFrame = {
            origin: [1,-.5,.3], x: unit([1,2,1]), y: unit([-2,1,0]), zSign: 1,
          };
          const origin: Vec3 = d.coordinateFrame?.origin ?? [0,0,0];
          const directions: Vec3[] = d.coordinateFrame
            ? [d.coordinateFrame.x,d.coordinateFrame.y,cross(d.coordinateFrame.x,d.coordinateFrame.y)]
            : [[1,0,0],[0,1,0],[0,0,1]];
          // A small cube directly between a point on each axis and the viewer.
          const ray = viewRay(d);
          directions.forEach((direction,i) => {
            const cube = solidObject("cube"); cube.id = `blocker${i}`; cube.width = .12;
            cube.origin = add(add(origin,mul(direction,1.1)),mul(ray,.5));
            cube.origin[2] -= .06;
            d.objects.push(cube);
          });
          const scene = sceneFor(d,[],[1000,700]);
          for (const axis of ["x","y","z"] as const) {
            const paths = scene.paths.filter(p => p.id === axisId(axis));
            expect(paths.some(p => p.dashed)).toBe(true);
            expect(paths.some(p => !p.dashed)).toBe(true);
            expect(paths.filter(p => p.arrow)).toHaveLength(1);
            expect(paths.at(-1)!.arrow).toBe(true);
          }
          expect(exportSvg(scene,d,[1000,700])).toContain('stroke-dasharray="5 4"');
        }
      });
  it("honors explicit axis styles, hidden blockers and 2d solid axes", () => {
    const d = spatial(), cube = solidObject("cube"); d.objects.push(cube);
    for (const mode of ["solid","dashed","hidden"] as const) {
      d.edgeStyles[axisId("x")] = mode;
      const paths = sceneFor(d,[]).paths.filter(p => p.id === axisId("x"));
      if (mode === "hidden") expect(paths).toHaveLength(0);
      else { expect(paths).toHaveLength(1); expect(paths[0].dashed).toBe(mode === "dashed"); }
    }
    delete d.edgeStyles[axisId("x")]; cube.hidden = true;
    expect(sceneFor(d,[]).paths.filter(p => p.id.startsWith("@axis:")).every(p => !p.dashed)).toBe(true);
    const planar = newDrawing();
    expect(sceneFor(planar,[]).paths.filter(p => p.id.startsWith("@axis:")).every(p => !p.dashed)).toBe(true);
  });
});
