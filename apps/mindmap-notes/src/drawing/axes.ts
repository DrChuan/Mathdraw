export type AxisName = "x" | "y" | "z";
export const axisId = (axis: AxisName, planeId?: string) => `@axis:${axis}${planeId ? `:${planeId}` : ""}`;
export function axisReference(id: string) {
  const m=id.match(/^@axis:([xyz])(?::(.+))?$/);
  return m ? {axis:m[1] as AxisName,planeId:m[2]} : undefined;
}
