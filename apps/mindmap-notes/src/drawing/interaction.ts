import { constraintHidden, selectedBranch } from "./constraints/document";
import { angleMark, defaultAngleRadius } from "./angleMark";
import { locusPaths } from "./constraints/loci";
import { world } from "./constraints/math";
import type {
  DrawingDocument,
  DrawingPoint,
  GeometryObject,
  Vec2,
  Vec3,
  WorkPlane,
} from "./types";
import {
  resolveGeometry,
  project,
  fromPlane,
  toPlane,
  unprojectOnPlane,
  add,
  mul,
  sub,
  dot,
  norm,
  cross,
  unit,
  coordinateAxis,
  pointObject,
  planeFromPoints,
} from "./geometry";
import type { CurveResult } from "./curves";
import { equation } from "./expression";
import { pointOnImplicit } from "./pathProjection";
import { intersectionObjects, nextSymbol } from "./model";
import { coordinateOnCurve } from "./constructions";
import { insidePlot } from "./viewport";
import { axisId, axisReference } from "./axes";
import { nearestParameter } from "./parametric";
export type Tool =
  | "normal" | "fold" | "section3" | "sectionLines" | "sectionLinePoint"
  | "reflect" | "tangent" | "locus" | "length" | "angle" | "area" | "perimeter" | "angleBisector" | "angleBisectorLine"
  | "select"
  | "point"
  | "segment"
  | "line"
  | "vector"
  | "triangle"
  | "polygon"
  | "circle"
  | "circleRadius"
  | "circle3"
  | "intersect"
  | "midpoint"
  | "divide"
  | "parallel"
  | "perpendicular"
  | "bisector"
  | "plane3"
  | "planeFace"
  | "prism"
  | "pyramid"
  | "axes"
  | "text";
export interface ToolState {
  tool: Tool;
  points: string[];
  references: string[];
  staged: GeometryObject[];
  preview: GeometryObject[];
  base?: string;
  axisPlane?: WorkPlane;
  axisFace?: string[];
}
export const initialTool = (tool: Tool = "select"): ToolState => ({
  tool,
  points: [],
  references: [],
  staged: [],
  preview: [],
});
export function rejectLastPoint(state: ToolState): ToolState {
  const points = state.points.slice(0, -1);
  return {
    ...state, points, preview: [],
    staged: state.staged.filter((o) => o.kind !== "point" || points.includes(o.id)),
  };
}
export function toolStep(state: ToolState): string {
  const n = state.points.length,
    t = state.tool;
  if(t==="normal")return "请选择平面面；也可使用新增定义 Normal(A,B,C)";
  if(t==="fold")return state.base?"请选择旋转轴（直线、坐标轴或多边形边）；默认创建 90° 滑块":"请选择需要翻折的多边形或三角形";
  if(t.startsWith("section"))return !state.base?"请选择要截取的几何体":t==="section3"?`请选择截平面的第 ${n+1} 个点（共三个）`:t==="sectionLines"?`请选择第 ${state.references.length+1} 条共面直线或边`:!state.references.length?"请选择截平面上的直线或边":"请选择直线外的一个点";
  if(t === "reflect")return state.references.length ? "请选择需要对称的点、线或图形" : "请选择对称轴（直线、坐标轴或直边）";
  if(t === "tangent")return state.references.length ? "请选择切线经过的点，可在曲线上或曲线外" : "请选择曲线，再选择切线经过的点";
  if(t === "locus")return n ? "请选择依赖主动点的从动点" : "请选择沿线或曲线运动的主动点";
  if(t === "area"||t === "perimeter")return "请选择三角形、多边形或圆";
  if(t === "length")return n ? "请选择第二个点" : "请选择线段或两个点来度量长度";
  if(t === "angle"||t === "angleBisector"||t === "angleBisectorLine")return ["请选择角的第一条边上的点","请选择角的顶点","请选择角的第二条边上的点"][n];
  if (t === "select")
    return "点击选择 · Shift 多选 · Alt 点击选择重合点 · 空白拖动框选 · 空格或中键平移";
  if (t === "point") return "点击放置点；吸附时建立关联，按 Alt 临时忽略";
  if (t === "intersect")
    return state.references.length
        ? "请选择第二个图形，选中后直接创建全部交点"
        : "点击交叉处取一个交点，或依次选择两个图形";
  if (t === "midpoint" || t === "divide" || t === "bisector")
    return n ? "请选择第二个端点" : "请选择一条边，或依次选择两个端点";
  if (t === "parallel" || t === "perpendicular")
    return state.references.length
      ? "请选择经过的点，也可直接点击尚未创建的交点"
      : state.points.length ? "已选经过的点，请选择参考直线、坐标轴或边" : "请选择经过的点或参考线，顺序不限；交点可直接点击";
  if (t === "polygon")
    return n < 3
      ? `请选择第 ${n + 1} 个顶点（至少三个）`
      : "点击首点闭合，或按 Enter 完成多边形";
  if (t === "planeFace") return "选择平面多边形或几何体的平面面作为工作平面";
  if (t === "prism")
    return state.base
      ? "移动鼠标预览高度；点击或 Enter 确认，也可输入侧棱向量"
      : "请选择底面多边形或几何体的平面面";
  if (t === "pyramid")
    return state.base
      ? "选择顶点，或在当前工作平面点击；也可输入空间坐标"
      : "请选择底面多边形或几何体的平面面";
  if (t === "axes")
    return state.axisPlane ? "第 4 步：选择 y 正方向后直接创建坐标系"
      : ["第 1 步：请选择原点", "第 2 步：请选择 x 正方向上的点", "第 3 步：点击平面面，或在下方面板选择 xOy 工作平面"][n];
  if (t === "text") return "点击放置文字，随后输入内容";
  if (t === "circleRadius") return "请选择圆心，然后输入半径";
  if (t === "circle") return n ? "请选择圆上一点" : "请选择圆心";
  if (t === "circle3" || t === "triangle" || t === "plane3")
    return `请选择第 ${n + 1} 个点（共三个）`;
  return n ? "请选择第二个端点" : "请选择第一个端点";
}
export const screenPoint = (
  doc: DrawingDocument,
  size: Vec2,
  p: Vec3,
): Vec2 => {
  const q = project(p, doc);
  return [
    (q[0] - doc.view.center[0]) * doc.view.scale + size[0] / 2,
    (q[1] - doc.view.center[1]) * doc.view.scale + size[1] / 2,
  ];
};
export function canvasPoint(doc: DrawingDocument, size: Vec2, q: Vec2): Vec3 {
  const plane = doc.planes.find((p) => p.id === doc.view.planeId)!;
  return unprojectOnPlane(
    [
      (q[0] - size[0] / 2) / doc.view.scale + doc.view.center[0],
      (q[1] - size[1] / 2) / doc.view.scale + doc.view.center[1],
    ],
    plane.origin,
    doc,
  );
}
export const distance = (a: Vec2, b: Vec2) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2, unbounded = false) {
  const v: Vec2 = [b[0] - a[0], b[1] - a[1]],
    d = v[0] ** 2 + v[1] ** 2;
  let t = d ? ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / d : 0;
  if (!unbounded) t = Math.max(0, Math.min(1, t));
  const q: Vec2 = [a[0] + t * v[0], a[1] + t * v[1]];
  return { t, q, distance: distance(p, q) };
}
export interface Hit {
  kind: "point" | "edge" | "curve" | "face" | "label" | "object";
  id: string;
  owner: string;
  distance: number;
  position?: Vec3;
  vertices?: string[];
}
/** A frame's plane selection must not be intercepted by axes, edges or point labels. */
export function toolHits(state:ToolState,hits:Hit[]):Hit[] {
  if(state.tool==="fold")return hits.filter(h=>h.kind===(state.base?"edge":"face")||!!state.base&&h.kind==="curve");
  if(state.tool==="normal"||state.tool.startsWith("section")&&!state.base)return hits.filter(h=>h.kind==="face");
  if(state.tool==="sectionLines"||state.tool==="sectionLinePoint"&&!state.references.length)return hits.filter(h=>h.kind==="edge"||h.kind==="curve");
  if(state.tool==="axes" && state.points.length===2)
    return hits.filter(h=>h.kind===(state.axisPlane?"point":"face"));
  return hits;
}
function inside(p: Vec2, polygon: Vec2[]) {
  let flag = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
    if (
      polygon[i][1] > p[1] !== polygon[j][1] > p[1] &&
      p[0] <
        ((polygon[j][0] - polygon[i][0]) * (p[1] - polygon[i][1])) /
          (polygon[j][1] - polygon[i][1]) +
          polygon[i][0]
    )
      flag = !flag;
  return flag;
}
/** Merge coplanar triangles into actual selectable faces, never expose tessellation diagonals. */
export function meshFaces(
  mesh: ReturnType<typeof resolveGeometry>["meshes"][number],
): { id: string; vertices: string[] }[] {
  if (mesh.round) return [];
  const groups: {
    normal: Vec3;
    offset: number;
    triangles: [number, number, number][];
  }[] = [];
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((i) => mesh.vertices[i]),
      raw = cross(sub(b, a), sub(c, a));
    if (norm(raw) < 1e-9) continue;
    let n = unit(raw),
      h = dot(n, a);
    const first = n.find((v) => Math.abs(v) > 1e-8)!;
    if (first < 0) {
      n = mul(n, -1);
      h = -h;
    }
    let group = groups.find(
      (g) => norm(sub(g.normal, n)) < 1e-7 && Math.abs(g.offset - h) < 1e-6,
    );
    if (!group) {
      group = { normal: n, offset: h, triangles: [] };
      groups.push(group);
    }
    group.triangles.push(face);
  }
  return groups.flatMap((group, index) => {
    const counts = new Map<string, { a: number; b: number; n: number }>();
    for (const f of group.triangles)
      for (let i = 0; i < 3; i++) {
        const a = f[i],
          b = f[(i + 1) % 3],
          key = [a, b].sort((x, y) => x - y).join(":");
        const e = counts.get(key) ?? { a, b, n: 0 };
        e.n++;
        counts.set(key, e);
      }
    const boundary = [...counts.values()].filter((e) => e.n === 1);
    if (!boundary.length) return [];
    const order = [boundary[0].a];
    let current = boundary[0].b;
    const used = new Set([0]);
    while (current !== order[0] && order.length <= boundary.length) {
      order.push(current);
      const j = boundary.findIndex(
        (e, i) => !used.has(i) && (e.a === current || e.b === current),
      );
      if (j < 0) return [];
      used.add(j);
      current = boundary[j].a === current ? boundary[j].b : boundary[j].a;
    }
    return [
      {
        id: `${mesh.id}:face:${index}`,
        vertices: order.map((i) => mesh.vertexIds?.[i]??`${mesh.id}:v:${i}`),
      },
    ];
  });
}
export function hitTest(
  doc: DrawingDocument,
  curves: CurveResult[],
  size: Vec2,
  q: Vec2,
  faces = false,
): Hit[] {
  if (!insidePlot(size,q)) return [];
  const geometry = resolveGeometry(doc),
    hits: Hit[] = [],
    visible = (id: string) =>
      !geometry.objects.get(id)?.hidden && !constraintHidden(geometry.objects,geometry.objects.get(id)) && !geometry.errors.has(id);
  for (const p of geometry.points.values())
    if (
      !axisReference(p.owner) &&
      !(geometry.objects.get(p.owner)?.kind === "solutionSet" && !p.object) &&
      !(!p.object&&geometry.meshes.some(m=>m.id===p.owner&&!!m.vertexIds)) &&
      !(
        doc.objects.find((o) => o.id === p.owner)?.kind === "line" &&
        p.id !== p.owner &&
        !p.object
      ) &&
      visible(p.owner) &&
      !p.object?.hidden
    ) {
      const d = distance(q, screenPoint(doc, size, p.p));
      if (d <= 9)
        hits.push({
          kind: "point",
          id: p.id,
          owner: p.owner,
          distance: d,
          position: p.p,
        });
    }
  for (const e of geometry.edges) {
    if (!visible(e.owner)) continue;
    const a = geometry.points.get(e.a),
      b = geometry.points.get(e.b);
    if (!a || !b) continue;
    const obj = geometry.objects.get(e.owner);
    if (doc.edgeStyles[e.id] === "hidden" || obj?.style.line === "hidden")
      continue;
    const found = nearestOnSegment(
      q,
      screenPoint(doc, size, a.p),
      screenPoint(doc, size, b.p),
      obj?.kind === "line",
    );
    if (((axisReference(e.id) && doc.dimension === "3d") || (obj?.kind === "line" && obj.ray)) && found.t < 0) continue;
    if (found.distance <= 8)
      hits.push({
        kind: "edge",
        id: e.id,
        owner: e.owner,
        distance: found.distance,
        position: add(a.p, mul(sub(b.p, a.p), found.t)),
      });
  }
  for (const result of curves) {
    if (!visible(result.id)) continue;
    const curve = geometry.curves.get(result.id);
    if (!curve || curve.style.line === "hidden") continue;
    const plane = doc.planes.find((p) => p.id === curve.planeId)!;
    let best: Hit | undefined;
    for (const path of result.paths)
      for (let i = 1; i < path.length; i++) {
        const a = fromPlane(plane, ...path[i - 1]),
          b = fromPlane(plane, ...path[i]),
          f = nearestOnSegment(
            q,
            screenPoint(doc, size, a),
            screenPoint(doc, size, b),
          );
        if (f.distance <= 8 && (!best || f.distance < best.distance))
          best = {
            kind: "curve",
            id: curve.id,
            owner: curve.id,
            distance: f.distance,
            position: add(a, mul(sub(b, a), f.t)),
          };
      }
    if (best) hits.push(best);
  }
  for(const obj of geometry.objects.values())if(obj.kind === "spatialLocus"&&visible(obj.id)) {
    const set=geometry.objects.get(obj.set);if(set?.kind!=="solutionSet")continue;
    const locus=selectedBranch(set)?.loci.find(l=>l.point===obj.point);if(!locus)continue;
    let best:Hit|undefined;
    for(const path of locusPaths(locus))for(let i=1;i<path.length;i++) {
      const a=world(path[i-1],set.placement),b=world(path[i],set.placement),f=nearestOnSegment(q,screenPoint(doc,size,a),screenPoint(doc,size,b));
      if(f.distance<=8&&(!best||f.distance<best.distance))best={kind:"curve",id:obj.id,owner:obj.id,distance:f.distance,position:add(a,mul(sub(b,a),f.t))};
    }
    if(best)hits.push(best);
  }
  for (const obj of geometry.objects.values())
    if (obj.kind === "label" && visible(obj.id) && !geometry.errors.has(obj.id)) {
      if(obj.measurement?.type==="angle"&&obj.style.line!=="hidden") {
        const m=obj.measurement,ps=m.references.map(id=>geometry.points.get(id)?.p),plane=doc.planes.find(p=>p.id===m.planeId);
        if(ps.every((p):p is Vec3=>!!p)&&plane) {
          const arc=angleMark(ps[0],ps[1],ps[2],(m.arcRadius??defaultAngleRadius)/doc.view.scale,cross(plane.u,plane.v));
          const screen=arc.points.map(p=>screenPoint(doc,size,p));
          const d=Math.min(...screen.slice(1).map((p,i)=>nearestOnSegment(q,screen[i],p).distance));
          if(arc.angle>1e-8&&d<=8)hits.push({kind:"object",id:obj.id,owner:obj.id,distance:d});
        }
      }
      const p = screenPoint(doc, size, obj.position),
        width = Math.max(20, obj.text.length * obj.style.fontSize * 0.55);
      if (
        q[0] >= p[0] - 5 &&
        q[0] <= p[0] + width &&
        q[1] >= p[1] - obj.style.fontSize - 5 &&
        q[1] <= p[1] + 5
      )
        hits.push({
          kind: "label",
          id: obj.id,
          owner: obj.id,
          distance: 0,
          position: obj.position,
        });
    }
  if (faces) {
    for (const obj of geometry.objects.values())
      if (
        (obj.kind === "polygon" || obj.kind === "triangle") &&
        visible(obj.id)
      ) {
        if(obj.kind==="polygon"&&obj.section) {
          const mesh=geometry.meshes.find(m=>m.id===obj.id);
          for(const loop of mesh?.loops??[])if(inside(q,loop.map(i=>screenPoint(doc,size,mesh!.vertices[i]))))hits.push({kind:"face",id:obj.id,owner:obj.id,distance:20,vertices:loop.map(i=>`${obj.id}:v:${i}`)});
          continue;
        }
        const ps = obj.points.map((id) => geometry.points.get(id)?.p);
        if (
          ps.every((p): p is Vec3 => !!p) &&
          inside(
            q,
            ps.map((p) => screenPoint(doc, size, p)),
          )
        )
          hits.push({
            kind: "face",
            id: obj.id,
            owner: obj.id,
            distance: 20,
            vertices: obj.points,
          });
      }
    for (const mesh of geometry.meshes)
      if (visible(mesh.id) && !mesh.vertexIds && !["polygon","triangle"].includes(geometry.objects.get(mesh.id)?.kind??""))
        for (const face of meshFaces(mesh)) {
          const ps = face.vertices.map((id) => geometry.points.get(id)!.p);
          if (
            inside(
              q,
              ps.map((p) => screenPoint(doc, size, p)),
            )
          )
            hits.push({
              kind: "face",
              id: face.id,
              owner: mesh.id,
              distance: 20,
              vertices: face.vertices,
            });
        }
  }
  const rank = { point: 0, label: 1, edge: 2, curve: 2, face: 3, object: 4 };
  return hits.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.distance - b.distance,
  );
}
export interface Snap {
  position: Vec3;
  hint: string;
  existing?: string;
  construction?: DrawingPoint["construction"];
}
const crossingCache = new WeakMap<DrawingDocument, Map<string, {position:Vec3; construction:DrawingPoint["construction"]}[]>>();
function crossings(doc:DrawingDocument, first:string, second:string) {
  let cache=crossingCache.get(doc);
  if(!cache) { cache=new Map(); crossingCache.set(doc,cache); }
  const key=[first,second].sort().join("|");
  let values=cache.get(key);
  if(!values) {
    try {
      const points=intersectionObjects(doc,first,second), resolved=resolveGeometry({...doc,objects:[...doc.objects,...points]});
      values=points.flatMap(o=>{const p=resolved.points.get(o.id);return p?[{position:p.p,construction:o.construction}]:[];});
    } catch { values=[]; }
    cache.set(key,values);
  }
  return values;
}
export function pointOnPath(
  doc: DrawingDocument,
  path: string,
  position: Vec3,
  previous?: number,
): DrawingPoint["construction"] {
  if(doc.objects.find(o=>o.id===path)?.kind === "spatialLocus")throw new Error("请拖动此轨迹对应的条件动点；新增关联点请在条件解集中声明");
  const geometry = resolveGeometry(doc),
    curve = geometry.curves.get(path);
  if (curve) {
    if(curve.locusInput)throw new Error("数值轨迹仅用于显示，请在来源构造上创建关联点");
    const plane = doc.planes.find((p) => p.id === curve.planeId)!,
      uv = toPlane(plane, position),
      type = equation(curve.equation).type;
    if(curve.parametric) return {type:"onPath",path,parameter:nearestParameter(curve,uv,previous)};
    return {
      type: "onPath",
      path,
      parameter: type === "x" ? uv[1] : uv[0],
      seed: type === "implicit" ? pointOnImplicit(curve, uv) : undefined,
    };
  }
  const edge = geometry.edges.find((e) => e.id === path);
  if (!edge) throw new Error("请选择直线、线段或曲线");
  const a = geometry.points.get(edge.a)!.p,
    b = geometry.points.get(edge.b)!.p,
    v = sub(b, a),
    t = dot(sub(position, a), v) / dot(v, v);
  return {
    type: "onPath",
    path,
    parameter:
      geometry.objects.get(edge.owner)?.kind === "line"
        ? (geometry.objects.get(edge.owner) as import("./types").DrawingSegment).ray ? Math.max(0,t) : t
        : Math.max(0, Math.min(1, t)),
  };
}
export function snapPoint(
  doc: DrawingDocument,
  curves: CurveResult[],
  size: Vec2,
  q: Vec2,
  alt = false,
  grid = false,
): Snap {
  const plane = doc.planes.find((p) => p.id === doc.view.planeId)!,
    spatial = doc.dimension === "3d",
    inPlane = (v: Vec3) =>
      Math.abs(dot(sub(v, plane.origin), cross(plane.u, plane.v))) < 1e-6;
  if (alt) return { position: canvasPoint(doc, size, q), hint: "自由点（忽略吸附）" };
  // Use the same spatial hits as highlighting. Their positions are interpolated
  // on the actual 3D edge, independent of the active construction plane.
  const hits = hitTest(doc, curves, size, q).filter(
    (h) => spatial || !h.position || inPlane(h.position),
  );
  const existing = hits.find((h) => h.kind === "point");
  if (existing)
    return {
      position: existing.position!,
      hint: `使用点 ${resolveGeometry(doc).points.get(existing.id)?.name}`,
      existing: existing.id,
    };
  const paths = hits.filter((h) => h.kind === "edge" || h.kind === "curve");
  let crossing: {position:Vec3; construction:DrawingPoint["construction"]} | undefined, best=10;
  for(let i=0;i<Math.min(paths.length,6);i++) for(let j=i+1;j<Math.min(paths.length,6);j++)
    for(const point of crossings(doc,paths[i].id,paths[j].id)) {
      const d=distance(screenPoint(doc,size,point.position),q);
      if(d<=best) {best=d;crossing=point;}
    }
  if(crossing) return {...crossing,hint:"交点（建立关联）"};
  const geometry = resolveGeometry(doc);
  const axes = doc.view.axes ? (["x","y",...(doc.view.mode === "space" ? ["z"] : [])] as ("x"|"y"|"z")[])
    .flatMap(axis => {
      const planeId = doc.view.mode === "plane" ? plane.id : undefined;
      if (doc.edgeStyles[axisId(axis,planeId)] === "hidden") return [];
      const {origin,direction} = coordinateAxis(doc,axis,planeId);
      if (!spatial && (!inPlane(origin) || Math.abs(dot(direction,cross(plane.u,plane.v)))>1e-6)) return [];
      const a=screenPoint(doc,size,origin), b=screenPoint(doc,size,add(origin,direction));
      if (distance(a,b)<1e-6) return [];
      const found=nearestOnSegment(q,a,b,true), t=doc.dimension === "3d" ? Math.max(0,found.t) : found.t;
      const position=add(origin,mul(direction,t)), d=distance(q,screenPoint(doc,size,position));
      return d<=8 ? [{axis,planeId,position,t,d}] : [];
    }).sort((a,b)=>a.d-b.d) : [];
  // A visible plane axis plus a curve also provides an exact, associated crossing.
  if (doc.view.mode === "plane" && axes.length && paths[0]?.kind === "curve") {
    const curve=geometry.curves.get(paths[0].id), axis=axes[0];
    if (curve?.planeId === plane.id && axis.axis !== "z") try {
      const fixed=axis.axis === "x" ? "y" : "x", candidates=coordinateOnCurve(curve,fixed,0,doc);
      const nearest=candidates.map((position,branch)=>({position,branch,d:distance(q,screenPoint(doc,size,position))})).sort((a,b)=>a.d-b.d)[0];
      if (nearest && nearest.d<=10) return { position:nearest.position, hint:"坐标轴与曲线交点（建立关联）",
        construction:{type:"curveCoordinate",curve:curve.id,axis:fixed,value:0,branch:nearest.branch} };
    } catch { /* No crossing near this cursor. */ }
  }
  if (axes[0] && (!paths[0] || axes[0].d < paths[0].distance)) {
    const a=axes[0];
    return {position:a.position,hint:`${a.axis} 轴上的点（建立关联）`,
      construction:{type:"onAxis",axis:a.axis,parameter:a.t,planeId:a.planeId}};
  }
  const path = paths[0];
  if (path?.position) {
    try {
      return {
        position: path.position,
        hint: "对象上的点（建立关联）",
        construction: pointOnPath(doc, path.id, path.position),
      };
    } catch {}
  }
  // Only blank-space creation needs to invert the current workplane. A
  // highlighted spatial edge also works when that plane is viewed edge-on.
  const p = canvasPoint(doc, size, q);
  if (grid) {
    const [u, v] = toPlane(plane, p);
    return {
      position: fromPlane(plane, Math.round(u), Math.round(v)),
      hint: "网格对齐",
    };
  }
  return { position: p, hint: "自由点" };
}
/** Coordinate-frame picking reuses an incident endpoint/point instead of
 * creating an unnecessary On(line) construction at the cursor. */
export function framePointSnap(doc:DrawingDocument,curves:CurveResult[],size:Vec2,q:Vec2,excluded:string[]=[],plane?:WorkPlane,alt=false):Snap {
  if(alt)return snapPoint(doc,curves,size,q,true);
  const geometry=resolveGeometry(doc),inPlane=(p:Vec3)=>!plane||Math.abs(dot(sub(p,plane.origin),cross(plane.u,plane.v)))<1e-6;
  const hits=hitTest(doc,curves,size,q),existing=hits.find(h=>h.kind==="point"&&h.position&&inPlane(h.position)&&!excluded.includes(h.id));
  if(existing)return {existing:existing.id,position:existing.position!,hint:`使用点 ${geometry.points.get(existing.id)?.name}`};
  for(const hit of hits.filter(h=>(h.kind==="edge"||h.kind==="curve")&&!axisReference(h.id))) {
    const edge=geometry.edges.find(e=>e.id===hit.id);
    let a:Vec3,b:Vec3;
    try {const line=geometry.straightReference(hit.id);a=line.a;b=line.b;}catch {continue;}
    const direction=sub(b,a),length=norm(direction);if(length<1e-9)continue;
    const choices=[...geometry.points.values()].filter(p=>!excluded.includes(p.id)&&inPlane(p.p)&&
      (p.id===edge?.a||p.id===edge?.b||!!p.object&&!p.object.hidden&&!p.object.auxiliary)&&
      norm(cross(sub(p.p,a),direction))<=1e-7*length);
    choices.sort((a,b)=>{
      const delta=distance(screenPoint(doc,size,a.p),q)-distance(screenPoint(doc,size,b.p),q),endpoint=(id:string)=>id===edge?.a||id===edge?.b?0:1;
      return Math.abs(delta)>1e-7?delta:endpoint(a.id)-endpoint(b.id);
    });
    if(choices[0])return {existing:choices[0].id,position:choices[0].p,hint:`使用线上的点 ${choices[0].name}`};
  }
  return snapPoint(doc,curves,size,q,false);
}
export function stagedPoint(
  doc: DrawingDocument,
  state: ToolState,
  snap: Snap,
): { id: string; state: ToolState } {
  if (snap.existing) return { id: snap.existing, state };
  const o = pointObject("新点", snap.position),
    all = { ...doc, objects: [...doc.objects, ...state.staged] };
  o.symbol = nextSymbol(all, "point");
  o.name = o.symbol;
  if (snap.construction) o.construction = snap.construction;
  return { id: o.id, state: { ...state, staged: [...state.staged, o] } };
}
export function selectRectangle(
  doc: DrawingDocument,
  size: Vec2,
  a: Vec2,
  b: Vec2,
): string[] {
  const r = resolveGeometry(doc),
    contains = (p: Vec3) => {
      const q = screenPoint(doc, size, p);
      return (
        q[0] >= Math.min(a[0], b[0]) &&
        q[0] <= Math.max(a[0], b[0]) &&
        q[1] >= Math.min(a[1], b[1]) &&
        q[1] <= Math.max(a[1], b[1])
      );
    };
  return doc.objects
    .filter(
      (o) =>
        !o.hidden &&
        ((o.kind === "point" &&
          r.points.has(o.id) &&
          contains(r.points.get(o.id)!.p)) ||
          ((o.kind === "polygon" ||
            o.kind === "triangle" ||
            o.kind === "segment" ||
            o.kind === "vector" ||
            o.kind === "line") &&
            o.points.every(
              (id) => r.points.has(id) && contains(r.points.get(id)!.p),
            )) ||
          (o.kind === "solid" &&
            r.meshes.find((m) => m.id === o.id)?.vertices.every(contains))),
    )
    .map((o) => o.id);
}
export function planeForHit(doc: DrawingDocument, hit: Hit): WorkPlane {
  const r = resolveGeometry(doc),
    vertices = hit.vertices;
  if (!vertices || vertices.length < 3) throw new Error("请选择平面面或多边形");
  const ps = vertices.map((id) => r.points.get(id)!.p);
  let third = 2;
  while (
    third < ps.length &&
    norm(cross(sub(ps[1], ps[0]), sub(ps[third], ps[0]))) < 1e-8
  )
    third++;
  if (third === ps.length) throw new Error("平面退化");
  return planeFromPoints(
    ps[0],
    ps[1],
    ps[third],
    `平面 ${doc.planes.length + 1}`,
  );
}
export function acceptPoint(
  state: ToolState,
  id: string,
): { state: ToolState; ready: boolean } {
  if (state.tool === "polygon" && id === state.points[0]) {
    if (state.points.length < 3) throw new Error("多边形至少需要三个不同顶点");
    return { state, ready: true };
  }
  if (state.points.includes(id)) throw new Error("请选择不同的点");
  const points = [...state.points, id],
    counts: Partial<Record<Tool, number>> = {
      point: 1,
      locus:2, length:2, angle:3, angleBisector:3, angleBisectorLine:3, tangent:1,
      segment: 2,
      line: 2,
      vector: 2,
      triangle: 3,
      circle: 2,
      circleRadius: 1,
      circle3: 3,
      midpoint: 2,
      divide: 2,
      bisector: 2,
      plane3: 3,
      section3:3,sectionLinePoint:1,
      axes: Infinity,
      parallel: 1,
      perpendicular: 1,
      text: 1,
    };
  return {
    state: { ...state, points },
    ready:
      state.tool !== "polygon" &&
      (!(state.tool === "parallel" || state.tool === "perpendicular" || state.tool === "tangent") || state.references.length > 0) &&
      points.length >= (counts[state.tool] ?? Infinity),
  };
}

/** Shared by hover previews and the active step prompt. */
export function canSelectPoint(s:ToolState):boolean {
 return s.tool === "select" || wantsPoint(s) || (s.tool === "reflect" && s.references.length > 0);
}
export function wantsPoint(s:ToolState):boolean {
 if(s.tool.startsWith("section"))return !!s.base&&(s.tool==="section3"||s.tool==="sectionLinePoint"&&!!s.references.length);
 if(s.tool==="tangent")return s.references.length>0;
 if(s.tool==="parallel"||s.tool==="perpendicular")return s.points.length===0;
 if(s.tool==="pyramid")return !!s.base;
 if(s.tool==="axes")return s.points.length<2||!!s.axisPlane;
 return ["point","segment","line","vector","triangle","polygon","circle","circleRadius","circle3","midpoint","divide","bisector","plane3","text","length","angle","angleBisector","angleBisectorLine","locus"].includes(s.tool);
}
export function toolTarget(s:ToolState):string {
 const n=s.points.length,t=s.tool;
 if(t==="fold")return s.base?"旋转轴":"需要翻折的多边形";
 if(t==="normal")return "平面面";
 if(t.startsWith("section"))return !s.base?"要截取的几何体":t==="section3"?`截平面的第 ${n+1} 个点`:t==="sectionLines"?`第 ${s.references.length+1} 条直线或边`:s.references.length?"直线外的点":"直线或边";
 if(t==="tangent")return s.references.length?"切线经过的点":"曲线";
 if(t==="reflect")return s.references.length?"需要对称的图形":"对称轴";
 if(t==="locus")return n?"从动点（依赖主动点）":"主动点（路径上的点）";
 if(t==="parallel"||t==="perpendicular")return s.references.length?"经过的点":n?"参考直线或边":"经过的点或参考线";
 if(t==="area"||t==="perimeter")return "三角形、多边形或圆";
 if(t==="intersect")return s.references.length?"第二个图形":"交叉处或第一个图形";
 if(t==="circle"||t==="circleRadius")return n?"圆上一点":"圆心";
 if(t==="angle"||t==="angleBisector"||t==="angleBisectorLine")return ["角第一条边上的点","角的顶点","角第二条边上的点"][n]??"角";
 if(t==="planeFace"||((t==="prism"||t==="pyramid")&&!s.base))return "底面或几何体的平面面";
 if(t==="prism")return "高度或侧棱方向";
 if(t==="pyramid")return "棱锥顶点";
 if(t==="axes")return s.axisPlane?"y 轴正方向":["坐标原点","x 轴正方向","xOy 平面"][n];
 if(t==="text")return "文字放置位置";
 if(t==="point")return "点的位置";
 return n?`第 ${n+1} 个点`: ["midpoint","divide","bisector","length"].includes(t)?"线段或第一个点":"第一个点";
}
