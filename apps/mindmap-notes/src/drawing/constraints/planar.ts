import type { Vec3 } from '../types';
import type { ConstraintProblem,ConstraintResult,PlanarUnknown,Positions,SolutionBranch,SolveRequest,AlgebraicValue } from './types';
import { evaluator,flatten,problemScale } from './compile';
import { jacobian,rowBasis,offRowSpace,dampedStep,sub,norm,dot,cross } from './math';
import { analyticLoci,nearestLocus } from './loci';
import { planConstructions } from './planner';
import { materializePlanar,planarPositions,objectSymbol,coordinatePlane } from './planarModel';
import { equationEnvironment } from './planarExpressions';
import { affectedObjects,resolveGeometry } from '../geometry';
import { algebraicRoots,algebraicSystem } from './algebraic';
import { symbolicPlanarEquations } from './planarSymbolic';
import { conicIntersections } from '../quadratic';
import { validateProblem } from './input';
import {solveExactSystem,type ExactCertificate} from './exactSystem';
import {localMobility} from './mobility';
import {substituteNames} from '../parameters';

interface Variable extends PlanarUnknown {point?:string;axis?:number}
const penalty=1e4,cap=12;
const size=(r:number[])=>Math.max(0,...r.map(v=>Math.abs(v)));
export function planarEvaluator(problem:ConstraintProblem) {
  const context=problem.planar,source=context?.document,names=new Set(source?.objects.filter(o=>o.kind==='point').map(objectSymbol)??[]),scale=problemScale(problem),geometric=evaluator(problem);
  const variables:Variable[]=[...(context?.unknowns??[])];
  for(const name of problem.points)if(!names.has(name))for(const axis of [0,1])variables.push({id:`point.${name}.${axis}`,object:'',field:axis?'y':'x',point:name,axis,initial:0});
  const initial=variables.map(v=>v.initial);
  const decode=(v:number[])=>{
    const values=Object.fromEntries(variables.map((u,i)=>[u.id,v[i]])),p:Positions={};
    variables.forEach((u,i)=>{if(u.point){p[u.point]??=[0,0,0];p[u.point][u.axis!]=v[i];}});
    const doc=materializePlanar(problem,values,p),positions=planarPositions(problem,doc,true);
    const geometry=resolveGeometry(doc),plane=coordinatePlane(doc),depths=problem.points.map(n=>{const o=doc.objects.find(o=>o.kind==='point'&&objectSymbol(o)===n)!;const p=geometry.points.get(o.id)?.p;return p?dot(sub(p,plane.origin),cross(plane.u,plane.v)):0;});
    return {doc,positions,values,depths};
  };
  let cached:number[]|undefined,last:ReturnType<typeof decode>|undefined;
  const model=(v:number[])=>{if(cached?.length===v.length&&cached.every((n,i)=>n===v[i])&&last)return last;const next=decode(v);cached=[...v];last=next;return next;};
  const equations=context?.equations.filter(e=>e.enabled)??[],equationSizes=new Map<string,number>();
  try{const d=decode(initial),env=equationEnvironment(d.doc);for(const e of equations)try{equationSizes.set(e.id,env.residual(e.source).length);}catch{equationSizes.set(e.id,/^intersection\s*\(/i.test(e.source)?10:/^on(?:Curve|Line)\s*\(/i.test(e.source)?5:/^(center|focus|directrix|vectorRelation)\s*\(/i.test(e.source)?2:1);}}catch{/* Free starting values may be degenerate. */}
  const errors=(v:number[])=>{
    const out:{source:string;error:number}[]=[];
    try{const d=model(v),check=geometric.verify(flatten(problem.points,d.positions));for(const e of check.errors)if(e.error>3e-6||e.degenerate)out.push({source:problem.conditions.find(c=>c.id===e.id)?.source??e.id,error:e.error||1});
      if(size(d.depths)>1e-9)out.push({source:'对象不在当前二维坐标平面内，不能投影后代替原定义',error:size(d.depths)});
      if(source){const g=resolveGeometry(d.doc);for(const [id,message] of g.errors)out.push({source:`${d.doc.objects.find(o=>o.id===id)?.name??id}：${message}`,error:1});}
      const env=equations.length?equationEnvironment(d.doc):undefined;for(const e of equations)try{const error=size(env!.residual(e.source));if(error>3e-6||!env!.satisfied(e.source))out.push({source:e.source,error:error||1});}catch(err){out.push({source:`${e.source}：${(err as Error).message}`,error:1});}
      variables.forEach((u,i)=>{if(!Number.isFinite(v[i])||Math.abs(v[i])>1e9||u.min!==undefined&&v[i]<u.min-1e-7||u.max!==undefined&&v[i]>u.max+1e-7)out.push({source:`${u.field} 超出取值范围`,error:1});});
    }catch(e){out.push({source:(e as Error).message,error:1});}return out;
  };
  const residual=(v:number[],includeBounds=true)=>{
    let rows:number[];
    try {const d=model(v);rows=[...geometric.values(flatten(problem.points,d.positions),false),...d.depths.map(v=>v/scale)];
      const env=equations.length?equationEnvironment(d.doc):undefined;for(const e of equations)try{const r=env!.residual(e.source);rows.push(...r.map(n=>Number.isFinite(n)?n:penalty));}catch{rows.push(...Array(equationSizes.get(e.id)??1).fill(penalty));}
    }catch{rows=Array(geometric.values(flatten(problem.points,Object.fromEntries(problem.points.map(n=>[n,[0,0,0] as Vec3]))),false).length+problem.points.length+equations.reduce((s,e)=>s+(equationSizes.get(e.id)??1),0)).fill(penalty);}
    if(includeBounds)variables.forEach((u,i)=>{if(u.min!==undefined)rows.push(Math.min(0,v[i]-u.min)/Math.max(1,Math.abs(u.min)));if(u.max!==undefined)rows.push(Math.max(0,v[i]-u.max)/Math.max(1,Math.abs(u.max)));});
    return rows.map(n=>Number.isFinite(n)?n:penalty);
  };
  const encode=(p:Positions,values:Record<string,number>={})=>variables.map(u=>u.point?p[u.point]?.[u.axis!]??u.initial:values[u.id]??u.initial);
  const mobilityResidual=(v:number[])=>residual(v,false);
  return {variables,initial,model,errors,residual,mobilityResidual,encode,scale};
}
function minimize(f:(v:number[])=>number[],start:number[],deadline:number,limits?:[number,number][]) {
  let v=[...start],r=f(v),cost=r.reduce((s,n)=>s+n*n,0),lambda=1e-3;
  for(let k=0;k<100&&Date.now()<deadline&&v.length;k++){
    if(size(r)<1e-10)break;const step=dampedStep(jacobian(f,v,r),r,lambda);if(step.length!==v.length||step.some(n=>!Number.isFinite(n)))break;
    const next=v.map((n,i)=>limits?Math.max(limits[i][0],Math.min(limits[i][1],n+step[i])):n+step[i]),s=f(next),c=s.reduce((sum,n)=>sum+n*n,0);
    if(c<cost){v=next;r=s;cost=c;lambda=Math.max(1e-12,lambda*.25);}else lambda*=8;if(lambda>1e12)break;
  }return v;
}
/** Count only Euclidean motions attainable by the current variables. Imported
 * definitions may already remove translations/rotations; subtracting three
 * unconditionally would erase real shape parameters. */
function planarOrbitDimension(e:ReturnType<typeof planarEvaluator>,v:number[]){
 const names=Object.keys(e.model(v).positions),position=(x:number[])=>names.flatMap(n=>e.model(x).positions[n].slice(0,2)),p=position(v);
 if(!p.length)return 0;
 const center=[0,1].map(axis=>p.reduce((sum,n,i)=>sum+(i%2===axis?n:0),0)/names.length),orbit=rowBasis([p.map((_,i)=>i%2===0?1:0),p.map((_,i)=>i%2===1?1:0),p.map((_,i)=>i%2===0?-(p[i+1]-center[1]):p[i-1]-center[0])]);
 const j=jacobian(position,v),constraints=jacobian(e.residual,v),projected=j.map(()=>v.map(()=>0));
 for(let col=0;col<v.length;col++){const q=offRowSpace(j.map(row=>row[col]),orbit);q.forEach((n,row)=>projected[row][col]=n);}
 return Math.max(0,rowBasis([...constraints,...j]).length-rowBasis([...constraints,...projected]).length);
}

export function solvePlanar(request:SolveRequest):ConstraintResult {
  const started=Date.now(),deadline=started+Math.max(30,Math.min(10000,request.budget??2000)),p=request.problem;validateProblem(p);
  const e=planarEvaluator(p),context=p.planar,branches:SolutionBranch[]=[],steps:string[]=[],equations=context?.equations.filter(q=>q.enabled)??[];
  let attempts=0,state=request.seed??81741;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  if(e.variables.length>100)throw Error('最多同时求解 100 个独立二维坐标分量或参数');
  const base=request.previous?.branches[request.trace?.branch??request.move?.branch??request.parameter?.branch??request.reference?.branch??0];
  const make=(v:number[],reference?:string[],exactValues?:Record<string,AlgebraicValue>)=>{
    const d=e.model(v),mobility=localMobility(e.mobilityResidual,v,e.variables.map(u=>Math.max(1,Math.abs(u.initial))),Math.min(deadline,Date.now()+50)),raw=mobility.dof,dof=p.mode==='plane'?Math.max(0,raw-planarOrbitDimension(e,v)):raw;
    const known=new Set<string>();if(context){const changed=new Set(context.unknowns.flatMap(u=>[u.object,...affectedObjects(context.document,u.object)]));for(const o of context.document.objects)if(o.kind==='point'&&!changed.has(o.id))known.add(objectSymbol(o));}
    const ref=reference??(p.mode==='coordinate'?[...known]:p.points.slice(0,1));
    const fixedResidual=(x:number[])=>{const q=e.model(x).positions;return ref.flatMap(n=>[0,1].map(i=>(q[n][i]-d.positions[n][i])/e.scale));};
    const motion=localMobility(x=>[...e.mobilityResidual(x),...fixedResidual(x)],v,e.scale,Math.min(deadline,Date.now()+30)),motionDof=p.mode==='plane'&&dof===0?0:motion.dof;
    const loci=analyticLoci(p,d.positions,ref,e.scale).filter(l=>l.kind!=='sphere'&&l.kind!=='plane').map(l=>({...l,origin:[l.origin[0],l.origin[1],0] as Vec3}));
    if((request.move||request.parameter)&&base)for(const l of base.loci)if(l.kind==='sampled'&&!ref.includes(l.point)&&!loci.some(k=>k.point===l.point))loci.push(l);
    return {positions:d.positions,values:d.values,exactValues,exactCertificate:undefined as ExactCertificate|undefined,reference:ref,rigid:[],dof,motionDof,loci,residual:size(e.residual(v)),rigidityPending:!mobility.checked||!motion.checked} satisfies SolutionBranch;
  };
  if(request.trace){
    const {point,branch}=request.trace;if(!base||!p.points.includes(point)||base.reference.includes(point))throw Error('请选择未固定的动点');
    const initial=e.encode(base.positions,base.values);if(e.errors(initial).length)throw Error('当前构型失效，请先重新求解');
    const fixed=(v:number[])=>base.reference.flatMap(n=>[0,1].map(i=>(e.model(v).positions[n][i]-base.positions[n][i])/e.scale));
    const hard=(v:number[])=>[...e.residual(v),...fixed(v)],smooth=(v:number[])=>[...e.mobilityResidual(v),...fixed(v)],basis=rowBasis(jacobian(smooth,initial));if(initial.length-basis.length!==1)throw Error('目前轨迹追踪需要当前参照下恰好一个连续自由度');
    const paths:Vec3[][]=[],stepSize=.12*Math.max(1,e.scale),start=base.positions[point];
    for(const sign of [-1,1]){let current=[...initial],previous:number[]|undefined;const path:Vec3[]=[[...start]];
      for(let k=0;k<480&&Date.now()<deadline;k++){
        const rows=rowBasis(jacobian(smooth,current));let tangent:number[]=[];for(let i=0;i<current.length;i++){const axis=current.map((_,j)=>i===j?1:0),v=offRowSpace(axis,rows);if(Math.hypot(...v)>Math.hypot(...tangent))tangent=v;}const len=Math.hypot(...tangent);if(len<1e-8)break;tangent=tangent.map(v=>v/len);if(previous&&tangent.reduce((s,v,i)=>s+v*previous![i],0)<0)tangent=tangent.map(v=>-v);if(!previous)tangent=tangent.map(v=>v*sign);previous=tangent;
        let accepted:number[]|undefined;for(const fraction of [1,.5,.25]){const distance=stepSize*fraction,origin=current,dir=tangent,candidate=current.map((v,i)=>v+distance*dir[i]),correction=(v:number[])=>[...hard(v),(v.reduce((s,n,i)=>s+(n-origin[i])*dir[i],0)-distance)/Math.max(1,e.scale)],next=minimize(correction,candidate,Math.min(deadline,Date.now()+60));if(!e.errors(next).length&&size(fixed(next))<3e-6&&size(correction(next))<3e-6){accepted=next;break;}}
        if(!accepted)break;current=accepted;const q=e.model(current).positions[point];if(norm(sub(q,path.at(-1)!))>stepSize*4)break;path.push([...q]);if(k>40&&norm(sub(q,start))<stepSize*.7){path.push([...start]);break;}
      }if(path.length>2)paths.push(path);
    }
    if(!paths.length)throw Error('未追踪到有效曲线；请检查自由度或继续求解');
    const result=structuredClone(request.previous!);result.branches[branch].loci=[...base.loci.filter(l=>l.point!==point),{point,kind:'sampled',origin:start,u:[1,0,0],v:[0,1,0],radius:Math.max(1,e.scale),paths,complete:false}];result.diagnostics=[...result.diagnostics,'轨迹由原始条件的连续求解产生；每个采样构型均回代全部条件，未证明穷尽。'];return {...result,elapsed:Date.now()-started};
  }
  const exactUpdate=(extra:(symbolic:ReturnType<typeof symbolicPlanarEquations>)=>string[]|undefined)=>{
    if(!base)return;
    const symbolic=symbolicPlanarEquations(p,e.variables);if(!symbolic.complete)return;
    const additions=extra(symbolic);if(!additions)return;
    const rootExpressions=Object.fromEntries(Object.entries(base.exactCertificate?.roots??{}).filter(([,r])=>r.expression).map(([name,r])=>[name,`(${r.expression})`]));
    const replacements:Record<string,string>={};
    for(const [i,v]of e.variables.entries()){
      const expression=base.exactValues?.[v.id]?.expression??base.exactCertificate?.assignments[symbolic.tokens[i]];
      if(expression){const source=substituteNames(expression,rootExpressions);if(!/root_\d+/.test(source))replacements[symbolic.tokens[i]]=`(${source})`;}
    }
    for(const name of base.reference)for(const expression of (symbolic.coordinates[name]??[])){
      if(!/\bq_\d+\b/.test(expression))continue;
      const source=substituteNames(expression,replacements);if(/\bq_\d+\b/.test(source))return;
      additions.push(`(${expression})=(${source})`);
    }
    const solved=solveExactSystem([...symbolic.sources,...additions],symbolic.tokens,{deadline:Math.min(deadline,Date.now()+Math.max(15,(request.budget??2000)*.3)),initial:e.encode(base.positions,base.values)});
    if(solved.kind!=='finite'||!solved.complete||!solved.candidates.length)return;
    const before=e.encode(base.positions,base.values),candidates=solved.candidates.filter(c=>!e.errors(c.values).length);
    candidates.sort((a,b)=>{if(request.move){const distance=(v:number[])=>e.model(v).positions[request.move!.point].slice(0,2).reduce((sum,n,i)=>sum+(n-request.move!.target[i])**2,0),delta=distance(a.values)-distance(b.values);if(Math.abs(delta)>1e-12*e.scale*e.scale)return delta;}return a.values.reduce((s,v,i)=>s+(v-before[i])**2,0)-b.values.reduce((s,v,i)=>s+(v-before[i])**2,0);});
    const candidate=candidates[0];if(!candidate)return;
    const exact=Object.fromEntries(Object.entries(candidate.exactValues).map(([token,value])=>[e.variables[symbolic.tokens.indexOf(token)].id,value])),branch=make(candidate.values,base.reference,exact);branch.exactCertificate=candidate.certificate;
    const result=structuredClone(request.previous!),index=request.parameter?.branch??request.move!.branch;result.branches[index]=branch;
    return {...result,exactAnalysis:undefined,complete:false,precision:result.branches.every(b=>b.exactCertificate)?'algebraic':'approximate',method:'construction',approximationReason:undefined,elapsed:Date.now()-started} as ConstraintResult;
  };
  if(request.reference){if(!base)throw Error('构型已失效');const ref=request.reference.points;if(new Set(ref).size!==ref.length||ref.some(n=>!p.points.includes(n)))throw Error('固定点无效');const v=e.encode(base.positions,base.values);if(e.errors(v).length)throw Error('当前构型已失效');const result=structuredClone(request.previous!);const certificate=result.branches[request.reference.branch].exactCertificate;result.branches[request.reference.branch]=make(v,ref,result.branches[request.reference.branch].exactValues);result.branches[request.reference.branch].exactCertificate=certificate;if(certificate&&result.exactAnalysis?.state==='finite'){result.branches[request.reference.branch].dof=0;result.branches[request.reference.branch].motionDof=0;}return {...result,elapsed:Date.now()-started};}
  if(request.parameter){
    const move=request.parameter,index=e.variables.findIndex(u=>u.id===move.variable);if(!base||index<0||!Number.isFinite(move.target))throw Error('该数值不是待求参数');
    const exact=exactUpdate(symbolic=>[`${symbolic.tokens[index]}=${move.target}`]);if(exact)return exact;
    const start=e.encode(base.positions,base.values),candidate=[...start];candidate[index]=move.target;
    const hard=(x:number[])=>[...e.residual(x),...base.reference.flatMap(n=>[0,1].map(i=>(e.model(x).positions[n][i]-base.positions[n][i])/e.scale))];
    let next=candidate;if(e.errors(next).length||size(hard(next))>3e-6)next=minimize(x=>[...hard(x),(x[index]-move.target)/Math.max(1,e.scale)],candidate,deadline);
    if(e.errors(next).length||size(hard(next))>3e-6||Math.abs(next[index]-move.target)>1e-5*Math.max(1,Math.abs(move.target)))throw Error('该参数值不满足全部条件，已保留原构型');
    const result=structuredClone(request.previous!);result.branches[move.branch]=make(next,base.reference);return {...result,exactAnalysis:undefined,complete:false,precision:'approximate',method:'hybrid',approximationReason:'参数改变后进行二维联动校正并回代全部条件。',elapsed:Date.now()-started};
  }
  if(request.move){if(!base||!p.points.includes(request.move.point)||base.reference.includes(request.move.point))throw Error('该点是固定参照，不能直接拖动');const v=e.encode(base.positions,base.values),locus=base.loci.find(l=>l.point===request.move!.point),raw:[number,number,number]=[request.move.target[0],request.move.target[1],0],target=locus?nearestLocus(locus,raw):raw;
    const axis=Math.abs(target[0]-base.positions[request.move.point][0])>=Math.abs(target[1]-base.positions[request.move.point][1])?0:1;
    const exact=exactUpdate(symbolic=>symbolic.coordinates[request.move!.point]?[`${symbolic.coordinates[request.move!.point][axis]}=${target[axis]}`]:undefined);if(exact)return exact;
    const fixed=(x:number[])=>{const q=e.model(x).positions;return base.reference.flatMap(n=>[0,1].map(i=>(q[n][i]-base.positions[n][i])/e.scale));};
    const hard=(x:number[])=>[...e.residual(x),...fixed(x)],withTarget=(x:number[])=>[...hard(x),...[0,1].map(i=>(e.model(x).positions[request.move!.point][i]-target[i])/e.scale)];
    let next=minimize(withTarget,v,deadline);if(e.errors(next).length||size(fixed(next))>3e-6)next=minimize(hard,next,deadline);
    if(e.errors(next).length||size(fixed(next))>3e-6)throw Error('该位置不满足全部条件，已保留上一个可行位置');
    const result=structuredClone(request.previous!);result.branches[request.move.branch]=make(next,base.reference);return {...result,exactAnalysis:undefined,complete:false,precision:'approximate',method:'hybrid',approximationReason:'二维约束联立校正，每次移动后回代全部条件。',elapsed:Date.now()-started};
  }
  const accept=(v:number[],exact?:Record<string,AlgebraicValue>,certificate?:ExactCertificate,finite=false)=>{
    attempts++;if(e.errors(v).length)return false;const b=make(v,undefined,exact);b.exactCertificate=certificate;if(finite){b.dof=0;b.motionDof=0;b.loci=[];if(p.mode==='plane')b.reference=[...p.points];}
    // In the coordinate-free problem, remove planar Euclidean motion only.
    // A reflection changes winding and is retained as a separate branch.
    if(p.mode==='plane'&&!certificate){
      const origin=b.positions[p.points[0]],second=p.points.find(n=>norm(sub(b.positions[n],origin))>1e-8),d=second?sub(b.positions[second],origin):[1,0,0] as Vec3,t=Math.atan2(d[1],d[0]),c=Math.cos(t),s=Math.sin(t);
      b.positions=Object.fromEntries(Object.entries(b.positions).map(([n,q])=>{const x=q[0]-origin[0],y=q[1]-origin[1];return [n,[c*x+s*y,-s*x+c*y,0] as Vec3];}));b.values=Object.fromEntries(e.variables.map(u=>[u.id,u.point?b.positions[u.point][u.axis!]:b.values[u.id]]));
      b.reference=b.dof===0?[...p.points]:[p.points[0]];
      if(b.dof===0)b.motionDof=0;
      b.loci=b.dof===0?[]:analyticLoci(p,b.positions,b.reference,e.scale).filter(l=>!['sphere','plane'].includes(l.kind));
    }
    // Isolated algebraic roots have identities independent of drawing tolerance.
    // Never merge distinct exact candidates just because their decimals are close.
    const sameRoots=(a:SolutionBranch)=>{
      if(a.exactCertificate||b.exactCertificate)return JSON.stringify(a.exactCertificate)===JSON.stringify(b.exactCertificate);
      if(!a.exactValues&&!b.exactValues)return true;
      if(!a.exactValues||!b.exactValues)return false;
      const keys=Object.keys(a.exactValues);
      return keys.length===Object.keys(b.exactValues).length&&keys.every(key=>{
        const x=a.exactValues![key],y=b.exactValues![key];
        return !!y&&x.polynomial.length===y.polynomial.length&&x.polynomial.every((c,i)=>c===y.polynomial[i])&&x.interval.every((v,i)=>v===y.interval[i]);
      });
    };
    if(!branches.some(a=>sameRoots(a)&&p.points.every(n=>norm(sub(a.positions[n],b.positions[n]))<e.scale*1e-5)&&e.variables.every(u=>u.point||Math.abs((a.values?.[u.id]??0)-(b.values?.[u.id]??0))<1e-6)))branches.push(b);return true;
  };
  let analytic=false,complete=false;let exactAnalysis:ConstraintResult['exactAnalysis'];
  const symbolic=symbolicPlanarEquations(p,e.variables);
  if(symbolic.sources.length&&e.variables.length&&(p.conditions.some(c=>c.enabled)||equations.length||p.curves?.length)){
    const exact=solveExactSystem(symbolic.sources,symbolic.tokens,{deadline:Math.min(deadline,Date.now()+Math.max(50,(request.budget??2000)*.4)),initial:e.initial});
    let accepted=0;for(const candidate of exact.candidates){const values=Object.fromEntries(Object.entries(candidate.exactValues).map(([token,value])=>[e.variables[symbolic.tokens.indexOf(token)].id,value]));if(accept(candidate.values,values,candidate.certificate,exact.kind==='finite'))accepted++;}
    exactAnalysis={state:exact.kind,certified:exact.complete&&symbolic.complete&&accepted===exact.candidates.length,totalSolutions:exact.candidates.length,reducedVariables:exact.reducedVariables,reason:exact.reason??symbolic.unsupported.join('；'),reasonCode:exact.reasonCode??(symbolic.complete?undefined:'translation'),family:exact.family,solutions:exact.complete?exact.candidates.map(c=>c.certificate):undefined};
    if(exact.kind==='finite'&&exact.complete){analytic=true;complete=exactAnalysis.certified;steps.push('精确线性降维、耦合块分解与有理单变量表示；使用 Sturm 隔离及代数符号判定验证候选。');}
    else if(exact.kind==='family'&&accepted){analytic=true;steps.push('保留精确参数关系及有效域，显示其中一个可行构型。');}
  }
  if(!analytic&&!p.conditions.some(c=>c.enabled)&&!equations.some(c=>c.enabled)) {
    const spread=Object.fromEntries(p.points.map((name,i)=>[name,[3*Math.cos(i*2*Math.PI/Math.max(3,p.points.length)),3*Math.sin(i*2*Math.PI/Math.max(3,p.points.length)),0] as Vec3]));
    if(accept(e.encode(request.seeds?.[0]??spread,request.seedValues?.[0]))){analytic=true;steps.push('无附加条件：显示自由布局，未增加长度、角度或位置约束。');}
  }
  if(e.variables.length===0&&!e.errors(e.initial).length){accept(e.initial);analytic=true;complete=true;steps.push('全部对象与数值均已知，直接验证已有定义和附加条件。');}
  // Exact rational elimination in a single independent parameter. The original
  // equations (including denominators and ranges) are always checked again.
  if(!analytic&&context&&e.variables.length>=1&&e.variables.length<=2&&equations.length){
    const symbolic=symbolicPlanarEquations(p,e.variables);
    if(symbolic){
      if(e.variables.length===1){for(const source of symbolic.sources){const roots=algebraicRoots(source,symbolic.tokens[0],{},Math.min(deadline,Date.now()+600));if(roots){for(const root of roots)accept([root.approximate],{[e.variables[0].id]:root});analytic=true;complete=false;steps.push('有理表达式清分母，使用精确 Sturm 序列隔离全部实根，回代排除增根。');break;}}}
      else {const pairs=algebraicSystem(symbolic.sources,symbolic.tokens as [string,string],{},Math.min(deadline,Date.now()+800));if(pairs){for(const pair of pairs)accept(pair.map(r=>r.approximate),Object.fromEntries(pair.map((r,i)=>[e.variables[i].id,r])));analytic=true;complete=false;steps.push('有理二元条件使用 Sylvester 结式双向消元；精确实根隔离后组合并回代原始条件；配对仍使用浮点校验，尚未认证解集穷尽。');}}
    }
  }
  // For a point constrained to two existing lines/conics, use the quadratic
  // resultant. Intersections are not limited to the visible sampling box.
  if(!analytic&&context&&!context.unknowns.length&&p.points.filter(n=>!context.document.objects.some(o=>o.kind==='point'&&objectSymbol(o)===n)).length===1){
    const name=p.points.find(n=>!context.document.objects.some(o=>o.kind==='point'&&objectSymbol(o)===n))!,env=equationEnvironment(e.model(e.initial).doc);
    const refs=equations.flatMap(q=>{const m=q.source.match(/^on(?:Curve|Line)\s*\(\s*([^,]+),\s*([^,)]+)\s*\)$/i);const k=q.source.match(/^intersection\s*\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/i);return m?.[1].trim()===name?[m[2].trim()]:k?.[1].trim()===name?[k[2].trim(),k[3].trim()]:[];});
    if(refs.length>=2)try{for(const q of conicIntersections(env.quadratic(refs[0]),env.quadratic(refs[1])))accept(e.encode({...e.model(e.initial).positions,[name]:[q[0],q[1],0]}));analytic=true;complete=false;steps.push('二次曲线消元求交，计算实交点并回代全部范围及附加条件；浮点求交尚未认证解集穷尽。');}catch(err){steps.push((err as Error).message);}
  }
  if(!analytic&&!context?.unknowns.length&&!equations.length){
    let anchors:Positions|undefined;
    if(context){try{const d=e.model(e.initial);anchors=Object.fromEntries(context.document.objects.filter(o=>o.kind==='point').map(o=>[objectSymbol(o),d.positions[objectSymbol(o)]]));}catch{/* A definition error is reported below. */}}
    const plan=planConstructions(p,Math.min(deadline,Date.now()+400),anchors&&Object.keys(anchors).length?{anchors}:undefined);
    for(const q of plan.solutions)if(p.points.every(n=>Math.abs(q[n][2])<1e-8)&&accept(e.encode(q)))analytic=true;
    steps.push(...plan.steps);complete=analytic&&plan.finite;
  }
  if(!analytic){
    for(const [i,p] of (request.seeds??[]).entries()) {try{accept(e.encode(p,request.seedValues?.[i]));}catch{/* Incompatible old points are not constraints. */}}
    for(const b of request.previous?.branches??[])accept(e.encode(b.positions,b.values));
    // Bounds are required for *numerical parameter search*, never inferred from
    // the viewport. A polynomial/constructive answer needs no finite box.
    const missing=e.variables.filter(u=>!u.point&&(u.min===undefined||u.max===undefined));
    if(missing.length&&!context?.automaticSearch)throw Error(`近似搜索需要给待求量设置上下界：${missing.map(u=>`${context!.document.objects.find(o=>o.id===u.object)?.name??u.object}.${u.field}`).join('、')}`);
    const scale=(context?.searchScale??20)*e.scale;
    const limits=e.variables.map((u):[number,number]=>{
      if(!u.point)return [u.min??-scale,u.max??scale];
      const bounds=context?.searchBounds?.[u.point],lo=u.axis===0?bounds?.xMin:bounds?.yMin,hi=u.axis===0?bounds?.xMax:bounds?.yMax;
      if(p.mode==='coordinate'&&!context?.automaticSearch&&(lo===undefined||hi===undefined))throw Error(`请在“近似搜索范围”设置 ${u.point} 的 ${u.axis===0?'x':'y'} 搜索上下界`);
      return [lo??-scale,hi??scale];
    });
    for(let attempt=0;attempt<24&&Date.now()<deadline&&branches.length<cap;attempt++){
      const exploration=Math.pow(4,Math.floor(attempt/6));
      const searchLimits=context?.automaticSearch?limits.map(([lo,hi],i):[number,number]=>[e.variables[i].min??lo*exploration,e.variables[i].max??hi*exploration]):limits;
      const guess=request.seeds?.[0]?e.encode(request.seeds[0],request.seedValues?.[0]):e.initial;
      const start=attempt===0?guess.map((v,i)=>Math.max(limits[i][0],Math.min(limits[i][1],v))):searchLimits.map(([lo,hi],i)=>{const radius=Math.min((hi-lo)/2,Math.max(2,Math.abs(e.initial[i])*2)*exploration);return Math.max(lo,Math.min(hi,e.initial[i]+(random()*2-1)*radius));});
      const candidate=minimize(e.residual,start,Math.min(deadline,Date.now()+Math.max(50,(request.budget??2000)/5)),searchLimits);accept(candidate);
      if(branches.length&&branches[0].dof>0&&attempt>3)break;
    }
  }
  const reason='当前二维条件含尚未完成解析消元的耦合关系，采用限定范围内的多起点数值联立，再回代原始定义和条件；不表示不存在解析解。';
  const failures=branches.length?[]:e.errors(e.initial).slice(0,5).map(v=>`${v.source}（误差 ${v.error.toPrecision(3)}）`);
  return {exactAnalysis,branches:branches.slice(0,cap),status:branches.length?'solved':analytic&&complete?'contradiction':'notFound',precision:analytic?branches.some(b=>b.exactValues||b.exactCertificate)?'algebraic':'construction':'approximate',method:analytic?'construction':'numerical',complete:complete&&branches.length<=cap,attempts,elapsed:Date.now()-started,constructionSteps:steps.slice(0,100),approximationReason:analytic?undefined:reason,diagnostics:[branches.length?`二维求解得到 ${branches.length} 个构型；已验证原始条件。`:analytic&&complete?'解析候选均不满足原条件，没有可行实解。':'暂未找到可行解，未证明无解。',...failures]};
}
