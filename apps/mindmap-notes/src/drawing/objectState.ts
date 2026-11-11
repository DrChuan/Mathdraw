import type {DrawingDocument,GeometryObject} from './types';
import {dependencies} from './geometry';
import {isPlanarInput} from './constraints/inputs';
export function objectState(doc:DrawingDocument,o:GeometryObject){
 const setId=o.constraintSet??(o.kind==='point'&&o.construction.type==='constraint'?o.construction.set:undefined),set=doc.objects.find(a=>a.id===setId);
 if(set?.kind==='solutionSet'&&isPlanarInput(set.problem.planar,o.id))return '可变输入';
 if(set?.kind==='solutionSet'&&o.kind==='number'){
  const variable=set.problem.planar?.unknowns.find(u=>u.object===o.id&&u.field==='value'),branch=set.result.branches[set.activeBranch];
  if(variable)return branch?.adjustableValues===undefined?'待求量':branch.adjustableValues.includes(variable.id)?'可调参数':'已限定';
  return dependencies(o).length?'关联计算':'已知条件';
 }
 if(set?.kind==='solutionSet'&&set.problem.planar?.unknowns.some(u=>u.object===o.id))return '待求量';
 if(setId)return '条件管理';
 if(o.kind==='point'&&o.construction.type==='origin')return '坐标基准';
 if(dependencies(o).length)return '关联构造';
 return o.kind==='point'&&o.construction.type==='free'?'自由点':'已知定义';
}
