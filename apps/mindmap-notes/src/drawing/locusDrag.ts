import type { DrawingCurve, DrawingDocument, DrawingPoint, Vec2, Vec3 } from "./types";
import { fromPlane, project, resolveLocusGeometry, toPlane } from "./geometry";
import { exactLocus, locusDocument, naturalLocusParameter } from "./locus";
import { conicPath } from "./conics";
import { equation, evaluate, parseExpression } from "./expression";
import { nearestParameter, withinCurve } from "./parametric";
import { rationalExpression } from "./locusAlgebra";

/** This relationship is an interaction, never a new dependency of the follower. */
export function inverseLocus(doc:DrawingDocument,follower:string):DrawingCurve|undefined {
  const candidates=doc.objects.filter((o):o is DrawingCurve=>o.kind==="curve"&&o.derived?.type==="locus"&&o.derived.follower===follower);
  const eligible=candidates.filter(o=>{
    const c=o.derived!;if(c.type!=="locus")return false;
    const p=doc.objects.find(p=>p.id===c.driver);
    return p?.kind==="point"&&!p.locked&&!p.parameters&&["onPath","onAxis","curveCoordinate"].includes(p.construction.type);
  });
  return eligible.filter(o=>!o.hidden).at(-1)??eligible.at(-1);
}
export interface LocusDrag {
  driver:string;
  move(target:Vec2):{document?:DrawingDocument;hint:string};
}

/** Invert a one-parameter trace in screen space. Exact traces provide a fast
 * search function, but every accepted result is checked in the original graph.
 * Numeric traces use the same driver construction and dependency evaluator. */
export function createLocusDrag(doc:DrawingDocument,locus:DrawingCurve,size:Vec2):LocusDrag {
  const trace=locus.derived;if(trace?.type!=="locus")throw new Error("该对象不是轨迹");
  const base=locusDocument(doc,trace.driver,trace.follower),geometry=resolveLocusGeometry(base);
  const original=base.objects.find(o=>o.id===trace.driver) as DrawingPoint;
  const current=geometry.points.get(trace.driver)?.p;
  if(!original||!current)throw new Error("轨迹主动点当前无效");
  const c=original.construction,plane=doc.planes.find(p=>p.id===locus.planeId)!;
  const path=c.type==="onPath"?geometry.curves.get(c.path):undefined;
  const pathPlane=path&&doc.planes.find(p=>p.id===path.planeId)!;
  const conic=path&&!path.parametric?conicPath(path,c.type==="onPath"?c.seed??toPlane(pathPlane!,current):[0,0]):null;
  const conicAst=conic?{x:parseExpression(conic.x,["t"]),y:parseExpression(conic.y,["t"])}:undefined;
  const parsed=path&&!path.parametric?equation(path.equation):undefined;
  const exact=exactLocus(base,trace.driver,trace.follower,locus.planeId);
  const natural=trace.natural&&exact?naturalLocusParameter(base,trace.driver,exact):undefined;
  const xy=natural?.xy??exact,ast=xy?xy.map(s=>parseExpression(s,["t"])):undefined;
  let min=natural?.min??trace.min,max=natural?.max??trace.max;
  if(!(Number.isFinite(min)&&Number.isFinite(max)&&max>min))throw new Error("轨迹的扫描范围无效");
  let initial=c.type==="curveCoordinate"?c.value:c.type==="onAxis"||c.type==="onPath"?c.parameter:NaN;
  if(conic&&pathPlane) {
    const uv=toPlane(pathPlane,current);
    // Parabolic parametrizations have an affine coordinate. Recover its exact
    // parameter instead of assuming it equals the onPath display parameter.
    const affine=[conic.x,conic.y].map(rationalExpression);
    const axis=affine.findIndex(r=>r&&r.denominator.length===1&&r.numerator.length===2&&Math.abs(r.numerator[1])>1e-12);
    if(axis>=0){const r=affine[axis]!;initial=(uv[axis]*r.denominator[0]-r.numerator[0])/r.numerator[1];}
    else initial=nearestParameter({...path,parametric:conic},uv);
  }
  if(natural)initial=Math.atan(initial);
  // A natural finite scan can have been created before the driver moved farther
  // along an unbounded path. Include its current value without changing files.
  if(trace.natural&&!natural&&!(path?.parametric)&&!conic){min=Math.min(min,initial);max=Math.max(max,initial);}
  let previous=Math.max(min,Math.min(max,initial));
  const span=max-min,analytic=!!ast,steps=analytic?128:48;
  const screen=(p:Vec3):Vec2=>{const q=project(p,doc);return [(q[0]-doc.view.center[0])*doc.view.scale+size[0]/2,(q[1]-doc.view.center[1])*doc.view.scale+size[1]/2];};
  const raw=(s:number)=>natural?Math.tan(s):s;
  const construction=(s:number):DrawingPoint["construction"]=>{
    if(natural&&Math.abs(Math.cos(s))<1e-7)throw new Error("这是轨迹的极限位置，没有有限的主动点");
    const t=raw(s);if(!Number.isFinite(t))throw new Error("主动点参数无效");
    if(c.type==="curveCoordinate")return {...c,value:t};
    if(c.type==="onAxis") {
      if(doc.dimension==="3d"&&t<0)throw new Error("超出坐标轴正半轴");
      return {...c,parameter:t};
    }
    if(c.type!=="onPath")throw new Error("主动点没有一维路径");
    if(conicAst&&path) {
      const uv:Vec2=[evaluate(conicAst.x,{t}),evaluate(conicAst.y,{t})];
      if(!withinCurve(path,uv)||path.followView===false&&(uv[0]<path.range[0]||uv[0]>path.range[1]||uv[1]<path.range[2]||uv[1]>path.range[3]))throw new Error("超出主动点路径范围");
      return {...c,seed:uv,parameter:parsed?.type==="y"?uv[0]:parsed?.type==="x"?uv[1]:t};
    }
    return {...c,parameter:t};
  };
  const changed=(s:number):DrawingPoint=>({...original,construction:construction(s)});
  const actual=(point:DrawingPoint)=>{
    const g=resolveLocusGeometry({...base,objects:base.objects.map(o=>o.id===original.id?point:o)});
    const p=g.points.get(trace.follower)?.p,driver=g.points.get(trace.driver)?.p;
    if(!p||!driver||![...p,...driver].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9))return;
    return screen(p);
  };
  const samples=new Map<number,Vec2|null>();
  const at=(s:number):Vec2|null=>{
    if(samples.has(s))return samples.get(s)!;
    let q:Vec2|null=null;
    try {
      if(ast)q=screen(fromPlane(plane,evaluate(ast[0],{t:s}),evaluate(ast[1],{t:s})));
      else q=actual(changed(s))??null;
      if(q&&!q.every(Number.isFinite))q=null;
    }catch{q=null;}
    samples.set(s,q);return q;
  };
  const grid=Array.from({length:steps+1},(_,i)=>min+span*i/steps);
  const anchors=new Set(grid);
  grid.forEach(at);
  const name=original.symbol??original.name;
  const failure="该处原构造无效或仅为轨迹的极限位置，已保留上一个有效位置";
  return {driver:trace.driver,move(target) {
    const distance=(s:number)=>{const q=at(s);return q?Math.hypot(q[0]-target[0],q[1]-target[1]):Infinity;};
    // Keep all local minima, so intersecting/overlapping parts of a trajectory
    // can choose the solution continuous with the previous driver parameter.
    const values=grid.map(distance),brackets:[number,number][]=[];
    for(let i=0;i<=steps;i++)if(Number.isFinite(values[i])&&(i===0||values[i]<=values[i-1])&&(i===steps||values[i]<=values[i+1]))
      brackets.push([grid[Math.max(0,i-1)],grid[Math.min(steps,i+1)]]);
    brackets.sort((a,b)=>Math.min(distance(a[0]),distance(a[1]),distance((a[0]+a[1])/2))-Math.min(distance(b[0]),distance(b[1]),distance((b[0]+b[1])/2)));
    const searched=brackets.slice(0,analytic?8:3);
    searched.push([Math.max(min,previous-span/steps),Math.min(max,previous+span/steps)]);
    const candidates:{t:number;distance:number}[]=[];
    for(const [lo,hi] of searched) {
      let a=lo,b=hi;const ratio=(Math.sqrt(5)-1)/2;
      let u=b-ratio*(b-a),v=a+ratio*(b-a),du=distance(u),dv=distance(v);
      for(let j=0;j<(analytic?36:20);j++) {
        if(du<dv){b=v;v=u;dv=du;u=b-ratio*(b-a);du=distance(u);}
        else {a=u;u=v;du=dv;v=a+ratio*(b-a);dv=distance(v);}
      }
      const t=du<dv?u:v;candidates.push({t,distance:Math.min(du,dv)});
    }
    candidates.push({t:previous,distance:distance(previous)});
    candidates.sort((a,b)=>a.distance-b.distance);
    const best=candidates[0];if(!best||!Number.isFinite(best.distance))return {hint:failure};
    const near=candidates.filter(c=>c.distance<=best.distance+.35);
    // Only closed driver paths wrap: compactifying an infinite line does not
    // make its two ends interchangeable at a limiting follower position.
    const periodic=!natural&&!!conic&&Math.abs(conic.tMax-conic.tMin-2*Math.PI)<1e-10&&Math.abs(span-2*Math.PI)<1e-10;
    const delta=(t:number)=>{const d=Math.abs(t-previous);return periodic?Math.min(d,span-d):d;};
    near.sort((a,b)=>delta(a.t)-delta(b.t));
    const candidate=near[0];
    try {
      const point=changed(candidate.t),q=actual(point),predicted=at(candidate.t);
      if(!q||!predicted||Math.hypot(q[0]-predicted[0],q[1]-predicted[1])>.75)return {hint:failure};
      previous=candidate.t;
      // Retain only fixed grid entries between frames; numeric searches must
      // not grow an unbounded cache over a long pointer gesture.
      if(samples.size>512)for(const t of samples.keys())if(!anchors.has(t)&&t!==previous)samples.delete(t);
      return {document:{...doc,objects:doc.objects.map(o=>o.id===point.id?point:o)},hint:`沿轨迹反向拖动 · 正在调整主动点 ${name}`};
    }catch{return {hint:failure};}
  }};
}
