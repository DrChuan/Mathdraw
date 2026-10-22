import type { DrawingDocument, DrawingPoint, Vec2, Vec3 } from "./types";
import { resolveGeometry, toPlane, fromPlane, dependencies } from "./geometry";
import { equation, parseExpression, evaluate, isLineEquation } from "./expression";
import { expressionText } from "./advanced";
import { circleCenter, conicPath } from "./conics";
import { curveFunction } from "./constructions";
import { implicitConicLocus } from "./implicitLocus";

type Coordinates=[string,string,string];
const num=(p:Vec3):Coordinates=>p.map(v=>`(${v})`) as Coordinates;
const mix=(a:Coordinates,b:Coordinates,t:string):Coordinates=>a.map((v,i)=>`(${v}+(${b[i]}-${v})*(${t}))`) as Coordinates;
export function locusDomain(doc:DrawingDocument,id:string):[number,number] {
  const p=doc.objects.find(o=>o.id===id);if(p?.kind!=="point") throw new Error("主动对象必须是点");
  const c=p.construction;
  if(c.type==="onAxis") return [-5,5];
  if(c.type==="onPath") {
    const g=resolveGeometry(doc),path=g.curves.get(c.path);
    if(path?.parametric) return [path.parametric.tMin,path.parametric.tMax];
    if(path) {
      const conic=conicPath(path,c.seed??toPlane(doc.planes.find(p=>p.id===path.planeId)!,g.points.get(id)!.p));
      if(conic)return [conic.tMin,conic.tMax];
      const parsed=equation(path.equation);
      if(parsed.type!=="implicit") return parsed.type==="y" ? [path.limits?.xMin??path.range[0],path.limits?.xMax??path.range[1]] : [path.limits?.yMin??path.range[2],path.limits?.yMax??path.range[3]];
      throw new Error("该隐式路径没有唯一的扫描参数，请先使用参数曲线上的主动点");
    }
    const edge=g.edges.find(e=>e.id===c.path);
    if(edge) return g.objects.get(edge.owner)?.kind==="line" ? [-5,5] : [0,1];
  }
  if(c.type==="curveCoordinate") {
    const path=resolveGeometry(doc).curves.get(c.curve);
    if(path) return c.axis==="x" ? [path.limits?.xMin??path.range[0],path.limits?.xMax??path.range[1]] : [path.limits?.yMin??path.range[2],path.limits?.yMax??path.range[3]];
  }
  throw new Error("轨迹需要沿一条路径运动的主动点。请先在线、圆或曲线上创建一个点；孤立自由点没有唯一轨迹");
}
export function dependsOn(doc:DrawingDocument,follower:string,driver:string):boolean {
  const seen=new Set<string>();
  const visit=(id:string):boolean=>{if(id===driver)return true;if(seen.has(id))return false;seen.add(id);const o=doc.objects.find(o=>o.id===id.split(":")[0]);return !!o&&dependencies(o).some(visit);};
  return follower!==driver&&visit(follower);
}
/** Exact coordinate composition; unsupported relations fall back to numerical tracing, never curve fitting. */
export function exactLocus(doc:DrawingDocument,driver:string,follower:string,planeId:string):[string,string]|null {
  const g=resolveGeometry(doc),plane=doc.planes.find(p=>p.id===planeId)!,active=new Set<string>();
  const fromLocal=(x:string,y:string,planeId:string):Coordinates=>{const p=doc.planes.find(p=>p.id===planeId)!;return p.origin.map((v,i)=>`(${v}+${p.u[i]}*(${x})+${p.v[i]}*(${y}))`) as Coordinates;};
  const pathPoint=(p:DrawingPoint):Coordinates=>{
    const c=p.construction;
    if(c.type==="onAxis") {const axis=g.edges.find(e=>g.objects.get(e.owner)?.symbol===`${c.axis}Axis`&&e.owner===`@axis:${c.axis}${c.planeId?`:${c.planeId}`:""}`);if(!axis)throw Error();return mix(num(g.points.get(axis.a)!.p),num(g.points.get(axis.b)!.p),"t");}
    if(c.type!=="onPath"&&c.type!=="curveCoordinate")throw Error();
    const path=g.curves.get(c.type==="onPath"?c.path:c.curve);
    if(!path){if(c.type!=="onPath")throw Error();const edge=g.edges.find(e=>e.id===c.path);if(!edge)throw Error();return mix(num(g.points.get(edge.a)!.p),num(g.points.get(edge.b)!.p),"t");}
    if(path.limits&&Object.values(path.limits).some(v=>v!==undefined))throw Error();
    if(path.parametric)return fromLocal(path.parametric.x,path.parametric.y,path.planeId);
    if(c.type==="onPath"){const conic=conicPath(path,c.seed??toPlane(doc.planes.find(p=>p.id===path.planeId)!,g.points.get(driver)!.p));if(conic)return fromLocal(conic.x,conic.y,path.planeId);}
    const parsed=equation(path.equation),center=c.type==="onPath"?circleCenter(path.equation):null;
    if(center){const fn=curveFunction(path),a=fn(center[0]+1,center[1])-fn(...center),r=Math.sqrt(-fn(...center)/a);return fromLocal(`(${center[0]}+${r}*cos(t))`,`(${center[1]}+${r}*sin(t))`,path.planeId);}
    if(parsed.type==="implicit")throw Error();
    const axis=parsed.type==="y"?"x":"y";
    if(c.type==="curveCoordinate"&&c.axis!==axis)throw Error();
    const f=expressionText(parsed.ast,{[axis]:"t",[axis==="x"?"u":"v"]:"t"});
    return fromLocal(parsed.type==="y"?"t":f,parsed.type==="y"?f:"t",path.planeId);
  };
  const pos=(id:string):Coordinates=>{
    if(id===driver)return pathPoint(doc.objects.find(o=>o.id===id) as DrawingPoint);
    if(active.has(id))throw Error();active.add(id);
    try {
      if(!dependsOn(doc,id,driver))return num(g.points.get(id)!.p);
      const o=doc.objects.find(o=>o.id===id);if(o?.kind!=="point")throw Error();const c=o.construction;
      if(c.type==="alias")return pos(c.point);
      if(c.type==="division")return mix(pos(c.a),pos(c.b),String(c.t));
      if(c.type==="center"&&c.center==="centroid"){const ps=c.points.map(pos);return ps[0].map((v,i)=>`((${v}+${ps[1][i]}+${ps[2][i]})/3)`) as Coordinates;}
      if(c.type==="reflection") {
        if(dependsOn(doc,c.axis,driver))throw Error();
        const edge=g.edges.find(e=>e.id===c.axis);let a:Vec3,b:Vec3;
        if(edge){a=g.points.get(edge.a)!.p;b=g.points.get(edge.b)!.p;}
        else {
          const curve=g.curves.get(c.axis);if(!curve||curve.parametric||!isLineEquation(curve.equation))throw Error();
          const f=curveFunction(curve),v=f(0,0),x=f(1,0)-v,y=f(0,1)-v,n=x*x+y*y;if(n<1e-18)throw Error();
          const plane=doc.planes.find(p=>p.id===curve.planeId)!;
          a=fromPlane(plane,-v*x/n,-v*y/n);b=fromPlane(plane,-v*x/n-y/Math.sqrt(n),-v*y/n+x/Math.sqrt(n));
        }
        const d=b.map((v,i)=>v-a[i]),n=d.reduce((s,v)=>s+v*v,0),p=pos(c.point),t=`((${p.map((v,i)=>`(${v}-${a[i]})*${d[i]}`).join("+")})/${n})`;
        return p.map((v,i)=>`(2*(${a[i]}+${d[i]}*${t})-${v})`) as Coordinates;
      }
      if(c.type==="free"&&o.parameters?.fields["construction.position"]) {
        const field=o.parameters.fields["construction.position"];if(typeof field==="string")throw Error();
        const values=field.coordinates.map(s=>s.replace(/\b([xyz])\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_m,a,n)=>pos(o.parameters!.references[n])[a==="x"?0:a==="y"?1:2]));
        return field.planeId?fromLocal(values[0],values[1],field.planeId):values as Coordinates;
      }
      throw Error();
    } finally {active.delete(id);}
  };
  try {const p=pos(follower),q=p.map((v,i)=>`(${v}-${plane.origin[i]})`),xy=[plane.u,plane.v].map(d=>`(${q.map((v,i)=>`${d[i]}*${v}`).join("+")})`) as [string,string];for(const s of xy)if(s.length>1900)throw Error();return xy.map(s=>expressionText(parseExpression(s,["t"]))) as [string,string];}catch{return null;}
}
export function sampleLocus(doc:DrawingDocument,driver:string,follower:string,planeId:string,min:number,max:number,budgetMs:number):Vec2[][] {
  const plane=doc.planes.find(p=>p.id===planeId)!,paths:Vec2[][]=[],start=performance.now();let current:Vec2[]=[];
  const base={...doc,objects:doc.objects.filter(o=>!(o.kind==="curve"&&o.derived?.type==="locus"))};
  const original=base.objects.find(o=>o.id===driver) as DrawingPoint;
  const initial=resolveGeometry(base),c=original.construction,path=c.type==="onPath"?initial.curves.get(c.path):undefined,center=path?circleCenter(path.equation):null,conic=path&&!path.parametric?conicPath(path,c.type==="onPath"?c.seed??toPlane(plane,initial.points.get(driver)!.p):[0,0]):null;
  const flush=()=>{if(current.length>1)paths.push(current);current=[];};
  for(let i=0;i<=192;i++) {
    if(performance.now()-start>budgetMs)throw new Error("轨迹计算超时，请缩小扫描区间或简化依赖构造");
    const t=min+(max-min)*i/192;let construction:DrawingPoint["construction"];
    if(c.type==="onAxis"||c.type==="onPath")construction={...c,parameter:t};
    else if(c.type==="curveCoordinate")construction={...c,value:t};else throw Error("主动点没有扫描路径");
    if(construction.type==="onPath"&&conic){construction={...construction,seed:[evaluate(parseExpression(conic.x,["t"]),{t}),evaluate(parseExpression(conic.y,["t"]),{t})]};}
    else if(construction.type==="onPath"&&center&&path){const fn=curveFunction(path),r=Math.sqrt(-fn(...center)/(fn(center[0]+1,center[1])-fn(...center)));construction={...construction,seed:[center[0]+r*Math.cos(t),center[1]+r*Math.sin(t)]};}
    try {
      const g=resolveGeometry({...base,objects:base.objects.map(o=>o.id===driver?{...original,construction,parameters:undefined}:o)}),p=g.points.get(follower)?.p;
      if(!p) {flush();continue;} const q=toPlane(plane,p);
      if(!q.every(Number.isFinite)||Math.max(...q.map(Math.abs))>1e6){flush();continue;}
      if(current.length>1){const previous=current[current.length-1],before=current[current.length-2],step=Math.hypot(q[0]-previous[0],q[1]-previous[1]),old=Math.hypot(previous[0]-before[0],previous[1]-before[1]);if(step>Math.max(2,old*15))flush();}
      current.push(q);
    }catch {flush();}
  }
  flush();return paths;
}

/** Algebraic elimination only for polynomial coordinates with one affine coordinate. */
export function cartesianLocus(xy:[string,string]):string|undefined {
  const conic=implicitConicLocus(xy);if(conic)return conic;
  const direct=polynomialLocus(xy);if(direct)return direct;
  // A coordinate-defined follower may depend polynomially on just sin(t) or cos(t).
  // Use that shared expression as the elimination variable, preserving the traced interval.
  for(const fn of ["sin","cos","exp"]) {
    const call=new RegExp(`\\b${fn}\\(t\\)`,"g");
    if(xy.some(s=>call.test(s)) && xy.every(s=>! /\bt\b/.test(s.replace(call,"scan")))) {
      const result=polynomialLocus(xy.map(s=>s.replace(call,"t")) as [string,string]);
      if(result)return result;
    }
  }
}
function polynomialLocus(xy:[string,string]):string|undefined {
  type Ast=ReturnType<typeof parseExpression>;
  const poly=(a:Ast):number[]|null=>{
    if(a.type==="number")return [a.value];
    if(a.type==="variable")return a.name==="t"?[0,1]:null;
    if(a.type==="unary"){const p=poly(a.value);return p?.map(v=>v*a.sign)??null;}
    if(a.type!=="binary")return null;
    const p=poly(a.left),q=poly(a.right);if(!p||!q)return null;
    if(a.op==="+"||a.op==="-")return Array.from({length:Math.max(p.length,q.length)},(_,i)=>(p[i]??0)+(a.op==="+"?1:-1)*(q[i]??0));
    const multiply=(p:number[],q:number[])=>{if(p.length+q.length>10)return null;const r=Array(p.length+q.length-1).fill(0);p.forEach((v,i)=>q.forEach((w,j)=>r[i+j]+=v*w));return r;};
    if(a.op==="*")return multiply(p,q);
    if(a.op==="/"&&q.length===1&&q[0]!==0)return p.map(v=>v/q[0]);
    if(a.op==="^"&&q.length===1&&Number.isInteger(q[0])&&q[0]>=0&&q[0]<=4){let r:number[]|null=[1];for(let i=0;i<q[0]&&r;i++)r=multiply(r,p);return r;}
    return null;
  };
  try {
    const trim=(p:number[]|null)=>{while(p&&p.length>1&&p.at(-1)===0)p.pop();return p;};
    const ps=xy.map(s=>trim(poly(parseExpression(s,["t"]))));
    const axis=ps[0]?.length===2&&ps[0][1]!==0?0:ps[1]?.length===2&&ps[1][1]!==0?1:-1;if(axis<0)return;
    const a=ps[axis]!,b=ps[1-axis];if(!b)return;
    const f=(v:number)=>String(Number(v.toPrecision(12))),name=axis===0?"x":"y",other=axis===0?"y":"x";
    const out=Array(b.length).fill(0);let power=[1];
    b.forEach((v,i)=>{power.forEach((p,j)=>out[j]+=v*p);if(i<b.length-1){const next=Array(power.length+1).fill(0);power.forEach((p,j)=>{next[j]+=-a[0]/a[1]*p;next[j+1]+=p/a[1];});power=next;}});
    let text="";out.forEach((v,i)=>{if(!v)return;const n=f(Math.abs(v)),body=i?`${n==="1"?"":`${n}*`}${name}${i>1?`^${i}`:""}`:n;text+=`${v<0?"-":text?"+":""}${body}`;});
    return `${other}=${text||"0"}`;
  }catch{return;}
}
