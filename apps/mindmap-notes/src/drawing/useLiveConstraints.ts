import {useEffect,useRef,useState} from 'react';
import type {ConstraintProblem,ConstraintResult} from './constraints/types';
import {useConstraintSolver} from './useConstraintSolver';
export const currentConstraintRevision=(token:number,revision:number,key:string,currentKey:string,active:boolean)=>token===revision&&key===currentKey&&active;
export function useLiveConstraints({documentId,inputKey,active=true,build,accept}:{documentId:string;inputKey:string;active?:boolean;build:()=>ConstraintProblem;accept:(p:ConstraintProblem,r:ConstraintResult)=>void}){
 const solver=useConstraintSolver(documentId),latest=useRef({build,accept,inputKey,active});latest.current={build,accept,inputKey,active};
 const accepted=useRef<{key:string;problem:ConstraintProblem;result:ConstraintResult}|undefined>(undefined);
 const revision=useRef(0),[state,setState]=useState<{key:string;status:'pending'|'ready'|'invalid'|'notFound'|'contradiction';message:string}>({key:'',status:'pending',message:''});
 const cancel=()=>{revision.current++;solver.cancel();};
 const invalidate=()=>{cancel();setState({key:latest.current.inputKey,status:'pending',message:''});};
 const run=async(deep=false)=>{
   const token=++revision.current,key=latest.current.inputKey;
   solver.cancel();setState({key,status:'pending',message:''});
   try{
    const p=latest.current.build(),old=accepted.current;
    const spread=Object.fromEntries(p.points.map((name,i)=>{const t=2*Math.PI*i/Math.max(3,p.points.length);return [name,[3*Math.cos(t),3*Math.sin(t),p.mode==='spatial'?Math.sin(t*2):0] as [number,number,number]];}));
    const seeds=old?.result.branches.map(b=>({...spread,...Object.fromEntries(Object.entries(b.positions).filter(([name])=>p.points.includes(name)))}))??[spread];
    const result=await solver.solve({problem:p,budget:deep?8000:2000,previous:old?.key===key?old.result:undefined,seeds,seedValues:old?.result.branches.map(b=>b.values??{})});
    if(!currentConstraintRevision(token,revision.current,key,latest.current.inputKey,latest.current.active))return;
    if(result.branches.length&&old?.result.branches[0]){
      const prior=old.result.branches[0].positions,score=(b:typeof result.branches[number])=>Object.entries(b.positions).reduce((sum,[name,p])=>sum+(prior[name]?p.reduce((s,v,i)=>s+(v-prior[name][i])**2,0):0),0);
      result.branches.sort((a,b)=>score(a)-score(b));
    }
    if(result.branches.length){accepted.current={key,problem:p,result};latest.current.accept(p,result);setState({key,status:'ready',message:p.conditions.some(c=>c.enabled)||p.planar?.equations.some(c=>c.enabled)?'已满足':'尚未限定 · 自由布局'});}
    else setState({key,status:result.status==='contradiction'?'contradiction':'notFound',message:(result.status==='contradiction'?'已证明条件互相矛盾':'暂未找到可行构型')+'。'+result.diagnostics.slice(0,2).join(' ')});
   }catch(e){if(token===revision.current&&key===latest.current.inputKey)setState({key,status:'invalid',message:(e as Error).message});}
 };
 useEffect(()=>{cancel();if(!active)return;setState({key:inputKey,status:'pending',message:''});const timer=setTimeout(()=>void run(),300);return()=>{clearTimeout(timer);cancel();};},[inputKey,active,documentId]);
 const current=state.key===inputKey?state:{key:inputKey,status:'pending' as const,message:''};
 const remember=(result:ConstraintResult,branch=0)=>{if(accepted.current){const branches=[result.branches[branch],...result.branches.filter((_,i)=>i!==branch)].filter(Boolean);accepted.current={...accepted.current,result:{...result,branches}};}};
 return {remember,solver,run,invalidate,cancel,status:current.status,message:current.message,ready:active&&current.status==='ready',stale:current.status!=='ready'&&!!accepted.current};
}
