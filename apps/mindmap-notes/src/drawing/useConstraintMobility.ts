import {useEffect,useRef,type RefObject} from 'react';
import type {DrawingDocument,DrawingChange} from './types';
import {useConstraintSolver} from './useConstraintSolver';

/** Recheck legacy first-order counts off the UI thread. Never change positions. */
export function useConstraintMobility(doc:DrawingDocument,docRef:RefObject<DrawingDocument>,change:DrawingChange){
  const solver=useConstraintSolver(doc.id),running=useRef(false),generation=useRef(0),failed=useRef(new Set<string>());
  const state=useRef({solver,change});state.current={solver,change};
  useEffect(()=>{failed.current.clear();return()=>{generation.current++;running.current=false;state.current.solver.cancel();};},[doc.id]);
  const pump=async()=>{
    if(running.current)return;
    const before=docRef.current,set=before.objects.find(o=>o.kind==='solutionSet'&&o.problem.mode!=='plane'&&o.problem.mode!=='coordinate'&&o.result.branches.some(b=>b.mobility?.version!==1)&&!failed.current.has(o.id));
    if(set?.kind!=='solutionSet')return;
    running.current=true;const token=generation.current;
    try{
      const result=await state.current.solver.solve({problem:set.problem,previous:set.result,refreshMobility:true,budget:1800});
      const current=docRef.current,now=current.objects.find(o=>o.id===set.id);
      if(token!==generation.current||current.id!==before.id||now?.kind!=='solutionSet')return;
      if(JSON.stringify(now.problem)===JSON.stringify(set.problem)&&JSON.stringify(now.result)===JSON.stringify(set.result)){
        const next={...current,objects:current.objects.map(o=>o.id===set.id?{...now,result}:o)};
        if(state.current.change(next,false,'complete'))docRef.current=next;else failed.current.add(set.id);
      }
    }catch(error){if(token===generation.current&&(error as Error).message!=='计算已取消')failed.current.add(set.id);}
    finally{if(token===generation.current){running.current=false;void pump();}}
  };
  useEffect(()=>{void pump();},[doc]);
}
