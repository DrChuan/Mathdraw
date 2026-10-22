import { scalar } from "../expression";
import type { ConstraintKind } from "./types";

export const angleKinds:ConstraintKind[]=["lineAngle","vertexAngle","linePlaneAngle","dihedral"];
export type AngleMode="degrees"|"radians"|"sin"|"cos"|"tan";
export function angleDegrees(source:string):number {
  const rad=source.match(/^rad\(([\s\S]*)\)$/i);
  return scalar(rad?.[1]??source)*(rad||/\\pi|\bpi\b|π/.test(source)?180/Math.PI:1);
}
export function parseTrigCondition(source:string):{inner:string;degrees:number;alternate?:number;mode:string;value:string}|undefined {
  const match=source.match(/^(sin|cos|tan)(Obtuse|Acute)?\s*\(([\s\S]*)\)\s*=\s*([\s\S]+)$/i);
  if(!match)return;
  const mode=match[1].toLowerCase(),range=match[2]?.toLowerCase(),value=scalar(match[4]),body=match[3];
  if(range&&mode!=="sin")throw new Error("只有正弦条件需要选择锐角或钝角分支");
  if((mode==="sin"&&(value<0||value>1))||(mode==="cos"&&Math.abs(value)>1))throw new Error("该三角函数值不在 0～180° 角的有效范围内");
  const acute=(mode==="sin"?Math.asin(value):mode==="cos"?Math.acos(value):Math.atan(value))*180/Math.PI;
  const degrees=mode==="tan"&&acute<0?acute+180:range==="obtuse"?180-acute:acute;
  const alternate=mode==="sin"&&!range&&Math.abs(acute-90)>1e-8?180-acute:mode==="tan"&&value===0?180:undefined;
  return {inner:`${body} = ${degrees}`,degrees,alternate,mode,value:match[4]};
}
export function angleSource(kind:ConstraintKind,refs:string,value:string,mode:AngleMode,range:"both"|"acute"|"obtuse"="both") {
  const call=`${kind}(${refs.replace(/;/g,",")})`;
  return mode==="degrees"?`${call} = ${value}`:mode==="radians"?`${call} = rad(${value})`:
    `${mode}${mode==="sin"&&range!=="both"?(range==="acute"?"Acute":"Obtuse"):""}(${call}) = ${value}`;
}
