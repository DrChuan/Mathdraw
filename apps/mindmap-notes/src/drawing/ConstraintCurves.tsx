import { useState } from "react";
import type { Condition,ConstraintCurve } from "./constraints/types";
import { entity,pointNames,validateCurves } from "./constraints/input";
import { scalar } from "./expression";
import { FormulaPreview } from "./FormulaPreview";
import { symbolLatex,mathPreview } from "./mathPreview";

export default function ConstraintCurves({points,curves,conditions,change,onError,planar=false}:{planar?:boolean;points:string;curves:ConstraintCurve[];conditions:Condition[];change:(curves:ConstraintCurve[])=>void;onError:(s:string)=>void}) {
  const [draft,setDraft]=useState<ConstraintCurve>(),[refs,setRefs]=useState<string[]>([]),[plane,setPlane]=useState(""),[value,setValue]=useState("1"),[error,setError]=useState("");
  const open=(c?:ConstraintCurve)=>{
    let name="c",i=1;while(curves.some(c=>c.name===name)||points.split(/[\s,]+/).includes(name))name=`c_${i++}`;
    setDraft(c??{id:crypto.randomUUID(),name,type:"circle",method:"centerPoint",points:[]});
    setRefs(c?.points??[]);setPlane(c?.plane?.join(" ")??"");setValue(c?.valueSource??"1");setError("");
  };
  const save=()=>{
    try {
      const names=pointNames(points),d=draft!,expected=d.method==="threePoint"?3:d.method==="centerRadius"?1:2;
      const resolved=Array.from({length:expected},(_,i)=>{const p=entity(refs[i]??"",names);if(p.length!==1)throw new Error("每个定义点选择一个已声明点");return p[0];});
      const needsValue=d.type==="ellipse"||d.method==="centerRadius";
      const next={...d,points:resolved,plane:d.normalAxis||d.method==="threePoint"||planar?undefined:entity(plane,names),value:needsValue?scalar(value):undefined,valueSource:needsValue?value:undefined};
      const all=curves.some(c=>c.id===next.id)?curves.map(c=>c.id===next.id?next:c):[...curves,next];
      validateCurves(all,names,planar);change(all);setDraft(undefined);
    }catch(e){setError((e as Error).message);}
  };
  const used=(id:string)=>conditions.some(c=>c.curve===id);
  const labels=draft?.type==="ellipse"?["第一焦点","第二焦点"]:draft?.method==="threePoint"?["圆上第一点","圆上第二点","圆上第三点"]:draft?.method==="centerRadius"?["圆心"]:["圆心","圆上一点"];
  let names:string[]=[];try{names=pointNames(points);}catch{/* Keep declaration drafts editable. */}
  return <section className={`constraint-curve-list ${curves.length?"":"empty"}`}><div className="constraint-section-heading">{curves.length>0&&<strong>曲线 <small>{curves.length}</small></strong>}<button onClick={()=>open()}>＋ 曲线</button></div>
    <div className="constraint-condition-flow">{curves.map(c=><div key={c.id} className="constraint-condition-chip"><button onClick={()=>open(c)} title="编辑曲线"><FormulaPreview source={symbolLatex(c.name)}/></button><span>{c.normalAxis?"几何体底面圆 · ":c.type==="ellipse"?"椭圆 · 焦点":"圆 · "+({centerPoint:"圆心与圆上一点",centerRadius:"圆心与半径",threePoint:"三点圆",foci:"焦点"}[c.method])} {c.points.join(", ")}</span>{c.valueSource&&<FormulaPreview source={`${c.type==="ellipse"?"2a":"r"}=${mathPreview(c.valueSource)}`}/>}<button aria-label={`删除曲线 ${c.name}`} onClick={()=>{if(used(c.id)){onError("请先移除引用该曲线的条件，再删除曲线");return;}change(curves.filter(k=>k.id!==c.id));}}>×</button></div>)}</div>
    {draft&&<div className="constraint-shape-overlay" onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"&&!e.nativeEvent.isComposing)setDraft(undefined);}} onPointerDown={e=>{if(e.target===e.currentTarget)setDraft(undefined);}}><section className="constraint-shape-modal" role="dialog" aria-modal="true" aria-label="添加曲线"><header><strong>{curves.some(c=>c.id===draft.id)?"编辑曲线":"添加曲线"}</strong><button onClick={()=>setDraft(undefined)}>×</button></header><form className="constraint-curve-form" onSubmit={e=>{e.preventDefault();save();}} onKeyDown={e=>{if(e.key==="Enter"&&e.nativeEvent.isComposing)e.preventDefault();}}>
      <label>名称<input autoFocus value={draft.name} disabled={used(draft.id)} maxLength={64} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>曲线类型<select disabled={!!draft.solid} value={draft.type} onChange={e=>{setDraft({...draft,type:e.target.value as ConstraintCurve["type"],method:e.target.value==="ellipse"?"foci":"centerPoint"});setRefs([]);}}><option value="circle">圆</option>{!planar&&<option value="ellipse">椭圆</option>}</select></label>
      {draft.type==="circle"&&<label>定圆方式<select disabled={!!draft.solid} value={draft.method} onChange={e=>{setDraft({...draft,method:e.target.value as ConstraintCurve["method"]});setRefs([]);}}><option value="centerPoint">圆心＋圆上一点</option><option value="centerRadius">圆心＋半径</option><option value="threePoint">三点圆</option></select></label>}
      {labels.map((label,i)=><label key={i}>{label}<select value={refs[i]??""} onChange={e=>setRefs(v=>{const n=[...v];n[i]=e.target.value;return n;})}><option value="">选择点…</option>{names.map(n=><option key={n}>{n}</option>)}</select></label>)}
      {draft.normalAxis&&<small>底面圆由几何体提供，轴向：{draft.normalAxis.join(" → ")}{draft.radiusSegment?`；半径来源：${draft.radiusSegment.join(" → ")}`:""}。</small>}{!planar&&!draft.normalAxis&&draft.method!=="threePoint"&&<label>所在平面（三个点）<input value={plane} placeholder="ABC 或 A B C" onChange={e=>setPlane(e.target.value)}/><small>确定立体空间中的曲线朝向。</small></label>}
      {(draft.type==="ellipse"||draft.method==="centerRadius")&&<label>{draft.type==="ellipse"?"长轴全长 2a（大于焦距）":"半径"}<input value={value} placeholder="支持分数、根式" onChange={e=>setValue(e.target.value)}/><FormulaPreview source={mathPreview(value)}/></label>}
      {error&&<small role="alert" className="constraint-field-error">{error}</small>}<button type="submit" className="primary">确定</button>
    </form></section></div>}
  </section>;
}
