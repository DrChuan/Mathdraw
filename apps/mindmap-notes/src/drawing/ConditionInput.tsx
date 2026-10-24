import { declaredAngleSuggestions } from './constraints/angleSuggestions';
import { FormulaPreview } from './FormulaPreview';
import { symbolLatex } from './mathPreview';
import { useMemo,useRef,useState } from "react";
import { conditionLabels,pointNames } from "./constraints/input";
import { conditionFields,conditionGroups,formConditionSource } from "./constraints/form";
import { angleKinds,type AngleMode } from "./constraints/angles";
import type { ConstraintKind,ConstraintCurve,Condition,VolumeShape,ConstraintMode } from "./constraints/types";

export default function ConditionInput({points,segments='',angleEdges,curves=[],conditions=[],append,onError,mode='spatial'}:{points:string;segments?:string;angleEdges?:[string,string][];curves?:ConstraintCurve[];conditions?:Condition[];append:(sources:string[])=>boolean;onError:(message:string)=>void;mode?:ConstraintMode}) {
  const [anglePage,setAnglePage]=useState(0);
  const angles=useMemo(()=>declaredAngleSuggestions(points,segments,angleEdges),[points,segments,angleEdges]);
  const pageCount=Math.ceil(angles.count/32),currentPage=Math.max(0,Math.min(anglePage,pageCount-1));
  const forbidden=new Set(['pointPlaneDistance','volume','linePlaneAngle','dihedral','coplanar','cospherical','prism','pyramid','frustum','cube','cylinder','cone','coneFrustum','sphere']);
  const groups=mode==='spatial'?conditionGroups:conditionGroups.map(g=>({...g,name:g.name==='面积 / 体积'?'面积':g.name,kinds:g.kinds.filter(k=>!forbidden.has(k))})).filter(g=>g.kinds.length);
  const [category,setCategory]=useState(0),[kind,setKind]=useState<ConstraintKind>("distance"),[fields,setFields]=useState<string[]>([]),[value,setValue]=useState("3"),[shorthand,setShorthand]=useState("");
  const [angleMode,setAngleMode]=useState<AngleMode>("degrees"),[range,setRange]=useState<"both"|"acute"|"obtuse">("both");
  const [solid,setSolid]=useState<VolumeShape>("prism");
  const input=useRef<HTMLInputElement>(null),composing=useRef(false);
  const choose=(next:ConstraintKind)=>{setKind(next);setFields([]);setValue(["concyclic","cospherical"].includes(next)?"":next==="division"?"1":next==="vectorDot"?"0":angleKinds.includes(next)?angleMode==="degrees"?"60":angleMode==="radians"?"pi/3":"1/2":"3");};
  const submitShort=()=>{if(shorthand.trim()&&append([shorthand]))setShorthand("");};
  const submit=()=>{
    try{let source:string;try{source=formConditionSource(kind,fields,pointNames(points,mode==='coordinate'?2000:50),value,angleMode,range,solid,curves);}catch(e){
      if(mode!=='coordinate'||!['pointLineDistance','parallel','perpendicular','distance','equal','ratio','lineAngle','vectorDot'].includes(kind))throw e;
      source=`${kind}(${fields.join(',')}${['pointLineDistance','distance','ratio','lineAngle','vectorDot'].includes(kind)?`,${value}`:''})`;
      if(kind==='lineAngle')source=['sin','cos','tan'].includes(angleMode)?`${angleMode}Angle(${fields.join(',')})=${value}`:`lineAngle(${fields.join(',')},${angleMode==='radians'||/\\pi|\bpi\b|π/.test(value)?`(${value})*180/pi`:value})`;
    }if(append([source]))setFields([]);}
    catch(e){onError((e as Error).message);}
  };
  const insert=(symbol:string,back=0)=>{
    const field=input.current,start=field?.selectionStart??shorthand.length,end=field?.selectionEnd??start;
    setShorthand(shorthand.slice(0,start)+symbol+shorthand.slice(end));
    requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(start+symbol.length-back,start+symbol.length-back);});
  };
  const numeric=["pointLineDistance","pointPlaneDistance","distance","ratio","division","vectorDot","area","volume","circumradius","concyclic","cospherical",...angleKinds].includes(kind);
  const inputs=kind==="volume"?conditionFields[solid]:conditionFields[kind];
  const bodies=conditions.filter(c=>c.enabled&&["prism","pyramid","frustum","cylinder","cone","coneFrustum","cube"].includes(c.kind));
  return <section className="constraint-input" aria-label="添加条件">
    <div className="constraint-section-heading"><strong>添加条件</strong></div>
    <div className="constraint-input-columns">
    <div className="constraint-full-input"><h3>完整输入</h3>
      <div className="constraint-categories" aria-label="条件分类">{groups.map((group,i)=><button key={group.name} className={category===i?"active":""} aria-pressed={category===i} onClick={()=>{setCategory(i);choose(group.kinds[0]);}}>{group.name}</button>)}</div>
      <form className="constraint-full-form" onSubmit={e=>{e.preventDefault();if(!composing.current)submit();}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||composing.current))e.preventDefault();}}>
        <label>条件类型<select aria-label="条件类型" value={kind} onChange={e=>choose(e.target.value as ConstraintKind)}>{groups[category].kinds.map(k=><option key={k} value={k}>{conditionLabels[k]}</option>)}</select></label>
        {kind==="volume"&&<><label>几何体类型<select value={solid} onChange={e=>{setSolid(e.target.value as VolumeShape);setFields([]);}}>{(["prism","pyramid","frustum","cylinder","cone","coneFrustum"] as const).map(k=><option key={k} value={k}>{conditionLabels[k]}</option>)}</select></label>{bodies.length>0&&<label>填入已声明几何体<select value="" onChange={e=>{const body=bodies.find(c=>c.id===e.target.value);if(!body)return;setSolid(body.kind==="cube"?"prism":body.kind as VolumeShape);const p=body.refs[0],n=p.length/2;setFields(body.kind==="pyramid"?[p[0],p.slice(1).join(" ")]:["prism","frustum","cube"].includes(body.kind)?[p.slice(0,n).join(" "),p.slice(n).join(" ")]:p);}}><option value="">选择…</option>{bodies.map(c=><option key={c.id} value={c.id}>{conditionLabels[c.kind]} {c.refs.flat().join(" ")}</option>)}</select></label>}</>}
        {inputs.map((field,i)=><label key={`${kind}-${solid}-${i}`}>{field.label}{kind==="onCurve"&&i===1?<select value={fields[i]??""} onChange={e=>setFields(v=>[v[0]??"",e.target.value])}><option value="">选择曲线…</option>{curves.map(c=><option key={c.id} value={c.name}>{c.name} · {c.type==="circle"?"圆":"椭圆"}</option>)}</select>:<input aria-label={field.label} spellCheck={false} autoComplete="off" placeholder={field.placeholder} value={fields[i]??""} onChange={e=>setFields(previous=>{const next=[...previous];next[i]=e.target.value;return next;})}/>}</label>)}
        {angleKinds.includes(kind)&&<label>给定方式<select aria-label="角的给定方式" value={angleMode} onChange={e=>{setAngleMode(e.target.value as AngleMode);setValue(e.target.value==="degrees"?"60":e.target.value==="radians"?"pi/3":"1/2");}}><option value="degrees">角度（度）</option><option value="radians">角度（弧度）</option><option value="sin">正弦值 sin</option><option value="cos">余弦值 cos</option><option value="tan">正切值 tan</option></select></label>}
        {numeric&&<label>{kind==="area"?"面积":kind==="volume"?"体积":kind==="circumradius"?"外接圆半径":["concyclic","cospherical"].includes(kind)?"半径（可留空）":["pointLineDistance","pointPlaneDistance"].includes(kind)?"距离":kind==="distance"?"长度":kind==="vectorDot"?"数量积（可为负数或零）":kind==="division"?"AP / PB（1 为中点）":kind==="ratio"?"长度比":angleMode==="degrees"?"角度（度）":angleMode==="radians"?"角度（弧度）":"三角函数值"}<input aria-label="条件数值" value={value} onChange={e=>setValue(e.target.value)} placeholder="支持分数和根式"/></label>}
        {angleMode==="sin"&&["vertexAngle","dihedral"].includes(kind)&&<label>角的范围<select aria-label="正弦角的范围" value={range} onChange={e=>setRange(e.target.value as typeof range)}><option value="both">保留两种可能</option><option value="acute">0°～90°</option><option value="obtuse">90°～180°</option></select></label>}
        <button className="primary constraint-add" type="submit" disabled={inputs.some((_,i)=>!fields[i]?.trim())}>加入条件</button>
      </form>
      {["congruent","similar"].includes(kind)&&<small>按对应顺序输入顶点；同时适用于三角形和多边形。</small>}
      {kind==="vectorRelation"&&<small>向量用端点表示，如 AB；支持数乘、加减和分数、根式系数，右侧可填 0。</small>}
      {kind==="convexPolygon"&&<small>限定共面、凸性及顶点环绕顺序，不限制边长或角度。</small>}
    </div><div className="constraint-short-input"><h3>简写</h3><form className="constraint-short-form" onSubmit={e=>{e.preventDefault();if(!composing.current)submitShort();}}>
      <input ref={input} aria-label="条件数学简写" spellCheck={false} autoComplete="off" placeholder={"AB=3 或 \\angle ABC=60"} value={shorthand} onChange={e=>setShorthand(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||composing.current))e.preventDefault();}}/>
      <button className="primary" type="submit" disabled={!shorthand.trim()}>加入</button>
    </form><div className="constraint-short-symbols">{[["⊥","\\perp "],["∥","\\parallel "],["∠","\\angle "],["向量","\\overrightarrow{}"],["·","\\cdot "]].map(([label,source])=><button type="button" key={label} title={`插入 ${source.trim()}`} onMouseDown={e=>e.preventDefault()} onClick={()=>insert(source,label==="向量"?1:0)}>{label}</button>)}</div>
    {angles.count>0&&<div className="constraint-angle-suggestions" aria-label="图中的角"><div className="constraint-angle-heading"><span>图中的角 <small>{angles.count}</small></span>{pageCount>1&&<span className="constraint-angle-paging"><button type="button" aria-label="上一页角" disabled={currentPage===0} onMouseDown={e=>e.preventDefault()} onClick={()=>setAnglePage(currentPage-1)}>‹</button><small>{currentPage+1}/{pageCount}</small><button type="button" aria-label="下一页角" disabled={currentPage===pageCount-1} onMouseDown={e=>e.preventDefault()} onClick={()=>setAnglePage(currentPage+1)}>›</button></span>}</div><div className="constraint-angle-buttons">{angles.page(currentPage*32).map(angle=><button type="button" key={JSON.stringify(angle)} title={`${angle[1]} 为顶点；点击插入简写`} aria-label={`插入角 ${angle.join(' ')}`} onMouseDown={e=>e.preventDefault()} onClick={()=>insert(`\\angle {${angle.join(' ')}} `)}><FormulaPreview source={`\\angle ${angle.map(symbolLatex).join('')}`}/></button>)}</div></div>}
    <small>回车录入 · 支持边、角的混合等式、分数、根式和 LaTeX。</small>
    <small>{"例：\\angle ABC=60；vec(AB)=2*vec(AC)-vec(AD)；dot(AB,AC)=1/2；ABC~DEF"}</small>
    </div></div>
  </section>;
}
