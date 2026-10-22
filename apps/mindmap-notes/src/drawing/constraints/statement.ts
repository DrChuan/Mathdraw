import type { Condition } from "./types";
import { conditionLabels,normalizeConditionNotation } from "./input";
import { mathPreview,symbolLatex } from "../mathPreview";
import { angleKinds,parseTrigCondition } from "./angles";
import { exactNumber } from "../exactNumber";

export type StatementPart={text:string}|{math:string};
const counts=["零","一","二","三","四","五","六","七","八","九","十","十一","十二"];
export const countName=(n:number)=>counts[n]??String(n);
export function conditionStatement(c:Condition):StatementPart[] {
  const text=(text:string):StatementPart=>({text}),math=(math:string):StatementPart=>({math});
  const normalized=normalizeConditionNotation(c.source,[...new Set(c.refs.flat())]);
  const r=c.refs.map(group=>group.map(symbolLatex).join(""));
  const rhs=()=>{
    const trig=parseTrigCondition(normalized);if(trig)return mathPreview(trig.value);
    const equal=normalized.lastIndexOf("=");
    const source=equal>=0?normalized.slice(equal+1).trim():normalized.slice(normalized.lastIndexOf(",")+1).trim().replace(/\)$/,"");
    const rad=source.match(/^rad\(([\s\S]*)\)$/i);
    return mathPreview(rad?.[1]??(source||exactNumber(c.value??1).source));
  };
  if(c.kind==="distance")return [math(`${r[0]}=${rhs()}`)];
  if(c.kind==="equal")return [math(`${r[0]}=${r[1]}`)];
  if(c.kind==="ratio")return [math(`\\frac{${r[0]}}{${r[1]}}=${rhs()}`)];
  if(c.kind==="parallel"||c.kind==="perpendicular")return [math(`${c.refs[0].length===3?"\\text{平面 }":""}${r[0]}${c.kind==="parallel"?"\\parallel ":"\\perp "}${c.refs[1].length===3?"\\text{平面 }":""}${r[1]}`)];
  if(c.kind==="division")return [math(r[0]),text(Math.abs((c.value??1)-1)<1e-12?" 是线段 ":" 在线段 "),math(r[1]),text(Math.abs((c.value??1)-1)<1e-12?" 的中点":" 上，"),...(Math.abs((c.value??1)-1)<1e-12?[]:[math(`${symbolLatex(c.refs[1][0])}${r[0]}:${r[0]}${symbolLatex(c.refs[1][1])}=${rhs()}:1`)])];
  if(c.kind==="onSegment")return [math(r[0]),text(" 在线段 "),math(r[1]),text(" 上")];
  if(c.kind==="collinear"||c.kind==="coplanar")return [math(c.refs[0].map(symbolLatex).join(",")),text(c.kind==="collinear"?" 三点共线":" 四点共面")];
  if(angleKinds.includes(c.kind)) {
    const trig=parseTrigCondition(normalized),name=c.kind==="dihedral"?`${r[1]}-${r[0]}-${r[2]}`:c.kind==="vertexAngle"?`\\angle ${r.join("")}`:`${r[0]},${r[1]}`;
    const angleParts=c.kind==="linePlaneAngle"?[text("直线 "),math(r[0]),text(" 与平面 "),math(r[1])]:c.kind==="lineAngle"?[text("直线 "),math(r[0]),text(" 与直线 "),math(r[1])]:[text(c.kind==="dihedral"?"二面角 ":"角 "),math(name)];
    if(trig)return [...angleParts,text(` 的${{sin:"正弦",cos:"余弦",tan:"正切"}[trig.mode as "sin"]}值为 `),math(rhs()),...(c.alternateValue!==undefined?[text(c.value===0?"（保留 0°、180° 两种可能）":"（保留锐角、钝角两种可能）")]:[])];
    const rad=/rad\(|\\pi|\bpi\b|π/.test(c.source),value=rhs().replace(/^rad\((.*)\)$/, "$1");
    return [...angleParts,text(c.kind==="lineAngle"||c.kind==="linePlaneAngle"?" 的夹角为 ":" 的大小为 "),math(rad?value:`${value}^{\\circ}`)];
  }
  const p=c.refs[0];
  if(c.kind==="pyramid")return [text(`${countName(p.length-1)}棱锥 `),math(`${symbolLatex(p[0])}-${p.slice(1).map(symbolLatex).join("")}`)];
  if(c.kind==="prism"||c.kind==="frustum")return [text(`${countName(p.length/2)}${c.kind==="prism"?"棱柱":"棱台"} `),math(`${p.slice(0,p.length/2).map(symbolLatex).join("")}-${p.slice(p.length/2).map(symbolLatex).join("")}`)];
  return [text(c.kind==="regularPolygon"?`正${countName(p.length)}边形 `:`${conditionLabels[c.kind]} `),math(r[0])];
}
