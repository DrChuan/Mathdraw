import type { DrawingDocument, DrawingSolutionSet, DrawingSpatialLocus, GeometryObject, Vec3 } from "../types";
import { defaultStyle } from "../types";
import type { ConstraintProblem, ConstraintResult, Pose } from "./types";
import { identityPose } from "./types";
import { validateProblem } from "./input";
import { evaluator, flatten } from "./compile";
import { norm, dot, cross, sub, unit, mul, local, world } from "./math";
import { numericFunctions } from "../symbols";
import { locusPaths } from "./loci";
import { conditionFaces } from "./faces";
import { groupClosedFaces } from "../polyhedra";

export function validPose(p:Pose) {
  return p&&[p.origin,p.x,p.y,p.z].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e9))&&
    [p.x,p.y,p.z].every(v=>Math.abs(norm(v)-1)<1e-6)&&Math.abs(dot(p.x,p.y))<1e-6&&Math.abs(dot(p.x,p.z))<1e-6&&Math.abs(dot(p.y,p.z))<1e-6;
}
export function validateSolutionSet(set:DrawingSolutionSet) {
  validateProblem(set.problem);
  const r=set.result,names=set.problem.points;
  if(set.driver!==undefined&&(typeof set.driver!=="string"||!names.includes(set.driver)))throw new Error("条件作图动点无效");
  if(!validPose(set.placement)||!r||
    r.approximationReason!==undefined&&(typeof r.approximationReason!=="string"||r.approximationReason.length>16384)||!Array.isArray(r.branches)||!r.branches.length||r.branches.length>12||!Number.isInteger(set.activeBranch)||set.activeBranch<0||set.activeBranch>=r.branches.length||
    r.method!==undefined&&!["construction","hybrid","numerical"].includes(r.method)||
    r.constructionSteps!==undefined&&(!Array.isArray(r.constructionSteps)||r.constructionSteps.length>200||r.constructionSteps.some(s=>typeof s!=="string"||s.length>4096))||
    typeof r.complete!=="boolean"||!["solved","notFound","contradiction"].includes(r.status)||!Number.isFinite(r.elapsed)||!Number.isInteger(r.attempts)||
    !Array.isArray(r.diagnostics)||r.diagnostics.length>100||r.diagnostics.some(s=>typeof s!=="string"||s.length>4096))throw new Error("约束解集数据无效");
  const vector=(p:unknown)=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=1e9);
  const check=evaluator(set.problem);
  for(const b of r.branches) {
    if(!b||!b.positions||Object.keys(b.positions).length!==names.length||names.some(n=>!vector(b.positions[n]))||!Number.isInteger(b.dof)||b.dof<0||b.dof>names.length*3||
      !Array.isArray(b.reference)||!b.reference.length||new Set(b.reference).size!==b.reference.length||b.reference.some(n=>!names.includes(n))||!Array.isArray(b.rigid)||b.rigid.length>2500||
      b.rigid.some(g=>!Array.isArray(g)||g.length<2||new Set(g).size!==g.length||g.some(n=>!names.includes(n)))||
      !Number.isFinite(b.residual)||!Array.isArray(b.loci)||b.loci.length>names.length)throw new Error("约束构型无效");
    if(!check.verify(flatten(names,b.positions)).valid)throw new Error("保存的约束构型不满足条件");
    for(const l of b.loci) {
      if(!l||!names.includes(l.point)||!["line","segment","circle","plane","sphere","sampled"].includes(l.kind)||!vector(l.origin)||!vector(l.u)||!vector(l.v)||
        Math.abs(norm(l.u)-1)>1e-5||Math.abs(norm(l.v)-1)>1e-5||Math.abs(dot(l.u,l.v))>1e-5||typeof l.radius!=="number"||!Number.isFinite(l.radius)||l.radius<=0||l.radius>1e9||typeof l.complete!=="boolean"||
        l.paths&&(!Array.isArray(l.paths)||l.paths.length>8||l.paths.some(path=>!Array.isArray(path)||path.length>2000||path.some(p=>!vector(p)))))throw new Error("空间轨迹数据无效");
    }
  }
}
export function selectedBranch(set:DrawingSolutionSet) {return set.result.branches[set.activeBranch];}
export function constraintPoint(set:DrawingSolutionSet,name:string):Vec3 {
  const p=selectedBranch(set)?.positions[name];if(!p)throw new Error("约束点没有对应的可行构型");return world(p,set.placement);
}
export function placeOnPlane(set:DrawingSolutionSet,names:[string,string,string],side:1|-1=1,reference?:string):DrawingSolutionSet {
  const p=selectedBranch(set).positions,[a,b,c]=names.map(n=>p[n]);
  if(!a||!b||!c||norm(sub(b,a))<1e-8||norm(cross(sub(b,a),sub(c,a)))<1e-8)throw new Error("请选择三个不共线的不同点作为 xOy 平面");
  const x=unit(sub(b,a)),z=unit(cross(x,sub(c,a))),y=unit(cross(z,x));
  const above=reference&&p[reference]?reference:Object.keys(p).find(n=>Math.abs(dot(sub(p[n],a),z))>1e-7);
  if(reference&&(!p[reference]||Math.abs(dot(sub(p[reference],a),z))<1e-7))throw new Error("朝向参考点必须在所选平面之外");
  const sign=above?(dot(sub(p[above],a),z)<0?-1:1)*side:side;
  const direction=(v:Vec3):Vec3=>[dot(v,x),dot(v,y),dot(v,z)*sign];
  // The placement maps the canonical solution into the user's chosen work plane.
  return {...set,placement:{origin:mul(direction(a),-1),x:direction([1,0,0]),y:direction([0,1,0]),z:direction([0,0,1])}};
}
export function solutionSetObject(problem:ConstraintProblem,result:ConstraintResult):DrawingSolutionSet {
  if(!result.branches.length)throw new Error("尚无可以放入绘图区的可行构型");
  return {id:crypto.randomUUID(),name:"条件作图解集",kind:"solutionSet",problem:structuredClone(problem),result:structuredClone(result),activeBranch:0,placement:identityPose(),style:defaultStyle()};
}
export function installSolutionSet(doc:DrawingDocument,set:DrawingSolutionSet):DrawingDocument {
  validateSolutionSet(set);
  const previous=doc.objects.find(o=>o.id===set.id),existing=new Map<string,string>();
  for(const o of doc.objects)if(o.kind==="point") {
    if(o.construction.type==="constraint"&&o.construction.set===set.id)existing.set(o.construction.point,o.id);
    else if(o.constraintSet===set.id&&o.constraintPointName)existing.set(o.constraintPointName,o.id);
  }
  const edgeKey=(a:string,b:string)=>[a,b].sort().join("|");
  const desiredEdges=new Set(set.problem.segments.map(([a,b])=>edgeKey(a,b))),nameForId=new Map([...existing].map(([name,id])=>[id,name]));
  const faces=conditionFaces(set.problem,selectedBranch(set).positions),faceKey=(names:string[])=>[...names].sort().join("|"),desiredFaces=new Set(faces.map(faceKey));
  const locusNames=new Set(set.result.branches.flatMap(b=>b.loci.map(l=>l.point)));
  const removed=new Set(doc.objects.filter(o=>
    o.kind==="point"&&((o.construction.type==="constraint"&&o.construction.set===set.id&&!set.problem.points.includes(o.construction.point))||
      o.constraintSet===set.id&&!!o.constraintPointName&&!set.problem.points.includes(o.constraintPointName))||
    o.kind==="spatialLocus"&&o.set===set.id&&!locusNames.has(o.point)||
    o.kind==="segment"&&o.constraintSet===set.id&&!desiredEdges.has(edgeKey(nameForId.get(o.points[0])??"",nameForId.get(o.points[1])??""))||
    o.constraintSet===set.id&&!!o.constraintFace&&!desiredFaces.has(o.constraintFace)
  ).map(o=>o.id));
  for(const o of doc.objects)if(o.kind==="solid"&&o.construction?.type==="faces"&&o.construction.faces.some(id=>removed.has(id)))removed.add(o.id);
  const referencesRemoved=(value:unknown):boolean=>{
    if(typeof value==="string")return [...removed].some(id=>value===id||value.startsWith(`${id}:`));
    if(value&&typeof value==="object")return Object.values(value).some(referencesRemoved);
    return false;
  };
  const outside=doc.objects.filter(o=>o.id!==set.id&&!removed.has(o.id)&&!(o.kind==="point"&&o.construction.type==="constraint"&&o.construction.set===set.id)&&
    !(o.kind==="spatialLocus"&&o.set===set.id)&&o.constraintSet!==set.id);
  const affected=outside.filter(referencesRemoved);
  if(affected.length)throw new Error(`不能删除仍被外部对象引用的点或线段：${affected.map(o=>o.symbol??o.name).join("、")}。请先修改这些对象的引用。`);
  let objects:GeometryObject[]=[...doc.objects.filter(o=>o.id!==set.id&&!removed.has(o.id)),set];
  const branch=selectedBranch(set);
  for(const name of set.problem.points) {
    const old=objects.find(o=>o.id===existing.get(name)),fixed=branch.dof===0||branch.reference.includes(name);
    const construction=fixed?{type:"free" as const,position:constraintPoint(set,name)}:{type:"constraint" as const,set:set.id,point:name};
    if(old?.kind==="point") {
      objects=objects.map(o=>o.id===old.id?{...old,construction,constraintSet:set.id,constraintPointName:name,
        ...(old.construction.type==="constraint"&&!old.constraintPointName?{dot:"auto" as const}:{}),parameters:undefined}:o);
    } else {
      const id=crypto.randomUUID();existing.set(name,id);
      let symbol=name,index=1;while(objects.some(o=>o.symbol===symbol)||numericFunctions.has(symbol.toLowerCase())||["x","y","z","u","v"].includes(symbol.toLowerCase()))symbol=`${name}_${index++}`;
      objects.push({id,name,symbol,kind:"point",construction,constraintSet:set.id,constraintPointName:name,style:defaultStyle(),showName:true,dot:"auto",coordinates:"none",labelOffset:[9,-10]});
    }
  }
  for(const [a,b] of set.problem.segments)if(!objects.some(o=>o.kind==="segment"&&o.constraintSet===set.id&&edgeKey(o.points[0],o.points[1])===edgeKey(existing.get(a)!,existing.get(b)!)))
    objects.push({id:crypto.randomUUID(),name:`${a}${b}`,kind:"segment",constraintSet:set.id,points:[existing.get(a)!,existing.get(b)!],style:defaultStyle()});
  const edgeStyles={...doc.edgeStyles};for(const key of Object.keys(edgeStyles))if(removed.has(key.split(":")[0]))delete edgeStyles[key];
  for(const face of faces) {
    const key=faceKey(face),old=objects.find(o=>o.constraintSet===set.id&&o.constraintFace===key);
    if(old)continue;
    const id=crypto.randomUUID();
    objects.push({id,name:`面 ${face.join("")}`,kind:"polygon",constraintSet:set.id,constraintFace:key,points:face.map(n=>existing.get(n)!),style:defaultStyle()});
    // The declared ordinary segments own their strokes and colors. Faces add
    // selectable surfaces, never a second black stroke over those segments.
    face.forEach((_,i)=>{edgeStyles[`${id}:e:${i}`]="hidden";});
  }
  for(const name of locusNames)if(!objects.some(o=>o.kind==="spatialLocus"&&o.set===set.id&&o.point===name)) {
    const locus:DrawingSpatialLocus={id:crypto.randomUUID(),name:`${name} 的空间轨迹`,kind:"spatialLocus",set:set.id,point:name,style:{...defaultStyle(),color:"#5475a6",line:"dashed"}};objects.push(locus);
  }
  const empty=!previous&&doc.objects.every(o=>o.kind === "number"||o.kind === "point"&&o.construction.type === "origin");
  return groupClosedFaces({...doc,schemaVersion:3,dimension:"3d",objects,edgeStyles,view:{...doc.view,mode:"space",angle:empty?-22:doc.view.angle}});
}
export function localTarget(set:DrawingSolutionSet,p:Vec3) {return local(p,set.placement);}
/** Finite bounds for fitting the complete displayed locus, not just its driver. */
export function constraintLocusPoints(doc:DrawingDocument):Vec3[] {
  const objects=new Map(doc.objects.map(o=>[o.id,o])),points:Vec3[]=[];
  for(const obj of doc.objects)if(obj.kind === "spatialLocus"&&!obj.hidden&&obj.style.line!=="hidden"&&doc.edgeStyles[obj.id]!=="hidden") {
    const set=objects.get(obj.set);if(set?.kind!=="solutionSet"||set.hidden)continue;
    const locus=selectedBranch(set)?.loci.find(l=>l.point===obj.point);if(!locus)continue;
    const ps=["line","plane"].includes(locus.kind)?[locus.origin]:locusPaths(locus).flat();
    points.push(...ps.map(p=>world(p,set.placement)));
  }
  return points;
}
export function constraintHidden(objects:Map<string,GeometryObject>,obj:GeometryObject|undefined):boolean {
  if(!obj)return false;
  if(obj.body&&objects.get(obj.body)?.hidden)return true;
  const id=obj.kind==="point"&&obj.construction.type==="constraint"?obj.construction.set:obj.kind==="spatialLocus"?obj.set:obj.constraintSet;
  return !!id&&!!objects.get(id)?.hidden;
}
export function solutionMesh(set:DrawingSolutionSet) {
  const names=set.problem.points,vertices=names.map(n=>constraintPoint(set,n)),faces:[number,number,number][]=[];
  for(const polygon of conditionFaces(set.problem,selectedBranch(set).positions))for(let i=1;i<polygon.length-1;i++)
    faces.push([names.indexOf(polygon[0]),names.indexOf(polygon[i]),names.indexOf(polygon[i+1])]);
  return {id:set.id,vertices,faces,edges:[] as [number,number][],round:false};
}

/** Reverse xOy winding about the local xOz mirror plane, preserving height.
 * Reflect output directions rather than a single input basis vector: placement
 * may already rotate the canonical solution onto a user-selected plane.
 */
export function mirrorSolutionSet(set:DrawingSolutionSet,yDirection:Vec3=[0,1,0]):DrawingSolutionSet {
  const normal=unit(yDirection),reflect=(v:Vec3)=>sub(v,mul(normal,2*dot(v,normal)));
  return {...set,placement:{...set.placement,x:reflect(set.placement.x),y:reflect(set.placement.y),z:reflect(set.placement.z)}};
}
