import { useEffect, useRef, type RefObject } from "react";
import type { DrawingChange, DrawingDocument, Vec3 } from "./types";
import { localTarget } from "./constraints/document";
import { installSolutionSet } from './constraints/document';
import { useConstraintSolver } from "./useConstraintSolver";
import { trackConstraintMotion } from './constraintPending';

/** One in-flight correction and one replaceable cursor target. */
export function useConstraintMotion(docRef:RefObject<DrawingDocument>,change:DrawingChange,onError:(s:string)=>void) {
  const solver=useConstraintSolver(docRef.current.id),generation=useRef(0),running=useRef(false),record=useRef(true);
  const latest=useRef<{set:string;point:string;target:Vec3}|{set:string;variable:string;value:number}|null>(null);
  const state=useRef({solver,change,onError});state.current={solver,change,onError};
  useEffect(()=>()=>{generation.current++;latest.current=null;running.current=false;},[docRef.current.id]);
  useEffect(()=>{const stop=()=>{generation.current++;latest.current=null;running.current=false;state.current.solver.cancel();};window.addEventListener("drawing-history",stop);return()=>window.removeEventListener("drawing-history",stop);},[]);
  const pump=async()=>{
    if(running.current||!latest.current)return;
    const job=latest.current;latest.current=null;
    const set=docRef.current.objects.find(o=>o.id===job.set);if(set?.kind!=="solutionSet")return;
    const token=generation.current;running.current=true;const complete=trackConstraintMotion(docRef.current.id);
    try {
      const result=await state.current.solver.solve({problem:set.problem,previous:set.result,budget:350,...('variable'in job?{parameter:{variable:job.variable,target:job.value,branch:set.activeBranch}}:{move:{point:job.point,target:localTarget(set,job.target),branch:set.activeBranch}})});
      const current=docRef.current.objects.find(o=>o.id===job.set);
      if(token!==generation.current||current?.kind!=="solutionSet"||JSON.stringify(current.result)!==JSON.stringify(set.result)||JSON.stringify(current.problem)!==JSON.stringify(set.problem)||JSON.stringify(current.placement)!==JSON.stringify(set.placement)||current.activeBranch!==set.activeBranch)return;
      const next=current.problem.mode==='plane'||current.problem.mode==='coordinate'?installSolutionSet(docRef.current,{...current,result}):{...docRef.current,objects:docRef.current.objects.map(o=>o.id===set.id?{...current,result}:o)};
      if(state.current.change(next,record.current,"complete")) {docRef.current=next;record.current=false;}
    } catch(e) {if(token===generation.current&&(e as Error).message!=="计算已取消")state.current.onError((e as Error).message);}
    finally {if(token===generation.current){running.current=false;void pump();}complete();}
  };
  const begin=()=>{generation.current++;state.current.solver.cancel();latest.current=null;running.current=false;record.current=true;state.current.onError("");};
  const move=(set:string,point:string,target:Vec3)=>{latest.current={set,point,target};void pump();};
  const moveValue=(set:string,variable:string,value:number)=>{latest.current={set,variable,value};void pump();};
  return {begin,move,moveValue,busy:solver.busy};
}
