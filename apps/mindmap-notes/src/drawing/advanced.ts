import type { DrawingCurve, DrawingDocument, Vec2 } from "./types";
import { equation, evaluate } from "./expression";
import { curveFunction, implicitIntersections, roots } from "./constructions";
import { pointAt, withinCurve } from "./parametric";
import { conicCoefficients } from "./conics";
import { lineConic } from "./quadratic";

/** Serialize the restricted AST, preserving explicit multiplication and substitutions. */
export function expressionText(ast: ReturnType<typeof equation>["ast"], vars: Record<string,string> = {}): string {
  if(ast.type === "number") return String(ast.value);
  if(ast.type === "variable") return vars[ast.name] ?? ast.name;
  if(ast.type === "unary") return `(${ast.sign < 0 ? "-" : "+"}${expressionText(ast.value,vars)})`;
  if(ast.type === "binary") {
    const a=expressionText(ast.left,vars),b=expressionText(ast.right,vars);
    const av=Number(a),bv=Number(b);
    if(Number.isFinite(av)&&Number.isFinite(bv)){const n=evaluate(ast);if(Number.isFinite(n))return String(n);}
    if(ast.op==="*"&&(a==="0"||b==="0"))return "0";
    if((ast.op==="+"||ast.op==="-")&&b==="0")return a;
    if(ast.op==="+"&&a==="0")return b;
    if((ast.op==="*"||ast.op==="/"||ast.op==="^")&&b==="1")return a;
    if(ast.op==="*"&&a==="1")return b;
    return `(${a}${ast.op}${b})`;
  }
  return `${ast.name}(${ast.args.map(a=>expressionText(a,vars)).join(",")})`;
}
export function reflectedCoordinates(a:Vec2,b:Vec2):[string,string] {
  const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy;
  if(n<1e-16) throw new Error("对称轴方向失效");
  const m=(dx*dx-dy*dy)/n,k=2*dx*dy/n;
  return [`(${m}*x+${k}*y+${a[0]-m*a[0]-k*a[1]})`,`(${k}*x-${m}*y+${a[1]-k*a[0]+m*a[1]})`];
}
export function reflectedCurve(source:DrawingCurve,a:Vec2,b:Vec2):Partial<DrawingCurve> {
  const [x,y]=reflectedCoordinates(a,b);
  if(source.parametric) {
    const sx=expressionText(equation(`y=${source.parametric.x}`, ["t"]).ast),sy=expressionText(equation(`y=${source.parametric.y}`,["t"]).ast);
    const subst=(s:string)=>expressionText(equation(`y=${s}`).ast,{x:sx,y:sy});
    return {equation:"0",parametric:{...source.parametric,x:subst(x),y:subst(y)}};
  }
  const parsed=equation(source.equation),f=expressionText(parsed.ast,{x,y,u:x,v:y});
  return {equation:parsed.type === "y" ? `${y}-(${f})=0` : parsed.type === "x" ? `${x}-(${f})=0` : `${f}=0`};
}
/** Return contact point and direction for every isolated real tangent in the search range. */
export function pointConstrainedToCurve(doc:DrawingDocument,point:string,curve:string,seen=new Set<string>()):boolean {
  if(seen.has(point))return false;seen.add(point);
  const o=doc.objects.find(o=>o.id===point);if(o?.kind!=="point")return false;
  const c=o.construction;
  return c.type==="onPath"?c.path===curve:c.type==="curveCoordinate"?c.curve===curve:c.type==="alias"?pointConstrainedToCurve(doc,c.point,curve,seen):false;
}
export function tangentCandidates(curve:DrawingCurve,p:Vec2,atCurvePoint=false):{point:Vec2;direction:Vec2}[] {
  // Geometry is resolved for previews, normalization and rendering as well as dragging.
  const key=JSON.stringify([curve.equation,curve.parametric,curve.range,curve.limits,curve.followView,curve.reflectionInput,p,atCurvePoint]);
  const cached=tangentCache.get(key);
  if(cached instanceof Error)throw cached;
  if(cached)return cached;
  try {const result=computeTangents(curve,p,atCurvePoint);rememberTangents(key,result);return result;}
  catch(e){rememberTangents(key,e as Error);throw e;}
}
type Tangents = {point:Vec2;direction:Vec2}[];
const tangentCache=new Map<string,Tangents|Error>();
function rememberTangents(key:string,result:Tangents|Error) {
  if(tangentCache.size>=128)tangentCache.delete(tangentCache.keys().next().value!);
  tangentCache.set(key,result);
}
function computeTangents(curve:DrawingCurve,p:Vec2,atCurvePoint:boolean):Tangents {
  const f=curveFunction(curve),conic=!curve.parametric||curve.declaration ? conicCoefficients(curve.equation) : null;
  const derivative=(q:Vec2):Vec2=>{
    if(conic){const [A,B,C,D,E]=conic;return [2*A*q[0]+B*q[1]+D,B*q[0]+2*C*q[1]+E];}
    const h=1e-5*Math.max(1,Math.hypot(...q));
    return [(f(q[0]+h,q[1])-f(q[0]-h,q[1]))/(2*h),(f(q[0],q[1]+h)-f(q[0],q[1]-h))/(2*h)];
  };
  let contacts:Vec2[]=[];
  if(conic) {
    const [A,B,C,D,E,F]=conic;
    const terms=[A*p[0]*p[0],B*p[0]*p[1],C*p[1]*p[1],D*p[0],E*p[1],F];
    // A contact point gives a double root of the polar intersection. Solving
    // that quadratic magnifies projection roundoff and can invent two roots.
    const onConic=Math.abs(terms.reduce((a,b)=>a+b,0))<=64*Number.EPSILON*Math.max(1,terms.reduce((a,b)=>a+Math.abs(b),0));
    if(atCurvePoint||onConic)contacts=[p];
    else if(A===0&&B===0&&C===0) {
      const g=derivative(p);if(Math.abs(f(...p))<1e-8*Math.hypot(...g))contacts=[p];
    } else contacts=lineConic(conic,2*A*p[0]+B*p[1]+D,B*p[0]+2*C*p[1]+E,D*p[0]+E*p[1]+2*F);
  } else if(curve.parametric) {
    const c=curve.parametric, tangent=(t:number)=>{
      const h=Math.max(1e-6,(c.tMax-c.tMin)*1e-6),a=pointAt(curve,t-h),b=pointAt(curve,t+h);
      return [(b[0]-a[0])/(2*h),(b[1]-a[1])/(2*h)] as Vec2;
    };
    return distinctTangents(curve,roots(t=>{const q=pointAt(curve,t),d=tangent(t);return (q[0]-p[0])*d[1]-(q[1]-p[1])*d[0];},c.tMin,c.tMax)
      .map(t=>({point:pointAt(curve,t),direction:tangent(t)})));
  } else {
    const g=derivative(p);
    if(Math.hypot(...g)>1e-10 && Math.abs(f(...p))/Math.hypot(...g)<1e-7) contacts.push(p);
    const parsed=equation(curve.equation);
    if(parsed.type!=="implicit") {
      const point=(t:number):Vec2=>parsed.type==="y"?[t,evaluate(parsed.ast,{x:t,u:t})]:[evaluate(parsed.ast,{y:t,v:t}),t];
      contacts.push(...roots(t=>{const q=point(t),g=derivative(q);return g[0]*(p[0]-q[0])+g[1]*(p[1]-q[1]);},
        curve.range[parsed.type==="y"?0:2],curve.range[parsed.type==="y"?1:3]).map(point));
    } else contacts.push(...implicitIntersections(f,(x,y)=>{const g=derivative([x,y]);return g[0]*(p[0]-x)+g[1]*(p[1]-y);},curve.range));
  }
  return distinctTangents(curve,contacts.map(point=>{const g=derivative(point);return {point,direction:[-g[1],g[0]]};}));
}
function distinctTangents(curve:DrawingCurve,candidates:Tangents):Tangents {
  const result:Tangents=[];
  for(const {point:q,direction} of candidates) {
    if(!withinDerivedCurve(curve,q)) continue;
    if(curve.followView===false && (q[0]<curve.range[0]-1e-8||q[0]>curve.range[1]+1e-8||q[1]<curve.range[2]-1e-8||q[1]>curve.range[3]+1e-8))continue;
    const n=Math.hypot(...direction);if(!Number.isFinite(n)||n<1e-10) continue;
    const d:Vec2=[direction[0]/n,direction[1]/n];
    if(!result.some(r=>Math.abs(r.direction[0]*d[1]-r.direction[1]*d[0])<1e-6 && Math.abs((q[0]-r.point[0])*d[1]-(q[1]-r.point[1])*d[0])<1e-6)) result.push({point:q,direction:d});
  }
  return result.sort((a,b)=>Math.atan2(a.direction[1],a.direction[0])-Math.atan2(b.direction[1],b.direction[0]));
}

export function reflectPosition(p:Vec2,a:Vec2,b:Vec2):Vec2 {
  const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy,t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/n;
  return [2*(a[0]+t*dx)-p[0],2*(a[1]+t*dy)-p[1]];
}
export const withinDerivedCurve = withinCurve;

/** Express a coplanar curve in another orthonormal basis before intersection.
 * Equal workplane IDs do not imply equal moving circle frames. */
export function reframeCurve(curve:DrawingCurve,from:import('./types').WorkPlane,to:import('./types').WorkPlane):DrawingCurve {
  const dot=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
  const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const n=cross(from.u,from.v),m=cross(to.u,to.v);
  if(Math.hypot(...cross(n,m))>1e-7||Math.abs(dot(sub(to.origin,from.origin),n))>1e-7)throw Error('两条空间曲线不共面；当前求交仅支持共面曲线');
  if(JSON.stringify([from.origin,from.u,from.v])===JSON.stringify([to.origin,to.u,to.v]))return curve;
  const affine=(axis:number[],offset:number[],u:number[],v:number[],x:string,y:string)=>`(${dot(offset,axis)}+(${dot(u,axis)})*(${x})+(${dot(v,axis)})*(${y}))`;
  const x=affine(from.u,sub(to.origin,from.origin),to.u,to.v,'x','y'),y=affine(from.v,sub(to.origin,from.origin),to.u,to.v,'x','y');
  const parsed=equation(curve.equation),f=expressionText(parsed.ast,{x,y,u:x,v:y});
  const equationText=parsed.type==='y'?`${y}-(${f})=0`:parsed.type==='x'?`${x}-(${f})=0`:`${f}=0`;
  const param=curve.parametric,xy=param?[
    affine(to.u,sub(from.origin,to.origin),from.u,from.v,param.x,param.y),
    affine(to.v,sub(from.origin,to.origin),from.u,from.v,param.x,param.y),
  ]:undefined;
  const corners=[0,1,2,3].map(i=>{
    const a=curve.range[i%2],b=curve.range[2+Math.floor(i/2)],offset=sub(from.origin,to.origin);
    return [dot(offset,to.u)+a*dot(from.u,to.u)+b*dot(from.v,to.u),dot(offset,to.v)+a*dot(from.u,to.v)+b*dot(from.v,to.v)];
  });
  return {...curve,frame:to,equation:equationText,parametric:param?{...param,x:xy![0],y:xy![1]}:undefined,limits:undefined,reflectionInput:undefined,
    range:[Math.min(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[1]))]};
}
