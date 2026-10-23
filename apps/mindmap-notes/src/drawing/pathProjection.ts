import type { DrawingCurve, Vec2 } from "./types";
import { curveFunction } from "./constructions";
/** A local cursor projection can fail without invalidating the source curve. */
export class PathProjectionError extends Error {}
/** Project locally, limiting travel so an invalid branch never silently jumps across the graph. */
export function pointOnImplicit(curve: DrawingCurve, seed: Vec2): Vec2 {
  const fn = curveFunction(curve),
    span = Math.max(
      curve.range[1] - curve.range[0],
      curve.range[3] - curve.range[2],
    ),
    h = 1e-5 * Math.max(1, span),
    maxTravel = Math.max(0.1, span * 0.15);
  let [x, y] = seed;
  for (let i = 0; i < 40; i++) {
    const f = fn(x, y);
    if (!Number.isFinite(f)) break;
    if (Math.abs(f) < 1e-9) return [x, y];
    const a = (fn(x + h, y) - fn(x - h, y)) / (2 * h),
      b = (fn(x, y + h) - fn(x, y - h)) / (2 * h),
      s = a * a + b * b;
    if (s < 1e-20) break;
    let dx = (f * a) / s,
      dy = (f * b) / s;
    const step = Math.hypot(dx, dy);
    if (step > maxTravel / 4) {
      dx *= maxTravel / 4 / step;
      dy *= maxTravel / 4 / step;
    }
    x -= dx;
    y -= dy;
    if (Math.hypot(x - seed[0], y - seed[1]) > maxTravel) break;
  }
  throw new PathProjectionError("原曲线分支暂时失效，保留原位置；可重新定位来源");
}
