import { useEffect, useState } from "react";
import { paletteColors, mergeColors, readColors, saveColors } from "./colors";
const savedKey="drawing.customPalette";
export function ColorPalette({value,change,used}:{value:string;change:(color:string)=>void;used:string[]}) {
 const [draft,setDraft]=useState(value),[error,setError]=useState("");
 const [saved,setSaved]=useState(()=>readColors(savedKey));
 useEffect(()=>{setDraft(value);setError("");},[value]);
 const color=()=>{const s=draft.startsWith("#")?draft:`#${draft}`;if(/^#[0-9a-f]{6}$/i.test(s)){setError("");return s.toLowerCase();}setError("请输入六位颜色值，如 #3773b4");};
 const apply=()=>{const s=color();if(s)change(s);};
 const add=()=>{const s=color();if(!s)return;change(s);const next=mergeColors(readColors(savedKey),saved,[s]).filter(c=>!paletteColors.some(([p])=>p===c)).slice(-64);setSaved(next);saveColors(savedKey,next);};
 const swatch=(color:string,name:string)=><button type="button" key={color} aria-label={`颜色：${name}`} title={name} aria-pressed={value.toLowerCase()===color} style={{background:color}} onClick={()=>change(color)}/>;
 return <fieldset className="drawing-palette"><legend>颜色</legend><div className="palette-swatches">{paletteColors.map(([c,n])=>swatch(c,n))}{saved.map(c=>swatch(c,`已添加 ${c}`))}</div>
 <div className="palette-custom"><label>自定义<input type="color" aria-label="选择自定义颜色" value={value} onChange={e=>change(e.target.value)}/></label>
 <input aria-label="自定义颜色值" value={draft} maxLength={7} autoCorrect="off" spellCheck={false} onChange={e=>setDraft(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();apply();}if(e.key==="Escape"){setDraft(value);setError("");}}}/></div>
 <button type="button" className="palette-add" onClick={add}>添加到调色板</button>
 {error&&<small role="alert">{error}</small>}
 <div className="palette-used"><span>已使用的颜色</span><div className="palette-swatches">{used.map(c=>swatch(c,`本画布 ${c}`))}</div></div></fieldset>;
}
