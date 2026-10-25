import type { DrawingDocument, DrawingPoint, Vec2, Vec3 } from "./types";
import { resolveGeometry, toPlane, fromPlane, dependencies,coordinateAxis, resolveLocusGeometry } from "./geometry";
import { equation, parseExpression, evaluate } from "./expression";
import { expressionText } from "./advanced";
import { circleCenter, conicPath } from "./conics";
import { curveFunction } from "./constructions";
import { implicitConicLocus } from "./implicitLocus";
import { conicCoefficients } from "./conics";
import { rationalConicLocus,simplifyLocusExpression,compactLocusParameter,rationalExpression } from "./locusAlgebra";
import { withinCurve } from "./parametric";

type Coordinates=[string,string,string];
const num=(p:Vec3):Coordinates=>p.map(v=>`(${v})`) as Coordinates;
const mix=(a:Coordinates,b:Coordinates,t:string):Coordinates=>a.map((v,i)=>`(${v}+(${b[i]}-${v})*(${t}))`) as Coordinates;
const simple=(source:string)=>simplifyLocusExpression(source);
const plus=(a:Coordinates,b:Coordinates):Coordinates=>a.map((v,i)=>simple(`(${v})+(${b[i]})`)) as Coordinates;
const minus=(a:Coordinates,b:Coordinates):Coordinates=>a.map((v,i)=>simple(`(${v})-(${b[i]})`)) as Coordinates;
const scaled=(a:Coordinates,k:string):Coordinates=>a.map(v=>simple(`(${v})*(${k})`)) as Coordinates;
const scalarProduct=(a:Coordinates,b:Coordinates)=>simple(a.map((v,i)=>`(${v})*(${b[i]})`).join("+"));
const vectorProduct=(a:Coordinates,b:Coordinates):Coordinates=>[0,1,2].map(i=>simple(`(${a[(i+1)%3]})*(${b[(i+2)%3]})-(${a[(i+2)%3]})*(${b[(i+1)%3]})`)) as Coordinates;

/** Exclude unrelated scene objects from a tracing job. A tangent branch or
 * complex solid outside this dependency closure cannot break/delay the locus. */
export function locusDocument(doc:DrawingDocument,driver:string,follower:string):DrawingDocument {
  const needed=new Set([...ancestors(doc,driver),...ancestors(doc,follower)]);
  return {...doc,objects:doc.objects.filter(o=>needed.has(o.id))};
}
export function locusDomain(doc:DrawingDocument,id:string):[number,number] {
  const p=doc.objects.find(o=>o.id===id);if(p?.kind!=="point") throw new Error("主动对象必须是点");
  const c=p.construction;
  if(c.type==="onAxis") return [-5,5];
  if(c.type==="onPath") {
    const g=resolveGeometry(doc),path=g.curves.get(c.path);
    if(path?.parametric) return [path.parametric.tMin,path.parametric.tMax];
    if(path) {
      const conic=conicPath(path,c.seed??(g.points.has(id)?toPlane(path.frame??doc.planes.find(p=>p.id===path.planeId)!,g.points.get(id)!.p):[c.parameter,0]));
      if(conic)return [conic.tMin,conic.tMax];
      const parsed=equation(path.equation);
      if(parsed.type!=="implicit") return parsed.type==="y" ? [path.limits?.xMin??path.range[0],path.limits?.xMax??path.range[1]] : [path.limits?.yMin??path.range[2],path.limits?.yMax??path.range[3]];
      throw new Error("该隐式路径没有唯一的扫描参数，请先使用参数曲线上的主动点");
    }
    const edge=g.edges.find(e=>e.id===c.path);
    if(edge) {const o=g.objects.get(edge.owner);return o?.kind==="line" ? o.ray?[0,5]:[-5,5] : [0,1];}
  }
  if(c.type==="curveCoordinate") {
    const path=resolveGeometry(doc).curves.get(c.curve);
    if(path) return c.axis==="x" ? [path.limits?.xMin??path.range[0],path.limits?.xMax??path.range[1]] : [path.limits?.yMin??path.range[2],path.limits?.yMax??path.range[3]];
  }
  throw new Error("轨迹需要沿一条路径运动的主动点。请先在线、圆或曲线上创建一个点；孤立自由点没有唯一轨迹");
}
export function naturalLocusParameter(doc:DrawingDocument,driver:string,xy:[string,string]) {
  const point=doc.objects.find(o=>o.id===driver);if(point?.kind!=="point")return;
  const c=point.construction;let unbounded=c.type==="onAxis",ray=false;
  if(c.type==="onPath") {
    const g=resolveGeometry(doc),path=g.curves.get(c.path),edge=g.edges.find(e=>e.id===c.path),line=edge&&g.objects.get(edge.owner);
    if(line?.kind==="line"){unbounded=true;ray=!!line.ray;}
    if(path&&!path.parametric&&!path.reflectionInput&&!path.limits&&path.followView!==false) {
      const q=conicCoefficients(path.equation);
      if(q)unbounded=q[1]*q[1]-4*q[0]*q[2]>=-1e-12;
      else {
        const parsed=equation(path.equation);
        if(parsed.type!=="implicit") {
          const f=expressionText(parsed.ast,{x:"t",y:"t",u:"t",v:"t"}),r=rationalExpression(f);
          unbounded=!!r&&r.denominator.length===1;
        }
      }
    }
  }
  if(!unbounded)return;
  const exact=compactLocusParameter(xy);if(!exact)return;
  return {xy:exact,min:ray?0:-Math.PI/2,max:Math.PI/2};
}
/** References can name generated vertices/edges; preserve full IDs until lookup. */
function referenceOwner(doc:DrawingDocument,id:string):string {
  if(doc.objects.some(o=>o.id===id))return id;
  return id.replace(/:(?:e|v|f):\d+$/, "");
}
const ancestorCache=new WeakMap<DrawingDocument,Map<string,Set<string>>>();
function ancestors(doc:DrawingDocument,id:string):Set<string> {
  let cache=ancestorCache.get(doc);if(!cache){cache=new Map();ancestorCache.set(doc,cache);}
  const cached=cache.get(id);if(cached)return cached;
  const objects=new Map(doc.objects.map(o=>[o.id,o])),result=new Set<string>(),queue=[id];
  while(queue.length) {
    const ref=queue.pop()!;if(result.has(ref))continue;result.add(ref);
    const owner=referenceOwner(doc,ref);if(owner!==ref)queue.push(owner);
    const o=objects.get(ref);if(o)queue.push(...dependencies(o));
  }
  cache.set(id,result);return result;
}
export function dependsOn(doc:DrawingDocument,follower:string,driver:string):boolean {
  return follower!==driver&&ancestors(doc,follower).has(driver);
}
/** A derived selected point can be driven by its unique shared path ancestor.
 * Independent path parameters stay at their current values. Ambiguity is explicit. */
export function locusDriver(doc:DrawingDocument,selected:string,follower:string):string {
  if(selected===follower)throw new Error("轨迹需要不同的主动点和从动点");
  const pathPoint=(id:string)=>{const o=doc.objects.find(o=>o.id===id);return o?.kind==="point"&&["onAxis","onPath","curveCoordinate"].includes(o.construction.type);};
  if(pathPoint(selected)&&dependsOn(doc,follower,selected))return selected;
  const candidates=[...ancestors(doc,selected)].filter(id=>pathPoint(id)&&dependsOn(doc,follower,id));
  // Prefer the closest path point over ancestors defining that point's path.
  const nearest=candidates.filter(id=>!candidates.some(other=>other!==id&&dependsOn(doc,other,id)));
  if(nearest.length===1)return nearest[0];
  if(nearest.length>1)throw new Error("这两个点关联多个独立动点，请直接选择要扫描的路径点作为主动点");
  if(!dependsOn(doc,follower,selected))throw new Error("从动点与主动点没有可计算的构造依赖；仅位置重合不会建立依赖关系");
  throw new Error("关联构造中没有可扫描的路径点，请先在线、圆或曲线上创建动点");
}
/** Exact coordinate composition; unsupported relations fall back to numerical tracing, never curve fitting. */
const exactCache=new Map<string,[string,string]|null>();
export function exactLocus(doc:DrawingDocument,driver:string,follower:string,planeId:string):[string,string]|null {
  const key=JSON.stringify([driver,follower,planeId,doc.objects,doc.planes,doc.coordinateFrame,doc.coordinateOriginId,doc.dimension,doc.view.mode,doc.view.planeId]);
  if(exactCache.has(key)){const value=exactCache.get(key)!;exactCache.delete(key);exactCache.set(key,value);return value;}
  const value=composeExactLocus(doc,driver,follower,planeId);
  if(key.length<=65536){exactCache.set(key,value);if(exactCache.size>16)exactCache.delete(exactCache.keys().next().value!);}
  return value;
}
function composeExactLocus(doc:DrawingDocument,driver:string,follower:string,planeId:string):[string,string]|null {
  const g=resolveLocusGeometry(doc),active=new Set<string>(),pointMemo=new Map<string,Coordinates>(),lineMemo=new Map<string,[Coordinates,Coordinates]>(),lineActive=new Set<string>();
  const local=(p:Coordinates,planeId:string):[string,string]=>{const pl=doc.planes.find(p=>p.id===planeId)!;return [pl.u,pl.v].map(v=>scalarProduct(minus(p,num(pl.origin)),num(v))) as [string,string];};
  const fromLocal=(x:string,y:string,planeId:string):Coordinates=>{const p=doc.planes.find(p=>p.id===planeId)!;return p.origin.map((v,i)=>`(${v}+${p.u[i]}*(${x})+${p.v[i]}*(${y}))`) as Coordinates;};
  const pathPoint=(p:DrawingPoint):Coordinates=>{
    const c=p.construction;
    if(c.type==="onAxis") {const axis=coordinateAxis(doc,c.axis,c.planeId);return plus(num(axis.origin),scaled(num(axis.direction),"t"));}
    if(c.type!=="onPath"&&c.type!=="curveCoordinate")throw Error();
    const path=g.curves.get(c.type==="onPath"?c.path:c.curve);
    if(!path){if(c.type!=="onPath")throw Error();const edge=g.edges.find(e=>e.id===c.path);if(!edge)throw Error();const ends=line(c.path);return mix(ends[0],ends[1],"t");}
    if(path.limits&&Object.values(path.limits).some(v=>v!==undefined))throw Error();
    if(path.parametric){if(c.type!=="onPath")throw Error();return fromLocal(path.parametric.x,path.parametric.y,path.planeId);}
    if(c.type==="curveCoordinate") {
      const coefficients=conicCoefficients(path.equation);
      if(coefficients) {
        const [A,B,C,D,E,F]=coefficients,a=c.axis==="x"?C:A;
        const b=simple(`(${B})*t+(${c.axis==="x"?E:D})`),k=simple(`(${c.axis==="x"?A:C})*t^2+(${c.axis==="x"?D:E})*t+(${F})`);
        if(c.branch>1||a===0&&c.branch!==0)throw Error();
        const other=a===0?simple(`-(${k})/(${b})`):simple(`(-(${b})+(${(c.branch===0?-1:1)*Math.sign(a)})*sqrt((${b})^2-4*(${a})*(${k})))/(2*(${a}))`);
        return fromLocal(c.axis==="x"?"t":other,c.axis==="x"?other:"t",path.planeId);
      }
    }
    if(c.type==="onPath"){const conic=conicPath(path,c.seed??(g.points.has(driver)?toPlane(path.frame??doc.planes.find(p=>p.id===path.planeId)!,g.points.get(driver)!.p):[c.parameter,0]));if(conic)return fromLocal(conic.x,conic.y,path.planeId);}
    const parsed=equation(path.equation),center=c.type==="onPath"?circleCenter(path.equation):null;
    if(center){const fn=curveFunction(path),a=fn(center[0]+1,center[1])-fn(...center),r=Math.sqrt(-fn(...center)/a);return fromLocal(`(${center[0]}+${r}*cos(t))`,`(${center[1]}+${r}*sin(t))`,path.planeId);}
    if(parsed.type==="implicit")throw Error();
    const axis=parsed.type==="y"?"x":"y";
    if(c.type==="curveCoordinate"&&c.axis!==axis)throw Error();
    const f=expressionText(parsed.ast,{[axis]:"t",[axis==="x"?"u":"v"]:"t"});
    return fromLocal(parsed.type==="y"?"t":f,parsed.type==="y"?f:"t",path.planeId);
  };
  const line=(id:string):[Coordinates,Coordinates]=>{
    const cached=lineMemo.get(id);if(cached)return cached;
    if(lineActive.has(id))throw Error();lineActive.add(id);
    try {
      const o=doc.objects.find(o=>o.id===id);let result:[Coordinates,Coordinates];
      if(!dependsOn(doc,id,driver)&&id!==driver) {const ref=g.straightReference(id);result=[num(ref.a),num(ref.b)];}
      else if(o?.kind==="line"||o?.kind==="segment"||o?.kind==="vector") {
        if(!o.relation)result=[pos(o.points[0]),pos(o.points[1])];
        else {
          const r=o.relation,pl=doc.planes.find(p=>p.id===r.planeId)!,normal=num([pl.u[1]*pl.v[2]-pl.u[2]*pl.v[1],pl.u[2]*pl.v[0]-pl.u[0]*pl.v[2],pl.u[0]*pl.v[1]-pl.u[1]*pl.v[0]]);
          if(r.type==="bisector") {
            const a=pos(o.points[0]),b=pos(o.points[1]),center=scaled(plus(a,b),"0.5");
            result=[center,plus(center,vectorProduct(normal,minus(b,a)))];
          } else {
            const ref=line(r.reference!),a=pos(o.points[0]);let d=minus(ref[1],ref[0]);
            if(r.type==="perpendicular")d=vectorProduct(normal,d);
            result=[a,plus(a,d)];
          }
        }
      } else if(!o&&g.edges.some(e=>e.id===id)) {
        const edge=g.edges.find(e=>e.id===id)!;result=[pos(edge.a),pos(edge.b)];
      } else if(o?.kind==="curve"&&o.derived?.type==="tangent") {
        const c=o.derived,point=doc.objects.find(o=>o.id===c.point),curve=g.curves.get(c.curve);
        if(!curve||c.branch>1||dependsOn(doc,c.curve,driver)||point?.kind!=="point"||
          !(point.construction.type==="onPath"&&point.construction.path===c.curve||point.construction.type==="curveCoordinate"&&point.construction.curve===c.curve))throw Error();
        const coefficients=conicCoefficients(curve.equation);if(!coefficients)throw Error();
        const [A,B,C,D,E]=coefficients,a=pos(c.point),[x,y]=local(a,curve.planeId);
        const dx=simple(`2*(${A})*(${x})+(${B})*(${y})+(${D})`),dy=simple(`(${B})*(${x})+2*(${C})*(${y})+(${E})`),pl=doc.planes.find(p=>p.id===curve.planeId)!;
        result=[a,plus(a,plus(scaled(num(pl.u),`-(${dy})`),scaled(num(pl.v),dx)))];
      } else throw Error();
      lineMemo.set(id,result);return result;
    }finally{lineActive.delete(id);}
  };
  const numberMemo=new Map<string,string>(),numberActive=new Set<string>();
  const numeric=(id:string):string=>{
    const cached=numberMemo.get(id);if(cached)return cached;
    if(numberActive.has(id))throw Error();numberActive.add(id);
    try {
      const o=doc.objects.find(o=>o.id===id);if(o?.kind!=="number")throw Error();
      const value=dependsOn(doc,id,driver)?substitute(o.expression,o):String(g.numbers.get(id));
      numberMemo.set(id,value);return value;
    }finally{numberActive.delete(id);}
  };
  const substitute=(source:string,object:DrawingDocument["objects"][number]):string=>{
    const refs=object.kind==="number"?object.references:object.parameters?.references??{};
    let result=source.replace(/\b([xyz])\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_m,a,n)=>`(${pos(refs[n])[a==="x"?0:a==="y"?1:2]})`);
    const constants:Record<string,string>={};
    for(const [name,id] of Object.entries(refs))if(doc.objects.find(o=>o.id===id)?.kind==="number")constants[name]=`(${numeric(id)})`;
    result=expressionText(parseExpression(result,["t",...Object.keys(constants)]),constants);
    return simple(result);
  };
  const pos=(id:string):Coordinates=>{
    const cached=pointMemo.get(id);if(cached)return cached;
    const p=compute(id).map(simple) as Coordinates;
    if(p.some(s=>s.length>1900))throw Error();
    pointMemo.set(id,p);return p;
  };
  const compute=(id:string):Coordinates=>{
    if(id===driver)return pathPoint(doc.objects.find(o=>o.id===id) as DrawingPoint);
    if(active.has(id))throw Error();active.add(id);
    try {
      if(!dependsOn(doc,id,driver))return num(g.points.get(id)!.p);
      const o=doc.objects.find(o=>o.id===id);if(o?.kind!=="point")throw Error();const c=o.construction;
      if(c.type==="alias")return pos(c.point);
      if(c.type==="onPath"&&!g.curves.has(c.path)) {
        const source=doc.objects.find(o=>o.id===c.path);if(source&&(source.kind==="line"||source.kind==="segment"||source.kind==="vector")&&source.relation)throw Error();
        const [a,b]=line(c.path),field=o.parameters?.fields["construction.parameter"];
        let t=typeof field==="string"?substitute(field,o):String(c.parameter);
        const ref=g.objects.get(c.path);
        if(ref?.kind!=="line") {if(typeof field==="string")throw Error();t=String(Math.max(0,Math.min(1,c.parameter)));}
        else if(ref.ray) {if(typeof field==="string")throw Error();t=String(Math.max(0,c.parameter));}
        return mix(a,b,t);
      }
      if(c.type==="division")return plus(pos(c.a),scaled(minus(pos(c.b),pos(c.a)),typeof o.parameters?.fields["construction.t"]==="string"?substitute(o.parameters.fields["construction.t"],o):String(c.t)));
      if(c.type==="intersection") {
        // A line identity does not enforce moving segment/ray bounds.
        for(const id of [c.first,c.second]) {
          const ref=g.objects.get(id);
          if(!ref||ref.kind==="segment"||ref.kind==="vector"||ref.kind==="line"&&ref.ray)throw Error();
        }
        const [a,b]=line(c.first),[p,q]=line(c.second),u=minus(b,a),v=minus(q,p),w=minus(p,a),n=vectorProduct(u,v),square=scalarProduct(n,n);
        const t=simple(`(${scalarProduct(vectorProduct(w,v),n)})/(${square})`),s=simple(`(${scalarProduct(vectorProduct(w,u),n)})/(${square})`);
        const first=plus(a,scaled(u,t)),second=plus(p,scaled(v,s));
        if(minus(first,second).some(v=>!Number.isFinite(Number(v))||Math.abs(Number(v))>1e-8))throw Error();
        return first;
      }
      if(c.type==="center") {
        const [a,b,d]=c.points.map(pos);
        if(c.center==="centroid")return scaled(plus(plus(a,b),d),"1/3");
        const u=minus(b,a),v=minus(d,a),n=vectorProduct(u,v),den=simple(`2*(${scalarProduct(n,n)})`);
        if(c.center==="incenter") {
          const lengths=[minus(b,d),minus(a,d),minus(a,b)].map(v=>`sqrt(${scalarProduct(v,v)})`),sum=simple(lengths.join("+"));
          return scaled(plus(plus(scaled(a,lengths[0]),scaled(b,lengths[1])),scaled(d,lengths[2])),`1/(${sum})`);
        }
        const center=plus(a,scaled(plus(scaled(vectorProduct(v,n),scalarProduct(u,u)),scaled(vectorProduct(n,u),scalarProduct(v,v))),`1/(${den})`));
        return c.center==="orthocenter"?minus(plus(plus(a,b),d),scaled(center,"2")):center;
      }
      if(c.type==="reflection") {
        const [a,b]=line(c.axis),d=minus(b,a),p=pos(c.point),t=simple(`(${scalarProduct(minus(p,a),d)})/(${scalarProduct(d,d)})`);
        return minus(scaled(plus(a,scaled(d,t)),"2"),p);
      }
      if(c.type==="free"&&o.parameters?.fields["construction.position"]) {
        const field=o.parameters.fields["construction.position"];if(typeof field==="string")throw Error();
        const values=field.coordinates.map(s=>substitute(s,o));
        return field.planeId?fromLocal(values[0],values[1],field.planeId):values as Coordinates;
      }
      throw Error();
    } finally {active.delete(id);}
  };
  try {const p=pos(follower),xy=local(p,planeId);for(const s of xy)if(s.length>1900)throw Error();return xy;}catch{return null;}
}
export function sampleLocus(doc:DrawingDocument,driver:string,follower:string,planeId:string,min:number,max:number,budgetMs:number):Vec2[][] {
  const plane=doc.planes.find(p=>p.id===planeId)!,paths:Vec2[][]=[],start=performance.now();let current:Vec2[]=[];
  let base=locusDocument(doc,driver,follower);
  const original=base.objects.find(o=>o.id===driver) as DrawingPoint;
  const initial=resolveLocusGeometry(base),c=original.construction,path=c.type==="onPath"?initial.curves.get(c.path):undefined,center=path?circleCenter(path.equation):null,conic=path&&!path.parametric?conicPath(path,c.type==="onPath"?c.seed??(initial.points.has(driver)?toPlane(path.frame??doc.planes.find(p=>p.id===path.planeId)!,initial.points.get(driver)!.p):[c.parameter,0]):[0,0]):null;
  const conicAst=conic?{x:parseExpression(conic.x,["t"]),y:parseExpression(conic.y,["t"])}:undefined;
  if(!base.objects.some(o=>o.kind==="curve"&&o.derived?.type==="locus"))base={...base,objects:base.objects.map(o=>o.kind==="point"&&o.id!==driver&&!dependsOn(base,o.id,driver)&&initial.points.has(o.id)
    ?{...o,construction:{type:"free" as const,position:initial.points.get(o.id)!.p},parameters:undefined}:o)};
  const flush=()=>{if(current.length>1)paths.push(current);current=[];};
  for(let i=0;i<=192;i++) {
    if(performance.now()-start>budgetMs)throw new Error("轨迹计算超时，请缩小扫描区间或简化依赖构造");
    const t=min+(max-min)*i/192;let construction:DrawingPoint["construction"];
    if(c.type==="onAxis"||c.type==="onPath")construction={...c,parameter:t};
    else if(c.type==="curveCoordinate")construction={...c,value:t};else throw Error("主动点没有扫描路径");
    if(construction.type==="onPath"&&conicAst&&path){
      const uv:Vec2=[evaluate(conicAst.x,{t}),evaluate(conicAst.y,{t})];
      if(!withinCurve(path,uv)||path.followView===false&&(uv[0]<path.range[0]||uv[0]>path.range[1]||uv[1]<path.range[2]||uv[1]>path.range[3])){flush();continue;}
      construction={type:"free",position:fromPlane(doc.planes.find(p=>p.id===path.planeId)!,...uv)};
    }
    else if(construction.type==="onPath"&&center&&path){const fn=curveFunction(path),r=Math.sqrt(-fn(...center)/(fn(center[0]+1,center[1])-fn(...center)));construction={...construction,seed:[center[0]+r*Math.cos(t),center[1]+r*Math.sin(t)]};}
    try {
      const g=resolveLocusGeometry({...base,objects:base.objects.map(o=>o.id===driver?{...original,construction,parameters:undefined}:o)}),p=g.points.get(follower)?.p;
      if(!p) {flush();continue;} const q=toPlane(plane,p);
      if(!q.every(Number.isFinite)||Math.max(...q.map(Math.abs))>1e6){flush();continue;}
      if(current.length>1){const previous=current[current.length-1],before=current[current.length-2],step=Math.hypot(q[0]-previous[0],q[1]-previous[1]),old=Math.hypot(previous[0]-before[0],previous[1]-before[1]);if(step>Math.max(2,old*15))flush();}
      current.push(q);
    }catch {flush();}
  }
  flush();if(!paths.length)throw new Error("当前扫描区间内没有有效轨迹，请检查从动点是否失效，或调整主动点的扫描范围");return paths;
}

/** Algebraic elimination only for polynomial coordinates with one affine coordinate. */
export function cartesianLocus(xy:[string,string]):string|undefined {
  const rational=rationalConicLocus(xy);if(rational)return rational;
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

/** Dependency-only guidance: does not sample or alter the drawing. */
export function locusSelectionInfo(doc:DrawingDocument,selected?:string):string {
 const points=doc.objects.filter(o=>o.kind==='point');
 if(!selected){const paths=points.filter(o=>o.kind==='point'&&['onAxis','onPath','curveCoordinate'].includes(o.construction.type));return paths.length?`先选主动点：${paths.map(o=>o.symbol??o.name).join('、')}；也可选择由唯一上游路径点控制的派生点。`:'先在线、圆或曲线上放一个点；孤立自由点没有唯一的扫描路径。';}
 const names=points.filter(o=>o.id!==selected).filter(o=>{try{locusDriver(doc,selected,o.id);return true;}catch{return false;}}).map(o=>o.symbol??o.name);
 return names.length?`可作为从动点：${names.join('、')}。仅位置重合不构成依赖。`:'没有找到由该点或其上游路径控制的从动点；请检查对象的构造依赖。';
}
