import type {DrawingDocument,GeometryObject} from './types';
import {dependencies} from './geometry';
export function objectState(doc:DrawingDocument,o:GeometryObject){
 const setId=o.constraintSet??(o.kind==='point'&&o.construction.type==='constraint'?o.construction.set:undefined),set=doc.objects.find(a=>a.id===setId);
 if(set?.kind==='solutionSet'&&set.problem.planar?.unknowns.some(u=>u.object===o.id))return '待求量';
 if(setId)return '条件管理';
 if(o.kind==='point'&&o.construction.type==='origin')return '坐标基准';
 if(dependencies(o).length)return '关联构造';
 return o.kind==='point'&&o.construction.type==='free'?'自由点':'已知定义';
}
