import type { Vec3 } from "../types";
import type { ConstraintProblem, Positions, SpatialLocus } from "./types";
import { expandConditions } from "./compile";
import { add, sub, mul, dot, cross, norm, unit, perpendicular } from "./math";

export function analyticLoci(problem:ConstraintProblem,p:Positions,reference:string[],scale:number):SpatialLocus[] {
  const fixed=new Set(reference), primitives=expandConditions(problem), result:SpatialLocus[]=[];
  for(const point of problem.points.filter(n=>!fixed.has(n))) {
    const planes:{n:Vec3;d:number}[]=[], spheres:{c:Vec3;r:number}[]=[];
    let segment:Vec3[]|undefined, unsupported=false;
    const plane=(o:Vec3,n:Vec3)=>{if(norm(n)>1e-8){n=unit(n);planes.push({n,d:dot(o,n)});}};
    const line=(o:Vec3,d:Vec3)=>{const u=perpendicular(unit(d));plane(o,u);plane(o,cross(unit(d),u));};
    for(const c of primitives.filter(c=>c.refs.flat().includes(point))) {
      if(c.refs.flat().some(n=>n!==point&&!fixed.has(n))){unsupported=true;continue;}
      const otherEdge=(edge:string[])=>edge.includes(point)?p[edge.find(n=>n!==point)!]:undefined;
      if(c.kind==="distance") {spheres.push({c:otherEdge(c.refs[0])!,r:c.value!});}
      else if((c.kind==="equal"||c.kind==="ratio")&&c.refs.filter(r=>r.includes(point)).length===1) {
        const i=c.refs[0].includes(point)?0:1,edge=c.refs[1-i];
        spheres.push({c:otherEdge(c.refs[i])!,r:norm(sub(p[edge[1]],p[edge[0]]))*(c.kind==="equal"?1:i===0?c.value!:1/c.value!)});
      } else if(c.kind==="collinear") {const [a,b]=c.refs[0].filter(n=>n!==point).map(n=>p[n]);line(a,sub(b,a));}
      else if(c.kind==="onSegment"&&c.refs[0][0]===point) {segment=c.refs[1].map(n=>p[n]);line(segment[0],sub(segment[1],segment[0]));}
      else if(c.kind==="coplanar") {const [a,b,d]=c.refs[0].filter(n=>n!==point).map(n=>p[n]);plane(a,cross(sub(b,a),sub(d,a)));}
      else if(["parallel","perpendicular","linePlaneAngle"].includes(c.kind)) {
        const i=c.refs.findIndex(r=>r.includes(point)),other=c.refs[1-i],moving=c.refs[i];
        if(moving.length!==2){unsupported=true;continue;}
        if(other.includes(point)) {
          if(other.length===2) {
            const a=otherEdge(moving)!,b=otherEdge(other)!;
            if(c.kind==="parallel")line(a,sub(b,a));
            else if(c.kind==="perpendicular")spheres.push({c:mul(add(a,b),.5),r:norm(sub(b,a))*.5});
            else unsupported=true;
          } else unsupported=true;
          continue;
        }
        const o=otherEdge(moving)!,d=other.length===2?sub(p[other[1]],p[other[0]]):cross(sub(p[other[1]],p[other[0]]),sub(p[other[2]],p[other[0]]));
        if(c.kind==="linePlaneAngle"&&c.value!==0&&c.value!==90){unsupported=true;continue;}
        const parallel=c.kind==="parallel"||c.kind==="linePlaneAngle"&&c.value===0;
        if(parallel===(other.length===2))line(o,d);else plane(o,d);
      } else if(c.kind==="vertexAngle"&&c.value===90) {
        const [a,b,d]=c.refs.flat();
        if(b===point)spheres.push({c:mul(add(p[a],p[d]),.5),r:norm(sub(p[a],p[d]))/2});
        else {const q=a===point?d:a;plane(p[b],sub(p[q],p[b]));}
      } else unsupported=true;
    }
    if(!planes.length&&!spheres.length)continue;
    const sphere=spheres[0];
    if(sphere)for(const s of spheres.slice(1)) {
      const delta=sub(s.c,sphere.c);if(norm(delta)<1e-8)continue;
      const d=(dot(s.c,s.c)-dot(sphere.c,sphere.c)+sphere.r*sphere.r-s.r*s.r)/2;
      planes.push({n:unit(delta),d:d/norm(delta)});
    }
    const basis:{n:Vec3;d:number}[]=[];
    for(const pl of planes) {
      let n=[...pl.n] as Vec3,d=pl.d;
      for(const b of basis){const t=dot(n,b.n);n=sub(n,mul(b.n,t));d-=t*b.d;}
      const length=norm(n);if(length>1e-6)basis.push({n:mul(n,1/length),d:d/length});
    }
    if(basis.length>=3)continue;
    let origin=basis.reduce((o,b)=>add(o,mul(b.n,b.d)),[0,0,0] as Vec3);
    const normal=basis[0]?.n??([0,0,1] as Vec3), u=basis.length===2?unit(cross(basis[0].n,basis[1].n)):perpendicular(normal),v=unit(cross(normal,u));
    let kind:SpatialLocus["kind"],radius=scale*3;
    if(sphere) {
      origin=[...sphere.c];for(const b of basis)origin=sub(origin,mul(b.n,dot(origin,b.n)-b.d));
      const r2=sphere.r*sphere.r-dot(sub(origin,sphere.c),sub(origin,sphere.c));
      if(r2<=scale*scale*1e-12||basis.length>=2)continue;
      radius=Math.sqrt(r2);kind=basis.length===0?"sphere":"circle";
    } else if(basis.length===2) {kind=segment?"segment":"line";if(segment){origin=segment[0];radius=norm(sub(segment[1],segment[0]));}}
    else kind="plane";
    const direction=segment?unit(sub(segment[1],segment[0])):u;
    result.push({point,kind,origin,u:direction,v,radius,complete:!unsupported});
  }
  return result;
}
export function locusPoint(l:SpatialLocus,a:number,b=0):Vec3 {
  if(l.kind==="circle")return add(l.origin,add(mul(l.u,l.radius*Math.cos(a)),mul(l.v,l.radius*Math.sin(a))));
  if(l.kind==="sphere") {const n=unit(cross(l.u,l.v));return add(l.origin,add(mul(n,l.radius*Math.sin(b)),add(mul(l.u,l.radius*Math.cos(b)*Math.cos(a)),mul(l.v,l.radius*Math.cos(b)*Math.sin(a)))));}
  if(l.kind==="plane")return add(l.origin,add(mul(l.u,a),mul(l.v,b)));
  return add(l.origin,mul(l.u,l.kind==="segment"?Math.max(0,Math.min(l.radius,a)):a));
}
export function nearestLocus(l:SpatialLocus,target:Vec3):Vec3 {
  const d=sub(target,l.origin),n=unit(cross(l.u,l.v));
  if(l.kind==="sphere")return add(l.origin,mul(norm(d)>1e-12?unit(d):l.u,l.radius));
  if(l.kind==="circle") {const planar=sub(d,mul(n,dot(d,n)));return add(l.origin,mul(norm(planar)>1e-12?unit(planar):l.u,l.radius));}
  if(l.kind==="plane")return sub(target,mul(n,dot(d,n)));
  if(l.kind==="line"||l.kind==="segment")return locusPoint(l,dot(d,l.u));
  let best=l.paths?.[0]?.[0]??target,bestDistance=Infinity;
  for(const path of l.paths??[])for(let i=1;i<path.length;i++) {
    const u=sub(path[i],path[i-1]),t=Math.max(0,Math.min(1,dot(sub(target,path[i-1]),u)/Math.max(1e-20,dot(u,u)))),p=add(path[i-1],mul(u,t)),distance=norm(sub(target,p));
    if(distance<bestDistance){bestDistance=distance;best=p;}
  }
  return best;
}
export function locusPaths(l:SpatialLocus):Vec3[][] {
  if(l.kind==="sampled")return l.paths??[];
  if(l.kind==="line")return [[locusPoint(l,-l.radius),locusPoint(l,l.radius)]];
  if(l.kind==="segment")return [[locusPoint(l,0),locusPoint(l,l.radius)]];
  if(l.kind==="circle")return [Array.from({length:97},(_,i)=>locusPoint(l,i*Math.PI/48))];
  if(l.kind==="plane")return [-1,0,1].flatMap(t=>[
    [locusPoint(l,-l.radius,t*l.radius),locusPoint(l,l.radius,t*l.radius)],
    [locusPoint(l,t*l.radius,-l.radius),locusPoint(l,t*l.radius,l.radius)],
  ]);
  return [0,Math.PI/2,Math.PI/4,-Math.PI/4].map(a=>Array.from({length:97},(_,i)=>{
    const t=i*Math.PI/48,n=unit(cross(l.u,l.v));
    return add(l.origin,mul(add(mul(l.u,Math.cos(t)),mul(add(mul(l.v,Math.cos(a)),mul(n,Math.sin(a))),Math.sin(t))),l.radius));
  }));
}
