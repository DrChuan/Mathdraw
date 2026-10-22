import { useEffect, useRef, useState } from "react";
import { runUpdate } from "./updateFlow";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/** Updates never write the user's source file: the recovery draft is flushed first. */
export default function UpdateNotice({ready,beforeInstall,locked}:{ready:boolean;beforeInstall:()=>Promise<void>;locked:(value:boolean)=>void}) {
  const [update,setUpdate]=useState<Update|null>(null),[notice,setNotice]=useState(""),[error,setError]=useState(""),[phase,setPhase]=useState<"idle"|"download"|"install">("idle"),[progress,setProgress]=useState("");
  const current=useRef<Update|null>(null),checking=useRef(false),running=useRef(false),started=useRef(false),alive=useRef(true);
  const callbacks=useRef({beforeInstall,locked});callbacks.current={beforeInstall,locked};
  const checkNow=async(manual=false)=>{
    if(checking.current||running.current)return;
    checking.current=true;
    try {
      const next=await check({timeout:15000});
      if(!alive.current){await next?.close();return;}
      await current.current?.close();current.current=next;setUpdate(next);setError("");
      setNotice(next?"":manual?"当前已是最新版本。":"");
    }catch(e){if(manual&&alive.current){setNotice("无法检查更新，请稍后重试。");setError(String(e));}}
    finally{checking.current=false;}
  };
  useEffect(()=>{
    alive.current=true;
    if(!ready||!new URLSearchParams(location.search).has("standalone"))return;
    let stop:(()=>void)|undefined,cancelled=false;
    void listen("mathdraw-check-update",()=>void checkNow(true)).then(s=>{if(cancelled)s();else stop=s;});
    if(!started.current){started.current=true;void checkNow();}
    return()=>{cancelled=true;stop?.();};
  },[ready]);
  useEffect(()=>()=>{alive.current=false;void current.current?.close();},[]);
  const dismiss=()=>{if(running.current)return;void current.current?.close();current.current=null;setUpdate(null);setNotice("");setError("");};
  const install=async()=>{
    const next=current.current;if(!next||running.current)return;
    running.current=true;callbacks.current.locked(true);setPhase("download");setError("");
    let bytes=0,total=0;
    try {
      await runUpdate(next,()=>callbacks.current.beforeInstall(),()=>invoke("drawing_update_restart"),event=>{
        if(event.event==="Started")total=event.data.contentLength??0;
        if(event.event==="Progress")bytes+=event.data.chunkLength;
        setProgress(total?`${Math.min(100,Math.round(bytes/total*100))}%`:`${(bytes/1048576).toFixed(1)} MB`);
      },()=>setPhase("install"));
    }catch(e){setError(`更新未完成：${String(e)}`);setPhase("idle");running.current=false;callbacks.current.locked(false);}
  };
  if(!update&&!notice)return null;
  return <div className="draw-modal-shade" onKeyDown={e=>e.stopPropagation()} style={{zIndex:10000}}>
    <section className="draw-modal" role="dialog" aria-modal="true" aria-label="软件更新">
      <h2>{update?`发现新版本 ${update.version}`:"检查更新"}</h2>
      {update?<><p>当前版本 {update.currentVersion}。确认后下载、更新并重新启动，未保存的绘图会保留在本机草稿中。</p>{update.body&&<p style={{whiteSpace:"pre-wrap",maxHeight:180,overflow:"auto"}}>{update.body}</p>}</>:<p>{notice}</p>}
      {phase!=="idle"&&<p role="status">{phase==="download"?`正在下载 ${progress}`:"正在安装并重新启动…"}</p>}
      {error&&<p role="alert" style={{color:"#b43c29",overflowWrap:"anywhere"}}>{error}</p>}
      <div className="draw-button-row"><button disabled={phase!=="idle"} onClick={dismiss}>{update?"稍后":"关闭"}</button>{update&&<button className="draw-primary" disabled={phase!=="idle"} onClick={()=>void install()}>{error?"重试更新":"下载并更新"}</button>}</div>
    </section>
  </div>;
}
