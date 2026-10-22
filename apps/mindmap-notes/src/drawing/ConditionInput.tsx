import { useRef,useState } from "react";
import { conditionLabels,pointNames } from "./constraints/input";
import { conditionFields,conditionGroups,formConditionSource } from "./constraints/form";
import { angleKinds,type AngleMode } from "./constraints/angles";
import type { ConstraintKind } from "./constraints/types";

export default function ConditionInput({points,append,onError}:{points:string;append:(sources:string[])=>boolean;onError:(message:string)=>void}) {
  const [mode,setMode]=useState<"full"|"short">("full"),[category,setCategory]=useState(0),[kind,setKind]=useState<ConstraintKind>("distance"),[fields,setFields]=useState<string[]>([]),[value,setValue]=useState("3"),[shorthand,setShorthand]=useState("");
  const [angleMode,setAngleMode]=useState<AngleMode>("degrees"),[range,setRange]=useState<"both"|"acute"|"obtuse">("both");
  const input=useRef<HTMLInputElement>(null),composing=useRef(false);
  const choose=(next:ConstraintKind)=>{setKind(next);setFields([]);setValue(next==="division"?"1":angleKinds.includes(next)?angleMode==="degrees"?"60":angleMode==="radians"?"pi/3":"1/2":"3");};
  const submit=()=>{
    if(mode==="short"){if(shorthand.trim()&&append([shorthand]))setShorthand("");return;}
    try{if(append([formConditionSource(kind,fields,pointNames(points),value,angleMode,range)]))setFields([]);}
    catch(e){onError((e as Error).message);}
  };
  const insert=(symbol:string)=>{
    const field=input.current,start=field?.selectionStart??shorthand.length,end=field?.selectionEnd??start;
    setShorthand(shorthand.slice(0,start)+symbol+shorthand.slice(end));
    requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(start+symbol.length,start+symbol.length);});
  };
  const numeric=["distance","ratio","division",...angleKinds].includes(kind);
  return <section className="constraint-input" aria-label="添加条件">
    <div className="constraint-section-heading"><strong>添加条件</strong><div className="constraint-input-modes" role="tablist" aria-label="条件输入方式">{[["full","完整输入"],["short","简写"]].map(([id,label])=><button key={id} role="tab" aria-selected={mode===id} className={mode===id?"active":""} onClick={()=>setMode(id as typeof mode)}>{label}</button>)}</div></div>
    {mode==="full"?<>
      <div className="constraint-categories" aria-label="条件分类">{conditionGroups.map((group,i)=><button key={group.name} className={category===i?"active":""} aria-pressed={category===i} onClick={()=>{setCategory(i);choose(group.kinds[0]);}}>{group.name}</button>)}</div>
      <form className="constraint-full-form" onSubmit={e=>{e.preventDefault();if(!composing.current)submit();}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||composing.current))e.preventDefault();}}>
        <label>条件类型<select aria-label="条件类型" value={kind} onChange={e=>choose(e.target.value as ConstraintKind)}>{conditionGroups[category].kinds.map(k=><option key={k} value={k}>{conditionLabels[k]}</option>)}</select></label>
        {conditionFields[kind].map((field,i)=><label key={`${kind}-${i}`}>{field.label}<input aria-label={field.label} spellCheck={false} autoComplete="off" placeholder={field.placeholder} value={fields[i]??""} onChange={e=>setFields(previous=>{const next=[...previous];next[i]=e.target.value;return next;})}/></label>)}
        {angleKinds.includes(kind)&&<label>给定方式<select aria-label="角的给定方式" value={angleMode} onChange={e=>{setAngleMode(e.target.value as AngleMode);setValue(e.target.value==="degrees"?"60":e.target.value==="radians"?"pi/3":"1/2");}}><option value="degrees">角度（度）</option><option value="radians">角度（弧度）</option><option value="sin">正弦值 sin</option><option value="cos">余弦值 cos</option><option value="tan">正切值 tan</option></select></label>}
        {numeric&&<label>{kind==="distance"?"长度":kind==="division"?"AP / PB（1 为中点）":kind==="ratio"?"长度比":angleMode==="degrees"?"角度（度）":angleMode==="radians"?"角度（弧度）":"三角函数值"}<input aria-label="条件数值" value={value} onChange={e=>setValue(e.target.value)} placeholder="支持分数和根式"/></label>}
        {angleMode==="sin"&&["vertexAngle","dihedral"].includes(kind)&&<label>角的范围<select aria-label="正弦角的范围" value={range} onChange={e=>setRange(e.target.value as typeof range)}><option value="both">保留两种可能</option><option value="acute">0°～90°</option><option value="obtuse">90°～180°</option></select></label>}
        <button className="primary constraint-add" type="submit" disabled={conditionFields[kind].some((_,i)=>!fields[i]?.trim())}>加入条件</button>
      </form>
    </>:<><form className="constraint-short-form" onSubmit={e=>{e.preventDefault();if(!composing.current)submit();}}>
      <input ref={input} aria-label="条件数学简写" spellCheck={false} autoComplete="off" placeholder={"AB=3 或 \\angle ABC=60"} value={shorthand} onChange={e=>setShorthand(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||composing.current))e.preventDefault();}}/>
      {[["⊥","\\perp "],["∥","\\parallel "],["∠","\\angle "]].map(([label,source])=><button type="button" key={label} title={`插入 ${source.trim()}`} onMouseDown={e=>e.preventDefault()} onClick={()=>insert(source)}>{label}</button>)}
      <button className="primary" type="submit" disabled={!shorthand.trim()}>加入</button>
    </form><small>回车录入 · 支持连等、分数、根式、LaTeX 角与三角函数，如 {"\\sin\\angle ABC=\\frac{1}{2}"}</small></>}
  </section>;
}
