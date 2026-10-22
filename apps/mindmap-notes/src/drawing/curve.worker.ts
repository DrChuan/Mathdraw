import { sampleCurve, type CurveResult } from "./curves";
import type { DrawingCurve } from "./types";
const cache = new Map<string, CurveResult>();
self.onmessage = (
  event: MessageEvent<{ id: number; curves: DrawingCurve[]; resolution: number }>,
) => {
  const results = event.data.curves.map((curve) => {
    try {
      const key = JSON.stringify([curve.id, curve.equation, curve.parametric, curve.range, curve.limits, curve.locusInput, curve.reflectionInput, event.data.resolution]);
      const previous = cache.get(key);
      if (previous) { cache.delete(key); cache.set(key,previous); return previous; }
      const result = sampleCurve(curve, curve.range, event.data.resolution);
      cache.set(key,result);
      if(cache.size > 32) cache.delete(cache.keys().next().value!);
      return result;
    } catch (e) {
      return { id: curve.id, paths: [], error: (e as Error).message };
    }
  });
  self.postMessage({id:event.data.id, results});
};
