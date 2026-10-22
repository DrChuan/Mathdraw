import type { Vec2 } from "./types";
/** Screen-space plot frame. Axes and geometry share its limits, leaving a clean margin. */
export function plotBounds(size: Vec2): [number, number, number, number] {
  const margin = Math.min(40, Math.min(...size) * .12);
  return [margin, size[0] - margin, margin, size[1] - margin];
}
export const insidePlot = (size: Vec2, q: Vec2) => {
  const [l,r,t,b] = plotBounds(size);
  return q[0] >= l && q[0] <= r && q[1] >= t && q[1] <= b;
};
