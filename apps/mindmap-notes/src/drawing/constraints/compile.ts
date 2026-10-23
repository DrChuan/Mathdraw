import { scalarRelation } from './scalarRelations';
import type { Vec3 } from "../types";
import type { Condition, ConstraintProblem, Positions } from "./types";
import { add, sub, mul, dot, cross, norm, unit } from "./math";
import { polygonArea,solidVolume,circleThrough,sphereThrough,curveGeometry } from "./measures";

export interface Primitive { owner:string; kind:Condition["kind"]|"vectorSum"|"homothety"|"curveDefinition"; refs:string[][]; value?:number;alternateValue?:number;coefficients?:number[];solid?:Condition["solid"];curve?:string }
export function expandConditions(problem:ConstraintProblem):Primitive[] {
  const out:Primitive[]=[];
  for(const c of problem.conditions.filter(c=>c.enabled)) {
    const put=(kind:Primitive["kind"],refs:string[][],value?:number)=>out.push({owner:c.id,kind,refs,value,alternateValue:kind===c.kind?c.alternateValue:undefined,coefficients:kind===c.kind?c.coefficients:undefined,solid:c.solid,curve:c.curve});
    if(c.kind==="volume") {
      out.push(...expandConditions({...problem,curves:[],conditions:[{...c,kind:c.solid!,solid:undefined,value:undefined}]}));put("volume",c.refs,c.value);continue;
    }
    if(c.kind==="area"||c.kind==="concyclic") {
      for(let i=3;i<c.refs[0].length;i++)put("coplanar",[[...c.refs[0].slice(0,3),c.refs[0][i]]]);
      put(c.kind,c.refs,c.value);continue;
    }
    if(["cylinder","cone","coneFrustum","sphere"].includes(c.kind)) {
      const [o,t,a,b]=c.refs[0];
      if(c.kind!=="sphere")put("perpendicular",[[o,t],[o,a]]);
      if(c.kind==="coneFrustum"){put("parallel",[[o,a],[t,b]]);put("perpendicular",[[o,t],[t,b]]);}
      put(c.kind,c.refs);continue;
    }
    if(c.kind==="convexPolygon"||c.kind==="congruent"||c.kind==="similar") {
      for(const polygon of c.refs)for(let i=3;i<polygon.length;i++)put("coplanar",[[polygon[0],polygon[1],polygon[2],polygon[i]]]);
      if(c.kind==="congruent") {
        const [a,b]=c.refs;
        for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)put("equal",[[a[i],a[j]],[b[i],b[j]]]);
      } else put(c.kind,c.refs);
      continue;
    }
    if(!["parallelogram","rectangle","rhombus","square","prism","pyramid","frustum","cube"].includes(c.kind)){put(c.kind,c.refs,c.value);continue;}
    const p=c.refs[0], [a,b,d,e]=p;
    if(["parallelogram","rectangle","rhombus","square"].includes(c.kind)) {
      put("vectorSum",[[a,d,b,e]]);
      if(c.kind==="rhombus"||c.kind==="square")put("equal",[[a,b],[a,e]]);
      if(c.kind==="square"||c.kind==="rectangle")put("perpendicular",[[a,b],[a,e]]);
    } else if(c.kind==="prism"||c.kind==="pyramid"||c.kind==="frustum") {
      const n=c.kind==="pyramid"?p.length-1:p.length/2,base=c.kind==="pyramid"?p.slice(1):p.slice(0,n);
      for(let i=3;i<n;i++)put("coplanar",[[base[0],base[1],base[2],base[i]]]);
      if(c.kind==="prism")for(let i=1;i<n;i++)put("vectorSum",[[p[0],p[n+i],p[i],p[n]]]);
      if(c.kind==="frustum")put("homothety",[base,p.slice(n)]);
    } else {
      put("vectorSum",[[p[0],p[2],p[1],p[3]]]);
      for(let i=1;i<4;i++)put("vectorSum",[[p[0],p[i+4],p[i],p[4]]]);
      const edges=[[p[0],p[1]],[p[0],p[3]],[p[0],p[4]]];
      put("equal",[edges[0],edges[1]]);put("equal",[edges[0],edges[2]]);
      put("perpendicular",[edges[0],edges[1]]);put("perpendicular",[edges[0],edges[2]]);put("perpendicular",[edges[1],edges[2]]);
    }
  }
  for(const c of problem.curves??[])out.push({owner:c.id,kind:"curveDefinition",curve:c.id,refs:[...c.points,...(c.plane??[])].map(n=>[n])});
  return out;
}
export const flatten=(names:string[],p:Positions)=>names.flatMap(n=>p[n]);
export const positions=(names:string[],x:number[]):Positions=>Object.fromEntries(names.map((n,i)=>[n,x.slice(i*3,i*3+3) as Vec3]));
export function problemScale(p:ConstraintProblem) {
  const lengths=p.conditions.filter(c=>c.enabled&&["distance","circumradius","concyclic","cospherical"].includes(c.kind)&&c.value!==undefined).map(c=>c.value!);
  lengths.push(...p.conditions.filter(c=>c.enabled&&["area","volume"].includes(c.kind)).map(c=>c.value!**(c.kind==="area"?.5:1/3)),...(p.curves??[]).filter(c=>c.value).map(c=>c.value!/(c.type==="ellipse"?2:1)));lengths.sort((a,b)=>a-b);
  const dots=p.conditions.filter(c=>c.enabled&&c.kind==="vectorDot"&&c.value).map(c=>Math.sqrt(Math.abs(c.value!)));
  return lengths.length?lengths[Math.floor(lengths.length/2)]:dots[0]??1;
}
export function evaluator(problem:ConstraintProblem) {
  const primitives=expandConditions(problem), scale=problemScale(problem), indices=new Map(problem.points.map((n,i)=>[n,i*3]));
  const scalars=new Map(problem.conditions.filter(c=>c.kind==='scalarEquation').map(c=>[c.id,scalarRelation(c.source,problem.points)]));
  const point=(x:number[],name:string):Vec3=>{const i=indices.get(name)!;return [x[i],x[i+1],x[i+2]];};
  const singleResidual=(c:Primitive,x:number[]):number[]=>{
    const refs=c.refs.map(r=>r.map(n=>point(x,n))), v=(r:Vec3[])=>sub(r[1],r[0]);
    const dir=(r:Vec3[])=>r.length===2?unit(v(r)):unit(cross(v(r),sub(r[2],r[0])));
    const angle=(c.value??0)*Math.PI/180;
    switch(c.kind) {
      case 'scalarEquation':try{return [scalars.get(c.owner)!.residual(positions(problem.points,x))];}catch{return [1e4];}
      case "curveDefinition": {
        const curve=problem.curves!.find(k=>k.id===c.curve)!,ps=curve.points.map(n=>point(x,n));
        const plane=curve.plane?.map(n=>point(x,n)),out=plane?ps.map(q=>dot(sub(q,plane[0]),unit(cross(sub(plane[1],plane[0]),sub(plane[2],plane[0]))))/scale):[];
        if(plane)out.push(Math.max(0,1e-4-norm(cross(unit(sub(plane[1],plane[0])),unit(sub(plane[2],plane[0]))))));
        if(curve.method==="threePoint")out.push(Math.max(0,1e-4-norm(cross(unit(sub(ps[1],ps[0])),unit(sub(ps[2],ps[0]))))));
        if(curve.type==="ellipse")out.push(Math.max(0,(norm(sub(ps[1],ps[0]))-curve.value!)/scale+1e-5));
        return out;
      }
      case "onCurve": {
        const curve=problem.curves!.find(k=>k.id===c.curve)!;
        try {
          const geometry=curveGeometry(curve,positions(problem.points,x)),q=sub(refs[0][0],geometry.center),u=dot(q,geometry.u),v=dot(q,geometry.v);
          return [dot(q,geometry.normal)/scale,(Math.hypot(u/geometry.a,v/geometry.b)-1)];
        }catch{return [1,1];}
      }
      case "area":return [(polygonArea(refs[0])-c.value!)/Math.max(c.value!,scale*scale*1e-12)];
      case "volume":return [(solidVolume(c.solid!,refs[0])-c.value!)/Math.max(c.value!,scale**3*1e-12)];
      case "circumradius": {
        const [a,b,d]=refs[0],area=norm(cross(sub(b,a),sub(d,a)))/2;
        const radius=norm(sub(b,a))*norm(sub(d,a))*norm(sub(d,b))/Math.max(4*area,scale*scale*1e-15);
        return [(radius-c.value!)/Math.max(c.value!,scale*1e-12)];
      }
      case "concyclic": {
        const circle=circleThrough(refs[0]);if(!circle)return Array(refs[0].length+1).fill(1);
        return [...refs[0].map(q=>(norm(sub(q,circle.center))-circle.radius)/scale),c.value===undefined?0:(circle.radius-c.value)/Math.max(c.value,scale*1e-12)];
      }
      case "cospherical": {
        const sphere=sphereThrough(refs[0]);
        return [...refs[0].map(q=>(norm(sub(q,sphere.center))-sphere.radius)/scale),c.value===undefined?0:(sphere.rank===3?sphere.radius-c.value:Math.max(0,sphere.radius-c.value))/Math.max(c.value,scale*1e-12)];
      }
      case "cylinder":case "cone":case "sphere":return [];
      case "coneFrustum": {
        const [o,t,a,b]=refs[0];return [Math.max(0,-dot(unit(sub(a,o)),unit(sub(b,t))))];
      }
      case "distance":return [(norm(v(refs[0]))-c.value!)/Math.max(c.value!,scale*1e-12)];
      case "equal": {const a=norm(v(refs[0])),b=norm(v(refs[1]));return [(a-b)/Math.max(a,b,scale*1e-12)];}
      case "ratio": {const a=norm(v(refs[0])),b=c.value!*norm(v(refs[1]));return [(a-b)/Math.max(a,b,scale*1e-12)];}
      case "lineAngle": {
        const a=dir(refs[0]),b=dir(refs[1]);
        return c.value===0?cross(a,b):[c.value===90?dot(a,b):Math.abs(dot(a,b))-Math.cos(angle)];
      }
      case "vertexAngle": {
        const a=unit(sub(refs[0][0],refs[1][0])),b=unit(sub(refs[2][0],refs[1][0])),d=dot(a,b);
        return c.value===0||c.value===180?[...cross(a,b),Math.max(0,c.value===0?-d:d)]:[d-Math.cos(angle)];
      }
      case "linePlaneAngle": {
        const a=dir(refs[0]),b=dir(refs[1]);
        return c.value===90?cross(a,b):[c.value===0?dot(a,b):Math.abs(dot(a,b))-Math.sin(angle)];
      }
      case "dihedral": {
        const axis=dir(refs[0]),side=(p:Vec3)=>{const d=sub(p,refs[0][0]);return unit(sub(d,mul(axis,dot(d,axis))));};
        const a=side(refs[1][0]),b=side(refs[2][0]),d=dot(a,b);
        return c.value===0||c.value===180?[...cross(a,b),Math.max(0,c.value===0?-d:d)]:[d-Math.cos(angle)];
      }
      case "parallel":case "perpendicular": {
        const a=dir(refs[0]),b=dir(refs[1]),same=refs[0].length===refs[1].length;
        return (c.kind==="parallel")===same?cross(a,b):[dot(a,b)];
      }
      case "collinear": {const a=v(refs[0]),b=sub(refs[0][2],refs[0][0]);return mul(cross(a,b),1/Math.max(norm(a)*norm(b),scale*scale*1e-24));}
      case "onSegment": {
        const d=v(refs[1]),delta=sub(refs[0][0],refs[1][0]),t=dot(delta,d)/Math.max(1e-24,dot(d,d));
        return [...mul(cross(unit(d),delta),1/Math.max(norm(d),scale*1e-12)),Math.min(0,t),Math.max(0,t-1)];
      }
      case "division":return mul(sub(refs[0][0],add(refs[1][0],mul(v(refs[1]),c.value!/(1+c.value!)))),1/scale);
      case "vectorRelation":return mul(refs.reduce((sum,r,i)=>add(sum,mul(v(r),c.coefficients![i])),[0,0,0] as Vec3),1/(scale*Math.max(1,...c.coefficients!.map(Math.abs))));
      case "vectorDot":return [(dot(v(refs[0]),v(refs[1]))-c.value!)/Math.max(scale*scale,Math.abs(c.value!),1e-24)];
      case "similar": {
        const [a,b]=refs,baseA=norm(sub(a[1],a[0])),baseB=norm(sub(b[1],b[0]));
        const out:number[]=[];
        for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++) {
          const x=norm(sub(a[j],a[i]))*baseB,y=norm(sub(b[j],b[i]))*baseA;
          out.push((x-y)/Math.max(x,y,scale*scale*1e-24));
        }
        return out;
      }
      case "convexPolygon": {
        const p=refs[0],normal=unit(cross(sub(p[1],p[0]),sub(p[2],p[0]))),out:number[]=[];
        // Every other vertex must lie strictly on the same side of each
        // oriented edge. Local turn signs alone would also admit star polygons.
        for(let i=0;i<p.length;i++)for(let j=0;j<p.length;j++)if(j!==i&&j!==(i+1)%p.length) {
          const e=sub(p[(i+1)%p.length],p[i]),d=sub(p[j],p[i]);
          out.push(Math.min(0,dot(cross(e,d),normal)/Math.max(norm(e)*norm(d),scale*scale*1e-24)-1e-4));
        }
        return out;
      }
      case "coplanar": {const [a,b,c,d]=refs[0];return [dot(cross(unit(sub(b,a)),unit(sub(c,a))),unit(sub(d,a)))];}
      case "vectorSum":return mul(sub(add(refs[0][0],refs[0][1]),add(refs[0][2],refs[0][3])),1/scale);
      case "homothety": {
        const [base,top]=refs,a=sub(base[1],base[0]),b=sub(top[1],top[0]),t=dot(a,b)/Math.max(dot(a,a),scale*scale*1e-24);
        return base.slice(1).flatMap((p,i)=>mul(sub(sub(top[i+1],top[0]),mul(sub(p,base[0]),t)),1/scale));
      }
      case "regularPolygon": {
        const p=refs[0],n=p.length,normal=unit(cross(sub(p[1],p[0]),sub(p[2],p[1]))),theta=2*Math.PI/n;
        const length=Math.max(norm(sub(p[1],p[0])),scale*1e-12);
        return p.flatMap((a,i)=>{
          const e=sub(p[(i+1)%n],a),next=sub(p[(i+2)%n],p[(i+1)%n]);
          return mul(sub(next,add(mul(e,Math.cos(theta)),mul(cross(normal,e),Math.sin(theta)))),1/length);
        });
      }
      default:return [];
    }
  };
  const residual=(c:Primitive,x:number[]):number[]=>{
    const a=singleResidual(c,x);if(c.alternateValue===undefined)return a;
    const b=singleResidual({...c,value:c.alternateValue,alternateValue:undefined},x);
    return a.reduce((s,v)=>s+v*v,0)<=b.reduce((s,v)=>s+v*v,0)?a:b;
  };
  const degeneracy=(c:Condition,x:number[])=>{
    const refs=c.refs.map(r=>r.map(n=>point(x,n))), lengths:number[]=[];
    const line=(r:Vec3[])=>{const length=norm(sub(r[1],r[0]));lengths.push(length/(length+scale*1e-12));};
    const plane=(r:Vec3[])=>{line(r);const a=sub(r[1],r[0]),b=sub(r[2],r[0]);lengths.push(norm(cross(a,b))/Math.max(norm(a)*norm(b),scale*scale*1e-24));};
    if(["distance","equal","ratio","lineAngle","linePlaneAngle","parallel","perpendicular"].includes(c.kind))
      refs.forEach(r=>r.length===2?line(r):plane(r));
    else if(c.kind==="vertexAngle"){line([refs[1][0],refs[0][0]]);line([refs[1][0],refs[2][0]]);}
    else if(c.kind==="dihedral"){plane([...refs[0],refs[1][0]]);plane([...refs[0],refs[2][0]]);}
    else if(c.kind==="onSegment"||c.kind==="division")line(refs[1]);
    else if(c.kind==="vectorDot")refs.forEach(line);
    else if(["convexPolygon","congruent","similar","area","concyclic","circumradius"].includes(c.kind))for(const polygon of refs){plane(polygon);polygon.forEach((p,i)=>line([p,polygon[(i+1)%polygon.length]]));}
    else if(c.kind==="cospherical"){const sphere=sphereThrough(refs[0]);lengths.push(sphere.radius/scale);}
    else if(c.kind==="volume")return degeneracy({...c,kind:c.solid!,solid:undefined},x);
    else if(["cylinder","cone","coneFrustum","sphere"].includes(c.kind)) {
      const p=refs[0];if(c.kind==="sphere")line(p);else{line([p[0],p[1]]);line([p[0],p[2]]);if(c.kind==="coneFrustum")line([p[1],p[3]]);}
    }
    else if(["prism","pyramid","frustum","regularPolygon"].includes(c.kind)) {
      const p=refs[0],n=c.kind==="pyramid"?p.length-1:c.kind==="regularPolygon"?p.length:p.length/2,base=c.kind==="pyramid"?p.slice(1):p.slice(0,n);
      plane(base);for(let i=0;i<n;i++)line([base[i],base[(i+1)%n]]);
      if(c.kind!=="regularPolygon") {
        const a=sub(base[1],base[0]),b=sub(base[2],base[0]),side=sub(c.kind==="pyramid"?p[0]:p[n],base[0]);
        lengths.push(Math.abs(dot(cross(a,b),side))/Math.max(norm(a)*norm(b)*norm(side),scale**3*1e-36));
      }
      if(c.kind==="frustum") {
        const top=p.slice(n),a=sub(base[1],base[0]),t=dot(a,sub(top[1],top[0]))/Math.max(dot(a,a),scale*scale*1e-24);
        plane(top);lengths.push(t,Math.abs(1-t));
      }
    }
    else if(["parallelogram","rectangle","rhombus","square","cube"].includes(c.kind)) {
      const p=refs[0];plane([p[0],p[1],p[3]]);
      if(c.kind==="cube") {
        const a=sub(p[1],p[0]),b=sub(p[3],p[0]),d=sub(p[4],p[0]);
        lengths.push(Math.abs(dot(cross(a,b),d))/Math.max(norm(a)*norm(b)*norm(d),scale**3*1e-36));
      }
    }
    return lengths;
  };
  const conditions=problem.conditions.filter(c=>c.enabled);
  // Template vertex order describes a simple polygon, not a self-crossing wire.
  // Check this discrete property on publication rather than putting a changing
  // number of terms into the finite-difference residual vector.
  const crossedBase=(c:Condition,x:number[]):boolean=>{
    if(c.kind==="congruent"||c.kind==="similar")return c.refs.some(refs=>crossedBase({...c,kind:"convexPolygon",refs:[refs]},x));
    if(c.kind==="volume")return crossedBase({...c,kind:c.solid!,solid:undefined},x);
    if(!["prism","pyramid","frustum","regularPolygon","convexPolygon","area"].includes(c.kind))return false;
    const names=c.refs[0],base=c.kind==="pyramid"?names.slice(1):["regularPolygon","convexPolygon","area"].includes(c.kind)?names:names.slice(0,names.length/2),ps=base.map(n=>point(x,n)),n=ps.length;
    const normal=unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),tolerance=scale*1e-8;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
      if(norm(sub(ps[i],ps[j]))<=tolerance)return true;
      if(j===i+1||i===0&&j===n-1)continue;
      const a=ps[i],b=ps[(i+1)%n],p=ps[j],q=ps[(j+1)%n],u=sub(b,a),v=sub(q,p),delta=sub(p,a),den=dot(cross(u,v),normal);
      if(Math.abs(den)>1e-12*norm(u)*norm(v)) {
        const t=dot(cross(delta,v),normal)/den,s=dot(cross(delta,u),normal)/den;
        if(t>=-1e-8&&t<=1+1e-8&&s>=-1e-8&&s<=1+1e-8)return true;
      } else if(norm(cross(delta,u))<=tolerance*norm(u)) {
        const length=Math.max(dot(u,u),1e-24),t=dot(delta,u)/length,s=dot(sub(q,a),u)/length;
        if(Math.max(0,Math.min(t,s))<=Math.min(1,Math.max(t,s))+1e-8)return true;
      }
    }
    return false;
  };
  const values=(x:number[],barriers=true)=>[
    ...primitives.flatMap(c=>residual(c,x)),
    ...(barriers?conditions.flatMap(c=>degeneracy(c,x).map(n=>Math.max(0,1e-4-n))):[]),
  ];
  const verify=(x:number[])=>{
    const errors=conditions.map(c=>({id:c.id,error:Math.max(0,...primitives.filter(p=>p.owner===c.id).flatMap(p=>residual(p,x)).map(Math.abs)),degenerate:degeneracy(c,x).some(n=>n<1e-7)||crossedBase(c,x)}));
    for(const curve of problem.curves??[]) {
      let degenerate=false;try{curveGeometry(curve,positions(problem.points,x));}catch{degenerate=true;}
      errors.push({id:curve.id,error:Math.max(0,...primitives.filter(p=>p.owner===curve.id).flatMap(p=>residual(p,x)).map(Math.abs)),degenerate});
    }
    const valid=x.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9)&&errors.every(e=>e.error<3e-6&&!e.degenerate);
    return {valid,errors,max:Math.max(0,...errors.map(e=>e.error))};
  };
  return {values,verify,primitives,scale};
}
export function contradictions(p:ConstraintProblem):string[] {
  const lengths=new Map<string,{length:number;source:string}>(),problems:string[]=[];
  const key=(a:string,b:string)=>[a,b].sort().join("|");
  for(const c of p.conditions.filter(c=>c.enabled&&c.kind==="distance")) {
    const [a,b]=c.refs[0],k=key(a,b),old=lengths.get(k);
    if(old&&Math.abs(old.length-c.value!)>1e-8*Math.max(old.length,c.value!))problems.push(`长度条件矛盾：${old.source}；${c.source}`);
    lengths.set(k,{length:c.value!,source:c.source});
  }
  for(let i=0;i<p.points.length;i++)for(let j=i+1;j<p.points.length;j++)for(let k=j+1;k<p.points.length;k++) {
    const a=lengths.get(key(p.points[i],p.points[j])),b=lengths.get(key(p.points[j],p.points[k])),c=lengths.get(key(p.points[i],p.points[k]));
    if(a&&b&&c&&Math.max(a.length,b.length,c.length)*2>a.length+b.length+c.length+1e-8)
      problems.push(`三角形不等式矛盾：${a.source}；${b.source}；${c.source}`);
  }
  const active=p.conditions.filter(c=>c.enabled),planes:string[][]=[];
  for(const c of active) {
    planes.push(...c.refs.filter(r=>r.length===3));
    const r=c.refs[0];
    if(c.kind==="pyramid")planes.push(r.slice(1));
    else if(c.kind==="prism"||c.kind==="frustum")planes.push(r.slice(0,r.length/2),r.slice(r.length/2));
    else if(["rectangle","parallelogram","rhombus","square","regularPolygon","convexPolygon","coplanar"].includes(c.kind))planes.push(r);
    else if(c.kind==="congruent"||c.kind==="similar")planes.push(...c.refs);
  }
  const collinear=active.flatMap(c=>c.kind==="collinear"?[c.refs[0]]:c.kind==="onSegment"||c.kind==="division"?[c.refs.flat()]:[]);
  const closures=planes.map(points=>{
    const set=new Set(points);for(let pass=0;pass<p.points.length;pass++){let changed=false;for(const line of collinear)if(line.filter(n=>set.has(n)).length>=2)for(const n of line)if(!set.has(n)){set.add(n);changed=true;}if(!changed)break;}return set;
  });
  const samePlane=(a:string[],b:string[])=>closures.some(s=>[...a,...b].every(n=>s.has(n)));
  for(const perpendicular of active.filter(c=>c.kind==="perpendicular"&&c.refs.some(r=>r.length===2)&&c.refs.some(r=>r.length===3))) {
    const line=perpendicular.refs.find(r=>r.length===2)!,plane=perpendicular.refs.find(r=>r.length===3)!;
    for(const angle of active.filter(c=>c.kind==="linePlaneAngle"))if(key(...line as [string,string])===key(...angle.refs[0] as [string,string])&&samePlane(plane,angle.refs[1])&&Math.abs(angle.value!-90)>1e-8)
      problems.push(`条件矛盾：${line.join("")} 垂直平面 ${plane.join("")}；由共面、共线或点在线段上的条件，平面 ${angle.refs[1].join("")} 与该平面相同，因此夹角必须为 90°，不能为 ${angle.value}°。请检查“${angle.source}”。`);
  }
  return [...new Set(problems)];
}
