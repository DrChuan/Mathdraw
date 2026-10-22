import { useEffect, useState } from "react";
import type { DrawingDocument } from "./types";

export const DEFAULT_COLOR = "#161b22";
export const paletteColors = [[DEFAULT_COLOR,"墨黑"],["#287f78","松绿"],["#3773b4","湖蓝"],["#6955a5","鸢紫"],["#b65373","蔷薇"],["#cb7544","陶橙"],["#a58a32","秋金"],["#64748b","岩灰"]];
export function mergeColors(...lists: string[][]): string[] {
  return [...new Set(lists.flat().filter(c => /^#[\da-f]{6}$/i.test(c)).map(c => c.toLowerCase()))];
}
export function readColors(key: string): string[] {
  try { const value:unknown=JSON.parse(localStorage.getItem(key) ?? "[]");return Array.isArray(value)?mergeColors(value.filter((c):c is string=>typeof c==="string")).slice(-128):[]; }
  catch { return []; }
}
export function saveColors(key:string, colors:string[]) {
  try { localStorage.setItem(key,JSON.stringify(colors)); } catch { /* Color preferences must not interrupt drawing. */ }
}
/** History stays with this local drawing ID, including colors later replaced or deleted. */
export function useDrawingColors(doc:DrawingDocument):string[] {
  const key=`drawing.usedColors.${doc.id}`;
  const current=mergeColors(doc.objects.filter(o=>!o.auxiliary).map(o=>o.style.color??DEFAULT_COLOR));
  const [history,setHistory]=useState(()=>({key,colors:readColors(key)}));
  const colors=mergeColors(history.key===key?history.colors:readColors(key),current).slice(-128);
  const signature=JSON.stringify(colors);
  useEffect(()=>{const colors:string[]=JSON.parse(signature);setHistory({key,colors});saveColors(key,colors);},[key,signature]);
  return colors;
}
