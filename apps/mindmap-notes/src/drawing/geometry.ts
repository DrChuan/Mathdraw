import { conicFeatureEquation,conicVertices } from './conics';
import { reframeCurve,reflectedCurve, tangentCandidates, withinDerivedCurve, pointConstrainedToCurve } from "./advanced";
import { angleMark, defaultAngleRadius } from "./angleMark";
import { exactLocus, cartesianLocus,locusDocument,naturalLocusParameter } from "./locus";
import {
  circumsphere,
  insphere,
  polygonGeometry,
  coordinateOnCurve,
  curveFunction,
  implicitIntersections,
  roots,
} from "./constructions";
import {
  defaultStyle,
  type DrawingDocument,
  type DrawingPoint,
  type DrawingCurve,
  type DrawingSegment,
  type DrawingSolid,
  type GeometryObject,
  type Vec2,
  type Vec3,
  type WorkPlane,
  type DrawingPlaneSource,
} from "./types";
import { sourcePlane,relationDirection,planeDependencies,simplestNormal,sectionLoops,type PlaneGeometry } from "./spatial";
import { rotateAboutAxis } from "./fold";
import { pointOnImplicit } from "./pathProjection";
import { equation, evaluate, parseExpression, isLineEquation } from "./expression";
import { materializeNumbers, parameterFieldAllowed, replaceCoordinates } from "./parameters";
import { axisId, axisReference } from "./axes";
import { pointAt, parameterCrossings, withinCurve, nearestParameter } from "./parametric";
import { conicFoci, circleCenter, conicCoefficients } from "./conics";
import { conicIntersections, type Quadratic } from "./quadratic";
import { constraintPoint, solutionMesh, validateSolutionSet, validPose,constraintHidden,constraintPointName } from "./constraints/document";
import { roundGeometry,curveGeometry } from "./constraints/measures";
import { shellTopology } from "./polyhedra";
import { local as inPose, world as fromPose } from "./constraints/math";
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const mul = (a: Vec3, t: number): Vec3 => [a[0] * t, a[1] * t, a[2] * t];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3) => Math.hypot(...a);
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  if (n < 1e-10) throw new Error("方向向量不能为零");
  return mul(a, 1 / n);
}
export const lerp = (a: Vec3, b: Vec3, t: number) => add(a, mul(sub(b, a), t));
export const fromPlane = (plane: WorkPlane, u: number, v: number) =>
  add(plane.origin, add(mul(plane.u, u), mul(plane.v, v)));
export const toPlane = (plane: WorkPlane, p: Vec3): Vec2 => [
  dot(sub(p, plane.origin), plane.u),
  dot(sub(p, plane.origin), plane.v),
];
export function coordinateAxis(doc: DrawingDocument, axis: "x" | "y" | "z", planeId?: string) {
  if (planeId) {
    const plane = doc.planes.find(p => p.id === planeId);
    if (!plane) throw new Error("坐标轴所在平面不存在");
    return { origin: plane.origin, direction: axis === "x" ? plane.u : axis === "y" ? plane.v : unit(cross(plane.u,plane.v)) };
  }
  const f = doc.coordinateFrame;
  return { origin: f?.origin ?? [0,0,0] as Vec3,
    direction: f ? axis === "x" ? f.x : axis === "y" ? f.y : mul(cross(f.x,f.y),f.zSign)
      : axis === "x" ? [1,0,0] as Vec3 : axis === "y" ? [0,1,0] as Vec3 : [0,0,1] as Vec3 };
}
export function planeFromPoints(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  name: string,
): WorkPlane {
  const u = unit(sub(b, a)),
    n = unit(cross(u, sub(c, a)));
  return { id: crypto.randomUUID(), name, origin: a, u, v: unit(cross(n, u)) };
}
export function planeFromEquation(
  a: number,
  b: number,
  c: number,
  d: number,
): WorkPlane {
  const n = unit([a, b, c]),
    origin = mul(n, -d / Math.hypot(a, b, c));
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(sub(ref, mul(n, dot(ref, n))));
  return {
    id: crypto.randomUUID(),
    name: `${a}x + ${b}y + ${c}z + ${d} = 0`,
    origin,
    u,
    v: unit(cross(n, u)),
  };
}
/** Build the default right-handed frame from the selected x direction and y half-plane. */
export function frameFromDirections(
  origin:Vec3, xPoint:Vec3, yPoint:Vec3, plane:WorkPlane,
):NonNullable<DrawingDocument["coordinateFrame"]> {
  const normal=unit(cross(plane.u,plane.v));
  if(Math.abs(dot(sub(origin,plane.origin),normal))>1e-6 ||
    Math.abs(dot(sub(xPoint,plane.origin),normal))>1e-6)
    throw new Error("原点和 x 轴方向必须位于所选面所在的平面内");
  if(norm(sub(xPoint,origin))<1e-9)throw new Error("x 轴方向点不能与原点重合");
  const x=unit(sub(xPoint,origin)),offset=sub(yPoint,origin);
  if(Math.abs(dot(sub(yPoint,plane.origin),normal))>1e-6)
    throw new Error("y 方向点必须位于所选 xOy 平面内");
  const perpendicular=sub(offset,mul(x,dot(offset,x)));
  if(norm(perpendicular)<1e-7)
    throw new Error("请选择 x 轴一侧来确定 y 正方向，不能选在 x 轴上");
  return {origin,x,y:unit(perpendicular),zSign:1};
}
export function rotate(p: Vec3, angles: Vec3): Vec3 {
  let [x, y, z] = p;
  const [a, b, c] = angles.map((v) => (v * Math.PI) / 180);
  [y, z] = [
    y * Math.cos(a) - z * Math.sin(a),
    y * Math.sin(a) + z * Math.cos(a),
  ];
  [x, z] = [
    x * Math.cos(b) + z * Math.sin(b),
    -x * Math.sin(b) + z * Math.cos(b),
  ];
  return [
    x * Math.cos(c) - y * Math.sin(c),
    x * Math.sin(c) + y * Math.cos(c),
    z,
  ];
}
export function project(p: Vec3, doc: DrawingDocument): Vec2 {
  if (doc.view.mode === "plane") {
    const uv = toPlane(doc.planes.find((p) => p.id === doc.view.planeId)!, p);
    return [uv[0], -uv[1]];
  }
  const [x, y, z] = rotate(doc.view.camera ? inPose(p,doc.view.camera) : p, [0, 0, doc.view.angle]),
    a = Math.SQRT2 / 4;
  const pitch = (doc.view.pitch ?? 0) * Math.PI / 180;
  if (doc.view.projection === "orthographic") {
    if (!pitch) return [(y - x) / Math.SQRT2, (x + y) / Math.sqrt(6) - z * Math.sqrt(2 / 3)];
    // Orbit around screen-right, retaining the original isometric elevation at 0.
    const elevation = Math.atan(1 / Math.SQRT2) + pitch;
    return [(y - x) / Math.SQRT2, (x + y) / Math.SQRT2 * Math.sin(elevation) - z * Math.cos(elevation)];
  }
  const depth = y * Math.cos(pitch) - z * Math.sin(pitch),
    height = y * Math.sin(pitch) + z * Math.cos(pitch);
  return [x + a * depth, -height - a * depth];
}
export function viewRay(doc: DrawingDocument): Vec3 {
  if (doc.view.mode === "plane") {
    const plane = doc.planes.find((p) => p.id === doc.view.planeId)!;
    return unit(cross(plane.u, plane.v));
  }
  const pitch = doc.view.pitch ?? 0,
    elevation = Math.atan(1 / Math.SQRT2) + pitch * Math.PI / 180;
  const ray: Vec3 = doc.view.projection === "orthographic"
    ? pitch ? [Math.cos(elevation) / Math.SQRT2, Math.cos(elevation) / Math.SQRT2, Math.sin(elevation)] : [1, 1, 1]
    : rotate([Math.SQRT2 / 4, -1, Math.SQRT2 / 4], [-pitch, 0, 0]);
  const direction = rotate(ray, [0, 0, -doc.view.angle]);
  return unit(doc.view.camera ? sub(fromPose(direction,doc.view.camera),doc.view.camera.origin) : direction);
}
/** Invert the projection on a parallel workplane through the original point. */
export function unprojectOnPlane(
  screen: Vec2,
  original: Vec3,
  doc: DrawingDocument,
): Vec3 {
  const plane = doc.planes.find((p) => p.id === doc.view.planeId)!,
    p = project(original, doc),
    a = project(add(original, plane.u), doc),
    b = project(add(original, plane.v), doc);
  const ux = a[0] - p[0],
    uy = a[1] - p[1],
    vx = b[0] - p[0],
    vy = b[1] - p[1],
    det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-8)
    throw new Error("当前工作平面在此视角下接近侧面，请切到正视平面后拖动");
  const dx = screen[0] - p[0],
    dy = screen[1] - p[1];
  return add(
    original,
    add(
      mul(plane.u, (dx * vy - dy * vx) / det),
      mul(plane.v, (ux * dy - uy * dx) / det),
    ),
  );
}
export function triangleCenter(a: Vec3, b: Vec3, c: Vec3, type: string): Vec3 {
  const u = sub(b, a),
    v = sub(c, a),
    n = cross(u, v),
    n2 = dot(n, n),
    scale = Math.max(norm(u), norm(v), norm(sub(c, b)), 1e-8);
  if (n2 < 1e-16 * scale ** 4)
    throw new Error("三点共线或重合，三角形中心暂时失效");
  if (type === "centroid") return mul(add(add(a, b), c), 1 / 3);
  if (type === "incenter") {
    const ab = norm(sub(a, b)),
      bc = norm(sub(b, c)),
      ca = norm(sub(c, a));
    return mul(
      add(add(mul(a, bc), mul(b, ca)), mul(c, ab)),
      1 / (ab + bc + ca),
    );
  }
  const circum = add(
    a,
    mul(
      add(mul(cross(v, n), dot(u, u)), mul(cross(n, u), dot(v, v))),
      1 / (2 * n2),
    ),
  );
  return type === "circumcenter"
    ? circum
    : sub(add(add(a, b), c), mul(circum, 2));
}
export interface Mesh {
  id: string;
  vertices: Vec3[];
  faces: [number, number, number][];
  edges: [number, number][];
  round: boolean;
  solid?: DrawingSolid;
  vertexIds?: string[];
  loops?: number[][];
}
export function solidMesh(s: DrawingSolid): Mesh {
  let vertices: Vec3[] = [],
    polygons: number[][] = [],
    edges: [number, number][] = [];
  const round = ["cylinder", "cone", "coneFrustum", "sphere"].includes(s.shape),
    n = round ? 40 : s.sides;
  if (s.shape === "cube" || s.shape === "cuboid") {
    const w = s.width / 2,
      d = (s.shape === "cube" ? s.width : s.depth) / 2,
      h = s.shape === "cube" ? s.width : s.height;
    vertices = [
      [-w, -d, 0],
      [w, -d, 0],
      [w, d, 0],
      [-w, d, 0],
      [-w, -d, h],
      [w, -d, h],
      [w, d, h],
      [-w, d, h],
    ];
    polygons = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
  } else if (s.shape === "sphere") {
    const rows = 20;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i < n; i++) {
        const lat = -Math.PI / 2 + (j * Math.PI) / rows,
          t = (i * 2 * Math.PI) / n;
        vertices.push([
          s.radius * Math.cos(lat) * Math.cos(t),
          s.radius * Math.cos(lat) * Math.sin(t),
          s.radius * Math.sin(lat),
        ]);
      }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i,
          l = j * n + ((i + 1) % n);
        polygons.push([k, l, l + n, k + n]);
      }
    // A conventional equator; the silhouette is generated from surface adjacency below.
    for (let i = 0; i < n; i++)
      edges.push([(rows / 2) * n + i, (rows / 2) * n + ((i + 1) % n)]);
  } else {
    const top =
      s.shape === "pyramid" || s.shape === "cone"
        ? 0
        : s.shape === "frustum" || s.shape === "coneFrustum"
          ? s.topRadius
          : s.radius;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n,
          r = j ? top : s.radius;
        vertices.push([r * Math.cos(t), r * Math.sin(t), j * s.height]);
      }
    polygons.push(
      Array.from({ length: n }, (_, i) => n - 1 - i),
      Array.from({ length: n }, (_, i) => n + i),
    );
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      polygons.push([i, k, n + k, n + i]);
      edges.push([i, k]);
      if (top > 0) edges.push([n + i, n + k]);
      if (!round) edges.push([i, n + i]);
    }
  }
  vertices = vertices.map((p) => {
    const q=rotate(p,s.rotation);
    return add(s.basis ? add(mul(s.basis[0],q[0]),add(mul(s.basis[1],q[1]),mul(s.basis[2],q[2]))) : q,s.origin);
  });
  const faces: [number, number, number][] = [];
  // Weld coincident poles/apices for surface adjacency, while retaining stable
  // public vertex indices used by point constructions.
  const canonical = new Map<string, number>();
  const index = vertices.map((p, i) => {
    const key = p.map((n) => n.toFixed(8)).join(",");
    const known = canonical.get(key);
    if (known !== undefined) return known;
    canonical.set(key, i);
    return i;
  });
  for (const p of polygons)
    for (let i = 1; i < p.length - 1; i++)
      if (
        norm(
          cross(
            sub(vertices[p[i]], vertices[p[0]]),
            sub(vertices[p[i + 1]], vertices[p[0]]),
          ),
        ) > 1e-10
      )
        faces.push([index[p[0]], index[p[i]], index[p[i + 1]]]);
  return { id: s.id, vertices, faces, edges, round, solid: s };
}
export interface ResolvedPoint {
  id: string;
  name: string;
  p: Vec3;
  owner: string;
  object?: DrawingPoint;
}
export interface GeometryEdge {
  id: string;
  owner: string;
  a: string;
  b: string;
  vector: boolean;
}
const resolvedCache = new WeakMap<DrawingDocument, ReturnType<typeof computeGeometry>>();
export function invalidateGeometry(doc: DrawingDocument) { resolvedCache.delete(doc); }
/** Documents are immutable during interaction; share one dependency/incidence pass per revision. */
export function resolveGeometry(doc: DrawingDocument) {
  let result = resolvedCache.get(doc);
  if (!result) { result = computeGeometry(doc); resolvedCache.set(doc,result); }
  return result;
}
function computeGeometry(doc: DrawingDocument) {
  const numeric = materializeNumbers(doc,id=>resolve(id).p);
  const objects = numeric.objects,
    points = new Map<string, ResolvedPoint>(),
    errors = numeric.errors,
    meshes: Mesh[] = [],
    visiting = new Set<string>();
  for (const planeId of [undefined,...doc.planes.map(p=>p.id)]) for (const axis of ["x","y","z"] as const) {
    const id=axisId(axis,planeId), a=coordinateAxis(doc,axis,planeId), b=add(a.origin,a.direction);
    const hidden=!doc.view.axes || (doc.view.mode === "plane" ? planeId!==doc.view.planeId || axis === "z" : planeId!==undefined);
    objects.set(id,{id,kind:"line",name:`${axis} 轴`,symbol:`${axis}Axis`,points:[`${id}:v:0`,`${id}:v:1`],style:defaultStyle(),hidden});
    [a.origin,b].forEach((p,i)=>points.set(`${id}:v:${i}`,{id:`${id}:v:${i}`,name:`${axis} 轴方向`,p,owner:id}));
  }
  const meshMap = new Map<string, Mesh>();
  const resolvingMeshes = new Set<string>();
  const intersectionCache = new Map<string, Vec3[]>();
  const intersectionErrors = new Map<string, Error>();
  const curves = new Map<string, DrawingCurve>();
  const tangents = new Map<string, ReturnType<typeof tangentCandidates>>();
  const visitingCurves = new Set<string>(),
    visitingLines = new Set<string>();
  const getCurve = (id: string): DrawingCurve => {
    if (errors.has(id)) throw new Error(errors.get(id));
    if (curves.has(id)) return curves.get(id)!;
    const source = numeric.get(id);
    if (source?.kind !== "curve") throw new Error("引用的曲线不存在");
    if (visitingCurves.has(id)) throw new Error("曲线构造循环");
    visitingCurves.add(id);
    try {
      let result = source;
      if(source.declaration) {
        const set=objects.get(source.constraintSet!);if(set?.kind!=="solutionSet")throw new Error("声明曲线所属的条件解集不存在");
        const curve=set.problem.curves?.find(c=>c.id===source.declaration!.id);if(!curve)throw new Error("声明曲线不存在");
        const p=Object.fromEntries([...new Set([...curve.points,...(curve.plane??[])])].map(n=>{
          const point=doc.objects.find(o=>o.kind==="point"&&o.constraintSet===set.id&&o.constraintPointName===n);
          return [n,point?resolve(point.id).p:constraintPoint(set,n)];
        }));
        curveGeometry(curve,p);
      }
      if(source.parametric && source.parametric.tMin>=source.parametric.tMax) throw new Error("参数起点必须小于终点");
      if (source.circle) {
        const c = source.circle,
          ps = c.points.map((id) => resolve(id).p),
          working = doc.planes.find((p) => p.id === source.planeId)!;
        const plane=doc.dimension==='3d'?(c.type==='threePoint'||c.type==='incircle'?{...planeFromPoints(ps[0],ps[1],ps[2],source.id),id:source.planeId}:{...working,origin:ps[0]}):working;
        if (
          ps.some(
            (p) =>
              Math.abs(dot(sub(p, plane.origin), cross(plane.u, plane.v))) >
              1e-6,
          )
        )
          throw new Error("圆的构造点不在同一工作平面内");
        const center =
          (c.type === "threePoint" || c.type === "incircle")
            ? triangleCenter(ps[0], ps[1], ps[2], c.type === "incircle" ? "incenter" : "circumcenter")
            : ps[0];
        const radius =
          c.type === "incircle"
            ? norm(cross(sub(center,ps[0]),sub(ps[1],ps[0]))) / norm(sub(ps[1],ps[0]))
            : c.type === "centerRadius"
            ? c.radius!
            : norm(sub(c.type === "threePoint" ? ps[0] : ps[1], center));
        if (radius < 1e-9) throw new Error("半径为零，圆暂时失效");
        const [x, y] = toPlane(plane, center);
        result = {
          ...source,...(doc.dimension==="3d"?{frame:plane}:{}),
          equation: `(x-(${x}))^2+(y-(${y}))^2=(${radius})^2`,
        };
      }
      if(source.derived) {
        const c=source.derived,plane=doc.planes.find(p=>p.id===source.planeId)!;
        if(c.type === "conicFeature") {const original=getCurve(c.curve);result={...source,planeId:original.planeId,frame:original.frame,equation:conicFeatureEquation(original.equation,c.feature,c.index)};}
        else if(c.type === "reflection") {
          const ref=straightReference(c.axis); if(!ref.a||!ref.b) throw new Error("对称轴必须是直线或边");
          const original=getCurve(c.source),frame=original.frame??doc.planes.find(p=>p.id===original.planeId)!;
          if(doc.dimension==='3d') {
            const d=sub(ref.b,ref.a),reflect=(p:Vec3)=>sub(mul(add(ref.a,mul(d,dot(sub(p,ref.a),d)/dot(d,d))),2),p),origin=reflect(frame.origin);
            result={...source,equation:original.equation,parametric:original.parametric,frame:{...frame,origin,u:sub(reflect(add(frame.origin,frame.u)),origin),v:sub(reflect(add(frame.origin,frame.v)),origin)}};
          } else result={...source,...reflectedCurve(original,toPlane(frame,ref.a),toPlane(frame,ref.b)),reflectionInput:{source:original,a:toPlane(frame,ref.a),b:toPlane(frame,ref.b)}};
        } else if(c.type === "tangent") {
          const curve=getCurve(c.curve),p=resolve(c.point).p,curvePlane=curve.frame??plane;
          if(Math.abs(dot(sub(p,curvePlane.origin),unit(cross(curvePlane.u,curvePlane.v))))>1e-7)throw new Error("点与曲线必须在同一工作平面");
          const key=`${c.curve}:${c.point}`;
          let candidates=tangents.get(key);if(!candidates){candidates=tangentCandidates(curve,toPlane(curvePlane,p),pointConstrainedToCurve(doc,c.point,c.curve));tangents.set(key,candidates);}
          const uv=toPlane(curvePlane,p);
          // At tangency the two real branches merge into the same line.
          const merged=c.branch===1 && candidates.length===1 &&
            Math.hypot(candidates[0].point[0]-uv[0],candidates[0].point[1]-uv[1])<1e-7;
          const candidate=candidates[c.branch] ?? (merged ? candidates[0] : undefined);
          if(!candidate)throw new Error("该位置没有对应的实切线");
          const {point:q,direction:d}=candidate;
          result={...source,frame:curvePlane,equation:`(${d[1]})*(x-(${q[0]}))-(${d[0]})*(y-(${q[1]}))=0`};
        } else {
          const base=locusDocument(doc,c.driver,c.follower);
          const exact=exactLocus(base,c.driver,c.follower,source.planeId);
          const natural=exact&&c.natural?naturalLocusParameter(base,c.driver,exact):undefined,xy=natural?.xy??exact;
          result=xy ? {...source,parametric:{x:xy[0],y:xy[1],tMin:natural?.min??c.min,tMax:natural?.max??c.max},resolvedDefinition:cartesianLocus(exact!) ?? `x(t)=${xy[0]}, y(t)=${xy[1]}`,
            ...(natural?{locusRangeDescription:"主动点的完整自然范围（无界参数已重新参数化）；方程包含极限位置，原构造失效的孤立位置不作为有效构造点。"}:{})} :
            {...source,locusInput:{document:base,...c},resolvedDefinition:"数值轨迹（未确定精确方程）"};
        }
      }
      objects.set(id,result);
      curves.set(id, result);
      return result;
    } finally {
      visitingCurves.delete(id);
    }
  };
  const lineEnds = (obj: DrawingSegment): [Vec3, Vec3] => {
    if (!obj.relation)
      return [resolve(obj.points[0]).p, resolve(obj.points[1]).p];
    if (visitingLines.has(obj.id)) throw new Error("直线构造循环");
    visitingLines.add(obj.id);
    try {
      const c=obj.relation,plane=doc.planes.find(p=>p.id===c.planeId)!;
      const ref=c.type==='bisector'?{a:resolve(obj.points[0]).p,b:resolve(obj.points[1]).p}:c.plane?undefined:straightReference(c.reference!);
      const a=c.type==='bisector'?lerp(ref!.a,ref!.b,.5):resolve(obj.points[0]).p;
      const direction=relationDirection(c.type,a,ref,c.plane?getPlane(c.plane):undefined,plane,doc.dimension==='3d');
      return [a, add(a, unit(direction))];
    } finally {
      visitingLines.delete(obj.id);
    }
  };

  const getMesh = (id: string): Mesh => {
    if (errors.has(id)) throw new Error(errors.get(id));
    const cached = meshMap.get(id);
    if (cached) return cached;
    if (resolvingMeshes.has(id)) throw new Error("构造依赖存在循环");
    const obj = numeric.get(id);
    if(obj?.kind==="polygon"&&obj.section) {
      resolvingMeshes.add(id);
      try {
        const loops=sectionLoops(getMesh(obj.section.solid),getPlane(obj.section.plane)),vertices:Vec3[]=[],faces:[number,number,number][]=[],edges:[number,number][]=[],boundaries:number[][]=[];
        for(const loop of loops) {
          const offset=vertices.length;vertices.push(...loop);
          boundaries.push(loop.map((_,i)=>i+offset));
          faces.push(...polygonGeometry(loop).triangles.map(t=>t.map(i=>i+offset) as [number,number,number]));
          loop.forEach((_,i)=>edges.push([offset+i,offset+(i+1)%loop.length]));
        }
        const mesh:Mesh={id,vertices,faces,edges,loops:boundaries,round:false};meshMap.set(id,mesh);meshes.push(mesh);
        const ids=vertices.map((p,i)=>{const key=`${id}:v:${i}`;points.set(key,{id:key,name:`${obj.name}_${i+1}`,p,owner:id});return key;});
        objects.set(id,{...obj,points:ids});return mesh;
      } finally {resolvingMeshes.delete(id);}
    }
    if(obj?.kind === "solutionSet") {
      const mesh=doc.objects.some(o=>o.constraintSet===id&&o.constraintFace)
        ? {id,vertices:obj.problem.points.map(n=>constraintPoint(obj,n)),faces:[] as [number,number,number][],edges:[] as [number,number][],round:false}
        : solutionMesh(obj);
      meshMap.set(id,mesh);meshes.push(mesh);
      mesh.vertices.forEach((p,i)=>points.set(`${id}:v:${i}`,{id:`${id}:v:${i}`,name:obj.problem.points[i],p,owner:id}));
      return mesh;
    }
    if (obj?.kind !== "solid") throw new Error("引用的几何体不存在");
    resolvingMeshes.add(id);
    try {
      const c = obj.construction;
      let mesh: Mesh;
      if (!c) mesh = solidMesh(obj);
      else if(c.type === "roundPoints") {
        if(!["cylinder","cone","coneFrustum","sphere"].includes(obj.shape))throw new Error("按点定义的曲面几何体类型无效");
        mesh=solidMesh({...obj,...roundGeometry(obj.shape as "cylinder"|"cone"|"coneFrustum"|"sphere",c.points.map(id=>resolve(id).p)),rotation:[0,0,0]});
      }
      else if(c.type === "faces") {
        const polygons=c.faces.map(face=>{
          const f=objects.get(face);if(!f||(f.kind!=="polygon"&&f.kind!=="triangle"))throw new Error("多面体引用的面不存在");return f;
        }),topology=shellTopology(polygons);
        if(!topology.closed)throw new Error("这些面尚未组成闭合多面体");
        const vertexIds=topology.vertices,vertices=vertexIds.map(id=>resolve(id).p),index=new Map(vertexIds.map((id,i)=>[id,i])),faces:[number,number,number][]=[];
        for(const polygon of polygons) {
          const {triangles}=polygonGeometry(polygon.points.map(id=>resolve(id).p));
          faces.push(...triangles.map(t=>t.map(i=>index.get(polygon.points[i])!) as [number,number,number]));
        }
        const origin=vertices[0],volume=faces.reduce((s,[a,b,c])=>s+Math.abs(dot(sub(vertices[a],origin),cross(sub(vertices[b],origin),sub(vertices[c],origin)))),0);
        const extent=Math.max(...vertices.map(p=>norm(sub(p,origin))));
        if(volume<=1e-9*extent**3)throw new Error("多面体退化，所有顶点共面");
        mesh={id,vertices,vertexIds,faces,edges:topology.edges,round:false};
      }
      else if (c.type === "extrusion" || c.type === "apex") {
        const base = objects.get(c.base);
        if (base?.kind !== "polygon" && base?.kind !== "triangle")
          throw new Error("请选择底面多边形");
        const vertices = base.points.map((id) => resolve(id).p),
          { triangles, normal } = polygonGeometry(vertices),
          n = vertices.length;
        const extrusion =
          c.type === "extrusion" && c.vector ? reference(c.vector) : undefined;
        const direction =
          c.type === "extrusion"
            ? extrusion?.a && extrusion.b
              ? sub(extrusion.b, extrusion.a)
              : c.direction
            : sub(resolve(c.apex).p, vertices[0]);
        if (Math.abs(dot(normal, direction)) < 1e-8)
          throw new Error("侧棱方向或顶点不能在底面平面内");
        const top =
          c.type === "extrusion"
            ? vertices.map((p) => add(p, direction))
            : [resolve(c.apex).p];
        const faces: [number, number, number][] = [...triangles];
        const edges: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          edges.push([i, j], [i, c.type === "extrusion" ? n + i : n]);
          if (c.type === "extrusion") {
            edges.push([n + i, n + j]);
            faces.push([i, j, n + j], [i, n + j, n + i]);
          } else faces.push([i, j, n]);
        }
        if (c.type === "extrusion")
          faces.push(
            ...triangles.map(
              (t) => t.map((i) => i + n) as [number, number, number],
            ),
          );
        mesh = {
          id,
          vertices: [...vertices, ...top],
          faces,
          edges,
          round: false,
        };
      } else {
        const sphere =
          c.type === "circumsphere"
            ? circumsphere(
                c.source
                  ? getMesh(c.source).vertices
                  : c.vertices.map((id) => resolve(id).p),
              )
            : (() => {
                const m = getMesh(c.source);
                if (m.round) throw new Error("请选择多面体");
                return insphere(m.vertices, m.faces);
              })();
        mesh = solidMesh({
          ...obj,
          shape: "sphere",
          origin: sphere.center,
          radius: sphere.radius,
          rotation: [0, 0, 0],
        });
      }
      if (
        mesh.vertices.some((p) =>
          p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9),
        )
      )
        throw new Error("构造结果超出有效坐标范围");
      meshMap.set(id, mesh);
      meshes.push(mesh);
      mesh.vertices.forEach((p, i) =>
        points.set(`${id}:v:${i}`, {
          id: `${id}:v:${i}`,
          name: `${obj.name}_${i + 1}`,
          p,
          owner: id,
        }),
      );
      return mesh;
    } finally {
      resolvingMeshes.delete(id);
    }
  };
  const reference = (id: string) => {
    const obj = numeric.get(id);
    if (obj?.kind === "curve") return { obj: getCurve(id) };
    if (
      obj?.kind === "segment" ||
      obj?.kind === "vector" ||
      obj?.kind === "line"
    ) {
      const [a, b] = lineEnds(obj);
      return { obj, a, b };
    }
    const m = id.match(/^([^:]+):e:(\d+)$/),
      owner = m ? objects.get(m[1]) : undefined;
    if (m && owner) {
      const index = Number(m[2]);
      if (owner.kind === "solid") {
        const mesh = getMesh(owner.id),
          edge = mesh.edges[index];
        if (edge)
          return {
            obj: owner,
            a: mesh.vertices[edge[0]],
            b: mesh.vertices[edge[1]],
          };
      }
      if (owner.kind === "triangle" || owner.kind === "polygon") {
        if(owner.kind==="polygon"&&owner.section) {
          const mesh=getMesh(owner.id),edge=mesh.edges[index];if(edge)return {obj:owner,a:mesh.vertices[edge[0]],b:mesh.vertices[edge[1]]};
          throw new Error("截面的这条边暂时不存在");
        }
        if (index < owner.points.length)
          return {
            obj: owner,
            a: resolve(owner.points[index]).p,
            b: resolve(owner.points[(index + 1) % owner.points.length]).p,
          };
      }
    }
    throw new Error("请选择两条直线、线段、向量或曲线");
  };
  const straightReference = (id:string):{a:Vec3;b:Vec3} => {
    const ref=reference(id);
    if(ref.a&&ref.b)return {a:ref.a,b:ref.b};
    if(ref.obj.kind!=="curve"||ref.obj.parametric||!isLineEquation(ref.obj.equation))throw new Error("参考对象必须为直线、坐标轴或直边");
    const f=curveFunction(ref.obj),c=f(0,0),x=f(1,0)-c,y=f(0,1)-c,n=x*x+y*y;
    if(n<1e-18)throw new Error("直线方向暂时失效");
    const plane=doc.planes.find(p=>p.id===ref.obj.planeId)!,a=fromPlane(plane,-c*x/n,-c*y/n),direction=add(mul(plane.u,-y),mul(plane.v,x));
    return {a,b:add(a,unit(direction))};
  };
  const getPlane=(source:DrawingPlaneSource):PlaneGeometry=>{
    if(source.type==="polygon") {
      const object=objects.get(source.polygon);
      if(object?.kind==="polygon"&&object.section) {
        getMesh(object.id); // A missing or degenerate section must still invalidate its normal.
        return getPlane(object.section.plane);
      }
    }
    return sourcePlane(source,{
    point:id=>resolve(id).p,line:straightReference,workplane:id=>doc.planes.find(p=>p.id===id),
    polygon:id=>{let o=objects.get(id);if(o?.kind==="polygon"&&o.section){getMesh(id);o=objects.get(id);}if(o?.kind!=="polygon"&&o?.kind!=="triangle")throw new Error("来源平面不存在");return o.points.map(id=>resolve(id).p);},
    });
  };
  const intersect = (first: string, second: string): Vec3[] => {
    const key=[first,second].sort().join("|");
    if(intersectionErrors.has(key))throw intersectionErrors.get(key)!;
    try {return computeIntersections(first,second);}
    catch(e){intersectionErrors.set(key,e as Error);throw e;}
  };
  const computeIntersections = (first: string, second: string): Vec3[] => {
    const key = [first,second].sort().join("|"),
      cached = intersectionCache.get(key);
    if (cached) return cached;
    if (first === second) throw new Error("不能选择同一个对象求交点");
    let a = reference(first), b = reference(second);
    let result: Vec3[];
    if (a.a && a.b && b.a && b.b) {
      const u = sub(a.b, a.a),
        v = sub(b.b, b.a),
        w = sub(b.a, a.a),
        n = cross(u, v),
        n2 = dot(n, n);
      if (n2 < 1e-16) throw new Error("两条直线平行或重合，没有唯一交点");
      const t = dot(cross(w, v), n) / n2,
        q = dot(cross(w, u), n) / n2,
        pa = add(a.a, mul(u, t)),
        pb = add(b.a, mul(v, q));
      result =
        norm(sub(pa, pb)) > 1e-7 ||
        ((a.obj.kind !== "line" || a.obj.ray) && (t < 0 || (a.obj.kind !== "line" && t > 1))) ||
        ((b.obj.kind !== "line" || b.obj.ray) && (q < 0 || (b.obj.kind !== "line" && q > 1)))
          ? []
          : [pa];
    } else {
      const curve =
        a.obj.kind === "curve"
          ? a.obj
          : b.obj.kind === "curve"
            ? b.obj
            : undefined;
      if (!curve) throw new Error("不支持的交点对象");
      const plane = curve.frame??doc.planes.find((p) => p.id === curve.planeId)!;
      const align=(r:ReturnType<typeof reference>):ReturnType<typeof reference>=>{const c=r.obj;if(c.kind!=='curve')return r;return {obj:reframeCurve(c,c.frame??doc.planes.find(p=>p.id===c.planeId)!,plane)};};
      a=align(a);b=align(b);
      const fn = (r: ReturnType<typeof reference>) => {
        if (r.obj.kind === "curve") {
          const otherCurve=r.obj,other=otherCurve.frame??doc.planes.find(p=>p.id===otherCurve.planeId)!,n=unit(cross(plane.u,plane.v)),m=unit(cross(other.u,other.v));
          if(norm(cross(n,m))>1e-7||Math.abs(dot(sub(other.origin,plane.origin),n))>1e-7)throw Error("两条空间曲线不共面；当前求交仅支持共面曲线");
          const f=curveFunction(r.obj);return (x:number,y:number)=>{const q=toPlane(other,fromPlane(plane,x,y));return f(...q);};
        }
        const p = toPlane(plane, r.a!),
          q = toPlane(plane, r.b!);
        if (
          Math.abs(dot(sub(r.a!, plane.origin), cross(plane.u, plane.v))) >
            1e-7 ||
          Math.abs(dot(sub(r.b!, plane.origin), cross(plane.u, plane.v))) > 1e-7
        )
          throw new Error("直线必须位于曲线平面内");
        return (x: number, y: number) =>
          (x - p[0]) * (q[1] - p[1]) - (y - p[1]) * (q[0] - p[0]);
      };

      const param=a.obj.kind === "curve" && a.obj.parametric ? a : b.obj.kind === "curve" && b.obj.parametric ? b : undefined;
      const other=param===a?b:a;
      const paramCurve=param?.obj.kind === "curve" ? param.obj : undefined;
      const quadratic=(r:ReturnType<typeof reference>):Quadratic|null=>{
        if(r.obj.kind==="curve")return r.obj.parametric?null:conicCoefficients(r.obj.equation);
        const p=toPlane(plane,r.a!),q=toPlane(plane,r.b!);
        fn(r); // Validate coplanarity before using the local line.
        return [0,0,0,q[1]-p[1],p[0]-q[0],p[1]*q[0]-p[0]*q[1]];
      };
      const qa=quadratic(a),qb=quadratic(b),otherFn=paramCurve && !(other.obj.kind==="curve" && other.obj.parametric) ? fn(other) : undefined;
      const localPoints=paramCurve?.parametric
        ? other.obj.kind === "curve" && other.obj.parametric ? parameterCrossings(paramCurve,other.obj)
          : roots(t=>{const p=pointAt(paramCurve,t);return otherFn!(...p);},paramCurve.parametric.tMin,paramCurve.parametric.tMax).map(t=>pointAt(paramCurve,t))
        : qa && qb ? conicIntersections(qa,qb) : implicitIntersections(fn(a), fn(b), curve.range);
      result = localPoints
        .map((p) => fromPlane(plane, ...p))
        .filter((p) =>
          [a, b].every((r) => {
            if (!r.a || !r.b || (r.obj.kind === "line" && !r.obj.ray)) return true;
            const u = sub(r.b, r.a),
              t = dot(sub(p, r.a), u) / dot(u, u);
            return t >= -1e-7 && (r.obj.kind === "line" || t <= 1 + 1e-7);
          }),
        );
    }
    result=result.filter(p=>[reference(first),reference(second)].every(r=>{const c=r.obj;if(c.kind!=="curve")return true;const uv=toPlane(doc.planes.find(p=>p.id===c.planeId)!,p);return withinCurve(c,uv)&&(c.followView!==false||(uv[0]>=c.range[0]-1e-8&&uv[0]<=c.range[1]+1e-8&&uv[1]>=c.range[2]-1e-8&&uv[1]<=c.range[3]+1e-8));}));
    intersectionCache.set(key, result);
    return result;
  };
  const resolve = (id: string): ResolvedPoint => {
    if (errors.has(id)) throw new Error(errors.get(id));
    const existing = points.get(id);
    if (existing) return existing;
    if (visiting.has(id)) throw new Error("构造依赖存在循环");
    const virtual = id.match(/^([^:]+):v:(\d+)$/);
    if (virtual) {
      const source = objects.get(virtual[1]);
      if (source?.kind === "line" && source.relation) {
        const ends = lineEnds(source);
        ends.forEach((p, i) =>
          points.set(`${source.id}:v:${i}`, {
            id: `${source.id}:v:${i}`,
            name: `${source.name}_${i + 1}`,
            p,
            owner: source.id,
          }),
        );
      } else getMesh(virtual[1]);
      const p = points.get(id);
      if (!p) throw new Error("引用的顶点不存在");
      return p;
    }
    const object = numeric.get(id);
    if (!object || object.kind !== "point") throw new Error("引用的点不存在");
    visiting.add(id);
    try {
      const c = object.construction;
      let p: Vec3;
      const owner=object.constraintSet&&objects.get(object.constraintSet);
      const ownedName=owner&&owner.kind==='solutionSet'?constraintPointName(owner,object):undefined;
      if(c.type!=="constraint"&&owner&&owner.kind==="solutionSet"&&ownedName)
        p=constraintPoint(owner,ownedName);
      else if (c.type === "origin") p = doc.coordinateFrame?.origin ?? [0,0,0];
      else if(c.type==="planeOffset") {
        const frame=getPlane(c.plane),u=unit(frame.u),n=unit(cross(frame.u,frame.v)),v=cross(n,u);
        p=add(resolve(c.anchor).p,add(mul(u,c.offset[0]),add(mul(v,c.offset[1]),mul(n,c.offset[2]))));
      }
      else if(c.type==="planeOrigin"||c.type==="planeNormal") {
        const plane=getPlane(c.plane),raw=cross(plane.u,plane.v);
        if(norm(raw)<1e-10)throw new Error("平面退化，法向量暂时失效");
        p=c.type==="planeOrigin"?plane.origin:add(plane.origin,planeHasVariables(doc,c.plane)?raw:simplestNormal(raw));
      }
      else if(c.type === "constraint") {
        const set=objects.get(c.set);if(set?.kind!=="solutionSet")throw new Error("约束解集不存在");
        p=constraintPoint(set,c.point);
      }
      else if (c.type === "onAxis") {
        const axis = coordinateAxis(doc,c.axis,c.planeId);
        p = add(axis.origin,mul(axis.direction,c.parameter));
      }
      else if (c.type === "curveCenter") {
        const curve = getCurve(c.curve), center = circleCenter(curve.equation);
        if (!center) throw new Error("圆心暂时失效，方程需为有效圆");
        p = fromPlane(curve.frame??doc.planes.find(p => p.id === curve.planeId)!, ...center);
      }
      else if (c.type === "vertex") {const curve=getCurve(c.curve),vertex=conicVertices(curve.equation)[c.index];if(!vertex)throw Error("该顶点不存在");p=fromPlane(curve.frame??doc.planes.find(p=>p.id===curve.planeId)!,...vertex);}
      else if (c.type === "focus") {
        const curve = getCurve(c.curve), foci = conicFoci(curve.equation, curve.preset);
        const focus = foci?.[c.index];
        if (!focus) throw new Error("圆锥曲线退化或焦点暂时失效");
        p = fromPlane(curve.frame??doc.planes.find(p => p.id === curve.planeId)!, ...focus);
      }
      else if (c.type === "free") p=c.position;
      else if (c.type === "alias") p = resolve(c.point).p;
      else if(c.type === "rotation") {
        numeric.get(c.angle);const angle=numeric.numbers.get(c.angle);if(angle===undefined)throw new Error("翻折角暂时失效");
        const axis=straightReference(c.axis);p=rotateAboutAxis(resolve(c.point).p,axis.a,axis.b,angle);
      }
      else if(c.type === "reflection") {
        const r=straightReference(c.axis);if(!r.a||!r.b)throw new Error("对称轴不是直线");
        const a=resolve(c.point).p,d=sub(r.b,r.a),n=dot(d,d);
        if(n<1e-16)throw new Error("对称轴方向失效");
        p=sub(mul(add(r.a,mul(d,dot(sub(a,r.a),d)/n)),2),a);
      } else if(c.type === "angleDirection") {
        const [a,b,d]=c.points.map(id=>resolve(id).p),u=sub(a,b),v=sub(d,b);
        if(Math.min(norm(u),norm(v))<1e-9)throw new Error("角的边长为零");
        const direction=add(unit(u),unit(v));if(norm(direction)<1e-9)throw new Error("平角没有唯一的内角平分方向");
        p=add(b,unit(direction));
      }
      else if (c.type === "curveCoordinate") {
        const curve = getCurve(c.curve);
        const candidates = coordinateOnCurve(curve, c.axis, c.value, doc);
        p = candidates[c.branch];
        if (!p) throw new Error("该坐标处没有对应的曲线点");
      } else if (c.type === "onPath") {
        const path = reference(c.path);
        if (path.obj.kind === "curve") {
          if(path.obj.locusInput)throw new Error("数值轨迹仅用于显示，请在来源构造上创建关联点");
          const curve = path.obj,
            plane = curve.frame??doc.planes.find((p) => p.id === curve.planeId)!,
            parsed = equation(curve.equation);
          if(curve.parametric) {
            if(c.parameter<curve.parametric.tMin || c.parameter>curve.parametric.tMax) throw new Error("曲线点超出参数区间");
            const uv=pointAt(curve,c.parameter); if(!withinCurve(curve,uv)) throw new Error("曲线点超出取值范围");
            p=fromPlane(plane,...uv);
          }
          else if (parsed.type === "implicit")
            p = fromPlane(
              plane,
              ...pointOnImplicit(curve, c.seed ?? [c.parameter, 0]),
            );
          else {
            const axis = parsed.type === "y" ? "x" : "y",
              solutions = coordinateOnCurve(curve, axis, c.parameter, doc);
            if (!solutions.length) throw new Error("曲线上的点暂时失效");
            p = solutions[0];
          }
          if (!withinCurve(curve,toPlane(plane,p))) throw new Error("曲线点超出取值范围");
        } else {
          if (!path.a || !path.b || norm(sub(path.b, path.a)) < 1e-9)
            throw new Error("参考线失效");
          p = lerp(
            path.a,
            path.b,
            path.obj.kind === "line"
              ? path.obj.ray ? Math.max(0,c.parameter) : c.parameter
              : Math.max(0, Math.min(1, c.parameter)),
          );
        }
      } else if (c.type === "intersection") {
        p = intersect(c.first, c.second)[c.branch];
        if (!p) throw new Error("当前范围内没有对应交点");
      } else if (c.type === "division") {
        const a = resolve(c.a).p,
          b = resolve(c.b).p;
        if (norm(sub(a, b)) < 1e-10)
          throw new Error("端点重合，等分点暂时失效");
        p = lerp(a, b, c.t);
      } else
        p = triangleCenter(
          ...(c.points.map((id) => resolve(id).p) as [Vec3, Vec3, Vec3]),
          c.center,
        );
      if (p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9))
        throw new Error("构造结果超出有效坐标范围");
      const point = { id, name: object.name, p, owner: id, object };
      points.set(id, point);
      return point;
    } finally {
      visiting.delete(id);
    }
  };
  for (const obj of doc.objects) try { numeric.get(obj.id); } catch(e) { errors.set(obj.id,(e as Error).message); }
  for (const obj of doc.objects)
    if (obj.kind === "solid" || obj.kind === "solutionSet" || obj.kind==="polygon"&&obj.section)
      try {
        getMesh(obj.id);
      } catch (e) {
        errors.set(obj.id, (e as Error).message);
      }
  for (const obj of doc.objects)
    if (obj.kind === "point")
      try {
        resolve(obj.id);
      } catch (e) {
        errors.set(obj.id, String((e as Error).message));
      }
  for (const obj of doc.objects)
    if (obj.kind === "curve")
      try {
        getCurve(obj.id);
      } catch (e) {
        errors.set(obj.id, (e as Error).message);
      }
  for(const original of doc.objects) if(original.kind === "label" && original.measurement) {
    try {
      const m=original.measurement,plane=doc.planes.find(p=>p.id===m.planeId)!;
      let value=0,anchor=original.position;
      const ps=m.references.map(id=>{try{return resolve(id).p;}catch{return undefined;}});
      if(m.type === "angle") {
        if(ps.some(p=>!p))throw new Error("角度引用的点失效");
        const [a,b,c]=ps as Vec3[],mark=angleMark(a,b,c,((m.arcRadius??defaultAngleRadius)+14)/doc.view.scale,cross(plane.u,plane.v));
        value=mark.angle*180/Math.PI;anchor=mark.mid;
      } else if(m.type === "length" && m.references.length===2) {
        if(!ps[0]||!ps[1])throw new Error("长度引用的点失效");value=norm(sub(ps[0],ps[1]));anchor=lerp(ps[0],ps[1],.5);
      } else {
        const target=objects.get(m.references[0]);
        if(target?.kind === "triangle" || target?.kind === "polygon") {
          if(target.kind==="polygon"&&target.section) {
            const mesh=getMesh(target.id);anchor=mul(mesh.vertices.reduce(add,[0,0,0]),1/mesh.vertices.length);
            value=m.type==="area"?mesh.faces.reduce((sum,[a,b,c])=>sum+norm(cross(sub(mesh.vertices[b],mesh.vertices[a]),sub(mesh.vertices[c],mesh.vertices[a])))/2,0):mesh.edges.reduce((sum,[a,b])=>sum+norm(sub(mesh.vertices[a],mesh.vertices[b])),0);
          } else {
          const vs=target.points.map(id=>resolve(id).p),local=vs.map(p=>toPlane(plane,p));
          anchor=mul(vs.reduce(add,[0,0,0]),1/vs.length);
          value=m.type === "area" ? norm(vs.reduce((sum,p,i)=>add(sum,cross(p,vs[(i+1)%vs.length])),[0,0,0]))/2 : vs.reduce((s,p,i)=>s+norm(sub(p,vs[(i+1)%vs.length])),0);
          if(!local.length)throw new Error("无效多边形");
          }
        } else if(target?.kind === "curve") {
          const curve=getCurve(target.id),center=circleCenter(curve.equation);if(!center)throw new Error("当前仅支持圆的面积和周长");
          const f=curveFunction(curve),r2=-f(...center)/(f(center[0]+1,center[1])-f(...center));
          if(!Number.isFinite(r2)||r2<=0)throw new Error("圆暂时失效");
          value=m.type === "area" ? Math.PI*r2 : 2*Math.PI*Math.sqrt(r2);anchor=fromPlane(curve.frame??doc.planes.find(p=>p.id===curve.planeId)!,...center);
        } else {
          if(m.type!=="length")throw new Error("面积或周长需要三角形、多边形或圆");
          const ref=reference(m.references[0]);if(!ref.a||!ref.b||ref.obj.kind === "line")throw new Error("直线没有有限长度");value=norm(sub(ref.b,ref.a));anchor=lerp(ref.a,ref.b,.5);
        }
      }
      if(!Number.isFinite(value))throw new Error("度量暂时失效");
      const name=m.type==="angle"?(m.angleName??"α"):{length:"d",area:"S",perimeter:"L"}[m.type];
      const formatted=`${Number(value.toFixed(5))}${m.type === "angle" ? "°" : ""}`;
      const text=m.type==="angle"&&m.angleDisplay==="name"?name:m.type==="angle"&&m.angleDisplay==="value"?formatted:`${name} = ${formatted}`;
      objects.set(original.id,{...original,text,position:add(anchor,original.position)});
    } catch(e) {errors.set(original.id,(e as Error).message);}
  }
  const edges: GeometryEdge[] = [];
  for (const obj of objects.values()) {
    if (obj.kind === "triangle") {
      const ps = obj.points.map((id) => points.get(id)?.p);
      if (ps.every((p): p is Vec3 => !!p)) {
        const u = sub(ps[1], ps[0]),
          v = sub(ps[2], ps[0]);
        if (norm(cross(u, v)) < 1e-8 * Math.max(1e-8, norm(u) * norm(v)))
          errors.set(obj.id, "三点共线或重合，三角形暂时失效");
      } else errors.set(obj.id, "三角形引用的点暂时失效");
    }
    if (
      obj.kind === "segment" ||
      obj.kind === "vector" ||
      obj.kind === "line"
    ) {
      if(!obj.relation)for(const point of obj.points)if(!points.has(point)) {
        errors.set(obj.id,errors.get(point)??"来源端点暂时失效");break;
      }
      if (obj.relation)
        try {
          const ends = lineEnds(obj);
          ends.forEach((p, i) =>
            points.set(`${obj.id}:v:${i}`, {
              id: `${obj.id}:v:${i}`,
              name: `${obj.name}_${i + 1}`,
              p,
              owner: obj.id,
            }),
          );
        } catch (e) {
          errors.set(obj.id, (e as Error).message);
        }
      edges.push({
        id: obj.id,
        owner: obj.id,
        a: obj.relation ? `${obj.id}:v:0` : obj.points[0],
        b: obj.relation ? `${obj.id}:v:1` : obj.points[1],
        vector: obj.kind === "vector",
      });
    }
    if (obj.kind === "polygon" || obj.kind === "triangle")
      try {
        if(obj.kind==="polygon"&&obj.section)continue;
        const vertices=obj.points.map((id) => {
            const p = points.get(id);
            if (!p) throw new Error("多边形顶点失效");
            return p.p;
          });
        const {triangles}=polygonGeometry(vertices);
        if(doc.dimension==="3d"&&!obj.body)meshes.push({id:obj.id,vertices,faces:triangles,edges:[],round:false});
      } catch (e) {
        errors.set(obj.id, (e as Error).message);
      }
    if (obj.kind === "triangle" || obj.kind === "polygon")
      for (let i = 0; i < obj.points.length; i++)
        edges.push({
          id: `${obj.id}:e:${i}`,
          owner: obj.id,
          a: obj.points[i],
          b: obj.points[(i + 1) % obj.points.length],
          vector: false,
        });
  }
  for (const m of meshes) if(!m.vertexIds)
    m.edges.forEach(([a, b], i) =>
      edges.push({
        id: `${m.id}:e:${i}`,
        owner: m.id,
        a: `${m.id}:v:${a}`,
        b: `${m.id}:v:${b}`,
        vector: false,
      }),
    );
  const connected = new Set<string>();
  // Appearance follows current incidence too: a free point can later lie on a line
  // or curve without changing its construction or introducing a dependency.
  const visibleEdges = edges.filter(edge => {
    const owner = objects.get(edge.owner);
    return owner && !owner.hidden && !errors.has(owner.id) &&
      (doc.edgeStyles[edge.id] ?? owner.style.line) !== "hidden";
  });
  const visibleCurves = [...curves.values()].filter(c => !c.hidden && !constraintHidden(objects,c) && c.style.line !== "hidden" && !errors.has(c.id))
    .flatMap(curve => {
      try { return [{ curve, parsed: equation(curve.equation), plane:curve.frame?? doc.planes.find(p => p.id === curve.planeId)! }]; }
      catch { return []; }
    });
  for (const point of points.values()) {
    if (!point.object || point.object.hidden) continue;
    let incidence = 0, endpoint = false;
    const p = point.p;
    const tolerance = 1e-7 + 32 * Number.EPSILON * Math.max(1, ...p.map(Math.abs));
    for (const edge of visibleEdges) {
      const onEdge = (() => {
      const a = points.get(edge.a)?.p, b = points.get(edge.b)?.p;
      if (!a || !b) return false;
      const d = sub(b, a), length = norm(d);
      if (length < 1e-10) return false;
      const t = dot(sub(p, a), d) / (length * length);
      if (axisReference(edge.owner) && doc.dimension === "3d" && t < 0) return false;
      if ((objects.get(edge.owner)?.kind !== "line" || (objects.get(edge.owner) as DrawingSegment)?.ray) && (t < -tolerance / length || (objects.get(edge.owner)?.kind !== "line" && t > 1 + tolerance / length))) return false;
      return norm(sub(p, add(a, mul(d, t)))) <= tolerance;
      })();
      if (onEdge) {
        incidence++;
        const owner=objects.get(edge.owner),a=points.get(edge.a)?.p,b=points.get(edge.b)?.p;
        if (owner?.kind !== "line" || owner.ray) {
          if(a && norm(sub(p,a))<=tolerance)endpoint=true;
          if(owner?.kind !== "line" && b && norm(sub(p,b))<=tolerance)endpoint=true;
        }
      }
    }
    for (const { curve, parsed, plane } of visibleCurves) {
      const onCurve = (() => {
      if (Math.abs(dot(sub(p, plane.origin), unit(cross(plane.u, plane.v)))) > tolerance) return false;
      const [x, y] = toPlane(plane, p);
      if(!withinDerivedCurve(curve,[x,y])) return false;
      if(curve.parametric) { try {const q=pointAt(curve,nearestParameter(curve,[x,y]));return Math.hypot(q[0]-x,q[1]-y)<=tolerance;}catch{return false;} }
      if (curve.followView === false && (x < curve.range[0] - tolerance || x > curve.range[1] + tolerance ||
        y < curve.range[2] - tolerance || y > curve.range[3] + tolerance)) return false;
      const value = (x: number, y: number) => evaluate(parsed.ast, { x, y, u: x, v: y });
      const f = value(x, y);
      if (!Number.isFinite(f)) return false;
      if (parsed.type === "y") return Math.abs(y - f) <= tolerance;
      if (parsed.type === "x") return Math.abs(x - f) <= tolerance;
      const h = 1e-5 * Math.max(1, Math.sqrt(Math.max(Math.abs(x), Math.abs(y))));
      const gradient = Math.hypot((value(x + h, y) - value(x - h, y)) / (2 * h),
        (value(x, y + h) - value(x, y - h)) / (2 * h));
      return Number.isFinite(gradient) && gradient > 1e-12 && Math.abs(f) / gradient <= tolerance;
      })();
      if (onCurve) incidence++;
    }
    if (incidence >= 2 || endpoint) connected.add(point.id);
  }
  return { points, edges, meshes, errors, connected, curves, numbers: numeric.numbers, objects, intersections: intersect, plane:getPlane, straightReference };
}
export function pointObject(name: string, p: Vec3): DrawingPoint {
  return {
    id: crypto.randomUUID(),
    name,
    kind: "point",
    construction: { type: "free", position: p },
    style: defaultStyle(),
    showName: true,
    coordinates: "none",
    labelOffset: [9, -10],
  };
}
function geometryDependencies(obj: GeometryObject): string[] {
  if (obj.kind === "point") {
    const c = obj.construction;
    if (c.type === "free" || c.type === "origin" || c.type === "onAxis") return [];
    if (c.type === "constraint") return [c.set];
    if(c.type==="planeOffset")return [c.anchor,...planeDependencies(c.plane)];
    if(c.type==="planeOrigin"||c.type==="planeNormal")return planeDependencies(c.plane);
    if (c.type === "focus" || c.type === "vertex" || c.type === "curveCenter") return [c.curve];
    if (c.type === "alias") return [c.point];
    if(c.type === "rotation")return [c.point,c.axis,c.angle];
    if (c.type === "reflection") return [c.point,c.axis];
    if (c.type === "angleDirection") return c.points;
    if (c.type === "division") return [c.a, c.b];
    if (c.type === "center") return c.points;
    if (c.type === "curveCoordinate") return [c.curve];
    if (c.type === "onPath") return [c.path];
    return [c.first, c.second];
  }
  if(obj.kind === "spatialLocus")return [obj.set];
  if(obj.kind==="polygon"&&obj.section)return [obj.section.solid,...planeDependencies(obj.section.plane)];
  if(obj.kind==="polygon"&&obj.fold)return [...obj.points,obj.fold.source,obj.fold.axis,obj.fold.angle,...(obj.fold.originalBody?[obj.fold.originalBody]:[])];
  if (obj.kind === "solid" && obj.construction) {
    const c = obj.construction;
    if(c.type === "roundPoints")return c.points;
    if(c.type === "faces")return c.faces;
    return c.type === "extrusion"
      ? [c.base, ...(c.vector ? [c.vector] : [])]
      : c.type === "apex"
        ? [c.base, c.apex]
        : c.type === "insphere"
          ? [c.source]
          : c.source
            ? [c.source]
            : c.vertices;
  }
  if(obj.kind === "label" && obj.measurement) return obj.measurement.references;
  if(obj.kind === "curve" && obj.derived) {
    const c=obj.derived;return c.type === "conicFeature" ? [c.curve] : c.type === "reflection" ? [c.source,c.axis] : c.type === "tangent" ? [c.curve,c.point] : [c.driver,c.follower];
  }
  if (obj.kind === "curve" && obj.declaration)return obj.declaration.points;
  if (obj.kind === "curve" && obj.circle) return obj.circle.points;
  if (
    (obj.kind === "line" || obj.kind === "segment" || obj.kind === "vector") &&
    obj.relation
  )
    return [
      ...obj.points,
      ...(obj.relation.reference ? [obj.relation.reference] : []),
      ...(obj.relation.plane?planeDependencies(obj.relation.plane):[]),
    ];
  return obj.kind === "segment" ||
    obj.kind === "vector" ||
    obj.kind === "line" ||
    obj.kind === "triangle" ||
    obj.kind === "polygon"
    ? obj.points
    : [];
}
export function dependencies(obj: GeometryObject): string[] {
  return [...new Set([...geometryDependencies(obj), ...Object.values(obj.parameters?.references ?? {}),
    ...(obj.constraintSet ? [obj.constraintSet] : []),
    ...(obj.kind === "number" ? Object.values(obj.references) : [])])];
}
export function planeHasVariables(doc:DrawingDocument,plane:DrawingPlaneSource):boolean {
  const seen=new Set<string>(),objects=new Map(doc.objects.map(o=>[o.id,o]));
  const visit=(id:string):boolean=>{id=id.split(":")[0];if(seen.has(id))return false;seen.add(id);const o=objects.get(id);return !!o&&(o.kind==="number"||dependencies(o).some(visit));};
  return planeDependencies(plane).some(visit);
}
export function affectedObjects(doc: DrawingDocument, id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const obj of doc.objects)
      if (
        !ids.has(obj.id) &&
        (obj.body&&ids.has(obj.body)||dependencies(obj).some(
          (ref) => ids.has(ref) || ids.has(ref.split(":")[0]),
        ))
      ) {
        ids.add(obj.id);
        changed = true;
      }
  }
  return ids;
}
export function validateDrawing(input: unknown): DrawingDocument {
  const d = input as DrawingDocument;
  if (
    !d ||
    ![1, 2, 3, 4].includes(d.schemaVersion) ||
    d.type !== "mindgrove-mathdraw" ||
    typeof d.id !== "string" ||
    typeof d.title !== "string" ||
    !["2d", "3d"].includes(d.dimension) ||
    !Array.isArray(d.objects) ||
    d.objects.length > 2000 ||
    !Array.isArray(d.planes) ||
    !d.planes.length ||
    d.planes.length > 128
  )
    throw new Error("绘图文件格式无效或对象数量超限");
  if (new TextEncoder().encode(JSON.stringify(d)).length > 8 * 1024 * 1024)
    throw new Error("绘图文件不能超过 8 MB");
  const finite = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9;
  const vector = (v: unknown, n: number) =>
    Array.isArray(v) && v.length === n && v.every(finite);
  const names = new Set<string>(),
    planeIds = new Set<string>();
  for (const p of d.planes) {
    if (
      !p ||
      typeof p.id !== "string" ||
      planeIds.has(p.id) ||
      typeof p.name !== "string" ||
      !vector(p.origin, 3) ||
      !vector(p.u, 3) ||
      !vector(p.v, 3) ||
      Math.abs(norm(p.u) - 1) > 1e-6 ||
      Math.abs(norm(p.v) - 1) > 1e-6 ||
      Math.abs(dot(p.u, p.v)) > 1e-6
    )
      throw new Error("工作平面无效");
    planeIds.add(p.id);
  }
  const style = (s: GeometryObject["style"]) =>
    s &&
    finite(s.width) &&
    s.width >= 0.2 &&
    s.width <= 10 &&
    finite(s.fontSize) &&
    s.fontSize >= 8 &&
    s.fontSize <= 96 &&
    ["auto", "solid", "dashed", "hidden"].includes(s.line) &&
    typeof s.italic === "boolean";
  for (const o of d.objects) {
    if (
      !o ||
      typeof o.id !== "string" ||
      !o.id ||
      o.id.includes(":") ||
      names.has(o.id) ||
      typeof o.name !== "string" ||
      o.name.length > 120 ||
      !style(o.style) ||
      (o.hidden !== undefined && typeof o.hidden !== "boolean") ||
      (o.locked !== undefined && typeof o.locked !== "boolean") ||
      (o.symbol !== undefined &&
        (!/^[A-Za-z][A-Za-z0-9_]*$/.test(o.symbol) ||
          d.objects.some((q) => q.id !== o.id && q.symbol === o.symbol)))
    )
      throw new Error("对象身份、名称或样式无效");
    if (o.auxiliary !== undefined && typeof o.auxiliary !== "boolean")throw new Error("辅助对象标记无效");
    if ((o.kind === "line" || o.kind === "segment" || o.kind === "vector") && o.ray !== undefined && typeof o.ray !== "boolean")throw new Error("射线标记无效");
    if (o.style.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(o.style.color)) throw new Error("线条颜色无效");
    names.add(o.id);
    if (o.parameters) {
      const p = o.parameters;
      if (typeof p.source !== "string" || p.source.length > 8192 || !p.references || !p.fields ||
        Object.keys(p.references).length > 64 || Object.keys(p.fields).length > 32 ||
        Object.entries(p.references).some(([k,v]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || typeof v !== "string"))
        throw new Error("数值关联数据无效");
      const vars = Object.entries(p.references).filter(([,id]) => d.objects.some(o => o.id === id && o.kind === "number")).map(([k]) => k);
      for (const [path, expr] of Object.entries(p.fields)) {
        if (!parameterFieldAllowed(path, typeof expr !== "string")) throw new Error("数值参数字段无效");
        const sources = typeof expr === "string" ? [expr] : expr?.coordinates;
        if (!Array.isArray(sources) || !sources.length || sources.length > 3 || sources.some(s => typeof s !== "string" || s.length > 2048))
          throw new Error("数值表达式无效");
        if (typeof expr !== "string" && expr.planeId && (!planeIds.has(expr.planeId) || sources.length !== 2))
          throw new Error("数值坐标的工作平面无效");
        if (typeof expr !== "string" &&
          ((expr.direction !== undefined && typeof expr.direction !== "boolean") ||
            sources.length !== (expr.planeId || path === "construction.seed" ? 2 : 3)))
          throw new Error("数值坐标维度无效");
        for (const source of sources) {
          const prepared=replaceCoordinates(d,source,p.references,()=>[1,1,1]);
          if (path === "equation") equation(prepared, vars);
          else parseExpression(prepared, [...vars,...(path.startsWith("parametric.") ? ["t"] : [])]);
        }
      }
    }
    switch (o.kind) {
      case "solutionSet": validateSolutionSet(o); break;
      case "spatialLocus":
        if(typeof o.set!=="string"||typeof o.point!=="string")throw new Error("空间轨迹引用无效");
        break;
      case "number": {
        if (typeof o.expression !== "string" || o.expression.length > 2048 || !finite(o.value) || !o.references ||
          Object.keys(o.references).length > 64 || Object.entries(o.references).some(([k,v]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || typeof v !== "string") ||
          !o.slider || !finite(o.slider.min) || !finite(o.slider.max) || !finite(o.slider.step) ||
          o.slider.min >= o.slider.max || o.slider.step <= 0) throw new Error("数值或滑块参数无效");
        parseExpression(replaceCoordinates(d,o.expression,o.references,()=>[1,1,1]), Object.keys(o.references));
        break;
      }
      case "point": {
        const c = o.construction;
        if (
          !c ||
          ![
            "free",
            "constraint",
            "origin", "focus", "vertex", "curveCenter", "onAxis",
            "alias", "reflection", "rotation", "angleDirection", "planeOffset", "planeOrigin", "planeNormal",
            "division",
            "center",
            "curveCoordinate",
            "intersection",
            "onPath",
          ].includes(c.type) ||
          !vector(o.labelOffset, 2) ||
          typeof o.showName !== "boolean" ||
          (o.dot !== undefined && !["auto","show","hide"].includes(o.dot)) ||
          !["none", "full", "axes"].includes(o.coordinates)
        )
          throw new Error("点数据无效");
        if(c.type === "vertex"&&(!Number.isInteger(c.index)||c.index<0||c.index>3))throw Error("顶点序号无效");
        if (c.type === "focus" && (!Number.isInteger(c.index) || c.index < 0 || c.index > 1))
          throw new Error("焦点序号无效");
        if (c.type === "onAxis" && (!["x","y","z"].includes(c.axis) || !finite(c.parameter) ||
          (c.planeId !== undefined && !d.planes.some(p => p.id === c.planeId))))
          throw new Error("坐标轴点参数无效");
        if (
          (c.type === "curveCoordinate" &&
            (!["x", "y"].includes(c.axis) || !finite(c.value))) ||
          ((c.type === "curveCoordinate" || c.type === "intersection") &&
            (!Number.isInteger(c.branch) || c.branch < 0 || c.branch > 100))
        )
          throw new Error("曲线点或交点参数无效");
        if (
          c.type === "onPath" &&
          (!finite(c.parameter) || (c.seed !== undefined && !vector(c.seed, 2)))
        )
          throw new Error("路径参数无效");
        if (c.type === "free" && !vector(c.position, 3))
          throw new Error("点坐标无效");
        if (c.type === "division" && (!finite(c.t) || c.t <= 0 || c.t >= 1))
          throw new Error("等分比例无效");
        if (
          c.type === "center" &&
          (!Array.isArray(c.points) ||
            c.points.length !== 3 ||
            !["centroid", "circumcenter", "orthocenter", "incenter"].includes(
              c.center,
            ))
        )
          throw new Error("中心构造无效");
        break;
      }
      case "line":
      case "segment":
      case "vector":
      case "triangle":
        if (
          !Array.isArray(o.points) ||
          o.points.length !== (o.kind === "triangle" ? 3 : 2)
        )
          throw new Error("图形顶点数量无效");
        if (
          "relation" in o &&
          o.relation &&
          (!["parallel", "perpendicular", "bisector"].includes(
            o.relation.type,
          ) ||
            !planeIds.has(o.relation.planeId) || (o.relation.showRightAngle !== undefined && typeof o.relation.showRightAngle !== "boolean"))
        )
          throw new Error("直线关系无效");
        break;
      case "polygon":
        if (
          !Array.isArray(o.points) ||
          (!!o.section&&o.points.length!==0) ||
          (!o.section&&o.points.length < 3) ||
          o.points.length > 64 ||
          new Set(o.points).size !== o.points.length
        )
          throw new Error("多边形顶点无效");
        break;
      case "curve":
        if(o.declaration&&(typeof o.declaration.id!=="string"||!Array.isArray(o.declaration.points)||o.declaration.points.length>50||o.declaration.points.some(id=>typeof id!=="string")))throw new Error("声明曲线引用无效");
        if(o.frame || o.locusInput || o.reflectionInput || o.resolvedDefinition !== undefined || o.locusRangeDescription!==undefined)throw new Error("文件不能包含临时计算缓存");
        if (
          !planeIds.has(o.planeId) ||
          typeof o.equation !== "string" ||
          (o.autoFoci !== undefined && typeof o.autoFoci !== "boolean") ||
          !vector(o.range, 4) ||
          o.range[0] >= o.range[1] ||
          o.range[2] >= o.range[3]
        )
          throw new Error("曲线数据无效");
        equation(replaceCoordinates(d,o.equation,o.parameters?.references ?? {},()=>[1,1,1]), Object.keys(o.parameters?.references ?? {}));
        if(o.derived) {
          const c=o.derived;
          if(c.type==="conicFeature"&&(!["directrix","asymptote"].includes(c.feature)||![0,1].includes(c.index)))throw Error("准线或渐近线参数无效");
          if(!["reflection","tangent","locus","conicFeature"].includes(c.type) || (c.type === "tangent" && (!Number.isInteger(c.branch)||c.branch<0||c.branch>32)) || (c.type === "locus" && (!finite(c.min)||!finite(c.max)||c.min>=c.max||c.natural!==undefined&&typeof c.natural!=="boolean")))throw new Error("派生曲线参数无效");
        }
        if(o.parametric) {
          if(typeof o.parametric.x!=="string" || typeof o.parametric.y!=="string" || !finite(o.parametric.tMin) || !finite(o.parametric.tMax) || o.parametric.tMin>=o.parametric.tMax)
            throw new Error("参数曲线与参数区间无效");
          for(const s of [o.parametric.x,o.parametric.y]) parseExpression(replaceCoordinates(d,s,o.parameters?.references ?? {},()=>[1,1,1]),["t",...Object.keys(o.parameters?.references ?? {})]);
        }
        if(o.limits && (Object.values(o.limits).some(v=>v!==undefined&&!finite(v)) ||
          (o.limits.xMin!==undefined && o.limits.xMax!==undefined && o.limits.xMin>=o.limits.xMax) ||
          (o.limits.yMin!==undefined && o.limits.yMax!==undefined && o.limits.yMin>=o.limits.yMax))) throw new Error("曲线取值范围无效");
        if (
          o.circle &&
          (!["centerPoint", "centerRadius", "threePoint", "incircle"].includes(
            o.circle.type,
          ) ||
            !Array.isArray(o.circle.points) ||
            o.circle.points.length !==
              (["threePoint","incircle"].includes(o.circle.type)
                ? 3
                : o.circle.type === "centerPoint"
                  ? 2
                  : 1) ||
            (o.circle.type === "centerRadius" &&
              (!finite(o.circle.radius) || o.circle.radius! <= 0)))
        )
          throw new Error("圆的构造无效");
        if (
          o.preset &&
          (!["circle", "ellipse", "hyperbola", "parabola"].includes(
            o.preset.type,
          ) ||
            ![
              o.preset.h,
              o.preset.k,
              o.preset.a,
              o.preset.b,
              o.preset.angle,
            ].every(finite) ||
            o.preset.a <= 0 ||
            o.preset.b <= 0)
        )
          throw new Error("圆锥曲线参数无效");
        break;
      case "solid":
        if (o.construction) {
          const c = o.construction;
          if (
            !["faces", "extrusion", "apex", "circumsphere", "insphere","roundPoints"].includes(
              c.type,
            ) ||
            (c.type==="roundPoints"&&(!["cylinder","cone","coneFrustum","sphere"].includes(o.shape)||!Array.isArray(c.points)||c.points.length!==(o.shape==="sphere"?2:o.shape==="coneFrustum"?4:3)||new Set(c.points).size!==c.points.length||c.points.some(id=>typeof id!=="string"))) ||
            (c.type === "faces"&&(!Array.isArray(c.faces)||c.faces.length<4||c.faces.length>2000||new Set(c.faces).size!==c.faces.length||c.faces.some(id=>typeof id!=="string"))) ||
            (c.type === "extrusion" &&
              (!vector(c.direction, 3) || norm(c.direction) < 1e-9)) ||
            (c.type === "circumsphere" &&
              (!Array.isArray(c.vertices) ||
                c.vertices.length > 2000 ||
                (!c.source && c.vertices.length < 4)))
          )
            throw new Error("几何体构造参数无效");
        }
        if (
          ![
            "cube",
            "cuboid",
            "prism",
            "pyramid",
            "frustum",
            "cylinder",
            "cone",
            "coneFrustum",
            "sphere",
          ].includes(o.shape) ||
          !vector(o.origin, 3) ||
          !vector(o.rotation, 3) ||
          (o.basis !== undefined && (!Array.isArray(o.basis)||o.basis.length!==3||!validPose({origin:[0,0,0],x:o.basis[0],y:o.basis[1],z:o.basis[2]}))) ||
          ![o.width, o.depth, o.height, o.radius, o.topRadius, o.sides].every(
            finite,
          ) ||
          Math.min(o.width, o.depth, o.height, o.radius) <= 0 ||
          o.topRadius < 0 ||
          !Number.isInteger(o.sides) ||
          o.sides < 3 ||
          o.sides > 64
        )
          throw new Error("几何体参数无效");
        break;
      case "label":
        if(o.measurement && (!["length","angle","area","perimeter"].includes(o.measurement.type)||!Array.isArray(o.measurement.references)||o.measurement.references.length<1||o.measurement.references.length>3||!planeIds.has(o.measurement.planeId)))throw new Error("度量参数无效");
        if(o.measurement) {
          const m=o.measurement;
          if(m.type==="angle"&&m.references.length!==3||
            m.arcRadius!==undefined&&(!finite(m.arcRadius)||m.arcRadius<4||m.arcRadius>500)||
            m.angleName!==undefined&&(typeof m.angleName!=="string"||!m.angleName.trim()||m.angleName.length>100)||
            m.angleDisplay!==undefined&&!["both","name","value"].includes(m.angleDisplay))throw new Error("角度标记参数无效");
        }
        if (
          !vector(o.position, 3) ||
          typeof o.text !== "string" ||
          o.text.length > 500
        )
          throw new Error("文字标注无效");
        break;
      default:
        throw new Error("未知的几何对象类型");
    }
  }
  const objects = new Map(d.objects.map((o) => [o.id, o]));
  const counts = new Map<string, [number, number]>();
  const solidCounts = (solid: DrawingSolid): [number, number] => {
    const cached = counts.get(solid.id);
    if (cached) return cached;
    const c = solid.construction;
    let result: [number, number];
    if(c?.type === "faces") {
      const faces=c.faces.flatMap(id=>{const f=objects.get(id);return f&&(f.kind==="polygon"||f.kind==="triangle")?[f]:[];}),topology=shellTopology(faces);
      result=[topology.vertices.length,topology.edges.length];
    } else if (c?.type === "extrusion" || c?.type === "apex") {
      const base = objects.get(c.base),
        n =
          base?.kind === "polygon" || base?.kind === "triangle"
            ? base.points.length
            : 0;
      result = c.type === "extrusion" ? [n * 2, n * 3] : [n + 1, n * 2];
    } else {
      const m = solidMesh(c&&c.type!=="roundPoints" ? { ...solid, shape: "sphere" } : solid);
      result = [m.vertices.length, m.edges.length];
    }
    counts.set(solid.id, result);
    return result;
  };
  const validRef = (id: string) => {
    if (typeof id !== "string") return false;
    const axis=axisReference(id);
    if(axis) return !axis.planeId || planeIds.has(axis.planeId);
    const o = objects.get(id);
    if (o) return true;
    const match = id.match(/^([^:]+):(v|e):(\d+)$/);
    if (!match) return false;
    const solid = objects.get(match[1]);
    return (
      (solid?.kind==="polygon"&&solid.section&&Number(match[3])<4096)||
      (solid?.kind === "line" &&
        solid.relation &&
        match[2] === "v" &&
        Number(match[3]) < 2) ||
      (solid?.kind === "solid" &&
        Number(match[3]) < solidCounts(solid)[match[2] === "v" ? 0 : 1]) ||
      (solid?.kind === "solutionSet" && match[2] === "v" && Number(match[3]) < solid.problem.points.length) ||
      ((solid?.kind === "polygon" || solid?.kind === "triangle") &&
        match[2] === "e" &&
        Number(match[3]) < solid.points.length)
    );
  };
  const pointRef = (id: string) =>
    typeof id === "string" &&
    (objects.get(id)?.kind === "point" ||
      (/^[^:]+:v:\d+$/.test(id) && validRef(id)));
  const lineRef = (id: string) =>
    typeof id === "string" &&
    ((!!axisReference(id) && validRef(id)) || ["curve", "line", "segment", "vector"].includes(
      objects.get(id)?.kind ?? "",
    ) ||
      (/^[^:]+:e:\d+$/.test(id) && validRef(id)));
  const validPlane=(source:DrawingPlaneSource)=>{
    if(!source||typeof source!=="object")throw new Error("平面定义无效");
    if(source.type==="points") {if(!Array.isArray(source.points)||source.points.length!==3||new Set(source.points).size!==3||!source.points.every(pointRef))throw new Error("平面需要三个不同的已存在点");}
    else if(source.type==="lines") {if(!Array.isArray(source.lines)||source.lines.length!==2||new Set(source.lines).size!==2||!source.lines.every(lineRef))throw new Error("平面需要两条不同的直线");}
    else if(source.type==="linePoint") {if(!lineRef(source.line)||!pointRef(source.point))throw new Error("平面的直线或点不存在");}
    else if(source.type==="polygon") {if(!["polygon","triangle"].includes(objects.get(source.polygon)?.kind??""))throw new Error("来源平面不存在");}
    else if(source.type==="workplane") {if(!planeIds.has(source.planeId))throw new Error("工作平面不存在");}
    else throw new Error("不支持的平面定义");
  };
  if(d.coordinateOriginId!==undefined&&!pointRef(d.coordinateOriginId))throw new Error("坐标原点引用无效");
  for (const o of d.objects) {
    let refs: string[] = [];
    if(o.body!==undefined) {
      const body=objects.get(o.body);
      if((o.kind!=="polygon"&&o.kind!=="triangle")||body?.kind!=="solid"||body.construction?.type!=="faces"||!body.construction.faces.includes(o.id))throw new Error("平面所属的多面体无效");
    }
    if(o.constraintSet!==undefined&&objects.get(o.constraintSet)?.kind!=="solutionSet")throw new Error("图形所属的约束解集不存在");
    if (o.kind === "number" && Object.values(o.references).some(id => !["number","point"].includes(objects.get(id)?.kind ?? "")))
      throw new Error("数值引用的数值或点不存在");
    if (o.kind === "point") {
      const c = o.construction;
      if(c.type==="planeOffset") {validPlane(c.plane);if(!pointRef(c.anchor)||!vector(c.offset,3))throw Error('平行平面来源无效');}
      else if(c.type==="planeOrigin"||c.type==="planeNormal")validPlane(c.plane);
      else if(c.type === "constraint") {
        const set=objects.get(c.set);
        if(set?.kind!=="solutionSet"||!set.problem.points.includes(c.point))throw new Error("约束点引用无效");
      } else if (c.type === "focus" || c.type === "vertex" || c.type === "curveCenter") {
        if (objects.get(c.curve)?.kind !== "curve") throw new Error("焦点引用的曲线不存在");
      } else if (c.type === "curveCoordinate") {
        if (objects.get(c.curve)?.kind !== "curve")
          throw new Error("曲线点引用的曲线不存在");
      } else if (c.type === "onPath") {
        if (!lineRef(c.path)) throw new Error("路径对象不存在");
      } else if (c.type === "intersection") {
        if (!lineRef(c.first) || !lineRef(c.second))
          throw new Error("交点引用的线或曲线不存在");
      } else if(c.type === "reflection") {
        if(!pointRef(c.point)||!lineRef(c.axis))throw new Error("对称点或对称轴无效");
      } else if(c.type === "rotation") {
        if(!pointRef(c.point)||!lineRef(c.axis)||objects.get(c.angle)?.kind!=="number")throw new Error("翻折点、旋转轴或角度变量无效");
      } else refs = geometryDependencies(o);
    } else if(o.kind === "spatialLocus") {
      const set=objects.get(o.set);if(set?.kind!=="solutionSet"||!set.problem.points.includes(o.point))throw new Error("空间轨迹的解集或点不存在");
    } else if (
      o.kind === "line" ||
      o.kind === "segment" ||
      o.kind === "vector" ||
      o.kind === "triangle" ||
      o.kind === "polygon"
    ) {
      if(o.kind==="polygon"&&o.section) {
        if(objects.get(o.section.solid)?.kind!=="solid")throw new Error("截面引用的几何体不存在");validPlane(o.section.plane);
      } else refs = o.points;
      if(o.kind==="vector"&&o.normalPlane)validPlane(o.normalPlane);
      if("relation" in o&&o.relation?.plane)validPlane(o.relation.plane);
      if(o.kind==="polygon"&&o.fold) {
        const f=o.fold;if(!["polygon","triangle"].includes(objects.get(f.source)?.kind??"")||!lineRef(f.axis)||objects.get(f.angle)?.kind!=="number"||f.originalBody!==undefined&&objects.get(f.originalBody)?.kind!=="solid")throw new Error("翻折来源、轴或角度变量无效");
      }
      if (
        "relation" in o &&
        o.relation?.reference &&
        !lineRef(o.relation.reference)
      )
        throw new Error("参考直线不存在");
    } else if(o.kind === "curve" && o.declaration) {
      const set=objects.get(o.constraintSet!);if(set?.kind!=="solutionSet"||!set.problem.curves?.some(c=>c.id===o.declaration!.id))throw new Error("声明曲线的来源无效");refs=o.declaration.points;
    } else if(o.kind === "curve" && o.derived) {
      const c=o.derived;
      if(c.type === "conicFeature"&&objects.get(c.curve)?.kind!=="curve")throw Error("圆锥曲线引用无效");
      if(c.type === "reflection" && (objects.get(c.source)?.kind!=="curve"||!lineRef(c.axis)))throw new Error("对称曲线引用无效");
      if(c.type === "tangent" && (objects.get(c.curve)?.kind!=="curve"||!pointRef(c.point)))throw new Error("切线引用无效");
      if(c.type === "locus" && (!pointRef(c.driver)||!pointRef(c.follower)||c.driver===c.follower))throw new Error("轨迹需要不同的主动点和从动点");
    } else if(o.kind === "label" && o.measurement) {
      if(o.measurement.references.some(id=>!validRef(id)))throw new Error("度量引用的对象不存在");
    } else if (o.kind === "curve" && o.circle) refs = o.circle.points;
    else if (o.kind === "solid" && o.construction) {
      const c = o.construction;
      if(c.type === "roundPoints")refs=c.points;
      else if(c.type === "faces") {
        if(c.faces.some(id=>!["polygon","triangle"].includes(objects.get(id)?.kind??"")))throw new Error("多面体引用的面不存在");
      } else if (c.type === "extrusion" || c.type === "apex") {
        if (!["polygon", "triangle"].includes(objects.get(c.base)?.kind ?? ""))
          throw new Error("底面引用的多边形不存在");
        if (c.type === "apex") refs = [c.apex];
        if (c.type === "extrusion" && c.vector && !lineRef(c.vector))
          throw new Error("侧棱向量不存在");
      } else if (c.type === "insphere" || c.source) {
        if (objects.get(c.source!)?.kind !== "solid")
          throw new Error("球引用的多面体不存在");
      } else refs = c.vertices;
    }
    if (refs.some((id) => !pointRef(id))) throw new Error("图形引用的点不存在");
  }
  const done = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string, depth = 0) => {
    if (depth > 128 || active.has(id))
      throw new Error("构造循环或依赖层级超过 128 层");
    if (done.has(id)) return;
    active.add(id);
    for (const ref of dependencies(objects.get(id)!)) {
      if (!validRef(ref)) throw new Error("引用的点不存在");
      const parent = ref.split(":")[0];
      if (objects.has(parent)) visit(parent, depth + 1);
    }
    active.delete(id);
    done.add(id);
  };
  for (const o of d.objects) visit(o.id);
  if (d.coordinateFrame) {
    const f = d.coordinateFrame;
    if (
      !vector(f.origin, 3) ||
      !vector(f.x, 3) ||
      !vector(f.y, 3) ||
      Math.abs(norm(f.x) - 1) > 1e-6 ||
      Math.abs(norm(f.y) - 1) > 1e-6 ||
      Math.abs(dot(f.x, f.y)) > 1e-6 ||
      ![1, -1].includes(f.zSign)
    )
      throw new Error("空间坐标系无效，x、y 正方向必须垂直");
  }
  const v = d.view,
    out = d.output;
  if (
    !v ||
    (v.camera !== undefined && !validPose(v.camera)) ||
    !["plane", "space"].includes(v.mode) ||
    !planeIds.has(v.planeId) ||
    (v.projection !== undefined &&
      !["orthographic", "oblique"].includes(v.projection)) ||
    (d.lineWidth !== undefined &&
      (!finite(d.lineWidth) || d.lineWidth < 0.2 || d.lineWidth > 10)) ||
    !finite(v.angle) ||
    (v.pitch !== undefined && (!finite(v.pitch) || Math.abs(v.pitch) > 85)) ||
    !finite(v.scale) ||
    v.scale < 2 ||
    v.scale > 2000 ||
    !vector(v.center, 2) ||
    typeof v.axes !== "boolean" ||
    typeof v.grid !== "boolean" ||
    !out ||
    !Number.isInteger(out.width) ||
    out.width < 100 ||
    out.width > 8000 ||
    !["transparent", "white"].includes(out.background) ||
    !["content", "view", "custom"].includes(out.crop) ||
    !vector(out.bounds, 4) ||
    out.bounds[0] >= out.bounds[1] ||
    out.bounds[2] >= out.bounds[3]
  )
    throw new Error("视图或导出设置无效");
  if (
    !d.edgeStyles ||
    typeof d.edgeStyles !== "object" ||
    Object.keys(d.edgeStyles).length > 10000 ||
    Object.values(d.edgeStyles).some(
      (v) => !["auto", "solid", "dashed", "hidden"].includes(v),
    )
  )
    throw new Error("边样式无效");
  return d;
}
