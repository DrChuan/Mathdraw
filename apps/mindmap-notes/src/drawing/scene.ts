import { annotationLayout } from "./annotation";
import { angleMark, defaultAngleRadius } from "./angleMark";
import { exactCoordinates, exactNumber } from "./exactNumber";
import { mathPreview } from "./mathPreview";
import type { DrawingDocument, DrawingStyle, Vec2, Vec3 } from "./types";
import { defaultStyle } from "./types";
import {
  add,
  cross,
  dot,
  fromPlane,
  lerp,
  mul,
  norm,
  project,
  resolveGeometry,
  sub,
  viewRay,
  type Mesh,
} from "./geometry";
import type { CurveResult } from "./curves";
import { plotBounds } from "./viewport";
import { axisId, axisReference } from "./axes";
import { selectedBranch, constraintHidden } from "./constraints/document";
import { world } from "./constraints/math";
import { locusPaths } from "./constraints/loci";
export interface ScenePath {
  color?: string;
  id: string;
  owner: string;
  points: Vec2[];
  dashed: boolean;
  width: number;
  arrow?: boolean;
}
export interface SceneText {
  literal?: boolean;
  color?: string;
  id: string;
  owner: string;
  p: Vec2;
  text: string;
  fontSize: number;
  italic: boolean;
}
export interface SceneDot {
  color?: string;
  id: string;
  p: Vec2;
  radius: number;
}
export interface DrawingScene {
  paths: ScenePath[];
  texts: SceneText[];
  dots: SceneDot[];
  bounds: [number, number, number, number];
}
// Möller–Trumbore: only intersections strictly in front of the point occlude it.
export function rayTriangle(
  p: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): number | null {
  const e1 = sub(b, a),
    e2 = sub(c, a),
    h = cross(dir, e2),
    det = dot(e1, h);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det,
    s = sub(p, a),
    u = inv * dot(s, h);
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  const q = cross(s, e1),
    v = inv * dot(dir, q);
  if (v < -1e-8 || u + v > 1 + 1e-8) return null;
  const t = inv * dot(e2, q);
  return t > 1e-6 ? t : null;
}
export function isOccluded(p: Vec3, dir: Vec3, meshes: Mesh[]): boolean {
  return meshes.some((m) =>
    m.faces.some(
      ([a, b, c]) =>
        rayTriangle(p, dir, m.vertices[a], m.vertices[b], m.vertices[c]) !==
        null,
    ),
  );
}
export function splitVisibility(
  a: Vec3,
  b: Vec3,
  dir: Vec3,
  meshes: Mesh[],
  steps = 16,
): { a: Vec3; b: Vec3; hidden: boolean }[] {
  const result: { a: Vec3; b: Vec3; hidden: boolean }[] = [];
  let start = 0,
    previous = isOccluded(lerp(a, b, 1e-5), dir, meshes);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      hidden = isOccluded(lerp(a, b, Math.min(1 - 1e-5, t)), dir, meshes);
    if (hidden !== previous) {
      let lo = (i - 1) / steps,
        hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        if (isOccluded(lerp(a, b, mid), dir, meshes) === previous) lo = mid;
        else hi = mid;
      }
      const cut = (lo + hi) / 2;
      result.push({
        a: lerp(a, b, start),
        b: lerp(a, b, cut),
        hidden: previous,
      });
      start = cut;
      previous = hidden;
    }
  }
  result.push({ a: lerp(a, b, start), b, hidden: previous });
  return result;
}
// Along a line segment, a fixed viewing ray's triangle barycentrics and depth
// are affine in the segment parameter. Clip their inequalities instead of
// sampling: even a narrow occluder on a long coordinate axis must be retained.
export function splitVisibilityExact(a: Vec3, b: Vec3, dir: Vec3, meshes: Mesh[]) {
  const intervals: [number, number][] = [];
  for (const mesh of meshes) for (const face of mesh.faces) {
    const [p, q, r] = face.map(i => mesh.vertices[i]);
    const e1 = sub(q, p), e2 = sub(r, p), h = cross(dir, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-10) continue;
    const at = (point: Vec3) => {
      const s = sub(point, p), v = cross(s, e1);
      return [dot(s, h) / det, dot(dir, v) / det, dot(e2, v) / det];
    };
    const [u0, v0, d0] = at(a), [u1, v1, d1] = at(b);
    if (d0 <= 1e-6 && d1 <= 1e-6) continue;
    let lo = 0, hi = 1;
    for (const [start, end] of [
      [u0 + 1e-8, u1 + 1e-8], [v0 + 1e-8, v1 + 1e-8],
      [1 + 1e-8 - u0 - v0, 1 + 1e-8 - u1 - v1],
      [d0 - 1e-6, d1 - 1e-6],
    ]) {
      if (start < 0 && end < 0) { hi = -1; break; }
      if (start < 0) lo = Math.max(lo, start / (start - end));
      else if (end < 0) hi = Math.min(hi, start / (start - end));
    }
    if (hi - lo > 1e-10) intervals.push([lo, hi]);
  }
  intervals.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + 1e-10) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  const result: { a: Vec3; b: Vec3; hidden: boolean }[] = [];
  const append = (start: number, end: number, hidden: boolean) => {
    if (end - start > 1e-10) result.push({ a: lerp(a, b, start), b: lerp(a, b, end), hidden });
  };
  let start = 0;
  for (const [lo, hi] of merged) {
    append(start, lo, false);
    append(lo, hi, true);
    start = hi;
  }
  append(start, 1, false);
  return result;
}
export function sceneFor(
  doc: DrawingDocument,
  curves: CurveResult[],
  size: Vec2 = [1000, 700],
): DrawingScene {
  const scene: DrawingScene = {
      paths: [],
      texts: [],
      dots: [],
      bounds: [0, 0, 0, 0],
    },
    resolved = resolveGeometry(doc),
    objects = resolved.objects,
    dir = viewRay(doc),
    visibleMeshes = resolved.meshes.filter((m) => !objects.get(m.id)?.hidden&&!constraintHidden(objects,objects.get(m.id)));
  const frameBounds = plotBounds(size);
  const screen = (p: Vec3): Vec2 => {
    const q = project(p, doc);
    return [
      (q[0] - doc.view.center[0]) * doc.view.scale + size[0] / 2,
      (q[1] - doc.view.center[1]) * doc.view.scale + size[1] / 2,
    ];
  };
  const line = (
    id: string,
    owner: string,
    a: Vec3,
    b: Vec3,
    style: DrawingStyle,
    arrow = false,
    auto = true,
    exact = false,
  ) => {
    const mode = doc.edgeStyles[id] ?? style.line;
    if (mode === "hidden" || norm(sub(a, b)) < 1e-9) return;
    const segments =
      mode === "auto" && doc.dimension === "3d" && auto
        ? (exact || visibleMeshes.every(m=>!m.round) ? splitVisibilityExact : splitVisibility)(
            a,
            b,
            dir,
            id.endsWith(":silhouette")
              ? visibleMeshes.filter((m) => m.id !== owner)
              : visibleMeshes,
          )
        : [{ a, b, hidden: mode === "dashed" }];
    segments.forEach((s, i) =>
      scene.paths.push({
        id,
        owner,
        points: [screen(s.a), screen(s.b)],
        dashed: s.hidden,
        width: doc.lineWidth ?? 1.25,
        arrow: arrow && i === segments.length - 1,
      }),
    );
  };
  for (const edge of resolved.edges) {
    if(axisReference(edge.owner)) continue;
    const o = objects.get(edge.owner)!,
      a = resolved.points.get(edge.a),
      b = resolved.points.get(edge.b);
    if (o.hidden || constraintHidden(objects,o) || !a || !b || resolved.errors.has(edge.owner)) continue;
    if (o.kind === "line") {
      const u = sub(b.p, a.p),
        pa = project(a.p, doc),
        pb = project(b.p, doc),
        q: [number, number] = [pb[0] - pa[0], pb[1] - pa[1]],
        length = q[0] * q[0] + q[1] * q[1];
      if (length > 1e-14) {
        const t =
            ((doc.view.center[0] - pa[0]) * q[0] +
              (doc.view.center[1] - pa[1]) * q[1]) /
            length,
          extent = Math.hypot(...size) / doc.view.scale / Math.sqrt(length);
        line(
          edge.id,
          edge.owner,
          add(a.p, mul(u, o.ray ? Math.max(0, t - extent) : t - extent)),
          add(a.p, mul(u, o.ray ? Math.max(0, t + extent) : t + extent)),
          o.style,
        );
      }
    } else line(edge.id, edge.owner, a.p, b.p, o.style, edge.vector);
  }
  for(const obj of objects.values()) if(obj.kind === "line" && obj.relation?.type === "perpendicular" && obj.relation.showRightAngle && !obj.hidden && obj.style.line !== "hidden" && doc.edgeStyles[obj.id] !== "hidden" && !resolved.errors.has(obj.id)) {
    const own=resolved.edges.find(e=>e.owner===obj.id), reference=resolved.edges.find(e=>e.id===obj.relation!.reference);
    if(!own || !reference) continue;
    const a=resolved.points.get(own.a)?.p, b=resolved.points.get(own.b)?.p;
    const r=resolved.points.get(reference.a)?.p, s=resolved.points.get(reference.b)?.p;
    if(!a||!b||!r||!s) continue;
    const u=mul(sub(s,r),1/norm(sub(s,r))), v=mul(sub(b,a),1/norm(sub(b,a)));
    const foot=add(r,mul(u,dot(sub(a,r),u)));
    if(norm(cross(sub(a,foot),v))>1e-6) continue;
    const q=screen(foot), pu=screen(add(foot,u)), pv=screen(add(foot,v));
    const du:Vec2=[pu[0]-q[0],pu[1]-q[1]], dv:Vec2=[pv[0]-q[0],pv[1]-q[1]];
    const lu=Math.hypot(...du),lv=Math.hypot(...dv);
    if(lu<1e-6||lv<1e-6) continue;
    const U=du.map(n=>n/lu*9) as Vec2,V=dv.map(n=>n/lv*9) as Vec2;
    scene.paths.push({id:`${obj.id}:right-angle`,owner:obj.id,width:doc.lineWidth??1.25,dashed:false,
      points:[[q[0]+U[0],q[1]+U[1]],[q[0]+U[0]+V[0],q[1]+U[1]+V[1]],[q[0]+V[0],q[1]+V[1]]]});
  }
  // Curved bodies also need silhouette generators; mesh diagonals are never drawn.
  for (const mesh of visibleMeshes) {
    if (!mesh.round) continue;
    const o = objects.get(mesh.id)!;
    const adjacency = new Map<
      string,
      { a: number; b: number; signs: number[] }
    >();
    for (const [a, b, c] of mesh.faces) {
      const n = cross(
          sub(mesh.vertices[b], mesh.vertices[a]),
          sub(mesh.vertices[c], mesh.vertices[a]),
        ),
        sign = dot(n, dir);
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const key = [u, v].sort((a, b) => a - b).join(":"),
          edge = adjacency.get(key) ?? { a: u, b: v, signs: [] };
        edge.signs.push(sign);
        adjacency.set(key, edge);
      }
    }
    for (const e of adjacency.values())
      if (e.signs.some((v) => v > 1e-7) && e.signs.some((v) => v < -1e-7))
        line(
          `${mesh.id}:silhouette`,
          mesh.id,
          mesh.vertices[e.a],
          mesh.vertices[e.b],
          o.style,
          false,
          true,
        );
  }
  for (const result of curves) {
    const obj = objects.get(result.id);
    if (
      !obj ||
      obj.kind !== "curve" ||
      obj.hidden ||
      resolved.errors.has(obj.id) ||
      obj.style.line === "hidden"
    )
      continue;
    const plane = doc.planes.find((p) => p.id === obj.planeId)!;
    for (const path of result.paths) {
      if (doc.dimension === "3d" && visibleMeshes.length) {
        for (let i = 1; i < path.length; i++)
          line(
            obj.id,
            obj.id,
            fromPlane(plane, ...path[i - 1]),
            fromPlane(plane, ...path[i]),
            obj.style,
          );
      } else
        scene.paths.push({
          id: obj.id,
          owner: obj.id,
          points: path.map((p) => screen(fromPlane(plane, ...p))),
          dashed: obj.style.line === "dashed",
          width: doc.lineWidth ?? 1.25,
        });
    }
  }
  for(const obj of objects.values())if(obj.kind === "spatialLocus" && !obj.hidden) {
    const set=objects.get(obj.set);if(set?.kind!=="solutionSet"||set.hidden)continue;
    const locus=selectedBranch(set)?.loci.find(l=>l.point===obj.point);if(!locus)continue;
    const display=["line","plane"].includes(locus.kind)?{...locus,radius:Math.max(locus.radius,Math.max(...size)/doc.view.scale)}:locus;
    const mode=doc.edgeStyles[obj.id]??obj.style.line;if(mode === "hidden")continue;
    for(const path of locusPaths(display)) {
      if(mode!=="auto"||doc.dimension!=="3d"||!visibleMeshes.length)scene.paths.push({id:obj.id,owner:obj.id,
        points:path.map(p=>screen(world(p,set.placement))),dashed:mode === "dashed",width:doc.lineWidth??1.25});
      else for(let i=1;i<path.length;i++)
        line(obj.id,obj.id,world(path[i-1],set.placement),world(path[i],set.placement),obj.style,false,true,true);
    }
  }
  const mathLabel=(id:string,owner:string,p:Vec2,source:string,fontSize:number,italic:boolean)=>{
    const box=annotationLayout(source,fontSize,italic);
    box.glyphs.forEach((g,i)=>scene.texts.push({id:`${id}:glyph:${i}`,owner,p:[p[0]+g.x,p[1]+g.y],text:g.text,fontSize:g.size,italic:g.italic,literal:true}));
    box.lines.forEach((line,i)=>scene.paths.push({id:`${id}:rule:${i}`,owner,points:line.map(([x,y])=>[p[0]+x,p[1]+y]),dashed:false,width:doc.lineWidth??1.25}));
  };
  for (const point of resolved.points.values()) {
    const obj = point.object;
    if (!obj || obj.hidden || constraintHidden(objects,obj)) continue;
    const p = screen(point.p);
    if (obj.dot === "show" || (obj.dot !== "hide" && !resolved.connected.has(point.id)))
      scene.dots.push({ id: point.id, p, radius: 2.3 });
    const frame = doc.coordinateFrame;
    const labelCoordinates: Vec3 =
      frame && doc.view.mode === "space"
        ? [
            dot(sub(point.p, frame.origin), frame.x),
            dot(sub(point.p, frame.origin), frame.y),
            dot(
              sub(point.p, frame.origin),
              mul(cross(frame.x, frame.y), frame.zSign),
            ),
          ]
        : point.p;
    const name = obj.showName ? obj.name : "";
    const at:Vec2=[p[0]+obj.labelOffset[0],p[1]+obj.labelOffset[1]];
    if(obj.coordinates==="full") {
      const coord=exactCoordinates(doc.dimension==="2d"?point.p.slice(0,2):labelCoordinates);
      mathLabel(`${point.id}:label`,point.id,at,`${name}$${coord.approximate?"\\approx":""}${mathPreview(coord.source)}$`,obj.style.fontSize,obj.style.italic);
    } else if(name)scene.texts.push({id:`${point.id}:label`,owner:point.id,p:at,text:name,fontSize:obj.style.fontSize,italic:obj.style.italic});
    if (obj.coordinates === "axes") {
      const plane = doc.planes.find((p) => p.id === doc.view.planeId)!,
        local = sub(point.p, plane.origin),
        u = dot(local, plane.u),
        v = dot(local, plane.v);
      const frame = doc.coordinateFrame,
        origin = frame?.origin ?? ([0, 0, 0] as Vec3),
        dirs: Vec3[] = frame
          ? [frame.x, frame.y, mul(cross(frame.x, frame.y), frame.zSign)]
          : [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ];
      const coordinates = dirs.map((dir) => dot(sub(point.p, origin), dir));
      const ps =
        doc.view.mode === "space"
          ? dirs.map((dir, i) => add(origin, mul(dir, coordinates[i])))
          : [fromPlane(plane, u, 0), fromPlane(plane, 0, v)];
      ps.forEach((axis, i) => {
        scene.paths.push({
          id: `${point.id}:projection`,
          owner: point.id,
          points: [p, screen(axis)],
          dashed: true,
          width: doc.lineWidth ?? 1.25,
        });
        const q = screen(axis);
        const value=exactNumber(doc.view.mode==="space"?coordinates[i]:i===0?u:v);
        mathLabel(`${point.id}:coord:${i}`,point.id,[q[0]+5,q[1]+18],`$${value.approximate?"\\approx":""}${mathPreview(value.source)}$`,obj.style.fontSize,false);
      });
    }
  }
  for (const o of objects.values()) if(o.kind === "label" && !o.hidden && !resolved.errors.has(o.id)) {
    if(o.measurement?.type==="angle"&&o.style.line!=="hidden") {
      const m=o.measurement,ps=m.references.map(id=>resolved.points.get(id)?.p),plane=doc.planes.find(p=>p.id===m.planeId);
      if(ps.every((p):p is Vec3=>!!p)&&plane) {
        const mark=angleMark(ps[0],ps[1],ps[2],(m.arcRadius??defaultAngleRadius)/doc.view.scale,cross(plane.u,plane.v));
        if(mark.angle>1e-8)scene.paths.push({id:`${o.id}:angle-arc`,owner:o.id,points:mark.points.map(screen),dashed:o.style.line==="dashed",width:doc.lineWidth??1.25});
      }
    }
    const p=screen(o.position);
    if(/\$|\\[([]/.test(o.text)) {
      const b=annotationLayout(o.text,o.style.fontSize,o.style.italic);
      b.glyphs.forEach((g,i)=>scene.texts.push({id:`${o.id}:math:${i}`,owner:o.id,p:[p[0]+g.x,p[1]+g.y],text:g.text,fontSize:g.size,italic:g.italic,literal:true}));
      b.lines.forEach((line,i)=>scene.paths.push({id:`${o.id}:math-rule:${i}`,owner:o.id,points:line.map(([x,y])=>[p[0]+x,p[1]+y]),dashed:false,width:doc.lineWidth??1.25}));
    } else scene.texts.push({id:o.id,owner:o.id,p,text:o.text,fontSize:o.style.fontSize,italic:o.style.italic});
  }
  if (doc.view.axes) {
    const plane = doc.planes.find((p) => p.id === doc.view.planeId)!,
      extent = (Math.max(size[0], size[1]) / doc.view.scale) * 0.7;
    const frame = doc.coordinateFrame,
      origin3 = frame?.origin ?? ([0, 0, 0] as Vec3);
    const dirs: Vec3[] = frame
      ? [frame.x, frame.y, mul(cross(frame.x, frame.y), frame.zSign)]
      : [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
    const axes =
      doc.view.mode === "space"
        ? [
            { origin: origin3, dir: dirs[0], name: "x" },
            { origin: origin3, dir: dirs[1], name: "y" },
            { origin: origin3, dir: dirs[2], name: "z" },
          ]
        : [
            {
              origin: plane.origin,
              dir: plane.u,
              name: doc.dimension === "2d" ? "x" : "u",
            },
            {
              origin: plane.origin,
              dir: plane.v,
              name: doc.dimension === "2d" ? "y" : "v",
            },
          ];
    for (const axis of axes) {
      const id=axisId(axis.name === "u" ? "x" : axis.name === "v" ? "y" : axis.name as "x"|"y"|"z",doc.view.mode === "plane" ? plane.id : undefined);
      if(doc.edgeStyles[id] === "hidden") continue;
      const worldA = add(axis.origin, mul(axis.dir, doc.dimension === "3d" ? 0 : -extent)),
        worldB = add(axis.origin, mul(axis.dir, extent)),
        a = screen(worldA), b = screen(worldB),
        dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
      if (length2 < 1e-12) continue;
      const clipped = clipLine(a, b, frameBounds);
      if (clipped) {
        const parameter = (p: Vec2) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2;
        line(id, id, lerp(worldA, worldB, parameter(clipped[0])),
          lerp(worldA, worldB, parameter(clipped[1])), defaultStyle(), true, true, true);
        scene.texts.push({
          id: `axis:${axis.name}`,
          owner: "axis",
          p: [clipped[1][0] - 18, clipped[1][1] + 20],
          text: axis.name,
          fontSize: 18,
          italic: true,
        });
      }
    }
    const origin = screen(doc.view.mode === "space" ? origin3 : plane.origin);
    const originObject = doc.objects.find(o => o.kind === "point" && o.construction.type === "origin");
    const offset = originObject?.kind === "point" ? originObject.labelOffset : [-17,19];
    if (!originObject&&!doc.coordinateOriginId) scene.texts.push({
      id: "axis:O",
      owner: "axis",
      p: [origin[0] + offset[0], origin[1] + offset[1]],
      text: "O",
      fontSize: 18,
      italic: true,
    });
  }
  for (const p of scene.paths) p.color = objects.get(p.owner)?.style.color;
  for (const p of scene.dots) p.color = objects.get(p.id)?.style.color;
  for (const p of scene.texts) p.color = objects.get(p.owner)?.style.color;
  // Geometry stops at the same frame as the axis endpoints, leaving screenshot margins.
  scene.paths = scene.paths.flatMap((path) => {
    const parts: ScenePath[] = [];
    let current: Vec2[] = [];
    for (let i = 1; i < path.points.length; i++) {
      const pair = clipLine(path.points[i - 1], path.points[i], frameBounds);
      if (!pair) {
        if (current.length > 1)
          parts.push({ ...path, points: current, arrow: false });
        current = [];
        continue;
      }
      const last = current.at(-1);
      if (last && Math.hypot(last[0] - pair[0][0], last[1] - pair[0][1]) < 0.01)
        current.push(pair[1]);
      else {
        if (current.length > 1)
          parts.push({ ...path, points: current, arrow: false });
        current = pair;
      }
    }
    if (current.length > 1) parts.push({ ...path, points: current });
    return parts;
  });
  scene.texts = scene.texts.filter(
    (t) => t.p[0] >= 12 && t.p[0] <= size[0]-12 && t.p[1] >= t.fontSize+8 && t.p[1] <= size[1]-12,
  );
  scene.dots = scene.dots.filter(
    (d) => d.p[0] >= frameBounds[0]+d.radius && d.p[0] <= frameBounds[1]-d.radius && d.p[1] >= frameBounds[2]+d.radius && d.p[1] <= frameBounds[3]-d.radius,
  );
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  const include = (p: Vec2, pad = 3) => {
    xmin = Math.min(xmin, p[0] - pad);
    xmax = Math.max(xmax, p[0] + pad);
    ymin = Math.min(ymin, p[1] - pad);
    ymax = Math.max(ymax, p[1] + pad);
  };
  for (const p of scene.paths)
    for (const q of p.points) include(q, p.arrow ? 10 : 3);
  for (const d of scene.dots) include(d.p, 4);
  for (const t of scene.texts) {
    include([t.p[0], t.p[1] - t.fontSize], 3);
    include(
      [
        t.p[0] + labelPlainText(t.text).length * t.fontSize * 0.7,
        t.p[1] + t.fontSize * 0.3,
      ],
      3,
    );
  }
  scene.bounds = Number.isFinite(xmin)
    ? [xmin - 12, xmax + 12, ymin - 12, ymax + 12]
    : [0, size[0], 0, size[1]];
  return scene;
}
export function clipLine(
  a: Vec2,
  b: Vec2,
  bounds: [number, number, number, number],
): [Vec2, Vec2] | null {
  const [xmin, xmax, ymin, ymax] = bounds,
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  let lo = 0,
    hi = 1;
  const p = [-dx, dx, -dy, dy],
    q = [a[0] - xmin, xmax - a[0], a[1] - ymin, ymax - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) lo = Math.max(lo, r);
      else hi = Math.min(hi, r);
      if (lo > hi) return null;
    }
  }
  return [
    [a[0] + lo * dx, a[1] + lo * dy],
    [a[0] + hi * dx, a[1] + hi * dy],
  ];
}
export interface LabelRun {
  text: string;
  script: "normal" | "sub" | "super";
}
export function labelRuns(text: string): LabelRun[] {
  const runs: LabelRun[] = [];
  const re = /([_^])(?:\{([^{}]*)\}|([^_^{}]))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last)
      runs.push({ text: text.slice(last, m.index), script: "normal" });
    runs.push({ text: m[2] ?? m[3], script: m[1] === "_" ? "sub" : "super" });
    last = m.index! + m[0].length;
  }
  if (last < text.length)
    runs.push({ text: text.slice(last), script: "normal" });
  return runs;
}
export const labelPlainText = (text: string) =>
  labelRuns(text)
    .map((r) => r.text)
    .join("");
export function labelTypography(text: string, italic: boolean): (LabelRun & { italic: boolean })[] {
  return labelRuns(text).flatMap(run => {
    const result: (LabelRun & { italic: boolean })[] = [];
    for (const char of run.text) {
      const slanted = italic && /[\p{Script=Latin}\p{Script=Greek}]/u.test(char);
      const previous = result.at(-1);
      if (previous?.italic === slanted) previous.text += char;
      else result.push({ text: char, script: run.script, italic: slanted });
    }
    return result;
  });
}
export const pathData = (points: Vec2[]) =>
  points
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(3)},${p[1].toFixed(3)}`)
    .join(" ");
export function arrowData(points: Vec2[], width = 1.25) {
  if (points.length < 2) return "";
  const b = points.at(-1)!,
    a = points.at(-2)!,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy);
  if (len < 1e-8) return "";
  const u = dx / len,
    v = dy / len,
    s = 6 + width;
  return `M${b[0]},${b[1]} L${b[0] - u * s - v * s * 0.45},${b[1] - v * s + u * s * 0.45} L${b[0] - u * s * 0.65},${b[1] - v * s * 0.65} L${b[0] - u * s + v * s * 0.45},${b[1] - v * s - u * s * 0.45} Z`;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function exportSvg(
  scene: DrawingScene,
  doc: DrawingDocument,
  size: Vec2,
): string {
  let bounds =
    doc.output.crop === "view" ? [0, size[0], 0, size[1]] : scene.bounds;
  if (doc.output.crop === "custom") {
    const [xmin, xmax, ymin, ymax] = doc.output.bounds,
      s = doc.view.scale,
      [cx, cy] = doc.view.center;
    bounds = [
      (xmin - cx) * s + size[0] / 2,
      (xmax - cx) * s + size[0] / 2,
      (-ymax - cy) * s + size[1] / 2,
      (-ymin - cy) * s + size[1] / 2,
    ];
  }
  const [xmin, xmax, ymin, ymax] = bounds,
    width = Math.max(1, xmax - xmin),
    height = Math.max(1, ymax - ymin);
  const body = [
    doc.output.background === "white"
      ? `<rect x="${xmin}" y="${ymin}" width="${width}" height="${height}" fill="white"/>`
      : "",
    ...scene.paths.map(
      (p) =>
        `<path d="${pathData(p.points)}" fill="none" stroke="${p.color ?? "#161b22"}" stroke-width="${p.width}"${p.dashed ? ' stroke-dasharray="5 4"' : ""}/>${p.arrow ? `<path d="${arrowData(p.points, p.width)}" fill="${p.color ?? "#161b22"}" stroke="none"/>` : ""}`,
    ),
    ...scene.dots.map(
      (d) =>
        `<circle cx="${d.p[0]}" cy="${d.p[1]}" r="${d.radius}" fill="${d.color ?? "#161b22"}"/>`,
    ),
    ...scene.texts.map(
      (t) =>
        `<text x="${t.p[0]}" y="${t.p[1]}" font-family="Times New Roman" font-size="${t.fontSize}" font-style="normal" fill="${t.color ?? "#161b22"}">${(t.literal ? [{text:t.text,script:"normal",italic:t.italic}] : labelTypography(t.text,t.italic))
          .map(
            (r) =>
              `<tspan font-style="${r.italic ? "italic" : "normal"}"${r.script === "normal" ? ' baseline-shift="0"' : ` baseline-shift="${r.script === "sub" ? "sub" : "super"}" font-size="70%"`}>${escape(r.text)}</tspan>`,
          )
          .join("")}</text>`,
    ),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${xmin} ${ymin} ${width} ${height}">${body}</svg>`;
}
