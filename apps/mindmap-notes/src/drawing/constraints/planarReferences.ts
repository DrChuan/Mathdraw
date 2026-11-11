import type {GeometryObject,DrawingCurve,DrawingSegment} from '../types';
import {entity} from './input';

/** Shared argument grammar for numeric measurements of named objects or point
 * pairs. Keep validation, numeric evaluation and symbolic lowering in sync. */
export function mapPlanarMetrics(source:string,visit:(kind:string,args:string[],original:string)=>string){
 return source.replace(/\b(length|dot|sinAngle|cosAngle|tanAngle|k|slope)\s*\(([^()]*)\)/gi,(original,kind:string,body:string)=>{
  const args=body.split(',').map(a=>a.trim()),name=kind.toLowerCase()==='k'?'slope':kind.toLowerCase(),count=['length','slope'].includes(name)?1:2;
  if(args.length!==count||args.some(a=>!a))throw Error(`${kind} 参数数量不正确`);
  return visit(name,args,original);
 });
}

/** Resolve syntax once for both symbolic compilation and numeric validation.
 * Objects retain their IDs and constructors; endpoint notation is a reference,
 * not a newly created line or a frozen copy of an existing object. */
export function planarReference(objects:GeometryObject[],source:string):
 | {kind:'curve';object:DrawingCurve}
 | {kind:'straight';object?:DrawingSegment;points:[string,string];extent:'line'|'ray'|'segment'} {
 const name=source.trim(),object=objects.find(o=>(o.symbol??o.name)===name);
 if(object?.kind==='curve')return {kind:'curve',object};
 if(object){
  if(!['line','segment','vector'].includes(object.kind))throw Error(`${name} 不是线或曲线`);
  const line=object as DrawingSegment;
  return {kind:'straight',object:line,points:line.points,extent:line.kind==='line'?(line.ray?'ray':'line'):'segment'};
 }
 const points=objects.filter(o=>o.kind==='point'),names=entity(name,points.map(o=>o.symbol??o.name));
 if(names.length!==2)throw Error(`需要两个端点或命名直线：${source}`);
 const ids=names.map(n=>points.find(o=>(o.symbol??o.name)===n)!.id) as [string,string];
 return {kind:'straight',points:ids,extent:/^(?:Segment|Vector)\s*\(/i.test(name)?'segment':'line'};
}
