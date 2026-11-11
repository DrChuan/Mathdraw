import type {GeometryObject,Vec3} from '../types';
import type {ConstraintProblem,PlanarContext,SolutionBranch} from './types';
import {unknownFields,unknownValue,setUnknown,coordinatePlane} from './planarModel';
import {fromPlane,toPlane,coordinateAxis,dot,sub} from '../geometry';
import {pointOnPath} from '../interaction';

export type PlanarRole='fixed'|'input'|'unknown';
export function inputFields(o:GeometryObject):string[]{
 if(o.locked||o.parameters&&Object.keys(o.parameters.references).length)return [];
 const fields=unknownFields(o);if(fields.length)return fields;
 if(o.kind==='point'&&['onPath','onAxis'].includes(o.construction.type))return ['construction.parameter'];
 return [];
}
export function isPlanarInput(context:PlanarContext|undefined,id:string,field?:string){return !!context?.inputs?.some(i=>i.object===id&&(!field||i.fields.includes(field)));}
export function planarRole(context:PlanarContext,id:string,field:string):PlanarRole{return context.unknowns.some(u=>u.object===id&&u.field===field)?'unknown':isPlanarInput(context,id,field)?'input':'fixed';}
export function coordinateInputPoints(problem:ConstraintProblem){
 if(problem.mode!=='coordinate'||!problem.planar)return [];
 return problem.planar.document.objects.filter(o=>o.kind==='point'&&inputFields(o).some(f=>isPlanarInput(problem.planar,o.id,f))).map(o=>o.symbol??o.name).filter(n=>problem.points.includes(n));
}
export function coordinateDriverChoices(problem:ConstraintProblem,branch:SolutionBranch){
 const inputs=new Set(coordinateInputPoints(problem));
 return problem.points.filter(n=>inputs.has(n)||(branch.motionDof??branch.dof)>0&&!branch.reference.includes(n));
}
export function setPlanarPointInput(context:PlanarContext,id:string){
 const o=context.document.objects.find(o=>o.id===id);if(o?.kind!=='point')throw Error('请选择点');
 const fields=inputFields(o);if(!fields.length)throw Error('这个点由来源构造决定，请调整来源点或参数');
 let next=context;for(const f of fields)next=setPlanarRole(next,id,f,'input');return next;
}
export function validatePlanarInputs(context:PlanarContext){
 if(context.inputs===undefined)return;
 if(!Array.isArray(context.inputs)||context.inputs.length>context.document.objects.length)throw Error('可变输入配置无效');
 const seen=new Set<string>();for(const i of context.inputs){const o=context.document.objects.find(o=>o.id===i?.object);if(!o||seen.has(i.object)||!Array.isArray(i.fields)||!i.fields.length||new Set(i.fields).size!==i.fields.length||i.fields.some(f=>!inputFields(o).includes(f)||context.unknowns.some(u=>u.object===i.object&&u.field===f)))throw Error('可变输入不能与待求量或关联定义重叠');seen.add(i.object);}
}
export function setPlanarRole(context:PlanarContext,id:string,field:string,role:PlanarRole,currentValue?:number){
 const o=context.document.objects.find(o=>o.id===id);if(!o)throw Error('对象不存在');
 if(role==='unknown'&&!unknownFields(o).includes(field)||role==='input'&&!inputFields(o).includes(field))throw Error('关联定义不能直接改为独立输入，请修改来源对象');
 const next=structuredClone(context);next.unknowns=next.unknowns.filter(u=>u.object!==id||u.field!==field);
 const former=context.unknowns.find(u=>u.object===id&&u.field===field);
 if(former&&role!=='unknown')setUnknown(next.document,former,Number.isFinite(currentValue)?currentValue!:former.initial);
 next.inputs=(next.inputs??[]).map(i=>i.object===id?{...i,fields:i.fields.filter(f=>f!==field)}:i).filter(i=>i.fields.length);
 if(role==='unknown')next.unknowns.push({id:`${id}.${field}`,object:id,field,initial:unknownValue(context.document,o,field)});
 if(role==='input'){const row=next.inputs.find(i=>i.object===id);if(row)row.fields.push(field);else next.inputs.push({object:id,fields:[field]});}
 return next;
}
/** Edit only the declared input in source definitions. Never edit result
 * positions or promote it to a solver unknown. Caller validates a new solution
 * before atomically installing this problem and its result together. */
export function updatePlanarInput(problem:ConstraintProblem,id:string,change:{field:string;value:number}|{target:Vec3}){
 if(problem.mode!=='coordinate'||!problem.planar)throw Error('仅有坐标条件图形支持可变输入');
 const next=structuredClone(problem),context=next.planar!,o=context.document.objects.find(o=>o.id===id);
 if(!o||o.locked)throw Error('对象已锁定或不存在');
 const fields=inputFields(o).filter(f=>isPlanarInput(context,id,f));if(!fields.length)throw Error('该对象不是可变输入');
 if('value'in change){
  if(!fields.includes(change.field)||!Number.isFinite(change.value)||Math.abs(change.value)>1e9)throw Error('输入值无效');
  if(o.kind==='number'&&change.field==='value'){o.value=change.value;o.expression=String(change.value);o.references={};}
  else if(o.kind==='curve'){const [parent,key]=change.field.split('.');(o as unknown as Record<string,Record<string,number>>)[parent][key]=change.value;}
  else throw Error('请通过拖动改变该点');
 }else {
  if(o.kind!=='point'||change.target.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9))throw Error('点位置无效');
  const c=o.construction;
  if(c.type==='free'){
   const plane=coordinatePlane(context.document),old=toPlane(plane,c.position),target=toPlane(plane,change.target);
   o.construction={type:'free',position:fromPlane(plane,fields.includes('x')?target[0]:old[0],fields.includes('y')?target[1]:old[1])};
  }else if(c.type==='onPath')o.construction=pointOnPath(context.document,c.path,change.target,c.parameter);
  else if(c.type==='onAxis'){const axis=coordinateAxis(context.document,c.axis,c.planeId);o.construction={...c,parameter:dot(sub(change.target,axis.origin),axis.direction)};}
  else throw Error('请调整这个点的来源');
 }
 return next;
}
