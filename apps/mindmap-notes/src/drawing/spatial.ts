import type { DrawingPlaneSource,Vec3,WorkPlane } from "./types";
import { add,sub,mul,dot,cross,norm,unit } from "./constraints/math";
import { exactNumber } from "./exactNumber";

export interface PlaneGeometry { origin:Vec3; u:Vec3; v:Vec3 }
export function planeDependencies(p:DrawingPlaneSource):string[] {
  return p.type==="points"?p.points:p.type==="lines"?p.lines:p.type==="linePoint"?[p.line,p.point]:p.type==="polygon"?[p.polygon]:[];
}
export function sourcePlane(source:DrawingPlaneSource,context:{point:(id:string)=>Vec3;line:(id:string)=>{a:Vec3;b:Vec3};polygon:(id:string)=>Vec3[];workplane:(id:string)=>WorkPlane|undefined}):PlaneGeometry {
  let origin:Vec3,u:Vec3,v:Vec3;
  if(source.type==="workplane") {
    const p=context.workplane(source.planeId);if(!p)throw new Error("来源工作平面不存在");return p;
  }
  if(source.type==="points"||source.type==="polygon") {
    const points=source.type==="points"?source.points.map(context.point):context.polygon(source.polygon);
    if(points.length<3)throw new Error("平面至少需要三个不共线的点");origin=points[0];
    const second=points.find(p=>norm(sub(p,origin))>1e-9);if(!second)throw new Error("平面上的点重合");
    u=sub(second,origin);const third=points.find(p=>norm(cross(u,sub(p,origin)))>1e-9*norm(u)*Math.max(norm(sub(p,origin)),1e-9));
    if(!third)throw new Error("三点共线，无法确定平面");v=sub(third,origin);
    const normal=unit(cross(u,v));if(points.some(p=>Math.abs(dot(sub(p,origin),normal))>1e-7*Math.max(1,norm(u),norm(v))))throw new Error("所选图形不共面");
  } else {
    const first=context.line(source.type==="lines"?source.lines[0]:source.line);origin=first.a;u=sub(first.b,first.a);
    if(norm(u)<1e-10)throw new Error("参考直线的方向失效");
    if(source.type==="linePoint")v=sub(context.point(source.point),origin);
    else {
      const second=context.line(source.lines[1]),direction=sub(second.b,second.a),offset=sub(second.a,origin),n=cross(u,direction);
      if(norm(direction)<1e-10)throw new Error("参考直线的方向失效");
      if(norm(n)>1e-9*norm(u)*norm(direction)) {
        if(Math.abs(dot(offset,unit(n)))>1e-7*Math.max(1,norm(offset)))throw new Error("两条直线异面，不能确定同一个截平面");
        v=direction;
      } else v=offset;
    }
  }
  if(norm(cross(u,v))<=1e-9*norm(u)*Math.max(norm(v),1e-9))throw new Error(source.type==="lines"?"两条直线重合，不能唯一确定平面":"点在直线上，不能唯一确定平面");
  return {origin,u,v};
}
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
/** Primitive integer/radical ratios: clear common denominators and factors. */
export function simplestNormal(raw:Vec3):Vec3 {
  if(norm(raw)<1e-12)throw new Error("平面退化，法向量暂时失效");
  const parts=raw.map(value=>{
    const exact=exactNumber(value);if(exact.approximate)return;
    const rational=exact.source.match(/^(-?\d+)(?:\/(\d+))?$/);
    if(rational)return {n:Number(rational[1]),d:Number(rational[2]??1),r:1};
    const radical=exact.source.match(/^(-?)(?:(\d+)\*)?sqrt\((\d+)\)(?:\/(\d+))?$/);
    if(radical)return {n:(radical[1]?-1:1)*Number(radical[2]??1),d:Number(radical[4]??1),r:Number(radical[3])};
  });
  if(parts.every(p=>!!p)) {
    const denominator=parts.reduce((l,p)=>l/gcd(l,p!.d)*p!.d,1);
    if(denominator<1e9) {
      const coefficients=parts.map(p=>p!.n*(denominator/p!.d)),factor=coefficients.filter(Boolean).reduce((g,n)=>gcd(g,Math.abs(n)),0)||1;
      const commonRadical=parts.filter(p=>p!.n!==0).reduce((g,p)=>gcd(g,p!.r),0)||1;
      const sign=coefficients.find(n=>n!==0)!<0?-1:1;
      return parts.map((p,i)=>sign*coefficients[i]/factor*Math.sqrt(p!.r/commonRadical)) as Vec3;
    }
  }
  const first=raw.find(n=>Math.abs(n)>1e-10)!;
  return mul(raw,(first<0?-1:1)/Math.max(...raw.map(Math.abs)));
}

/** Slice the actual triangulated shell, retaining concave and separate loops.
 * Coplanar tessellation diagonals cancel; tangent points/edges are not sections. */
export function sectionLoops(mesh:{vertices:Vec3[];faces:[number,number,number][]},plane:PlaneGeometry):Vec3[][] {
  if(mesh.faces.length>20000)throw new Error("几何体表面过于复杂，请简化后再创建截面");
  const n=unit(cross(plane.u,plane.v)),extent=Math.max(1,...mesh.vertices.map(p=>norm(sub(p,plane.origin)))),epsilon=extent*1e-8;
  const points:Vec3[]=[],segments=new Map<string,[number,number]>(),coplanar=new Map<string,{edge:[number,number];count:number}>();
  const index=(p:Vec3)=>{const old=points.findIndex(q=>norm(sub(q,p))<=epsilon);if(old>=0)return old;if(points.length>=4096)throw new Error("截面顶点过多，请简化几何体");points.push(p);return points.length-1;};
  const segment=(a:Vec3,b:Vec3,onPlane=false)=>{
    if(norm(sub(a,b))<=epsilon)return;const i=index(a),j=index(b),key=[i,j].sort((a,b)=>a-b).join(":");
    if(onPlane){const old=coplanar.get(key);coplanar.set(key,{edge:[i,j],count:(old?.count??0)+1});}else segments.set(key,[i,j]);
  };
  for(const face of mesh.faces) {
    const p=face.map(i=>mesh.vertices[i]),d=p.map(v=>dot(sub(v,plane.origin),n));
    if(d.every(v=>Math.abs(v)<=epsilon)){for(let i=0;i<3;i++)segment(p[i],p[(i+1)%3],true);continue;}
    const intersections:Vec3[]=[];
    for(let i=0;i<3;i++) {
      const j=(i+1)%3;if(Math.abs(d[i])<=epsilon)intersections.push(p[i]);
      if(d[i]*d[j]<0&&Math.abs(d[i])>epsilon&&Math.abs(d[j])>epsilon)intersections.push(add(p[i],mul(sub(p[j],p[i]),d[i]/(d[i]-d[j]))));
    }
    const unique=intersections.filter((p,i,all)=>all.findIndex(q=>norm(sub(q,p))<=epsilon)===i);
    if(unique.length>=2)segment(unique[0],unique[1]);
  }
  for(const [key,value] of coplanar)if(value.count===1)segments.set(key,value.edge);
  const adjacency=new Map<number,Set<number>>();for(const [a,b] of segments.values()){if(!adjacency.has(a))adjacency.set(a,new Set());if(!adjacency.has(b))adjacency.set(b,new Set());adjacency.get(a)!.add(b);adjacency.get(b)!.add(a);}
  const used=new Set<string>(),loops:Vec3[][]=[];
  const edgeKey=(a:number,b:number)=>[a,b].sort((a,b)=>a-b).join(":");
  for(const [start,second] of segments.values()) {
    if(used.has(edgeKey(start,second)))continue;
    const indices=[start];let before=start,current=second,closed=false;
    used.add(edgeKey(before,current));
    for(let step=0;step<=segments.size;step++) {
      if(current===start){closed=true;break;}indices.push(current);
      const choices=[...(adjacency.get(current)??[])].filter(j=>!used.has(edgeKey(current,j)));
      if(!choices.length)break;
      const incoming=sub(points[current],points[before]);
      choices.sort((a,b)=>{
        const turn=(i:number)=>{const out=sub(points[i],points[current]);return (Math.atan2(dot(n,cross(incoming,out)),dot(incoming,out))+Math.PI*2)%(Math.PI*2);};return turn(a)-turn(b);
      });
      const next=choices[0];used.add(edgeKey(current,next));before=current;current=next;
    }
    if(!closed||indices.length<3)continue;
    let loop=indices.map(i=>points[i]);
    for(let pass=0;pass<points.length&&loop.length>3;pass++) {
      const i=loop.findIndex((p,i)=>{const a=sub(p,loop[(i+loop.length-1)%loop.length]),b=sub(loop[(i+1)%loop.length],p);return norm(cross(a,b))<=epsilon*(norm(a)+norm(b));});
      if(i<0)break;loop=loop.filter((_,j)=>j!==i);
    }
    const area=norm(loop.reduce((sum,p,i)=>add(sum,cross(sub(p,plane.origin),sub(loop[(i+1)%loop.length],plane.origin))),[0,0,0]));
    if(area>epsilon*epsilon)loops.push(loop);
  }
  if(!loops.length)throw new Error("该平面与几何体没有非零面积的截面（可能相离或仅相切）");
  loops.sort((a,b)=>b.length-a.length);return loops;
}

/** A spatial perpendicular is the line through the point and its orthogonal
 * projection on the reference, not the 90-degree turn of a screen vector. */
export function relationDirection(type:'parallel'|'perpendicular'|'bisector',a:Vec3,
  line:{a:Vec3;b:Vec3}|undefined,plane:PlaneGeometry|undefined,workplane:WorkPlane,spatial:boolean):Vec3 {
  if(plane){if(type!=='perpendicular')throw Error('过点平行于平面有无数条直线；请创建平行平面或选择平面内的方向');return unit(cross(plane.u,plane.v));}
  if(!line)throw Error('请选择参考直线、边或平面');
  const d=sub(line.b,line.a);if(norm(d)<1e-10)throw Error('参考直线方向失效');
  if(type==='parallel')return unit(d);
  const n=cross(workplane.u,workplane.v);
  if(spatial&&type==='perpendicular'){
    const foot=add(line.a,mul(d,dot(sub(a,line.a),d)/dot(d,d))),delta=sub(foot,a);
    if(norm(delta)>1e-8*Math.max(1,norm(sub(a,line.a)),norm(d)))return unit(delta);
  }
  // At a point ON the line (and for the perpendicular bisector), 3D has a
  // pencil of choices. Only a containing workplane makes the requested line unique.
  if(spatial&&(Math.abs(dot(d,unit(n)))>1e-7*norm(d)||Math.abs(dot(sub(a,workplane.origin),unit(n)))>1e-7))
    throw Error(type==='bisector'?'空间线段的垂直平分对象是平面；要作垂直平分线，请先选择包含线段的工作平面':'点在参考直线上，空间垂线不唯一；请先选择包含参考线的工作平面');
  const result=cross(n,d);if(norm(result)<1e-10)throw Error('请先选择包含参考线的工作平面');return unit(result);
}
