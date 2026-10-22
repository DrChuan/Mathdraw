import type { Vec3 } from "./types";
import { add, sub, mul, dot, cross, norm, unit } from "./constraints/math";

export const defaultAngleRadius = 28;

/** The minor angle in the actual plane of its three points, including 3D. */
export function angleMark(a:Vec3,b:Vec3,c:Vec3,radius:number,planeNormal:Vec3) {
  const ba=sub(a,b),bc=sub(c,b);
  if(norm(ba)<1e-12||norm(bc)<1e-12)throw new Error("重合点无法度量角度");
  const u=unit(ba),v=unit(bc),cos=Math.max(-1,Math.min(1,dot(u,v))),angle=Math.acos(cos);
  let tangent=sub(v,mul(u,cos));
  if(norm(tangent)<1e-10) {
    tangent=cross(planeNormal,u);
    if(norm(tangent)<1e-10)tangent=cross(Math.abs(u[0])<.8?[1,0,0]:[0,1,0],u);
  }
  tangent=unit(tangent);
  const at=(t:number)=>add(b,mul(add(mul(u,Math.cos(t)),mul(tangent,Math.sin(t))),radius));
  const count=Math.max(8,Math.ceil(angle*24));
  return {angle,points:Array.from({length:count+1},(_,i)=>at(angle*i/count)),mid:at(angle/2)};
}
