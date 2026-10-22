import { useEffect, useRef, useState, type RefObject } from "react";
import type { DrawingChange, DrawingDocument, DrawingSolutionSet } from "./types";
import { selectedBranch, installSolutionSet, mirrorSolutionSet } from "./constraints/document";
import { world, dot, sub, cross } from "./constraints/math";
import { locusPoint } from "./constraints/loci";
import { useConstraintMotion } from "./useConstraintMotion";
import { exactCoordinates } from "./exactNumber";
import { mathPreview } from "./mathPreview";
import { FormulaPreview } from "./FormulaPreview";
import { useConstraintSolver } from "./useConstraintSolver";
import { referenceChoices, referenceKey, driverChoices } from "./constraints/reference";

export const locusLabels={line:"直线",segment:"线段",circle:"圆",plane:"平面",sphere:"球面",sampled:"数值轨迹"};
export default function ConstraintSetControls({set,docRef,change,edit,mirror}:{set:DrawingSolutionSet;docRef:RefObject<DrawingDocument>;change:DrawingChange;edit:()=>void;mirror?:()=>void}) {
  const branch=selectedBranch(set),[point,setPoint]=useState(""),[error,setError]=useState("");
  const motion=useConstraintMotion(docRef,change,setError),gesture=useRef(false);
  const referenceSolver=useConstraintSolver(docRef.current.id);
  const references=referenceChoices(branch),drivers=driverChoices(branch,set.problem.points);
  const driver=set.driver&&!branch.reference.includes(set.driver)?set.driver:branch.loci[0]?.point??set.problem.points.find(n=>!branch.reference.includes(n))??"";
  const [gestureActive,setGestureActive]=useState(false),[parameters,setParameters]=useState<{point:string;a:number;b:number}|null>(null);
  const locus=branch.loci.find(l=>l.point===(point||driver))??branch.loci.find(l=>l.point===driver)??branch.loci[0],name=locus?.point??"";
  const p=locus?branch.positions[name]:undefined,delta=p&&locus?sub(p,locus.origin):undefined;
  let a=0,b=0;
  if(locus&&delta) {
    a=["circle","sphere"].includes(locus.kind)?Math.atan2(dot(delta,locus.v),dot(delta,locus.u)):dot(delta,locus.u);
    b=locus.kind==="sphere"?Math.asin(Math.max(-1,Math.min(1,dot(delta,cross(locus.u,locus.v))/locus.radius))):dot(delta,locus.v);
  }
  if(parameters?.point===name){a=parameters.a;b=parameters.b;}
  useEffect(()=>{if(!motion.busy&&!gestureActive)setParameters(null);},[motion.busy,gestureActive,set.result,name]);
  const begin=()=>{motion.begin();gesture.current=true;setGestureActive(true);};
  const drag=(value:number,second=false)=>{
    if(!locus)return;if(!gesture.current)begin();
    const next={point:name,a:second?a:value,b:second?value:b};setParameters(next);
    motion.move(set.id,name,world(locusPoint(locus,next.a,next.b),set.placement));
  };
  const finish=()=>{gesture.current=false;setGestureActive(false);};
  useEffect(()=>{const stop=()=>referenceSolver.cancel();window.addEventListener("drawing-history",stop);return()=>window.removeEventListener("drawing-history",stop);},[]);
  const chooseReference=async(reference:string[],preferred:string)=>{
    finish();setParameters(null);motion.begin();setError("");
    const before=docRef.current,original=before.objects.find(o=>o.id===set.id);if(original?.kind!=="solutionSet")return;
    try {
      const result=await referenceSolver.solve({problem:original.problem,previous:original.result,budget:1500,reference:{branch:original.activeBranch,points:reference}});
      const current=docRef.current.objects.find(o=>o.id===original.id);
      if(current?.kind!=="solutionSet"||current.activeBranch!==original.activeBranch||JSON.stringify(current.result)!==JSON.stringify(original.result)||JSON.stringify(current.problem)!==JSON.stringify(original.problem)||JSON.stringify(current.placement)!==JSON.stringify(original.placement))return;
      const driver=preferred&&!reference.includes(preferred)?preferred:current.problem.points.find(n=>!reference.includes(n));
      if(change(installSolutionSet(docRef.current,{...current,result,driver})))setPoint(driver??"");
    }catch(e){if((e as Error).message!=="计算已取消")setError((e as Error).message);}
  };
  return <div className="constraint-set-controls" onPointerDown={e=>e.stopPropagation()}>
    <label>当前构型<select disabled={referenceSolver.busy} aria-label={`切换构型 ${set.symbol??set.name}`} value={set.activeBranch} onChange={e=>{
      finish();setParameters(null);motion.begin();try{
        const activeBranch=Number(e.target.value),reference=set.result.branches[activeBranch].reference,driver=set.driver&&!reference.includes(set.driver)?set.driver:set.problem.points.find(n=>!reference.includes(n));
        change(installSolutionSet(docRef.current,{...set,activeBranch,driver}));
      }catch(e){setError((e as Error).message);}
    }}>{set.result.branches.map((b,i)=><option key={i} value={i}>构型 {i+1} · {b.dof} 个连续自由度</option>)}</select></label>
    {drivers.length>0&&<label>动点<select aria-label="选择条件作图动点" disabled={referenceSolver.busy||motion.busy} value={driver} onChange={e=>{
      const name=e.target.value,reference=!branch.reference.includes(name)?branch.reference:references.find(g=>!g.includes(name));
      if(reference)void chooseReference(reference,name);
    }}>{drivers.map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
    {references.length>1?<label>参照结构<select aria-label="选择参照结构" disabled={referenceSolver.busy||motion.busy} value={referenceKey(branch.reference)} onChange={e=>{
      const reference=references.find(g=>referenceKey(g)===e.target.value);if(reference)void chooseReference(reference,driver);
    }}>{references.map(g=><option key={referenceKey(g)} value={referenceKey(g)}>{g.join("、")}</option>)}</select></label>:<small>参照结构：{branch.reference.join("、")}</small>}
    <small>{referenceSolver.busy?"正在更新动点与轨迹…":"参照结构保持不动；切换动点会自动选择不包含该点的参照结构。"}</small>
    <small>{set.result.complete?"解集完整":"已验证现有构型，尚未证明穷尽"}</small>
    <button disabled={referenceSolver.busy||motion.busy} title="反转 xOy 平面内的顶点绕行方向，保持高度；再次点击恢复" onClick={()=>{finish();setParameters(null);motion.begin();if(mirror)mirror();else change(installSolutionSet(docRef.current,mirrorSolutionSet(set)));}}>切换手性</button>
    <button disabled={referenceSolver.busy} onClick={edit}>编辑条件 / 继续搜索</button>
    {locus&&<>
      <label>轨迹动点<select disabled={referenceSolver.busy} aria-label="选择轨迹动点" value={name} onChange={e=>{finish();setParameters(null);setPoint(e.target.value);}}>{branch.loci.map(l=><option key={l.point} value={l.point}>{l.point} · {locusLabels[l.kind]}</option>)}</select></label>
      <small>{locus.complete?"解析轨迹":"局部/候选轨迹，移动时验证全部条件"}{motion.busy?" · 计算中…":""}</small>
      {locus.kind!=="sampled"&&<>
        <label>{["circle","sphere"].includes(locus.kind)?"方位角":"参数 u"}<input type="range" aria-label="轨迹参数 u"
          min={["circle","sphere"].includes(locus.kind)?-Math.PI:locus.kind==="segment"?0:-locus.radius} max={["circle","sphere"].includes(locus.kind)?Math.PI:locus.radius} step="any" value={a}
          disabled={referenceSolver.busy} onPointerDown={begin} onPointerUp={finish} onBlur={finish} onKeyUp={finish} onChange={e=>drag(Number(e.target.value))}/></label>
        {["sphere","plane"].includes(locus.kind)&&<label>{locus.kind==="sphere"?"纬度":"参数 v"}<input type="range" aria-label="轨迹参数 v"
          min={locus.kind==="sphere"?-Math.PI/2:-locus.radius} max={locus.kind==="sphere"?Math.PI/2:locus.radius} step="any" value={b}
          disabled={referenceSolver.busy} onPointerDown={begin} onPointerUp={finish} onBlur={finish} onKeyUp={finish} onChange={e=>drag(Number(e.target.value),true)}/></label>}
      </>}
      {p&&<div>{name} {exactCoordinates(world(p,set.placement)).approximate?"≈":"="} <FormulaPreview source={mathPreview(exactCoordinates(world(p,set.placement)).source)}/></div>}
    </>}
    {error&&<small role="alert" className="expression-problem">{error}</small>}
  </div>;
}
