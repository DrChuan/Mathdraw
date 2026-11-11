import {entity} from './input';
import {planarRelationSource} from './planarRelations';
import type {ConstraintProblem,PlanarUnknown,SpatialLocus} from './types';
import type {Vec3} from '../types';
import {conicEquationFamily} from './conicFamily';
import {symbolicConicCoefficients} from './conicAlgebra';
import {symbolicPlanarEquations} from './planarSymbolic';
import {conicCoefficients,perpendicularConicTangents} from '../conics';
import {substituteNames,expressionNames} from '../parameters';
import {objectSymbol} from './planarModel';
import {affectedObjects} from '../geometry';
import {nearestLocus} from './loci';
import {splitArguments} from '../model';
type Variable=PlanarUnknown&{point?:string;axis?:number};
/** Eliminate a pair of perpendicular conic tangents by dual quadratic forms.
 * A line through X has L=(u,v,-uX-vY). Restrict Lᵀ adj(Q) L to (u,v).
 * Its two real null directions are perpendicular iff its trace is zero.
 * Contact points and line directions are then reconstructed, not optimized.
 */
export function tangentConicFamily(problem:ConstraintProblem,variables:Variable[],compiled:ReturnType<typeof symbolicPlanarEquations>,fixed:Map<number,number>,expressions:Map<number,string>){
 if(problem.mode!=='coordinate'||!problem.planar)return;
 const doc=problem.planar.document,byName=new Map(doc.objects.map(o=>[objectSymbol(o),o])),rows=[...problem.planar.equations,...problem.conditions].filter(q=>q.enabled);
 const calls=rows.flatMap(q=>{const m=planarRelationSource(q.source).match(/^(tangent|perpendicular|onCurve|onLine)\s*\(([\s\S]*)\)$/i);return m?[{row:q,kind:m[1].toLowerCase(),args:splitArguments(m[2]).map(s=>s.trim())}]:[];});
 const tangencies=calls.filter(c=>c.kind==='tangent'&&c.args.length===2);
 for(const o of doc.objects)if(o.kind==='curve'&&o.derived?.type==='tangent'){const source=o.derived.curve,parent=doc.objects.find(c=>c.id===source);if(parent)tangencies.push({row:{id:`definition:${o.id}`,source:'',enabled:true},kind:'tangent',args:[objectSymbol(o),objectSymbol(parent)]});}
 for(const perpendicular of calls.filter(c=>c.kind==='perpendicular'&&c.args.length===2))try{
  const lines=perpendicular.args.map(name=>byName.get(name));if(lines.some(o=>o?.kind!=='curve'))continue;
  const pair=perpendicular.args.map(name=>tangencies.find(t=>t.args[0]===name));if(!pair[0]||!pair[1]||pair[0].args[1]!==pair[1].args[1])continue;
  const conic=pair[0].args[1],source=compiled.curves[conic];if(!source)continue;
  const replacements=Object.fromEntries([...expressions].map(([i,s])=>[compiled.tokens[i],`(${s})`]));
  const equation=substituteNames(source,replacements);if(/\bq_\d+\b/.test(equation))continue;
  const coefficients=symbolicConicCoefficients(equation,[]),numbers=conicCoefficients(equation);if(!numbers)continue;
  // Accept the native through-point representation, regardless of names/IDs.
  const through=lines.map(o=>{if(o?.kind!=='curve')return;if(o.derived?.type==='tangent'){const anchor=doc.objects.find(p=>p.id===(o.derived?.type==='tangent'?o.derived.point:''));return anchor?.kind==='point'?{index:-1,anchor}:undefined;}const s=(typeof o.parameters?.fields.equation==='string'?o.parameters.fields.equation:o.equation).replace(/\s/g,'');
   const m=s.match(/^cos\(([A-Za-z][A-Za-z0-9_]*)\)\*\(y-y\(([A-Za-z][A-Za-z0-9_]*)\)\)-sin\(\1\)\*\(x-x\(\2\)\)=0$/);if(!m)return;
   const angle=byName.get(m[1]),anchor=byName.get(m[2]),index=variables.findIndex(v=>v.object===angle?.id&&v.field==='value');if(index<0||anchor?.kind!=='point')return;
   const u=variables[index];if(u.min!==undefined&&u.max!==undefined&&u.max-u.min<Math.PI-1e-8)return;
   return {index,anchor};});
  if(!through[0]||!through[1])continue;
  const shared=through[0].anchor.id===through[1].anchor.id?through[0].anchor:undefined;
  const intersection=doc.objects.find(o=>o.kind==='point'&&o.construction.type==='intersection'&&o.construction.branch===0&&lines.every(l=>l&&[o.construction.type==='intersection'?o.construction.first:'',o.construction.type==='intersection'?o.construction.second:''].includes(l.id)));
  const driver=shared??intersection;if(driver&&(driver.kind!=='point'||!problem.points.includes(objectSymbol(driver))))continue;
  // The eliminated intersection is an internal algebraic quantity. Its
  // existence must not depend on the user drawing an extra point.
  const familyPoint=driver?objectSymbol(driver):'__tangent_intersection';
  const consumed=new Set<number>(fixed.keys()),handled=new Set([perpendicular.row.id,pair[0].row.id,pair[1].row.id]);
  const xy=(id:string)=>['x','y'].map(field=>variables.findIndex(v=>v.object===id&&v.field===field));
  const driverIndices=shared?xy(shared.id):[];if(shared&&driverIndices.some(i=>i<0))continue;driverIndices.forEach(i=>consumed.add(i));
  const contacts=through.map(t=>{
   if(t!.index>=0)consumed.add(t!.index);if(shared)return [];
   const name=objectSymbol(t!.anchor),incidence=calls.find(c=>['oncurve','online'].includes(c.kind)&&c.args.length===2&&entity(c.args[0],problem.points).includes(name)&&c.args[1]===conic);if(!incidence)return;
   handled.add(incidence.row.id);const indices=xy(t!.anchor.id);if(indices.some(i=>i<0))return;indices.forEach(i=>consumed.add(i));return indices;
  });
  if(contacts.some(c=>!c)||variables.some((_,i)=>!consumed.has(i)))continue;
  const dynamic=new Set(variables.flatMap((v,i)=>fixed.has(i)?[]:[v.object,...affectedObjects(doc,v.object)])),dynamicNames=new Set(doc.objects.filter(o=>dynamic.has(o.id)).map(objectSymbol));
  if(rows.some(q=>!handled.has(q.id)&&(expressionNames(q.source).some(n=>dynamicNames.has(n))||problem.conditions.find(c=>c.id===q.id)?.refs.flat().some(n=>dynamicNames.has(n)))))continue;
  const [A,B,C,D,E,F]=coefficients,z=`(4*(${A})*(${C})-(${B})^2)`,ux=`(2*(${B})*(${E})-4*(${C})*(${D}))`,vy=`(2*(${B})*(${D})-4*(${A})*(${E}))`;
  const projected=`(${z})*(x^2+y^2)-(${ux})*x-(${vy})*y+4*((${A})+(${C}))*(${F})-(${D})^2-(${E})^2=0`;
  const family=conicEquationFamily(projected,familyPoint,doc);if(!family)continue;
  const [a,b,c,d,e,f]=numbers,det=4*a*c*f+b*d*e-a*e*e-c*d*d-f*b*b;if(Math.abs(det)<1e-14)continue;
  const adj=[4*c*f-e*e,d*e-2*b*f,b*e-2*c*d,4*a*f-d*d,b*d-2*a*e,4*a*c-b*b];
  const lift=(angle:number,index:number,old:number)=>{
   const u=variables[index],lo=u.min??-Infinity,hi=u.max??Infinity;
   const k=Math.max(Math.ceil((lo-angle)/Math.PI),Math.min(Math.floor((hi-angle)/Math.PI),Math.round((old-angle)/Math.PI)));
   return angle+k*Math.PI;
  };
  const reconstruct=(target:Vec3,previous:number[])=>{
   const p=nearestLocus(family.locus(target),target),[x,y]=p;
   const alpha=adj[0]-2*adj[2]*x+adj[5]*x*x,beta=2*(adj[1]-adj[2]*y-adj[4]*x+adj[5]*x*y),gamma=adj[3]-2*adj[4]*y+adj[5]*y*y;
   if(Math.hypot(alpha,beta,gamma)<1e-14)throw Error('该位置的切线对退化');
   const phi=.5*Math.atan2(beta,alpha-gamma),normals=[phi+Math.PI/4,phi-Math.PI/4].map(t=>[Math.cos(t),Math.sin(t)]);
   const candidates=[normals,[normals[1],normals[0]]].map(ns=>{
    const v=[...previous];for(const [i,n]of fixed)v[i]=n;driverIndices.forEach((index,axis)=>v[index]=p[axis]);
    for(const [i,[u,w]]of ns.entries()){
     if(through[i]!.index>=0)v[through[i]!.index]=lift(Math.atan2(-u,w),through[i]!.index,previous[through[i]!.index]);
     if(!shared){const offset=-u*x-w*y,X=adj[0]*u+adj[1]*w+adj[2]*offset,Y=adj[1]*u+adj[3]*w+adj[4]*offset,Z=adj[2]*u+adj[4]*w+adj[5]*offset;if(Math.abs(Z)<1e-14)throw Error('切点在无穷远处');v[contacts[i]![0]]=X/Z;v[contacts[i]![1]]=Y/Z;}
    }
    return v;
   });
   candidates.sort((a,b)=>a.reduce((s,n,i)=>s+(n-previous[i])**2,0)-b.reduce((s,n,i)=>s+(n-previous[i])**2,0));return candidates;
  };
  const intersect=(first:number[],second:number[]):Vec3=>{const [u,v,w]=first,[a,b,c]=second,det=u*b-v*a;if(Math.abs(det)<1e-14)throw Error('切线没有唯一交点');return [(v*c-w*b)/det,(w*a-u*c)/det,0];};
  const line=(s:string)=>conicCoefficients(s)!.slice(3);
  const move=(name:string,target:Vec3,previous:number[])=>{
   if(driver&&name===objectSymbol(driver))return reconstruct(target,previous);
   if(shared)return [];const index=through.findIndex(t=>objectSymbol(t!.anchor)===name);if(index<0)return [];
   const original=conicEquationFamily(equation,name,doc);if(!original)return [];const p=nearestLocus(original.locus(target),target),u=2*a*p[0]+b*p[1]+d,v=b*p[0]+2*c*p[1]+e,w=-u*p[0]-v*p[1];
   return perpendicularConicTangents(equation,[-v,u]).flatMap(s=>reconstruct(intersect([u,v,w],line(s)),previous)).filter(values=>Math.hypot(values[contacts[index]![0]]-p[0],values[contacts[index]![1]]-p[1])<1e-6);
  };
  const parameter=(index:number,value:number,previous:number[])=>{
   if(index<0||!through.some(t=>t!.index===index))return [];
   const n=[-Math.sin(value),Math.cos(value)] as [number,number],m=[-n[1],n[0]] as [number,number];
   return perpendicularConicTangents(equation,n).flatMap(first=>perpendicularConicTangents(equation,m).flatMap(second=>reconstruct(intersect(line(first),line(second)),previous))).filter(v=>Math.abs(Math.sin(v[index]-value))<1e-7).map(v=>{v[index]=value;return v;});
  };
  const point=familyPoint,locus=(p:Vec3):SpatialLocus=>family.locus(p);
  const loci=(positions:Record<string,Vec3>)=>[...(driver?[locus(positions[point])]:[]),...(!shared?through.flatMap(t=>{const name=objectSymbol(t!.anchor),contact=conicEquationFamily(equation,name,doc);return contact&&contact.locus(positions[name]).conic?.closed?[contact.locus(positions[name])]:[];}):[])];
  const initialPoint=(previous:number[]):Vec3|undefined=>{
   if(shared)return [previous[driverIndices[0]],previous[driverIndices[1]],0];
   try{const pair=through.map((t,i)=>{const x=previous[contacts[i]![0]],y=previous[contacts[i]![1]],u=t!.index>=0?-Math.sin(previous[t!.index]):2*a*x+b*y+d,v=t!.index>=0?Math.cos(previous[t!.index]):b*x+2*c*y+e;return [u,v,-u*x-v*y];});return intersect(pair[0],pair[1]);}catch{return;}
  };
  return {...family,point,visiblePoint:!!driver,initialPoint,locus,loci,reconstruct,move,parameter,contacts:through.map(t=>objectSymbol(t!.anchor)),angleIndices:through.map(t=>t!.index),steps:['将同一圆锥曲线的相切关系转成对偶二次型，消去直线方向，以正交条件取方向二次型的迹，得到交点的精确轨迹。','按二次型零方向恢复两条切线，并由对偶映射恢复切点；每次仍验证全部原定义和条件。']};
 }catch{/* An unhandled domain/extra constraint stays in the general solver. */}
}
