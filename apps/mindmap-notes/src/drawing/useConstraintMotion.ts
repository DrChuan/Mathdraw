import { useEffect, useRef, type RefObject } from "react";
import type { DrawingChange, DrawingDocument, Vec3 } from "./types";
import { localTarget } from "./constraints/document";
import { installSolutionSet } from './constraints/document';
import { useConstraintSolver } from "./useConstraintSolver";
import { trackConstraintMotion } from './constraintPending';
import {expandedCoordinateSet} from './constraints/planarMembers';
import {updatePlanarInput} from './constraints/inputs';

/** One in-flight correction and one replaceable cursor target. */
export function useConstraintMotion(docRef:RefObject<DrawingDocument>,change:DrawingChange,onError:(s:string)=>void) {
  const solver=useConstraintSolver(docRef.current.id),generation=useRef(0),running=useRef(false),record=useRef(true);
  const latest=useRef<{set:string;point:string;target:Vec3}|{set:string;variable:string;value:number}|{set:string;input:string;change:{target:Vec3}|{field:string;value:number}}|null>(null);
  const state=useRef({solver,change,onError});state.current={solver,change,onError};
  useEffect(()=>()=>{generation.current++;latest.current=null;running.current=false;},[docRef.current.id]);
  useEffect(()=>{const stop=()=>{generation.current++;latest.current=null;running.current=false;state.current.solver.cancel();};window.addEventListener("drawing-history",stop);return()=>window.removeEventListener("drawing-history",stop);},[]);
  const pump=async()=>{
    if(running.current||!latest.current)return;
    const job=latest.current;latest.current=null;
    const saved=docRef.current.objects.find(o=>o.id===job.set);if(saved?.kind!=="solutionSet")return;
    const token=generation.current;running.current=true;const complete=trackConstraintMotion(docRef.current.id);
    try {
      const set=expandedCoordinateSet(docRef.current,saved);
      const input='input'in job,problem=input?updatePlanarInput(set.problem,job.input,job.change):set.problem,previous=set.result.branches[set.activeBranch];
      const result=await state.current.solver.solve({problem,previous:set.result,budget:input?1000:350,...(input?{seeds:[previous.positions],seedValues:[previous.values??{}]}:'variable'in job?{parameter:{variable:job.variable,target:job.value,branch:set.activeBranch}}:{move:{point:job.point,target:localTarget(set,job.target),branch:set.activeBranch}})});
      if(!result.branches.length)throw Error('这个输入下暂未找到满足全部条件的构型，已保留上一有效输入和图形');
      const current=docRef.current.objects.find(o=>o.id===job.set);
      if(token!==generation.current||current?.kind!=="solutionSet"||JSON.stringify(current.result)!==JSON.stringify(saved.result)||JSON.stringify(current.problem)!==JSON.stringify(saved.problem)||JSON.stringify(current.placement)!==JSON.stringify(set.placement)||current.activeBranch!==set.activeBranch)return;
      const score=(b:typeof previous)=>Object.entries(previous.positions).reduce((sum,[n,p])=>sum+(b.positions[n]?.reduce((s,v,i)=>s+(v-p[i])**2,0)??0),0);
      const activeBranch=input?result.branches.reduce((best,b,i)=>score(b)<score(result.branches[best])?i:best,0):Math.min(current.activeBranch,result.branches.length-1);
      const next=current.problem.mode==='plane'||current.problem.mode==='coordinate'?installSolutionSet(docRef.current,{...current,problem,result,activeBranch}):{...docRef.current,objects:docRef.current.objects.map(o=>o.id===set.id?{...current,result}:o)};
      if(state.current.change(next,record.current,"complete")) {docRef.current=next;record.current=false;}
    } catch(e) {if(token===generation.current&&(e as Error).message!=="计算已取消")state.current.onError((e as Error).message);}
    finally {if(token===generation.current){running.current=false;void pump();}complete();}
  };
  const begin=()=>{generation.current++;state.current.solver.cancel();latest.current=null;running.current=false;record.current=true;state.current.onError("");};
  const move=(set:string,point:string,target:Vec3)=>{latest.current={set,point,target};void pump();};
  const moveValue=(set:string,variable:string,value:number)=>{latest.current={set,variable,value};void pump();};
  const moveInputPoint=(set:string,input:string,target:Vec3)=>{latest.current={set,input,change:{target}};void pump();};
  const moveInputValue=(set:string,input:string,value:number)=>{latest.current={set,input,change:{field:'value',value}};void pump();};
  return {begin,move,moveValue,moveInputPoint,moveInputValue,busy:solver.busy};
}
