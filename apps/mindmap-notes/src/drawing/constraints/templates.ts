import type { Condition, ConstraintProblem } from "./types";
import { parseCondition, parseConditions, pointNames, segmentsFrom, validateProblem } from "./input";

export type DeclarationShape="prism"|"pyramid"|"frustum";
export type DeclarationVariant="general"|"right"|"regular";
export interface ShapeDeclaration {
  shape:DeclarationShape;
  variant:DeclarationVariant;
  base:string[];
  top:string[];
  apex:string;
}
export const shapeNames:Record<DeclarationShape,string>={prism:"棱柱",pyramid:"棱锥",frustum:"棱台"};
export const maximumSides=(shape:DeclarationShape)=>shape==="pyramid"?49:25;
export function defaultDeclaration(shape:DeclarationShape,sides:number):ShapeDeclaration {
  if(!Number.isInteger(sides)||sides<3||sides>maximumSides(shape))throw new Error("棱数超出当前 50 个点的限制");
  const alphabet=[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter(n=>shape!=="pyramid"||n!=="P");
  const base=Array.from({length:sides},(_,i)=>`${alphabet[i%alphabet.length]}${i<alphabet.length?"":`_${Math.floor(i/alphabet.length)+1}`}`);
  return {shape,variant:"general",base,top:shape==="pyramid"?[]:base.map(n=>`${n}_1`),apex:"P"};
}
export function declarationLabel(d:ShapeDeclaration) {
  return `${d.variant==="regular"?"正":d.variant==="right"?"直":""}${d.base.length}${shapeNames[d.shape]}`;
}
export function declarationProblem(d:ShapeDeclaration):ConstraintProblem {
  const n=d.base.length;
  if(!["prism","pyramid","frustum"].includes(d.shape)||!["general","right","regular"].includes(d.variant)||d.variant==="right"&&d.shape!=="prism"||n<3||n>maximumSides(d.shape)||d.shape!=="pyramid"&&d.top.length!==n)throw new Error("图形类型、棱数或顶点数量不正确");
  const points=[...d.base,...(d.shape==="pyramid"?[d.apex]:d.top)];
  // Validate individual fields before joining: one input is exactly one point.
  if(points.some(p=>!p||p!==p.trim()||!/^[A-Za-z][A-Za-z0-9_]*$/.test(p)))throw new Error("每个点名须以字母开头，只能包含字母、数字和下标");
  if(new Set(points).size!==points.length)throw new Error("同一图形的各个顶点不能同名");
  pointNames(points.join(" "));
  const segments:[string,string][]=[];
  for(let i=0;i<n;i++) {
    segments.push([d.base[i],d.base[(i+1)%n]]);
    if(d.shape==="pyramid")segments.push([d.apex,d.base[i]]);
    else segments.push([d.top[i],d.top[(i+1)%n]],[d.base[i],d.top[i]]);
  }
  const order=d.shape==="pyramid"?[d.apex,...d.base]:[...d.base,...d.top];
  const sources=[`${d.shape}(${order.join(", ")})`];
  if(d.variant==="regular")sources.push(`regularPolygon(${d.base.join(", ")})`);
  if(d.shape==="prism"&&d.variant!=="general")sources.push(`perpendicular(${d.base[0]} ${d.top[0]}, ${d.base.slice(0,3).join(" ")})`);
  if(d.variant==="regular"&&d.shape!=="prism") {
    const end=(i:number)=>d.shape==="pyramid"?d.apex:d.top[i];
    for(let i=1;i<n;i++)sources.push(`equal(${d.base[0]} ${end(0)}, ${d.base[i]} ${end(i)})`);
  }
  const problem={points,segments,conditions:sources.map(s=>parseCondition(s,points))};validateProblem(problem);return problem;
}
/** Prepare the full declaration before touching UI state, including draft validation. */
export function appendDeclaration(pointSource:string,segmentSource:string,conditions:Condition[],drafts:Record<string,string>,d:ShapeDeclaration):ConstraintProblem {
  const added=declarationProblem(d),existing=pointSource.trim()?pointNames(pointSource):[],points=[...new Set([...existing,...added.points])];
  pointNames(points.join(" "));
  const segments=segmentsFrom(segmentSource,points),edges=new Set(segments.map(e=>JSON.stringify([...e].sort())));
  for(const edge of added.segments){const key=JSON.stringify([...edge].sort());if(!edges.has(key)){segments.push(edge);edges.add(key);}}
  const list=conditions.flatMap(c=>parseConditions(drafts[c.id]??c.source,points,c.id).map(p=>({...p,enabled:c.enabled})));
  const signature=(c:Condition)=>JSON.stringify([c.kind,c.refs,c.value]),enabled=new Set(list.filter(c=>c.enabled).map(signature));
  for(const condition of added.conditions){const key=signature(condition);if(!enabled.has(key)){list.push(condition);enabled.add(key);}}
  const result={points,segments,conditions:list};validateProblem(result);return result;
}
