import { invoke } from "@tauri-apps/api/core";
export interface ConstraintConfiguration {
  format:"mathdraw-conditions";version:1;points:string;segments:string;
  conditions:{source:string;enabled:boolean}[];
  placement:{planeNames:string[];side:1|-1;orientationPoint:string;keepPlacement:boolean;mirrored:boolean;driver?:string;targetPlane?:string};
}
export function decodeConfiguration(content:string):ConstraintConfiguration {
  if(content.length>1024*1024)throw new Error("条件配置不能超过 1 MB");
  const c=JSON.parse(content) as ConstraintConfiguration,p=c?.placement;
  const string=(v:unknown,max:number)=>typeof v==="string"&&v.length<=max;
  if(c?.format!=="mathdraw-conditions"||c.version!==1)throw new Error("不是受支持的条件作图配置文件");
  if(!string(c.points,4096)||!string(c.segments,16384)||!Array.isArray(c.conditions)||c.conditions.length>200||
    c.conditions.some(v=>!v||!string(v.source,2048)||typeof v.enabled!=="boolean")||!p||
    !Array.isArray(p.planeNames)||p.planeNames.length>3||p.planeNames.some(n=>!string(n,64))||![1,-1].includes(p.side)||
    !string(p.orientationPoint,64)||typeof p.keepPlacement!=="boolean"||typeof p.mirrored!=="boolean"||
    p.driver!==undefined&&!string(p.driver,64)||p.targetPlane!==undefined&&!string(p.targetPlane,256))throw new Error("条件配置内容或格式无效");
  return c;
}
export const configurationFiles={
  open:()=>invoke<{path:string;content:string}|null>("drawing_conditions_open"),
  save:(configuration:ConstraintConfiguration)=>invoke<string|null>("drawing_conditions_save",{content:JSON.stringify(configuration,null,2)}),
};
