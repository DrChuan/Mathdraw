import { invoke } from "@tauri-apps/api/core";
import type { ConstraintCurve,ConstraintMode,PlanarContext } from "./types";
import { pointNames,validateCurves } from "./input";
import { validateDrawing } from '../geometry';
import {validateRecognition} from '../recognition/model';
import type {RecognizedQuestion} from '../recognition/types';
export interface ConstraintConfiguration {
  format:"mathdraw-conditions";version:1|2;points:string;segments:string;
  mode?:ConstraintMode;planar?:PlanarContext;
  curves?:ConstraintCurve[];
  conditions:{id?:string;source:string;enabled:boolean}[];
  recognition?:RecognizedQuestion;
  placement:{planeNames:string[];side:1|-1;orientationPoint:string;keepPlacement:boolean;mirrored:boolean;driver?:string;targetPlane?:string};
}
export function decodeConfiguration(content:string):ConstraintConfiguration {
  if(new TextEncoder().encode(content).length>8*1024*1024)throw new Error("条件配置不能超过 8 MB");
  const c=JSON.parse(content) as ConstraintConfiguration,p=c?.placement;
  if(c?.recognition)validateRecognition(c.recognition);
  const string=(v:unknown,max:number)=>typeof v==="string"&&v.length<=max;
  if(c?.format!=="mathdraw-conditions"||![1,2].includes(c.version)||c.version===2&&!['spatial','plane','coordinate'].includes(c.mode??''))throw new Error("不是受支持的条件作图配置文件");
  if(c.version===1&&c.mode&&c.mode!=='spatial')throw new Error('旧版条件配置仅支持原立体语义');
  if(!string(c.points,4096)||!string(c.segments,16384)||!Array.isArray(c.conditions)||c.conditions.length>200||
    c.conditions.some(v=>!v||!string(v.source,2048)||typeof v.enabled!=="boolean"||v.id!==undefined&&!string(v.id,256))||!p||
    !Array.isArray(p.planeNames)||p.planeNames.length>3||p.planeNames.some(n=>!string(n,64))||![1,-1].includes(p.side)||
    !string(p.orientationPoint,64)||typeof p.keepPlacement!=="boolean"||typeof p.mirrored!=="boolean"||
    p.driver!==undefined&&!string(p.driver,64)||p.targetPlane!==undefined&&!string(p.targetPlane,256))throw new Error("条件配置内容或格式无效");
  if(c.curves!==undefined) {
    if(!Array.isArray(c.curves))throw new Error("曲线列表格式无效");
    validateCurves(c.curves,c.curves.length?pointNames(c.points):[],c.mode==='plane'||c.mode==='coordinate');
  }
  if(c.mode==='coordinate'&&!c.planar)throw new Error('缺少有坐标模式的对象定义');
  if(c.planar){validateDrawing(c.planar.document);if(!Array.isArray(c.planar.unknowns)||!Array.isArray(c.planar.equations))throw new Error('二维条件配置无效');}
  return c;
}
export const configurationFiles={
  open:()=>invoke<{path:string;content:string}|null>("drawing_conditions_open"),
  save:(configuration:ConstraintConfiguration)=>invoke<string|null>("drawing_conditions_save",{content:JSON.stringify(configuration,null,2)}),
};
