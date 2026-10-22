import { useEffect, useRef, useState } from "react";
import type { SolveRequest, SolveResponse, ConstraintResult } from "./constraints/types";

export function useConstraintSolver(documentId:string) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const worker=useRef<Worker|null>(null),sequence=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const pending=useRef<{id:number;resolve:(result:ConstraintResult)=>void;reject:(e:Error)=>void}|null>(null);
  const cancel=()=>{sequence.current++;clearTimeout(timer.current);worker.current?.terminate();worker.current=null;pending.current?.reject(new Error("计算已取消"));pending.current=null;setBusy(false);};
  useEffect(()=>{setBusy(false);return()=>{worker.current?.terminate();worker.current=null;clearTimeout(timer.current);pending.current?.reject(new Error("计算已取消"));pending.current=null;};},[documentId]);
  const solve=(input:Omit<SolveRequest,"id">):Promise<ConstraintResult>=>{
    if(pending.current)cancel();setError("");setBusy(true);
    const id=++sequence.current;
    return new Promise((resolve,reject)=>{
      pending.current={id,resolve,reject};
      const fail=(text:string)=>{if(pending.current?.id!==id)return;clearTimeout(timer.current);pending.current=null;worker.current?.terminate();worker.current=null;setBusy(false);setError(text);reject(new Error(text));};
      worker.current??=new Worker(new URL("./constraint.worker.ts",import.meta.url),{type:"module"});
      worker.current.onmessage=(e:MessageEvent<SolveResponse>)=>{
        if(pending.current?.id!==id||e.data.id!==id)return;
        if(e.data.error||!e.data.result){fail(e.data.error??"求解结果无效");return;}
        clearTimeout(timer.current);pending.current=null;setBusy(false);resolve(e.data.result);
      };
      worker.current.onerror=()=>fail("约束计算失败，请检查条件或减少问题规模");
      timer.current=setTimeout(()=>fail("本轮计算超时，已保留上次结果，可继续搜索"),(input.budget??2000)+2500);
      worker.current.postMessage({...input,id});
    });
  };
  return {solve,cancel,busy,error};
}
