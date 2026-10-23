import type { Vec3 } from "../types";
import type { ConstraintCurve, Positions, VolumeShape } from "./types";
import { add, sub, mul, dot, cross, norm, unit, perpendicular } from "./math";

export function polygonArea(p:Vec3[]) {
  const origin=p[0];return norm(p.reduce((sum,v,i)=>add(sum,cross(sub(v,origin),sub(p[(i+1)%p.length],origin))),[0,0,0] as Vec3))/2;
}
export function circleThrough(p:Vec3[]) {
  for(let i=1;i<p.length;i++)for(let j=i+1;j<p.length;j++) {
    const a=sub(p[i],p[0]),b=sub(p[j],p[0]),n=cross(a,b),s=dot(n,n);
    if(s<=1e-20*Math.max(1e-24,dot(a,a)*dot(b,b)))continue;
    const center=add(p[0],mul(add(mul(cross(b,n),dot(a,a)),mul(cross(n,a),dot(b,b))),1/(2*s)));
    return {center,radius:norm(sub(center,p[0])),normal:unit(n),u:unit(a)};
  }
}
/** Centres satisfy a linear system of radical planes. Rank < 3 describes a
 * family of spheres: a prescribed radius is possible iff it is at least the
 * minimum radius. Coplanar points must not be falsely rejected as non-unique. */
export function sphereThrough(p:Vec3[]) {
  const basis:{n:Vec3;d:number}[]=[];
  for(const q of p.slice(1)) {
    const delta=sub(q,p[0]);let n=delta,d=dot(delta,delta)/2;
    for(let pass=0;pass<2;pass++)for(const row of basis){const k=dot(n,row.n);n=sub(n,mul(row.n,k));d-=k*row.d;}
    const length=norm(n);if(length>1e-8*Math.max(norm(delta),1e-12))basis.push({n:mul(n,1/length),d:d/length});
  }
  const offset=basis.reduce((sum,b)=>add(sum,mul(b.n,b.d)),[0,0,0] as Vec3);
  return {center:add(p[0],offset),radius:norm(offset),rank:basis.length};
}
export function solidVolume(shape:VolumeShape,p:Vec3[]) {
  if(["cylinder","cone","coneFrustum"].includes(shape)) {
    const h=norm(sub(p[1],p[0])),r=norm(sub(p[2],p[0])),s=shape==="coneFrustum"?norm(sub(p[3],p[1])):r;
    return Math.PI*h*(shape==="cone"?r*r/3:shape==="coneFrustum"?(r*r+r*s+s*s)/3:r*r);
  }
  const n=shape==="pyramid"?p.length-1:p.length/2,base=shape==="pyramid"?p.slice(1):p.slice(0,n);
  const normal=unit(base.reduce((sum,q,i)=>add(sum,cross(sub(q,base[0]),sub(base[(i+1)%n],base[0]))),[0,0,0] as Vec3));
  const h=Math.abs(dot(sub(shape==="pyramid"?p[0]:p[n],base[0]),normal)),area=polygonArea(base);
  if(shape==="prism")return area*h;
  if(shape==="pyramid")return area*h/3;
  const top=polygonArea(p.slice(n));return h*(area+top+Math.sqrt(area*top))/3;
}
export function curveGeometry(c:ConstraintCurve,p:Positions) {
  const points=c.points.map(n=>p[n]);if(points.some(v=>!v))throw new Error(`曲线 ${c.name} 的定义点尚未确定`);
  if(c.method==="threePoint") {
    const circle=circleThrough(points);if(!circle)throw new Error(`圆 ${c.name} 的三个点共线`);
    return {...circle,v:unit(cross(circle.normal,circle.u)),a:circle.radius,b:circle.radius};
  }
  const plane=c.plane?.map(n=>p[n])??(c.type==='circle'&&points.every(p=>Math.abs(p[2])<1e-10)?[[0,0,0],[1,0,0],[0,1,0]] as Vec3[]:undefined);
  if(!plane||plane.some(v=>!v))throw new Error(`请指定曲线 ${c.name} 所在的平面`);
  const normal=unit(cross(sub(plane[1],plane[0]),sub(plane[2],plane[0])));
  if(norm(normal)<.9)throw new Error(`曲线 ${c.name} 的平面退化`);
  const center=c.type==="ellipse"?mul(add(points[0],points[1]),.5):points[0];
  const d=c.type==="ellipse"?sub(points[1],points[0]):c.method==="centerPoint"?sub(points[1],points[0]):sub(plane[1],plane[0]);
  const projected=sub(d,mul(normal,dot(d,normal))),u=norm(projected)>1e-10?unit(projected):perpendicular(normal),v=unit(cross(normal,u));
  const a=c.type==="ellipse"?c.value!/2:c.method==="centerRadius"?c.value!:norm(d),f=c.type==="ellipse"?norm(d)/2:0;
  if(!(a>f&&a>1e-10))throw new Error(c.type==="ellipse"?`椭圆 ${c.name} 的长轴长必须大于焦距`:`圆 ${c.name} 的半径必须大于零`);
  const b=Math.sqrt(a*a-f*f);return {center,normal,u,v,a,b,radius:a};
}
export function roundGeometry(shape:"cylinder"|"cone"|"coneFrustum"|"sphere",p:Vec3[]) {
  const origin=p[0],radius=norm(sub(p[shape==="sphere"?1:2],origin));
  if(!(radius>1e-9))throw new Error("圆面半径为零");
  if(shape==="sphere")return {origin,radius,height:radius*2,topRadius:radius,basis:[[1,0,0],[0,1,0],[0,0,1]] as [Vec3,Vec3,Vec3]};
  const axis=sub(p[1],origin),height=norm(axis);if(height<1e-9)throw new Error("几何体的高度为零");
  const z=unit(axis),radial=sub(p[2],origin);
  if(Math.abs(dot(radial,z))>1e-5*Math.max(radius,height))throw new Error("圆面半径方向必须垂直于轴线");
  const x=unit(sub(radial,mul(z,dot(radial,z)))),y=unit(cross(z,x)),topRadius=shape==="cone"?0:shape==="coneFrustum"?norm(sub(p[3],p[1])):radius;
  if(shape==="coneFrustum"&&(topRadius<1e-9||Math.abs(dot(sub(p[3],p[1]),z))>1e-5*Math.max(radius,height,topRadius)||dot(unit(sub(p[3],p[1])),x)<1-1e-6))throw new Error("圆台两底面半径必须平行同向且垂直于轴线");
  return {origin,radius,height,topRadius,basis:[x,y,z] as [Vec3,Vec3,Vec3]};
}
