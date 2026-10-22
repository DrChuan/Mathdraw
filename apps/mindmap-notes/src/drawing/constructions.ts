import type { DrawingDocument, DrawingCurve, Vec2, Vec3 } from "./types";
import { equation, evaluate } from "./expression";
import { pointAt, withinCurve } from "./parametric";
// Kept independent of rendering and the UI; every construction is recomputed from its sources.
const add = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x + b[i]) as Vec3;
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x - b[i]) as Vec3;
const mul = (a: Vec3, k: number): Vec3 => a.map((x) => x * k) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3) => mul(a, 1 / norm(a));
export function leastSquares(
  rows: number[][],
  values: number[],
  dimension: number,
): number[] {
  // Column-pivoted elimination on a scaled system; rank deficiency is an error, never a guessed solution.
  const scales = Array.from({ length: dimension }, (_, i) =>
    Math.max(...rows.map((r) => Math.abs(r[i])), 1e-30),
  );
  const scaled = rows.map((r) => r.map((v, i) => v / scales[i]));
  const a = Array.from({ length: dimension }, (_, i) => [
    ...Array.from({ length: dimension }, (_, j) =>
      scaled.reduce((s, r) => s + r[i] * r[j], 0),
    ),
    scaled.reduce((s, r, k) => s + r[i] * values[k], 0),
  ]);
  for (let col = 0; col < dimension; col++) {
    let pivot = col;
    for (let i = col + 1; i < dimension; i++)
      if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    if (Math.abs(a[pivot][col]) < 1e-10)
      throw new Error("无法唯一确定，请补充不共面的顶点");
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const k = a[col][col];
    for (let j = col; j <= dimension; j++) a[col][j] /= k;
    for (let i = 0; i < dimension; i++)
      if (i !== col) {
        const k = a[i][col];
        for (let j = col; j <= dimension; j++) a[i][j] -= k * a[col][j];
      }
  }
  return a.map((r, i) => r[dimension] / scales[i]);
}
export function circumsphere(points: Vec3[]): { center: Vec3; radius: number } {
  if (points.length < 4)
    throw new Error("外接球无法唯一确定，请选择至少 4 个不共面的顶点");
  const origin = points[0],
    local = points.slice(1).map((p) => sub(p, origin));
  const centerLocal = leastSquares(
    local.map((p) => mul(p, 2)),
    local.map((p) => dot(p, p)),
    3,
  ) as Vec3;
  const radius = norm(centerLocal),
    tolerance = 1e-6 * Math.max(1, radius);
  if (
    !Number.isFinite(radius) ||
    radius < 1e-9 ||
    local.some((p) => Math.abs(norm(sub(p, centerLocal)) - radius) > tolerance)
  )
    throw new Error("所选顶点不共球，不存在外接球");
  return { center: add(origin, centerLocal), radius };
}
export function insphere(
  vertices: Vec3[],
  faces: [number, number, number][],
): { center: Vec3; radius: number } {
  const origin = mul(vertices.reduce(add, [0, 0, 0]), 1 / vertices.length),
    local = vertices.map((v) => sub(v, origin));
  const rows: number[][] = [],
    values: number[] = [];
  for (const [a, b, c] of faces) {
    let n = cross(sub(local[b], local[a]), sub(local[c], local[a]));
    if (norm(n) < 1e-10) continue;
    n = unit(n);
    if (dot(n, local[a]) < 0) n = mul(n, -1);
    const h = dot(n, local[a]);
    if (local.some((p) => dot(n, p) > h + 1e-7))
      throw new Error("该多面体不是凸多面体，无法建立与全部面相切的内切球");
    if (
      rows.some(
        (r, i) =>
          norm(sub(r.slice(0, 3) as Vec3, n)) < 1e-7 &&
          Math.abs(values[i] - h) < 1e-7,
      )
    )
      continue;
    rows.push([...n, 1]);
    values.push(h);
  }
  const result = leastSquares(rows, values, 4),
    center = result.slice(0, 3) as Vec3,
    radius = result[3];
  if (
    radius <= 1e-9 ||
    rows.some(
      (r, i) =>
        Math.abs(dot(r.slice(0, 3) as Vec3, center) + radius - values[i]) >
        1e-6 * Math.max(1, radius),
    )
  )
    throw new Error("不存在与该多面体所有面相切的内切球");
  return { center: add(origin, center), radius };
}
export function polygonGeometry(points: Vec3[]) {
  if (points.length < 3 || points.length > 64)
    throw new Error("多边形需要 3～64 个顶点");
  if (
    points.some((p, i) =>
      points.some((q, j) => i !== j && norm(sub(p, q)) < 1e-8),
    )
  )
    throw new Error("多边形顶点不能重合");
  const o = points[0],
    u = unit(sub(points[1], o));
  let n: Vec3 = [0, 0, 0];
  for (let i = 2; i < points.length && norm(n) < 1e-9; i++)
    n = cross(u, sub(points[i], o));
  if (norm(n) < 1e-9) throw new Error("多边形顶点共线");
  n = unit(n);
  const v = cross(n, u);
  const scale = Math.max(1, ...points.map((p) => norm(sub(p, o))));
  if (points.some((p) => Math.abs(dot(sub(p, o), n)) > scale * 1e-7))
    throw new Error("多边形顶点必须在同一平面");
  const p: Vec2[] = points.map((p) => [dot(sub(p, o), u), dot(sub(p, o), v)]);
  const area = (a: Vec2, b: Vec2, c: Vec2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const eps = 1e-10 * scale * scale;
  const between = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.abs(area(a, b, c)) <= eps &&
    c[0] >= Math.min(a[0], b[0]) - eps &&
    c[0] <= Math.max(a[0], b[0]) + eps &&
    c[1] >= Math.min(a[1], b[1]) - eps &&
    c[1] <= Math.max(a[1], b[1]) + eps;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length];
      if (
        (area(a, b, c) * area(a, b, d) < -eps &&
          area(c, d, a) * area(c, d, b) < -eps) ||
        between(a, b, c) ||
        between(a, b, d) ||
        between(c, d, a) ||
        between(c, d, b)
      )
        throw new Error("多边形边不能交叉或重叠，请按轮廓顺序输入顶点");
    }
  const signed = p.reduce(
      (s, a, i) =>
        s + a[0] * p[(i + 1) % p.length][1] - a[1] * p[(i + 1) % p.length][0],
      0,
    ),
    sign = Math.sign(signed);
  if (Math.abs(signed) < eps) throw new Error("多边形面积为零");
  const remaining = p.map((_, i) => i),
    triangles: [number, number, number][] = [];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length],
        b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (sign * area(p[a], p[b], p[c]) <= eps) continue;
      if (
        remaining.some(
          (k) =>
            k !== a &&
            k !== b &&
            k !== c &&
            sign * area(p[a], p[b], p[k]) >= -eps &&
            sign * area(p[b], p[c], p[k]) >= -eps &&
            sign * area(p[c], p[a], p[k]) >= -eps,
        )
      )
        continue;
      triangles.push([a, b, c]);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) throw new Error("多边形含重复或多余共线顶点，请简化顶点");
  }
  triangles.push(remaining as [number, number, number]);
  return { triangles, normal: n };
}
export function curveFunction(curve: DrawingCurve) {
  const parsed = equation(curve.equation);
  return (x: number, y: number) => {
    const value = evaluate(parsed.ast, { x, y, u: x, v: y });
    return parsed.type === "y"
      ? y - value
      : parsed.type === "x"
        ? x - value
        : value;
  };
}
/** Bisection plus local minimization catches simple roots and tangency, rejecting poles by residual. */
export function roots(
  fn: (t: number) => number,
  lo: number,
  hi: number,
): number[] {
  const out: number[] = [],
    steps = 1200,
    step = (hi - lo) / steps;
  const started=performance.now();
  const accept = (t: number) => {
    const value = fn(t);
    if (
      Number.isFinite(value) &&
      Math.abs(value) < 1e-7 &&
      !out.some((x) => Math.abs(x - t) < 1e-5 * Math.max(1, hi - lo))
    ) {
      out.push(t);
      if(out.length>100)throw new Error("此坐标对应无穷多个点，无法唯一确定，请更换坐标");
    }
  };
  let a = lo,
    fa = fn(a);
  accept(a);
  for (let i = 1; i <= steps; i++) {
    if(i%16===0 && performance.now()-started>12)
      throw new Error("曲线求解超时，请缩小范围或简化表达式");
    const b = lo + i * step,
      fb = fn(b);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) {
      let l = a,
        r = b,
        f = fa;
      for (let j = 0; j < 48; j++) {
        const m = (l + r) / 2,
          g = fn(m);
        if (f * g <= 0) r = m;
        else {
          l = m;
          f = g;
        }
      }
      accept((l + r) / 2);
    }
    const mid = (a + b) / 2,
      fm = fn(mid);
    if (
      Number.isFinite(fm) &&
      Math.abs(fm) < Math.min(Math.abs(fa), Math.abs(fb))
    ) {
      let l = a,
        r = b;
      for (let j = 0; j < 48; j++) {
        const l1 = l + (r - l) / 3,
          r1 = r - (r - l) / 3;
        if (Math.abs(fn(l1)) < Math.abs(fn(r1))) r = r1;
        else l = l1;
      }
      accept((l + r) / 2);
    }
    accept(b);
    a = b;
    fa = fb;
  }
  if (out.length > 100)
    throw new Error("此坐标对应无穷多个点，无法唯一确定，请更换坐标");
  return out.sort((a, b) => a - b);
}
export function coordinateOnCurve(
  curve: DrawingCurve,
  axis: "x" | "y",
  value: number,
  doc: DrawingDocument,
): Vec3[] {
  if(curve.parametric) {
    const p=doc.planes.find(p=>p.id===curve.planeId)!,i=axis === "x"?0:1;
    return roots(t=>pointAt(curve,t)[i]-value,curve.parametric.tMin,curve.parametric.tMax)
      .map(t=>pointAt(curve,t)).filter(q=>withinCurve(curve,q))
      .map(q=>add(p.origin,add(mul(p.u,q[0]),mul(p.v,q[1]))));
  }
  const fn = curveFunction(curve),
    range = curve.range,
    parsed = equation(curve.equation);
  const plane = doc.planes.find((p) => p.id === curve.planeId)!;
  if (parsed.type === (axis === "x" ? "y" : "x")) {
    const other = evaluate(parsed.ast, {
      x: value,
      y: value,
      u: value,
      v: value,
    });
    if (!Number.isFinite(other) || Math.abs(other) > 1e9) return [];
    return [
      add(
        plane.origin,
        add(
          mul(plane.u, axis === "x" ? value : other),
          mul(plane.v, axis === "x" ? other : value),
        ),
      ),
    ].filter(p=>withinCurve(curve,[dot(sub(p,plane.origin),plane.u),dot(sub(p,plane.origin),plane.v)]));
  }
  const solutions = roots(
    (t) => (axis === "x" ? fn(value, t) : fn(t, value)),
    axis === "x" ? range[2] : range[0],
    axis === "x" ? range[3] : range[1],
  );
  const p = doc.planes.find((p) => p.id === curve.planeId)!;
  return solutions.map((t) =>
    add(
      p.origin,
      add(
        mul(p.u, axis === "x" ? value : t),
        mul(p.v, axis === "x" ? t : value),
      ),
    ),
  ).filter(q=>withinCurve(curve,[dot(sub(q,p.origin),p.u),dot(sub(q,p.origin),p.v)]));
}
export function implicitIntersections(
  first: (x: number, y: number) => number,
  second: (x: number, y: number) => number,
  range: [number, number, number, number],
  budgetMs = 12,
): Vec2[] {
  const result: Vec2[] = [],
    [xmin, xmax, ymin, ymax] = range,
    span = Math.max(xmax - xmin, ymax - ymin),
    h = 1e-5 * Math.max(1, span),
    start = performance.now();
  const probes = Array.from({ length: 12 }, (_, i) => {
    const x = xmin + ((xmax - xmin) * (i + 0.31)) / 12,
      y = ymin + ((ymax - ymin) * (((i * 7) % 12) + 0.17)) / 12;
    return [first(x, y), second(x, y)];
  }).filter((p) => p.every(Number.isFinite));
  const reference = probes.find(
    (p) => Math.abs(p[0]) > 1e-8 && Math.abs(p[1]) > 1e-8,
  );
  if (reference && probes.length >= 8) {
    const ratio = reference[0] / reference[1];
    if (
      probes.every(
        ([a, b]) =>
          Math.abs(a - ratio * b) <
          1e-8 * Math.max(1, Math.abs(a), Math.abs(ratio * b)),
      )
    )
      throw new Error("两个图形重合，交点无法唯一确定");
  }
  for (let i = 0; i <= 24; i++)
    for (let j = 0; j <= 24; j++) {
      if (performance.now() - start > budgetMs)
        throw new Error("交点计算超时，请缩小曲线范围");
      let x = xmin + ((xmax - xmin) * i) / 24,
        y = ymin + ((ymax - ymin) * j) / 24;
      for (let k = 0; k < 45; k++) {
        const f = first(x, y),
          g = second(x, y);
        if (!Number.isFinite(f + g)) break;
        if (Math.abs(f)+Math.abs(g)<1e-11) break;
        const a = (first(x + h, y) - first(x - h, y)) / (2 * h),
          b = (first(x, y + h) - first(x, y - h)) / (2 * h),
          c = (second(x + h, y) - second(x - h, y)) / (2 * h),
          d = (second(x, y + h) - second(x, y - h)) / (2 * h),
          det = a * d - b * c;
        if (Math.abs(det) < 1e-13) break;
        const dx = (d * f - b * g) / det,
          dy = (a * g - c * f) / det;
        x -= dx;
        y -= dy;
        if (Math.abs(dx) + Math.abs(dy) < 1e-10) break;
        if (Math.abs(x) + Math.abs(y) > 1e9) break;
      }
      if (
        x >= xmin - 1e-6 &&
        x <= xmax + 1e-6 &&
        y >= ymin - 1e-6 &&
        y <= ymax + 1e-6 &&
        Math.abs(first(x, y)) + Math.abs(second(x, y)) < 1e-7 &&
        !result.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-5)
      )
        result.push([x, y]);
    }
  if (result.length > 100)
    throw new Error("两个图形可能重合，交点无法唯一确定");
  return result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
