import { useState } from "react";
import { declarationLabel, defaultDeclaration, maximumSides, shapeNames, roundDeclaration,type DeclarationShape, type ShapeDeclaration as Declaration } from "./constraints/templates";
import { countName } from "./constraints/statement";

export default function ShapeDeclaration({add}:{add:(declaration:Declaration)=>void}) {
  const [draft,setDraft]=useState<Declaration>(()=>defaultDeclaration("prism",4));
  const [base,setBase]=useState(draft.base.join(" ")),[top,setTop]=useState(draft.top.join(" ")),[error,setError]=useState("");
  const reset=(shape:DeclarationShape,sides:number,variant=draft.variant)=>{
    const next={...defaultDeclaration(shape,Math.max(3,Math.min(sides,maximumSides(shape)))),variant:roundDeclaration(shape)||variant==="right"&&shape!=="prism"?"general" as const:variant};
    setDraft(next);setBase(next.base.join(" "));setTop(next.top.join(" "));setError("");
  };
  const confirm=()=>{
    const names=(s:string)=>s.trim().split(/[\s,，;；]+/).filter(Boolean),b=names(base),t=names(top);
    if(b.length!==draft.base.length||!roundDeclaration(draft.shape)&&draft.shape!=="pyramid"&&t.length!==draft.base.length||roundDeclaration(draft.shape)&&t.length!==draft.top.length){setError("请按提示填写每个底面、顶面或特征点的名称，用空格分隔");return;}
    try{setError("");add({...draft,base:b,top:draft.shape==="pyramid"?[]:t});}catch(e){setError((e as Error).message);}
  };
  return <section className={`constraint-shape-declaration${roundDeclaration(draft.shape)?" round":""}`} aria-label="声明几何图形">
    <div className="constraint-shape-heading"><strong>声明图形</strong><small>选择图形并命名顶点</small></div>
    <div className="constraint-shape-options">
      <label>图形<select aria-label="声明图形类型" value={draft.shape} onChange={e=>reset(e.target.value as DeclarationShape,draft.base.length)}>{Object.entries(shapeNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      {!roundDeclaration(draft.shape)&&<><label>底面边数<select aria-label="声明图形棱数" value={draft.base.length} onChange={e=>reset(draft.shape,Number(e.target.value))}>{Array.from({length:maximumSides(draft.shape)-2},(_,i)=><option key={i+3} value={i+3}>{i+3}</option>)}</select></label>
      <label>性质<select aria-label="声明图形附加类型" value={draft.variant} onChange={e=>setDraft({...draft,variant:e.target.value as Declaration["variant"]})}><option value="general">一般</option>{draft.shape==="prism"&&<option value="right">直棱柱</option>}<option value="regular">正{shapeNames[draft.shape]}</option></select></label></>}
    </div>
    {["pyramid","cone"].includes(draft.shape)&&<label className="constraint-name-line"><span>顶点</span><input aria-label="声明顶点名称" spellCheck={false} maxLength={64} value={draft.apex} onChange={e=>setDraft({...draft,apex:e.target.value})}/></label>}
    <label className="constraint-name-line"><span>{roundDeclaration(draft.shape)?draft.shape==="sphere"?"球心、球上一点":"底面圆心、圆上一点":"底面"}</span><input aria-label="声明底面顶点名称" spellCheck={false} value={base} onChange={e=>setBase(e.target.value)}/></label>
    {draft.top.length>0&&<label className="constraint-name-line"><span>{draft.shape==="cylinder"?"顶面圆心":draft.shape==="coneFrustum"?"顶面圆心、圆上一点":"顶面"}</span><input aria-label="声明顶面顶点名称" spellCheck={false} value={top} onChange={e=>setTop(e.target.value)}/></label>}
    <div className="constraint-shape-footer"><small>{roundDeclaration(draft.shape)?shapeNames[draft.shape]:`${draft.variant==="regular"?"正":draft.variant==="right"?"直":""}${countName(draft.base.length)}${shapeNames[draft.shape]}`} · 点名用空格分隔</small><button onClick={()=>reset(draft.shape,draft.base.length)}>重置点名</button><button className="primary" onClick={confirm}>添加图形</button></div>
    {error&&<small role="alert" className="constraint-field-error">{error}</small>}
    <details><summary>命名与附加条件</summary><small>{roundDeclaration(draft.shape)?"使用圆心、轴向点及圆上一点定义尺寸和方向；圆柱、圆锥、圆台为直圆几何体。半径与高度可在条件中指定。":"底面按顺序命名，顶面与底面一一对应；正图形附加正多边形与侧棱条件，直棱柱附加侧棱垂直底面。"}同名点复用。{declarationLabel(draft)}会添加定义点和相应限制。</small></details>
  </section>;
}
