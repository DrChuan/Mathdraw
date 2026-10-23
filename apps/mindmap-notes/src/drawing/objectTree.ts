import type {DrawingDocument,GeometryObject} from './types';
import {dependencies} from './geometry';
export interface ObjectTreeNode {id:string;label?:string;object?:GeometryObject;children:ObjectTreeNode[]}
const categories=['点','线','面','轨迹','其他'] as const;
function category(o:GeometryObject):string {
  return o.kind==='point'?'点':o.kind==='spatialLocus'||o.kind==='curve'&&o.derived?.type==='locus'?'轨迹':
    ['line','segment','vector','curve'].includes(o.kind)?'线':['triangle','polygon','solid'].includes(o.kind)?'面':'其他';
}
/** The hierarchy is a view. Ownership never changes definitions or visibility. */
export function objectTree(doc:DrawingDocument,shown:GeometryObject[]):ObjectTreeNode[] {
  const map=new Map(doc.objects.map(o=>[o.id,o])),memo=new Map<string,string|undefined>(),visiting=new Set<string>();
  const owner=(id:string):string|undefined=>{
    id=id.split(':')[0];if(memo.has(id))return memo.get(id);if(visiting.has(id))return;
    const o=map.get(id);if(!o)return;
    const explicit=o.kind==='solutionSet'?o.id:o.kind==='spatialLocus'?o.set:o.constraintSet??(o.kind==='point'&&o.construction.type==='constraint'?o.construction.set:undefined);
    if(explicit){memo.set(id,explicit);return explicit;}
    visiting.add(id);const parents=new Set(dependencies(o).map(owner).filter((x):x is string=>!!x));visiting.delete(id);
    const result=parents.size===1?[...parents][0]:undefined;memo.set(id,result);return result;
  };
  const sets=new Map<string,ObjectTreeNode>(),roots:ObjectTreeNode[]=[];
  const setNode=(id:string)=>{
    if(sets.has(id))return sets.get(id)!;const object=map.get(id);if(object?.kind!=='solutionSet')return;
    const node:ObjectTreeNode={id,object,children:categories.map(label=>({id:`${id}/${label}`,label,children:[]}))};sets.set(id,node);return node;
  };
  for(const object of shown){const id=owner(object.id);if(id)setNode(id);}
  const emitted=new Set<string>();
  for(const object of shown) {
    const set=sets.get(owner(object.id)??'');
    if(set){if(!emitted.has(set.id)){roots.push(set);emitted.add(set.id);}if(object.id!==set.id)set.children.find(n=>n.label===category(object))!.children.push({id:object.id,object,children:[]});}
    else roots.push({id:object.id,object,children:[]});
  }
  return roots;
}
