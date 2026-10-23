import type { Positions } from "./types";
import type { Vec3 } from "../types";
import { add,sub,mul,dot,cross,norm,unit,perpendicular } from "./math";

/** Try an exact Euclidean motion before deforming a configuration. One anchor
 * permits rotation about that point; collinear anchors permit rotation about
 * their common axis. All anchors must remain fixed. The caller still verifies
 * every original condition, so this is only a candidate, never an exemption. */
export function rigidMotion(p:Positions,reference:string[],driver:string,target:Vec3,scale:number):Positions|undefined {
  const origin=p[reference[0]],source=p[driver];if(!origin||!source)return;
  const tolerance=1e-8*Math.max(scale,1e-8),a=sub(source,origin),b=sub(target,origin);
  const fixed=reference.map(n=>sub(p[n],origin)),second=fixed.find(v=>norm(v)>tolerance);
  let axis:Vec3,cosine:number,sine:number;
  if(second) {
    axis=unit(second);if(fixed.some(v=>norm(cross(v,axis))>tolerance))return;
    if(Math.abs(dot(a,axis)-dot(b,axis))>tolerance)return;
    const u=sub(a,mul(axis,dot(a,axis))),v=sub(b,mul(axis,dot(b,axis))),length=norm(u);
    if(length<tolerance||Math.abs(length-norm(v))>tolerance)return;
    cosine=dot(u,v)/(length*length);sine=dot(axis,cross(u,v))/(length*length);
  } else {
    const length=norm(a);if(length<tolerance||Math.abs(length-norm(b))>tolerance)return;
    const u=unit(a),v=unit(b),normal=cross(u,v);cosine=Math.max(-1,Math.min(1,dot(u,v)));sine=norm(normal);
    axis=sine>1e-12?unit(normal):perpendicular(u);
  }
  const rotate=(v:Vec3)=>add(add(mul(v,cosine),mul(cross(axis,v),sine)),mul(axis,dot(axis,v)*(1-cosine)));
  const result=Object.fromEntries(Object.entries(p).map(([name,q])=>[name,add(origin,rotate(sub(q,origin)))]));
  if(reference.some(n=>norm(sub(result[n],p[n]))>tolerance)||norm(sub(result[driver],target))>tolerance)return;
  reference.forEach(n=>result[n]=[...p[n]]);return result;
}
