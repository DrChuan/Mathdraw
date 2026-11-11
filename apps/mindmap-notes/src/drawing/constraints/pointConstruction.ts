import {entity} from './input';
import type {ConstraintProblem,PlanarUnknown} from './types';
import type {Vec3} from '../types';
import {symbolicPlanarEquations} from './planarSymbolic';
import {objectSymbol} from './planarModel';
import {planarRelationSource} from './planarRelations';
import {splitArguments} from '../model';
import {substituteNames,expressionNames} from '../parameters';
import {conicEquationFamily} from './conicFamily';
import {tangentCandidates} from '../advanced';
import {conicCoefficients,conicVertices} from '../conics';
import {affectedObjects} from '../geometry';
import {nearestLocus} from './loci';
type Variable=PlanarUnknown&{point?:string;axis?:number};
/** Independent point incidences precede their dependent constructions. A
 * tangent at a contact point is a definition, not a numerical double root. */
export function independentPointConstructions(problem:ConstraintProblem,variables:Variable[],compiled:ReturnType<typeof symbolicPlanarEquations>,fixed:Map<number,number>,expressions:Map<number,string>,initial:number[]){
 if(problem.mode!=='coordinate'||!problem.planar||problem.conditions.some(c=>c.enabled))return [];
 const doc=problem.planar.document,groups=new Map<string,{name:string;indices:[number,number]}>();
 for(const [i,u]of variables.entries())if(!fixed.has(i)){
  const object=doc.objects.find(o=>o.id===u.object);if(object?.kind!=='point'||object.construction.type!=='free'||!['x','y'].includes(u.field))return [];
  let group=groups.get(u.object);if(!group){group={name:objectSymbol(object),indices:[-1,-1]};groups.set(u.object,group);}group.indices[u.field==='x'?0:1]=i;
 }
 if(!groups.size||[...groups.values()].some(g=>g.indices.includes(-1)))return [];
 const dynamic=new Set([...groups.keys()].flatMap(id=>[id,...affectedObjects(doc,id)])),names=new Set(doc.objects.filter(o=>dynamic.has(o.id)).map(objectSymbol));
 const references=new Map<string,string>(),handled=new Set<string>();
 for(const row of problem.planar.equations.filter(q=>q.enabled)){
  const m=planarRelationSource(row.source).match(/^on(?:Curve|Line)\s*\(([\s\S]*)\)$/i);if(!m)continue;const args=splitArguments(m[1]);
  if(args.length!==2)continue;const groupNames=entity(args[0],problem.points),reference=args[1].trim();
  for(const name of groupNames){const group=[...groups.values()].find(g=>g.name===name);if(!group)continue;
   if(references.has(group.name)&&references.get(group.name)!==reference)return [];
   references.set(group.name,reference);handled.add(row.id);
  }
 }
 if(problem.planar.equations.some(q=>q.enabled&&!handled.has(q.id)&&expressionNames(q.source).some(n=>names.has(n))))return [];
 const replace=Object.fromEntries([...expressions].map(([i,s])=>[compiled.tokens[i],`(${s})`])),base=[...initial];for(const [i,n]of fixed)base[i]=n;
 const candidates=[base];let index=0;
 for(const group of groups.values()){
  const name=references.get(group.name),target:[number,number,number]=[base[group.indices[0]],base[group.indices[1]],0];let chosen:Vec3=target;
  if(name){
   const original=doc.objects.find(o=>objectSymbol(o)===name);if(original?.kind==='curve'&&(original.limits||original.followView===false))return [];
   const source=substituteNames(compiled.curves[name]??'',replace);if(!source||/\bq_\d+\b/.test(source))return [];
   const conic=conicEquationFamily(source,group.name,doc),q=conicCoefficients(source);if(!q)return [];
   if(conic)chosen=nearestLocus(conic.locus(target),target);
   else if(q.slice(0,3).every(n=>n===0)&&q[3]**2+q[4]**2>0){const k=(q[3]*target[0]+q[4]*target[1]+q[5])/(q[3]**2+q[4]**2);chosen=[target[0]-k*q[3],target[1]-k*q[4],0];}else return [];
  }else{
   const tangents=doc.objects.filter(o=>o.kind==='curve'&&o.derived?.type==='tangent'&&doc.objects.find(p=>p.id===(o.derived?.type==='tangent'?o.derived.point:''))?.symbol===group.name);
   const alternatives:Vec3[]=[target];
   for(const t of tangents)if(t.kind==='curve'&&t.derived?.type==='tangent'){
    const parentId=t.derived.curve,parent=doc.objects.find(o=>o.id===parentId);if(parent?.kind!=='curve')return [];const source=substituteNames(compiled.curves[objectSymbol(parent)]??'',replace);if(!source||/\bq_\d+\b/.test(source))return [];
    const q=conicCoefficients(source);if(!q)return [];const det=4*q[0]*q[2]-q[1]**2,center=Math.abs(det)>1e-12?[(q[1]*q[4]-2*q[2]*q[3])/det,(q[1]*q[3]-2*q[0]*q[4])/det]:[0,0];
    for(const v of conicVertices(source))alternatives.push([center[0]+2*(v[0]-center[0]),center[1]+2*(v[1]-center[1]),0]);
   }
   const valid=(p:Vec3)=>tangents.every(t=>{if(t.kind!=='curve'||t.derived?.type!=='tangent')return true;const c=t.derived,parent=doc.objects.find(o=>o.id===c.curve);if(parent?.kind!=='curve')return false;const equation=substituteNames(compiled.curves[objectSymbol(parent)]??'',replace);try{return tangentCandidates({...parent,parameters:undefined,derived:undefined,equation},[p[0],p[1]],false).length>c.branch;}catch{return false;}});
   const angle=++index*2.399963229728653;chosen=tangents.length?alternatives.find(valid)??target:[Math.cos(angle)*(2+index*.12),Math.sin(angle)*(2+index*.12),0];
  }
  for(const values of candidates){values[group.indices[0]]=chosen[0];values[group.indices[1]]=chosen[1];}
 }
 return candidates;
}
