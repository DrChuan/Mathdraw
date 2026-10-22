import type { Vec3 } from "../types";
import { add,sub,mul,dot,cross,norm,unit,perpendicular } from "./math";

export interface PlaneEquation { n:Vec3; d:number }
export interface SphereEquation { center:Vec3; radius:number }
export interface LocusIntersection { points:Vec3[]; dimension:number }
/** Intersect affine planes and spheres by radical planes and an orthonormal
 * affine basis, followed by a quadratic. Continuous loci receive deterministic
 * sample positions, never an unjustified claim of uniqueness. */
export function intersectLoci(planes:PlaneEquation[],spheres:SphereEquation[],scale:number,preferred?:Vec3):LocusIntersection {
  const equations=[...planes],first=spheres[0],basis:PlaneEquation[]=[];
  if(first)for(const sphere of spheres.slice(1)) {
    const delta=sub(sphere.center,first.center),length=norm(delta);
    if(length<1e-12*scale){if(Math.abs(sphere.radius-first.radius)>1e-8*scale)return {points:[],dimension:0};continue;}
    // Difference of squared distances, expressed about the first center to
    // avoid subtracting two large squared world coordinates.
    const n=mul(delta,1/length),offset=(length*length+first.radius**2-sphere.radius**2)/(2*length);
    equations.push({n,d:dot(n,first.center)+offset});
  }
  for(const equation of equations) {
    const length=norm(equation.n);if(length<1e-14)continue;
    let n=mul(equation.n,1/length),d=equation.d/length;
    for(const b of basis){const t=dot(n,b.n);n=sub(n,mul(b.n,t));d-=t*b.d;}
    const size=norm(n);
    if(size<1e-10){if(Math.abs(d)>1e-8*scale)return {points:[],dimension:0};continue;}
    basis.push({n:mul(n,1/size),d:d/size});
  }
  let origin=basis.reduce((p,b)=>add(p,mul(b.n,b.d)),[0,0,0] as Vec3);
  const dimension=3-basis.length;
  const directions:Vec3[]=dimension===3?[[1,0,0],[0,1,0],[0,0,1]]:dimension===2?
    [perpendicular(basis[0].n),unit(cross(basis[0].n,perpendicular(basis[0].n)))]:dimension===1?[unit(cross(basis[0].n,basis[1].n))]:[];
  if(first) {
    origin=[...first.center];for(const b of basis)origin=sub(origin,mul(b.n,dot(origin,b.n)-b.d));
    const offset2=dot(sub(origin,first.center),sub(origin,first.center)),r2=first.radius**2-offset2,tolerance=1e-12*Math.max(first.radius**2,offset2,Number.MIN_VALUE);
    if(r2 < -tolerance)return {points:[],dimension:0};
    if(!dimension)return {points:Math.abs(r2)<=tolerance?[origin]:[],dimension:0};
    const radius=Math.sqrt(Math.max(0,r2));
    if(!radius)return {points:[origin],dimension:0};
    if(dimension===1)return {points:[add(origin,mul(directions[0],radius)),add(origin,mul(directions[0],-radius))],dimension:0};
    const hint=preferred?directions.reduce((v,u)=>add(v,mul(u,dot(sub(preferred,origin),u))),[0,0,0] as Vec3):undefined;
    const closest=hint&&norm(hint)>1e-12*radius?[add(origin,mul(unit(hint),radius))]:[];
    if(dimension===2)return {points:[...closest,...Array.from({length:8},(_,i)=>add(origin,add(mul(directions[0],radius*Math.cos(i*Math.PI/4)),mul(directions[1],radius*Math.sin(i*Math.PI/4)))))],dimension:1};
    return {points:[...closest,...directions.flatMap(u=>[add(origin,mul(u,radius)),add(origin,mul(u,-radius))])],dimension:2};
  }
  const closest=preferred?[directions.reduce((v,u)=>add(v,mul(u,dot(sub(preferred,origin),u))),origin)]:[];
  return {points:[...closest,origin,...directions.flatMap(u=>[add(origin,mul(u,scale)),add(origin,mul(u,-scale))])],dimension};
}
