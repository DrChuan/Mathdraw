import { useEffect, useRef, useState } from "react";
import { scalar } from "./expression";
import type { DrawingCurve, DrawingLabel } from "./types";
import { defaultAngleRadius } from "./angleMark";
export function AngleMeasurementControls({label,change,error}:{label:DrawingLabel;change:(m:NonNullable<DrawingLabel["measurement"]>)=>void;error:(s:string)=>void}) {
  const m=label.measurement!;
  return <div className="angle-measurement-controls"><h3>角度标记</h3>
    <label>角名<input aria-label="角名" key={`${label.id}:${m.angleName??""}`} defaultValue={m.angleName??"α"} placeholder="α 或 ∠ABC"
      onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}
      onBlur={e=>{const name=e.target.value.trim();if(!name||name.length>100){error("角名需要 1～100 个字符");e.target.value=m.angleName??"α";}else if(name!==(m.angleName??"α"))change({...m,angleName:name});}}/></label>
    <label>角度文字<select aria-label="角度文字显示" value={m.angleDisplay??"both"} onChange={e=>change({...m,angleDisplay:e.target.value as "both"|"name"|"value"})}>
      <option value="both">角名＋大小</option><option value="name">仅角名（隐藏大小）</option><option value="value">仅大小</option>
    </select></label>
    <NumberField label="弧线半径（像素）" value={m.arcRadius??defaultAngleRadius} error={error}
      change={radius=>{if(radius<4||radius>500){error("弧线半径应为 4～500 像素");return;}change({...m,arcRadius:radius});}}/>
  </div>;
}
const limitKeys = ["xMin", "xMax", "yMin", "yMax"] as const;
export function CurveLimits({curve, change, error}: {
  curve: DrawingCurve; change: (limits: DrawingCurve["limits"]) => void; error: (s: string) => void;
}) {
  const [draft, setDraft] = useState(() => Object.fromEntries(limitKeys.map(k => [k, curve.limits?.[k]?.toString() ?? ""])));
  useEffect(() => setDraft(Object.fromEntries(limitKeys.map(k => [k, curve.limits?.[k]?.toString() ?? ""]))), [JSON.stringify(curve.limits)]);
  const apply = () => {
    try {
      const limits = Object.fromEntries(limitKeys.filter(k => draft[k].trim()).map(k => [k, scalar(draft[k])])) as NonNullable<DrawingCurve["limits"]>;
      if ((limits.xMin !== undefined && limits.xMax !== undefined && limits.xMin >= limits.xMax) ||
          (limits.yMin !== undefined && limits.yMax !== undefined && limits.yMin >= limits.yMax)) throw new Error("范围下限必须小于上限");
      change(Object.keys(limits).length ? limits : undefined);
    } catch(e) { error((e as Error).message); }
  };
  return <div className="curve-limits"><h3>曲线取值范围</h3>
    <small>留空表示不限制，遵循自然定义域；范围只限制此曲线。</small>
    {limitKeys.map((k,i) => <label key={k} className="draw-number"><span>{["x 下限", "x 上限", "y 下限", "y 上限"][i]}</span>
      <input aria-label={["曲线 x 下限", "曲线 x 上限", "曲线 y 下限", "曲线 y 上限"][i]} placeholder="不限制" value={draft[k]}
        onChange={e => setDraft({...draft,[k]:e.target.value})} onKeyDown={e => { if(e.key === "Enter" && !e.nativeEvent.isComposing) apply(); }} /></label>)}
    <button onClick={apply}>应用范围</button><button onClick={() => change(undefined)}>恢复自然定义域</button>
  </div>;
}
export function NumberField({
  label,
  value,
  change,
  error,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  error: (s: string) => void;
}) {
  const [text, setText] = useState(String(value)),
    focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setText(String(Number(value.toFixed(6))));
  }, [value]);
  return (
    <label className="draw-number">
      <span>{label}</span>
      <input
        aria-label={label}
        value={text}
        onFocus={() => {
          focus.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focus.current = false;
          try {
            change(scalar(text));
          } catch (e) {
            error((e as Error).message);
            setText(String(value));
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
