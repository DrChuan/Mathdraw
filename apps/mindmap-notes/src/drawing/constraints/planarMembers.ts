import type {DrawingDocument,DrawingSolutionSet,DrawingPoint} from '../types';
import {dependencies} from '../geometry';
import {planarContext,contextPoints} from './planarModel';
import {planarEvaluator} from './planar';
/** Effective membership follows source dependencies, never equal coordinates.
 * Build a source-only view until a successful solve is committed. */
const cache=new WeakMap<DrawingDocument,Map<string,DrawingSolutionSet>>();
const plain=(o:DrawingDocument['objects'][number])=>!['solutionSet','spatialLocus'].includes(o.kind);
const rootId=(id:string)=>id.split(':')[0];
export function coordinateOwners(doc:DrawingDocument,point:DrawingPoint){
 const byId=new Map(doc.objects.map(o=>[o.id,o])),seen=new Set<string>(),roots=new Set<string>();
 const visit=(id:string)=>{id=byId.has(id)?id:rootId(id);if(seen.has(id))return;seen.add(id);const o=byId.get(id);if(!o)return;if(o.kind==='solutionSet'){if(o.problem.mode==='coordinate')roots.add(id);return;}for(const parent of dependencies(o))visit(parent);};
 visit(point.id);return doc.objects.filter((o):o is DrawingSolutionSet=>o.kind==='solutionSet'&&roots.has(o.id));
}
export function expandedCoordinateSet(doc:DrawingDocument,set:DrawingSolutionSet):DrawingSolutionSet{
 if(set.problem.mode!=='coordinate'||!set.problem.planar)return set;
 let entries=cache.get(doc);if(!entries){entries=new Map();cache.set(doc,entries);}const cached=entries.get(set.id);if(cached)return cached;
 try{
 const byId=new Map(doc.objects.map(o=>[o.id,o])),ids=new Set([set.id,...set.problem.planar.document.objects.map(o=>o.id),...doc.objects.filter(o=>o.constraintSet===set.id).map(o=>o.id)]);
 const addParents=(id:string)=>{id=byId.has(id)?id:rootId(id);if(ids.has(id))return;const o=byId.get(id);if(!o)return;ids.add(id);if(o.kind==='solutionSet'){if(o.problem.mode!=='coordinate')throw Error('相关对象连接到另一种条件模式，请先在工作区明确合并');for(const member of doc.objects.filter(m=>m.constraintSet===id))addParents(member.id);for(const member of o.problem.planar?.document.objects??[])addParents(member.id);return;}for(const parent of dependencies(o))addParents(parent);};
 let changed=true;while(changed){changed=false;for(const o of doc.objects)if(plain(o)&&!ids.has(o.id)&&dependencies(o).some(id=>ids.has(id)||ids.has(rootId(id)))){const before=ids.size;addParents(o.id);changed||=ids.size!==before;}}
 const added=doc.objects.filter(o=>plain(o)&&ids.has(o.id)&&!set.problem.planar!.document.objects.some(p=>p.id===o.id));
 if(!added.length){entries.set(set.id,set);return set;}
 const scope={...doc,objects:doc.objects.filter(o=>ids.has(o.id))},context=planarContext(scope,true),points=contextPoints(context);
 const problem={...set.problem,points,segments:[] as [string,string][],conditions:context.inheritedConditions??[],curves:context.inheritedCurves??[],planar:context};
 const evaluator=planarEvaluator(problem),initial=Object.fromEntries(context.unknowns.map(u=>[u.id,u.initial]));
 const others=scope.objects.filter((o):o is DrawingSolutionSet=>o.kind==='solutionSet'&&o.id!==set.id);
 const branches=set.result.branches.map(b=>{const values={...initial,...b.values},v=evaluator.encode(b.positions,values),positions=evaluator.model(v).positions;
  return {...b,positions,values,exactCertificate:undefined,dof:b.dof+others.reduce((s,o)=>s+o.result.branches[o.activeBranch].dof,0),motionDof:(b.motionDof??b.dof)+others.reduce((s,o)=>s+(o.result.branches[o.activeBranch].motionDof??o.result.branches[o.activeBranch].dof),0),rigidityPending:true};});
 const expanded={...set,problem,result:{...set.result,branches,exactAnalysis:undefined,complete:false,precision:set.result.precision==='algebraic'?'construction' as const:set.result.precision}};
 entries.set(set.id,expanded);return expanded;
 }catch{/* An invalid downstream construction must not disable its upstream source. */entries.set(set.id,set);return set;}
}
