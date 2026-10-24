import {localMobility} from './mobility';
import {shapeMobility} from './shapeMobility';
import type { Vec3 } from "../types";
import { validateProblem } from "./input";
import { contradictions, evaluator, flatten, positions, problemScale } from "./compile";
import { add, sub, mul, dot, cross, norm, unit, perpendicular, local, rowBasis, offRowSpace, jacobian, dampedStep } from "./math";
import { analyticLoci, nearestLocus } from "./loci";
import { constructRightPrism } from "./construction";
import { planConstructions } from "./planner";
import { rigidMotion } from "./rigidMotion";
import { solvePlanar } from './planar';
import type { ConstraintProblem, ConstraintResult, Positions, SolutionBranch, SolveRequest } from "./types";

type Fixed = Map<number,number>;
const squareSum=(r:number[])=>r.reduce((s,v)=>s+v*v,0);
function minimize(f:(x:number[])=>number[],start:number[],deadline:number,fixed:Fixed=new Map(),extra?:(x:number[])=>number[]) {
  const variables=start.map((_,i)=>i).filter(i=>!fixed.has(i));
  const unpack=(v:number[])=>{const x=[...start];for(const [i,n] of fixed)x[i]=n;variables.forEach((i,k)=>x[i]=v[k]);return x;};
  const evaluate=(v:number[])=>{const x=unpack(v);return [...f(x),...(extra?.(x)??[])];};
  let v=variables.map(i=>start[i]),r=evaluate(v),cost=squareSum(r),lambda=1e-3;
  for(let iteration=0;iteration<120&&Date.now()<deadline&&variables.length;iteration++) {
    if(Math.max(0,...r.map(Math.abs))<2e-9)break;
    const j=jacobian(evaluate,v,r),step=dampedStep(j,r,lambda);
    if(step.some(n=>!Number.isFinite(n)))break;
    const candidate=v.map((n,i)=>n+step[i]),next=evaluate(candidate),nextCost=squareSum(next);
    if(nextCost<cost) {v=candidate;r=next;cost=nextCost;lambda=Math.max(1e-10,lambda*.3);if(Math.hypot(...step)<1e-11)break;}
    else {lambda*=8;if(lambda>1e12)break;}
  }
  return unpack(v);
}
const fixedCoordinates=(names:string[],p:Positions,reference:string[]):Fixed=>{
  const fixed:Fixed=new Map();for(const name of reference){const i=names.indexOf(name)*3;p[name].forEach((n,k)=>fixed.set(i+k,n));}return fixed;
};
function initial(problem:ConstraintProblem,random:()=>number):number[] {
  const scale=problemScale(problem),p:Positions=Object.fromEntries(problem.points.map(n=>[n,[0,0,0]]));
  const seeded=new Set<string>();
  problem.points.forEach((n,i)=>p[n]=[i===0?0:(random()-.5)*scale*3,(random()-.5)*scale*3,(random()-.5)*scale*3]);
  for(const c of problem.conditions.filter(c=>c.enabled)) {
    const points=c.refs[0], assign=(values:Vec3[])=>points.forEach((n,i)=>{p[n]=mul(values[i],scale);seeded.add(n);});
    if(c.kind==="cube")assign([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]);
    else if(["prism","pyramid","frustum","regularPolygon","convexPolygon"].includes(c.kind)) {
      const n=c.kind==="pyramid"?points.length-1:["regularPolygon","convexPolygon"].includes(c.kind)?points.length:points.length/2;
      const baseNames=c.kind==="pyramid"?points.slice(1):points.slice(0,n);
      const regular=c.kind==="regularPolygon"||problem.conditions.some(k=>k.enabled&&k.kind==="regularPolygon"&&k.refs[0].length===n&&k.refs[0].every((name,i)=>name===baseNames[i]));
      const radius=scale/(2*Math.sin(Math.PI/n));
      const base=baseNames.every(name=>seeded.has(name))?baseNames.map(name=>p[name]):baseNames.map((_,i):Vec3=>{
        const t=2*Math.PI*i/n,x=radius*Math.cos(t),y=radius*Math.sin(t);
        return regular?[x,y,0]:[1.15*x+.18*y,.85*y,0];
      });
      const center=mul(base.reduce(add,[0,0,0] as Vec3),1/n),normal=unit(cross(sub(base[1],base[0]),sub(base[2],base[0]))),u=unit(sub(base[1],base[0]));
      const right=regular||problem.conditions.some(k=>k.enabled&&k.kind==="perpendicular"&&k.refs.some(r=>r.length===2&&r.includes(baseNames[0])&&r.includes(points[n])));
      const side=add(mul(normal,scale),right?[0,0,0]:mul(u,scale*.3));
      const values=c.kind==="pyramid"?[add(center,add(mul(normal,scale),regular?[0,0,0]:mul(u,scale*.2))),...base]
        :c.kind==="prism"?[...base,...base.map(v=>add(v,side))]
        :c.kind==="frustum"?[...base,...base.map(v=>add(add(center,mul(sub(v,center),.55)),side))]:base;
      points.forEach((name,i)=>{p[name]=values[i];seeded.add(name);});
    }
    else if(["square","rectangle","rhombus","parallelogram"].includes(c.kind))assign([[0,0,0],[1,0,0],[1,1,0],[0,1,0]]);
  }
  // Exact sphere intersections supply good starting positions for distance
  // networks; these are seeds only, never additional constraints or anchors.
  const distances=new Map(problem.conditions.filter(c=>c.enabled&&c.kind==="distance").map(c=>[[...c.refs[0]].sort().join("|"),c.value!]));
  const distance=(a:string,b:string)=>distances.get([a,b].sort().join("|"));
  if(!seeded.size){seeded.add(problem.points[0]);p[problem.points[0]]=[0,0,0];}
  for(let pass=0;pass<problem.points.length;pass++) {
    let progress=false;
    for(const name of problem.points.filter(n=>!seeded.has(n))) {
      const anchors=[...seeded].filter(n=>distance(n,name)!==undefined);if(!anchors.length)continue;
      const a=p[anchors[0]],ra=distance(anchors[0],name)!;
      let q=add(a,mul(norm(sub(p[name],a))>1e-10?unit(sub(p[name],a)):([1,0,0] as Vec3),ra));
      const bName=anchors.find(n=>norm(sub(p[n],a))>1e-8*scale);
      if(bName) {
        const b=p[bName],d=norm(sub(b,a)),ex=unit(sub(b,a)),rb=distance(bName,name)!,x=(ra*ra-rb*rb+d*d)/(2*d),r2=ra*ra-x*x;
        if(r2>=-1e-9*scale*scale) {
          const ey=perpendicular(ex),ez=cross(ex,ey),t=random()*Math.PI*2;
          q=add(a,add(mul(ex,x),add(mul(ey,Math.sqrt(Math.max(0,r2))*Math.cos(t)),mul(ez,Math.sqrt(Math.max(0,r2))*Math.sin(t)))));
          const cName=anchors.find(n=>norm(cross(sub(p[n],a),ex))>1e-7*scale);
          if(cName) {
            const ac=sub(p[cName],a),i=dot(ex,ac),yAxis=unit(sub(ac,mul(ex,i))),j=dot(ac,yAxis),rc=distance(cName,name)!;
            const y=(ra*ra-rc*rc+i*i+j*j-2*i*x)/(2*j),z2=ra*ra-x*x-y*y;
            if(z2>=-1e-9*scale*scale)q=add(a,add(mul(ex,x),add(mul(yAxis,y),mul(cross(ex,yAxis),Math.sqrt(Math.max(0,z2))))));
          }
        }
      }
      p[name]=q;seeded.add(name);progress=true;
    }
    if(seeded.size===problem.points.length)break;
    if(!progress)seeded.add(problem.points.find(n=>!seeded.has(n))!);
  }
  return flatten(problem.points,p);
}
function rigidity(problem:ConstraintProblem,x:number[],samples:number[][]) {
  const e=evaluator(problem),j=jacobian(v=>e.values(v,false),x),basis=rowBasis(j),n=problem.points.length;
  const invariant=Array.from({length:n},()=>new Array(n).fill(false));
  const explicitDistances=new Set(problem.conditions.filter(c=>c.enabled&&c.kind==="distance").map(c=>[...c.refs[0]].sort().join("|")));
  for(let i=0;i<n;i++)for(let k=i+1;k<n;k++) {
    const d:Vec3=[x[i*3]-x[k*3],x[i*3+1]-x[k*3+1],x[i*3+2]-x[k*3+2]],length=norm(d);
    if(length<e.scale*1e-7)continue;
    const gradient=new Array(n*3).fill(0);d.forEach((v,axis)=>{gradient[i*3+axis]=v/length;gradient[k*3+axis]=-v/length;});
    const supported=samples.length>=2||explicitDistances.has([problem.points[i],problem.points[k]].sort().join("|"));
    const locked=supported&&Math.hypot(...offRowSpace(gradient,basis))<2e-4&&samples.every(s=>
      Math.abs(Math.hypot(s[i*3]-s[k*3],s[i*3+1]-s[k*3+1],s[i*3+2]-s[k*3+2])-length)<Math.max(e.scale,length)*2e-4);
    invariant[i][k]=invariant[k][i]=locked;
  }
  // Maximal invariant-distance cliques. The bounded search avoids exponential
  // work on pathological graphs; a conservative set of smaller blocks is safe.
  const cliques:number[][]=[];let nodes=0;
  const visit=(r:number[],p:number[],excluded:number[])=>{
    if(++nodes>6000)return;
    if(!p.length&&!excluded.length){if(r.length>1)cliques.push(r);return;}
    const pivot=[...p,...excluded].sort((a,b)=>p.filter(v=>invariant[b][v]).length-p.filter(v=>invariant[a][v]).length)[0];
    for(const v of p.filter(v=>pivot===undefined||!invariant[pivot][v])) {
      visit([...r,v],p.filter(w=>invariant[v][w]),excluded.filter(w=>invariant[v][w]));
      p=p.filter(w=>w!==v);excluded.push(v);
    }
  };
  visit([],Array.from({length:n},(_,i)=>i),[]);
  cliques.forEach(c=>c.sort((a,b)=>a-b));cliques.sort((a,b)=>b.length-a.length||a[0]-b[0]);
  const rigid=cliques.map(c=>c.map(i=>problem.points[i])), reference=rigid[0]??[problem.points[0]];
  return {rigid,reference,rigidityPending:samples.length<2||nodes>6000};
}
function canonical(p:Positions,reference:string[]):Positions {
  const origin=p[reference[0]],second=reference.find(n=>norm(sub(p[n],origin))>1e-7);
  const x=second?unit(sub(p[second],origin)):([1,0,0] as Vec3);
  const third=reference.find(n=>norm(cross(sub(p[n],origin),x))>1e-7);
  const y=third?unit(sub(sub(p[third],origin),mul(x,dot(sub(p[third],origin),x)))):perpendicular(x);
  const frame={origin,x,y,z:cross(x,y)};
  return Object.fromEntries(Object.entries(p).map(([name,p])=>[name,local(p,frame)]));
}
function align(p:Positions,target:Positions,reference:string[]) {
  const toBasis=(p:Positions)=>{
    const origin=p[reference[0]],second=reference.find(n=>norm(sub(p[n],origin))>1e-7),x=second?unit(sub(p[second],origin)):([1,0,0] as Vec3);
    const third=reference.find(n=>norm(cross(sub(p[n],origin),x))>1e-7);
    const y=third?unit(sub(sub(p[third],origin),mul(x,dot(sub(p[third],origin),x)))):perpendicular(x);
    return {origin,x,y,z:cross(x,y)};
  };
  const source=toBasis(p),dest=toBasis(target);
  return Object.fromEntries(Object.entries(p).map(([n,p])=>{const q=local(p,source);return [n,add(dest.origin,add(mul(dest.x,q[0]),add(mul(dest.y,q[1]),mul(dest.z,q[2]))))];}));
}
function analyze(problem:ConstraintProblem,x:number[],deadline:number,random:()=>number,chosen?:Pick<SolutionBranch,"reference"|"rigid"|"rigidityPending">):SolutionBranch {
  const e=evaluator(problem),samples:number[][]=[];
  for(let i=0;!chosen&&i<3&&Date.now()<deadline;i++) {
    const start=x.map(n=>n+(random()-.5)*e.scale*.2),s=minimize(e.values,start,Math.min(deadline,Date.now()+120));
    if(e.verify(s).valid)samples.push(s);
  }
  const {rigid,reference,rigidityPending}=chosen??rigidity(problem,x,samples),raw=positions(problem.points,x),p=chosen?raw:canonical(raw,reference),flat=flatten(problem.points,p);
  const fixed=fixedCoordinates(problem.points,p,reference),variables=flat.map((_,i)=>i).filter(i=>!fixed.has(i));
  const mobility=localMobility(v=>{const q=[...flat];variables.forEach((index,k)=>q[index]=v[k]);return e.values(q,false);},variables.map(i=>flat[i]),e.scale,Math.max(deadline,Date.now()+80));
  const shape=shapeMobility(v=>e.values(v,false),flat,e.scale,Math.max(deadline,Date.now()+80));
  const dof=shape.dof,motionDof=dof?mobility.dof:0;
  const loci=motionDof?analyticLoci(problem,p,reference,e.scale):[];
  // Trace a one-dimensional solution family with a tangent hyperplane
  // corrector. Every stored point comes from a jointly verified configuration.
  if(motionDof===1&&Date.now()<deadline&&problem.points.some(n=>!reference.includes(n)&&!loci.some(l=>l.point===n&&l.complete))) {
    const paths:Record<string,Vec3[][]>=Object.fromEntries(problem.points.filter(n=>!reference.includes(n)).map(n=>[n,[]]));
    for(const sign of [-1,1]) {
      let current=[...flat],previous:number[]|undefined;
      const trace:Positions[]=[p];
      for(let step=0;step<36&&Date.now()<deadline;step++) {
        const rows=jacobian(v=>e.values(v,false),current).map(row=>variables.map(i=>row[i])),basis=rowBasis(rows);
        let tangent:number[]=[];for(let i=0;i<variables.length;i++){const v=new Array(variables.length).fill(0);v[i]=1;const projected=offRowSpace(v,basis);if(Math.hypot(...projected)>Math.hypot(...tangent))tangent=projected;}
        const len=Math.hypot(...tangent);if(len<1e-8)break;tangent=tangent.map(v=>v/len);
        if(previous&&tangent.reduce((s,v,i)=>s+v*previous![i],0)<0)tangent=tangent.map(v=>-v);
        if(!previous)tangent=tangent.map(v=>v*sign);previous=tangent;
        const start=[...current],distance=e.scale*.12;
        variables.forEach((index,k)=>start[index]+=tangent[k]*distance);
        const base=current,dir=tangent;
        const next=minimize(e.values,start,Math.min(deadline,Date.now()+70),fixed,v=>[
          (variables.reduce((s,index,k)=>s+(v[index]-base[index])*dir[k],0)-distance)/e.scale,
        ]);
        if(!e.verify(next).valid)break;current=next;trace.push(positions(problem.points,next));
      }
      for(const name of Object.keys(paths))paths[name].push(trace.map(p=>p[name]));
    }
    for(const [name,traces] of Object.entries(paths))if(!loci.some(l=>l.point===name&&l.complete)&&traces.some(t=>t.length>2))
      {const old=loci.findIndex(l=>l.point===name);if(old>=0)loci.splice(old,1);
      loci.push({point:name,kind:"sampled",origin:p[name],u:[1,0,0],v:[0,1,0],radius:e.scale,paths:traces,complete:false});}
  }
  return {positions:p,rigid,reference,dof,motionDof,loci,residual:e.verify(flat).max,rigidityPending,mobility:{version:2,linear:shape.linear,removed:shape.removed,checked:shape.checked&&mobility.checked}};
}
function branchEquivalent(a:SolutionBranch,b:SolutionBranch,scale:number) {
  if(a.dof===0&&b.dof===0)return Object.keys(a.positions).every(n=>norm(sub(a.positions[n],b.positions[n]))<scale*2e-4);
  // Continuous variation does not create a new discrete branch. Compare the
  // invariant metrics and chirality of each rigid block instead.
  for(const block of a.rigid) {
    for(let i=0;i<block.length;i++)for(let j=i+1;j<block.length;j++) {
      const distance=(p:Positions)=>norm(sub(p[block[i]],p[block[j]]));
      if(Math.abs(distance(a.positions)-distance(b.positions))>scale*2e-4)return false;
    }
    if(block.length>=4)for(let i=3;i<block.length;i++) {
      const volume=(p:Positions)=>dot(cross(sub(p[block[1]],p[block[0]]),sub(p[block[2]],p[block[0]])),sub(p[block[i]],p[block[0]]));
      if(volume(a.positions)*volume(b.positions)<-(scale**6)*1e-8)return false;
    }
  }
  return true;
}
/** Refresh old first-order counts without changing coordinates or constraints. */
export function refreshSpatialMobility(problem:ConstraintProblem,branch:SolutionBranch):SolutionBranch {
  if(problem.mode==='plane'||problem.mode==='coordinate'||branch.mobility?.version===2)return branch;
  const e=evaluator(problem),flat=flatten(problem.points,branch.positions),fixed=fixedCoordinates(problem.points,branch.positions,branch.reference),indices=flat.map((_,i)=>i).filter(i=>!fixed.has(i));
  const mobility=localMobility(v=>{const next=[...flat];indices.forEach((index,i)=>next[index]=v[i]);return e.values(next,false);},indices.map(i=>flat[i]),e.scale,Date.now()+100);
  const shape=shapeMobility(v=>e.values(v,false),flat,e.scale,Date.now()+100),motionDof=shape.dof?mobility.dof:0;
  return {...branch,dof:shape.dof,motionDof,loci:motionDof?branch.loci:[],mobility:{version:2,linear:shape.linear,removed:shape.removed,checked:shape.checked&&mobility.checked}};
}
export function solveConstraints(request:SolveRequest):ConstraintResult {
  if(request.problem.mode==='plane'||request.problem.mode==='coordinate')return solvePlanar(request);
  const started=Date.now(),problem=request.problem;validateProblem(problem);
  if(request.refreshMobility&&request.previous){const result=structuredClone(request.previous);result.branches=result.branches.map(b=>refreshSpatialMobility(problem,b));result.elapsed=Date.now()-started;return result;}
  const alternatives=problem.conditions.filter(c=>c.enabled&&c.alternateValue!==undefined);
  if(alternatives.length) {
    const issues=contradictions(problem);if(issues.length)return {branches:[],status:"contradiction",complete:true,attempts:0,elapsed:Date.now()-started,diagnostics:issues};
    const selected=request.move?.branch??request.reference?.branch,branch=selected===undefined?undefined:request.previous?.branches[selected];
    if(branch) {
      const flat=flatten(problem.points,branch.positions),conditions=problem.conditions.map(c=>{
        if(c.alternateValue===undefined)return c;
        const first={...c,alternateValue:undefined},valid=evaluator({...problem,conditions:[first]}).verify(flat).valid;
        return {...first,value:valid?c.value:c.alternateValue};
      });
      return solveConstraints({...request,problem:{...problem,conditions}});
    }
  }
  if(alternatives.length&&!request.move&&!request.reference) {
    const count=Math.min(64,2**alternatives.length),budget=request.budget??2000,scale=problemScale(problem),branches:SolutionBranch[]=[],results:ConstraintResult[]=[];
    for(let mask=0;mask<count;mask++) {
      const conditions=problem.conditions.map(c=>{const i=alternatives.indexOf(c);return {...c,value:i>=0&&i<6&&(mask>>i&1)?c.alternateValue:c.value,alternateValue:undefined};}),part={...problem,conditions},check=evaluator(part);
      const previous=request.previous?{...request.previous,branches:request.previous.branches.filter(b=>check.verify(flatten(problem.points,b.positions)).valid)}:undefined;
      const result=solveConstraints({...request,problem:part,previous,budget:Math.max(30,(budget-(Date.now()-started))/(count-mask))});results.push(result);
      for(const b of result.branches)if(!branches.some(a=>branchEquivalent(a,b,scale)))branches.push(b);
    }
    return {branches:branches.slice(0,12),status:branches.length?"solved":"notFound",complete:count===2**alternatives.length&&branches.length<=12&&results.every(r=>r.complete),
      attempts:results.reduce((n,r)=>n+r.attempts,0),elapsed:Date.now()-started,method:results.every(r=>r.method==="construction")?"construction":"hybrid",
      approximationReason:[...new Set(results.flatMap(r=>r.approximationReason?[r.approximationReason]:[]))].join("；")||undefined,
      constructionSteps:[...new Set(results.flatMap(r=>r.constructionSteps??[]))],diagnostics:["三角函数条件先枚举允许的角度分支，再分别解析构造并回代校验。",...new Set(results.flatMap(r=>r.diagnostics))]};
  }
  const budget=Math.max(30,Math.min(10000,request.budget??2000)),deadline=started+budget,e=evaluator(problem),issues=contradictions(problem);
  if(issues.length)return {branches:[],status:"contradiction",complete:true,attempts:0,elapsed:Date.now()-started,diagnostics:issues};
  let state=(request.seed??(request.previous?.attempts??0)+3127351)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  if(request.reference&&request.previous) {
    const result=structuredClone(request.previous),branch=result.branches[request.reference.branch],reference=request.reference.points;
    // A user may fix any subset of the current valid configuration. This can
    // reduce its freedoms; it never relaxes a condition or changes coordinates.
    if(!branch||!Array.isArray(reference)||!reference.length||new Set(reference).size!==reference.length||reference.some(n=>!problem.points.includes(n)))throw new Error("请选择至少一个有效且不重复的固定点");
    const flat=flatten(problem.points,branch.positions);if(!e.verify(flat).valid)throw new Error("当前构型已失效，请重新求解条件");
    result.branches[request.reference.branch]=analyze(problem,flat,deadline,random,{...branch,reference:[...reference]});
    result.elapsed=Date.now()-started;
    return result;
  }
  if(request.move&&request.previous) {
    const result=structuredClone(request.previous),branch=result.branches[request.move.branch];
    if(!branch||!problem.points.includes(request.move.point))throw new Error("动点或构型已失效");
    if(branch.reference.includes(request.move.point))throw new Error("此点属于参照结构，请先切换参照结构或选择其他动点");
    const refreshed=refreshSpatialMobility(problem,branch);Object.assign(branch,refreshed);
    if(branch.dof===0)throw Error(branch.mobility?.removed?'当前构型在极值或相切处被条件锁定，没有可连续拖动的自由度':'当前形状已固定，整体平移和旋转不计构型自由度');
    if(branch.motionDof===0)throw Error('当前参照下没有可连续拖动的自由度，请减少固定点');
    const fixed=fixedCoordinates(problem.points,branch.positions,branch.reference),index=problem.points.indexOf(request.move.point)*3;
    const locus=branch.loci.find(l=>l.point===request.move!.point),target=locus?nearestLocus(locus,request.move.target):request.move.target;
    const transported=rigidMotion(branch.positions,branch.reference,request.move.point,target,e.scale);
    if(transported) {
      const check=e.verify(flatten(problem.points,transported));
      if(check.valid){branch.positions=transported;branch.residual=check.max;result.elapsed=Date.now()-started;return result;}
    }
    // A point on an explicit locus, and followers constructible from it, do not
    // need an optimizer for each pointer movement. Preserve the reference frame
    // and prefer the nearest continuous position for dependent points.
    let direct={...branch.positions,[request.move.point]:target};
    if(!e.verify(flatten(problem.points,direct)).valid) {
      const anchors=Object.fromEntries(branch.reference.map(name=>[name,branch.positions[name]]));anchors[request.move.point]=target;
      const plan=planConstructions(problem,Math.min(deadline,Date.now()+Math.max(10,budget*.25)),{anchors,preferred:branch.positions});
      const cost=(p:Positions)=>problem.points.reduce((sum,n)=>sum+norm(sub(p[n],branch.positions[n]))**2,0);
      plan.solutions.sort((a,b)=>cost(a)-cost(b));if(plan.solutions.length)direct=plan.solutions[0];
    }
    const directCheck=e.verify(flatten(problem.points,direct));
    if(directCheck.valid){branch.positions=direct;branch.residual=directCheck.max;result.elapsed=Date.now()-started;return result;}
    const moveScale=locus&&["circle","sphere","segment"].includes(locus.kind)?locus.radius:e.scale;
    const extra=(x:number[])=>target.map((v,k)=>(x[index+k]-v)/moveScale);
    let x=minimize(e.values,flatten(problem.points,branch.positions),deadline,fixed,extra);
    if(!e.verify(x).valid) {
      // A cursor position need not lie on the solution family. First approach
      // it softly, then restore every hard condition before publishing.
      x=minimize(v=>e.values(v).map(n=>n*100),flatten(problem.points,branch.positions),Math.min(deadline,Date.now()+150),fixed,extra);
      x=minimize(e.values,x,deadline,fixed);
    }
    if(!e.verify(x).valid)throw new Error("该位置不满足全部条件，已保留上一个可行位置");
    branch.positions=positions(problem.points,x);branch.residual=e.verify(x).max;result.elapsed=Date.now()-started;
    result.method=result.method==="construction"?"hybrid":result.method??"numerical";
    result.approximationReason="当前拖动位置不能直接由现有构造满足全部条件，采用数值联动并回代校验。";
    return result;
  }
  const construction=constructRightPrism(problem);
  if(construction) {
    const branches:SolutionBranch[]=[];
    for(const raw of construction.positions) {
      const p=canonical(raw,problem.points),branch:SolutionBranch={positions:p,rigid:[[...problem.points]],reference:[...problem.points],
        dof:0,motionDof:0,mobility:{version:2,linear:0,removed:0,checked:true},loci:[],residual:e.verify(flatten(problem.points,p)).max,rigidityPending:false};
      if(!branches.some(b=>branchEquivalent(b,branch,e.scale)))branches.push(branch);
    }
    const complete=branches.length<=12,shown=branches.slice(0,12);
    return {branches:shown,status:"solved",method:"construction",complete,attempts:construction.candidates,elapsed:Date.now()-started,
      constructionSteps:["由已知相邻边及夹角，用余弦定理计算对角线；无向线线角枚举两个顶角。","底面各点由两个已知距离对应的圆求交，枚举交点，排除交叉底面。","沿底面法向取正、负侧棱向量，平移生成顶面；回代全部原始条件。"],
      diagnostics:[`解析构造得到 ${shown.length} 个可行构型，均已回代全部条件。`,
        "用余弦定理和圆交点确定底面，再沿底面法向按侧棱长度平移生成顶面；无向线线角的两种顶角及镜像位置分别枚举。",
        complete?"此构造的有限分支已枚举完成；整体平移和旋转视为同一构型。":"构型数量超过显示上限，当前保留前 12 个，不声明穷尽。"]};
  }
  const plan=planConstructions(problem,Math.min(deadline,Date.now()+Math.max(10,budget*.25)));
  if(plan.solutions.length&&!request.previous?.branches.length) {
    const branches:SolutionBranch[]=[];let complete=plan.finite;
    for(const raw of plan.solutions) {
      const reference=plan.finite?problem.points:branches[0]?.reference??problem.points,p=canonical(raw,reference);
      const provisional:SolutionBranch=branches.length?{...branches[0],positions:p}:{positions:p,rigid:[problem.points],reference:problem.points,dof:0,loci:[],residual:0};
      if(branches.some(b=>branchEquivalent(b,provisional,e.scale)))continue;
      if(branches.length>=12||branches.length&&Date.now()>deadline){complete=false;break;}
      const branch=plan.finite?{...provisional,motionDof:0,mobility:{version:2 as const,linear:0,removed:0,checked:true},rigidityPending:false,residual:e.verify(flatten(problem.points,p)).max}:
        analyze(problem,flatten(problem.points,raw),Math.min(deadline,Date.now()+700),random);
      // Guard the coordinate change too, not only the construction pose.
      if(e.verify(flatten(problem.points,branch.positions)).valid)branches.push(branch);
      else complete=false;
    }
    if(branches.length)return {branches,status:"solved",method:"construction",complete,attempts:plan.solutions.length,elapsed:Date.now()-started,constructionSteps:plan.steps,
      diagnostics:[`优先通过几何构造与轨迹求交得到 ${branches.length} 个可行构型，均已回代全部条件。`,
        "辅助直线、平面、圆和球面只参与构造计算，不加入绘图区。",
        complete?"此构造的有限分支已枚举完成；整体平移和旋转视为同一构型。":"存在连续自由度或尚未完成全部分支枚举，不声明穷尽。"]};
  }
  const branches=structuredClone(request.previous?.branches??[]).map(b=>refreshSpatialMobility(problem,b));let attempts=request.previous?.attempts??0,bestErrors:{id:string;error:number;degenerate:boolean}[]=[];
  let best=Infinity;
  for(let i=0;i<32&&Date.now()<deadline;i++,attempts++) {
    let start=initial(problem,random);
    if(request.seeds?.[i]){const seed=request.seeds[i];start=flatten(problem.points,Object.fromEntries(problem.points.map((name,k)=>[name,seed[name]?.every(Number.isFinite)?seed[name]:start.slice(k*3,k*3+3) as Vec3])));}
    else if(i<plan.seeds.length)start=flatten(problem.points,{...positions(problem.points,start),...plan.seeds[i]});
    if(branches.length&&i%3!==2) {
      const base=branches[i%branches.length].positions;
      start=flatten(problem.points,base).map((n,k)=>i%3===0?(k%3===2?-n:n):n+(random()-.5)*e.scale);
    } else if(i>=plan.seeds.length&&i>0)start=start.map(n=>n+(random()-.5)*e.scale*(.4+i%4));
    const x=minimize(e.values,start,Math.min(deadline,Date.now()+Math.max(80,budget/5))),check=e.verify(x);
    if(check.max<best){best=check.max;bestErrors=check.errors;}
    if(!check.valid)continue;
    const branch=analyze(problem,x,Math.min(deadline,Date.now()+Math.min(700,budget*.4)),random);
    if(!branches.some(b=>branchEquivalent(b,branch,e.scale)))branches.push(branch);
    if(branches.length>=12)break;
    // Continue a few independent starts even if the first construction is rigid.
    if(i>=5&&branches.length&&Date.now()-started>budget*.6)break;
  }
  const diagnostics:string[]=[];
  const hybrid=plan.seeds.some(p=>Object.keys(p).length>2);
  const seed=plan.seeds.reduce<Record<string,unknown>>((best,next)=>Object.keys(next).length>Object.keys(best).length?next:best,{});
  const pending=problem.points.filter(name=>!seed[name]);
  const approximationReason=pending.length?`当前解析构造规则尚不能直接确定${pending.slice(0,12).join("、")}${pending.length>12?"等点":""}的关联位置，需要联立数值逼近。这不表示这些条件没有解析解。`:
    "几何构造候选尚未同时满足全部附加条件，需要数值联立调整。这不表示这些条件没有解析解。";
  diagnostics.push(hybrid?"已优先构造可确定的几何部分；其余耦合关系使用多起点数值求解，再回代全部条件校验。":"已尝试解析构造；当前条件尚不能由已支持的构造规则直接确定，使用多起点数值求解，再回代全部条件校验。");
  if(!branches.length) {
    const worst=bestErrors.filter(e=>e.error>3e-6||e.degenerate).sort((a,b)=>b.error-a.error).slice(0,4);
    diagnostics.push("尚未找到满足全部条件的解；这不代表已证明无解。可继续搜索或检查以下条件。");
    diagnostics.push(...worst.map(w=>`${problem.conditions.find(c=>c.id===w.id)?.source??`曲线 ${problem.curves?.find(c=>c.id===w.id)?.name??w.id}`}：${w.degenerate?"图形退化":`归一化误差 ${w.error.toPrecision(3)}`}`));
  } else {
    diagnostics.push(`已找到 ${branches.length} 个可行构型，尚未证明穷尽。`);
    if(branches.some(b=>b.dof>0))diagnostics.push("构型自由度只计形状变化，排除整图平移、旋转；轨迹上的移动会重新校验整组条件。");
    if(branches.some(b=>b.rigidityPending))diagnostics.push("本轮时间不足以完成全部刚性扰动验证，仅固定已确认的参照关系，可继续搜索。");
  }
  return {branches,status:branches.length?"solved":"notFound",method:hybrid?"hybrid":"numerical",approximationReason,complete:false,attempts,elapsed:Date.now()-started,
    constructionSteps:hybrid?(plan.steps.length?plan.steps:request.previous?.constructionSteps):undefined,diagnostics};
}
export { align as alignPositions };
