import type { DrawingDocument, DrawingSolutionSet, DrawingSpatialLocus, DrawingPoint,GeometryObject, Vec3 } from "../types";
import { defaultStyle } from "../types";
import type { ConstraintProblem, ConstraintResult, Pose } from "./types";
import { identityPose } from "./types";
import { validateProblem } from "./input";
import { evaluator, flatten } from "./compile";
import { norm, dot, cross, sub, unit, mul, local, world } from "./math";
import { numericFunctions } from "../symbols";
import { locusPaths, displayableLocus } from "./loci";
import { conditionFaces,templateFaces } from "./faces";
import { groupClosedFaces } from "../polyhedra";
import { polygonGeometry } from "../constructions";
import { curveGeometry } from "./measures";
import { resolveGeometry } from "../geometry";
import { planarMode,installPlanarSolution } from './planarModel';
import { planarEvaluator } from './planar';
import {validateRoot} from './exactArithmetic';
import {validateExactCertificate,validateRootExpression,solveExactSystem} from './exactSystem';
import {symbolicSpatialEquations} from './spatialExact';
import {symbolicPlanarEquations} from './planarSymbolic';

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
    r.precision!==undefined&&!['construction','algebraic','approximate'].includes(r.precision)||
    r.method!==undefined&&!["construction","hybrid","numerical"].includes(r.method)||
    r.constructionSteps!==undefined&&(!Array.isArray(r.constructionSteps)||r.constructionSteps.length>200||r.constructionSteps.some(s=>typeof s!=="string"||s.length>4096))||
    typeof r.complete!=="boolean"||!["solved","notFound","contradiction"].includes(r.status)||!Number.isFinite(r.elapsed)||!Number.isInteger(r.attempts)||
    !Array.isArray(r.diagnostics)||r.diagnostics.length>100||r.diagnostics.some(s=>typeof s!=="string"||s.length>4096))throw new Error("约束解集数据无效");
  const vector=(p:unknown)=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=1e9);
  const check=evaluator(set.problem),planar=planarMode(set.problem)?planarEvaluator(set.problem):undefined;
  if(r.precision==='algebraic'&&r.branches.some(b=>!b.exactCertificate&&!Object.keys(b.exactValues??{}).length))throw Error('代数精度声明缺少精确信息');
  if(r.exactAnalysis){const a=r.exactAnalysis;if(!['finite','family','unresolved'].includes(a.state)||typeof a.certified!=='boolean'||!Number.isInteger(a.totalSolutions)||a.totalSolutions<0||a.totalSolutions>256||!Number.isInteger(a.reducedVariables)||a.reducedVariables<0||a.solutions!==undefined&&(!Array.isArray(a.solutions)||a.solutions.length!==a.totalSolutions))throw Error('精确求解状态数据无效');}
  if(r.exactAnalysis?.certified){
    const symbolic=planar?symbolicPlanarEquations(set.problem,planar.variables):symbolicSpatialEquations(set.problem),verified=solveExactSystem(symbolic.sources,symbolic.tokens,{deadline:Date.now()+1500});
    if(!symbolic.complete||!verified.complete||verified.kind!=='finite'||r.exactAnalysis.state!=='finite'||r.exactAnalysis.totalSolutions!==verified.candidates.length||r.complete&&r.branches.length!==verified.candidates.length)throw Error('解集完整性证据无效或无法在预算内验证');
  }
  for(const b of r.branches) {
    if(!b||!b.positions||Object.keys(b.positions).length!==names.length||names.some(n=>!vector(b.positions[n]))||!Number.isInteger(b.dof)||b.dof<0||b.dof>(planar?.variables.length??names.length*3)||
      !Array.isArray(b.reference)||!planar&&!b.reference.length||new Set(b.reference).size!==b.reference.length||b.reference.some(n=>!names.includes(n))||!Array.isArray(b.rigid)||b.rigid.length>2500||
      b.rigid.some(g=>!Array.isArray(g)||g.length<2||new Set(g).size!==g.length||g.some(n=>!names.includes(n)))||
      !Number.isFinite(b.residual)||!Array.isArray(b.loci)||b.loci.length>names.length)throw new Error("约束构型无效");
    if(b.mobility&&(![1,2].includes(b.mobility.version)||!Number.isInteger(b.mobility.linear)||b.mobility.linear<0||b.mobility.linear>names.length*3||!Number.isInteger(b.mobility.removed)||b.mobility.removed<0||b.mobility.removed>b.mobility.linear||typeof b.mobility.checked!=='boolean')||b.motionDof!==undefined&&(!Number.isInteger(b.motionDof)||b.motionDof<0||b.motionDof>(planar?.variables.length??names.length*3)))throw Error('局部自由度分析数据无效');
    if(planar){
      const values=planar.encode(b.positions,b.values),calculated=planar.model(values).positions;
      if(names.some(n=>Math.abs(b.positions[n][2])>1e-9||norm(sub(b.positions[n],calculated[n]))>1e-6*Math.max(1,planar.scale))||planar.errors(values).length||b.motionDof!==undefined&&(!Number.isInteger(b.motionDof)||b.motionDof<0)||b.values&&Object.values(b.values).some(v=>!Number.isFinite(v)))throw new Error('保存的二维构型不满足条件');
    }else if(!check.verify(flatten(names,b.positions)).valid)throw new Error("保存的约束构型不满足条件");
    if(b.exactValues){
      if(typeof b.exactValues!=='object'||Array.isArray(b.exactValues)||Object.keys(b.exactValues).length>(planar?.variables.length??names.length*3))throw Error('精确数值记录无效');
      for(const [id,root]of Object.entries(b.exactValues)){
        validateRoot(root);validateRootExpression(root as Parameters<typeof validateRootExpression>[0]);const value=planar?planar.encode(b.positions,b.values)[planar.variables.findIndex(v=>v.id===id)]:b.values?.[id];
        if(value===undefined||!Number.isFinite(value)||Math.abs(root.approximate-value)>1e-11*Math.max(1,Math.abs(value)))throw Error('保存的坐标与代数根不一致');
      }
    }
    if(b.exactCertificate){
      const conditions=set.problem.conditions.map(c=>{if(c.alternateValue===undefined)return c;const first={...c,alternateValue:undefined};return {...first,value:evaluator({...set.problem,conditions:[first]}).verify(flatten(names,b.positions)).valid?c.value:c.alternateValue};});
      const problem={...set.problem,conditions},symbolic=planar?symbolicPlanarEquations(problem,planar.variables):symbolicSpatialEquations(problem,false);
      validateExactCertificate(b.exactCertificate,planar?planar.encode(b.positions,b.values):flatten(names,b.positions),symbolic.sources,symbolic.tokens);
    }
    for(const l of b.loci) {
      if(!l||!names.includes(l.point)||!["line","segment","circle","plane","sphere","sampled"].includes(l.kind)||!vector(l.origin)||!vector(l.u)||!vector(l.v)||
        Math.abs(norm(l.u)-1)>1e-5||Math.abs(norm(l.v)-1)>1e-5||Math.abs(dot(l.u,l.v))>1e-5||typeof l.radius!=="number"||!Number.isFinite(l.radius)||l.radius<=0||l.radius>1e9||typeof l.complete!=="boolean"||
        l.paths&&(!Array.isArray(l.paths)||l.paths.length>8||l.paths.some(path=>!Array.isArray(path)||path.length>2000||path.some(p=>!vector(p)))))throw new Error("空间轨迹数据无效");
    }
  }
}
export function selectedBranch(set:DrawingSolutionSet) {return set.result.branches[set.activeBranch];}
/** Resolve ownership by stable IDs; display symbols may be renamed or reserved. */
export function constraintPointName(set:DrawingSolutionSet,point:DrawingPoint):string|undefined {
  const c=point.construction;
  if(c.type==='constraint'&&c.set===set.id&&set.problem.points.includes(c.point))return c.point;
  if(point.constraintPointName&&set.problem.points.includes(point.constraintPointName))return point.constraintPointName;
  if(!planarMode(set.problem))return;
  const original=set.problem.planar?.document.objects.find(o=>o.id===point.id&&o.kind==='point');
  const logical=original&&(original.symbol??original.name);
  if(logical&&set.problem.points.includes(logical))return logical;
  return set.problem.points.find(n=>point.id===`${set.id}-point-${n}`);
}
/** Old fixed children are ordinary free point records, but their owning
 * solution is still authoritative for coordinates and interaction. */
export function constraintBinding(doc:DrawingDocument,point:DrawingPoint|undefined) {
  if(!point)return;
  const c=point.construction,id=c.type==='constraint'?c.set:point.constraintSet;
  const set=id&&doc.objects.find(o=>o.id===id);
  if(!set||set.kind!=='solutionSet')return;
  const name=constraintPointName(set,point);if(!name)return {set,point:'',reference:false,movable:false};
  const branch=selectedBranch(set);return {set,point:name,reference:branch.reference.includes(name),movable:(branch.motionDof??branch.dof)>0&&!branch.reference.includes(name)};
}
export function restoreConstraintPoints(doc:DrawingDocument):DrawingDocument {
  let changed=false;
  const objects=doc.objects.map(o=>{
    if(o.kind!=="point"||o.construction.type==="constraint"||!o.constraintSet)return o;
    const binding=constraintBinding(doc,o);if(!binding)return o;
    if(planarMode(binding.set.problem)){
      if(o.constraintPointName===binding.point)return o;
      changed=true;return {...o,constraintPointName:binding.point,...(o.construction.type==='free'&&!o.parameters?{construction:{type:'free' as const,position:constraintPoint(binding.set,binding.point)}}:{})};
    }
    const position=constraintPoint(binding.set,binding.point);
    if(o.construction.type==="free"&&!o.parameters&&norm(sub(position,o.construction.position))===0)return o;
    changed=true;return {...o,construction:o.construction.type==="free"?{type:"free" as const,position}:{type:"constraint" as const,set:binding.set.id,point:binding.point},parameters:undefined};
  });
  return changed?{...doc,objects}:doc;
}
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
  if(planarMode(set.problem))return installPlanarSolution(doc,set);
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
    o.constraintSet===set.id&&!!o.constraintFace&&!desiredFaces.has(o.constraintFace)||
    o.constraintSet===set.id&&o.kind==="curve"&&!!o.declaration&&!(set.problem.curves??[]).some(c=>c.id===o.declaration!.id)||
    o.constraintSet===set.id&&o.kind==="solid"&&o.construction?.type==="roundPoints"&&!set.problem.conditions.some(c=>c.enabled&&c.id===o.id.slice(`${set.id}-round-`.length))
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
  const planes=[...doc.planes];
  for(const curve of set.problem.curves??[]) {
    const id=`${set.id}-curve-${curve.id}`,planeId=`${id}-plane`,points=[...new Set([...curve.points,...(curve.plane??[]),...(curve.normalAxis??[]),...(curve.radiusSegment??[])])].map(n=>existing.get(n)!);
    const frame=curveGeometry(curve,Object.fromEntries(set.problem.points.map(n=>[n,constraintPoint(set,n)])));
    if(!planes.some(p=>p.id===planeId))planes.push({id:planeId,name:`${curve.name} 所在平面`,origin:frame.center,u:frame.u,v:frame.v});
    const old=objects.find(o=>o.id===id),item:GeometryObject={...(old?.kind==="curve"?old:{}),id,name:curve.name,kind:"curve",constraintSet:set.id,declaration:{id:curve.id,points},circle:undefined,preset:undefined,derived:undefined,parameters:undefined,parametric:undefined,planeId,equation:"x^2+y^2=1",range:[-frame.a*1.1,frame.a*1.1,-frame.b*1.1,frame.b*1.1],followView:true,style:old?.style??defaultStyle()};
    if(old)objects=objects.map(o=>o.id===id?item:o);else objects.push(item);
  }
  for(const condition of set.problem.conditions.filter(c=>c.enabled&&["cylinder","cone","coneFrustum","sphere"].includes(c.kind))) {
    const id=`${set.id}-round-${condition.id}`,old=objects.find(o=>o.id===id),item:GeometryObject={...(old?.kind==="solid"?old:{}),id,name:({cylinder:"圆柱",cone:"圆锥",coneFrustum:"圆台",sphere:"球"} as Record<string,string>)[condition.kind],kind:"solid",shape:condition.kind as "cylinder"|"cone"|"coneFrustum"|"sphere",constraintSet:set.id,construction:{type:"roundPoints",points:condition.refs[0].map(n=>existing.get(n)!)},origin:[0,0,0],rotation:[0,0,0],width:1,depth:1,height:1,radius:1,topRadius:1,sides:40,style:old?.style??defaultStyle()};
    if(old)objects=objects.map(o=>o.id===id?item:o);else objects.push(item);
  }
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
  return refreshDeclaredCurves(groupClosedFaces(restoreConditionSurfaces({...doc,planes,schemaVersion:3,dimension:"3d",objects,edgeStyles,view:{...doc.view,mode:"space",angle:empty?-22:doc.view.angle}})));
}
/** Recompute the plane as well as the equation: spatial conics must retain
 * their true orientation when a solution moves or its placement changes. */
export function refreshDeclaredCurves(doc:DrawingDocument):DrawingDocument {
  const declared=doc.objects.filter(o=>o.kind==="curve"&&o.declaration);if(!declared.length)return doc;
  const geometry=resolveGeometry(doc),planes=[...doc.planes],patches=new Map<string,GeometryObject>();
  for(const object of declared) {
    if(object.kind!=="curve"||!object.declaration)continue;
    const set=doc.objects.find(o=>o.id===object.constraintSet);if(set?.kind!=="solutionSet")continue;
    const curve=set.problem.curves?.find(c=>c.id===object.declaration!.id);if(!curve)continue;
    const p=Object.fromEntries(set.problem.points.map(n=>{
      const source=doc.objects.find(o=>o.kind==="point"&&o.constraintSet===set.id&&o.constraintPointName===n);
      return [n,source&&geometry.points.get(source.id)?.p||constraintPoint(set,n)];
    }));
    try {
      const frame=curveGeometry(curve,p),index=planes.findIndex(p=>p.id===object.planeId);
      const plane={id:object.planeId,name:`${curve.name} 所在平面`,origin:frame.center,u:frame.u,v:frame.v};if(index>=0)planes[index]=plane;else planes.push(plane);
      patches.set(object.id,{...object,equation:curve.type==="circle"?`x^2+y^2=${frame.a**2}`:`x^2/(${frame.a**2})+y^2/(${frame.b**2})=1`,parametric:{x:`(${frame.a})*cos(t)`,y:`(${frame.b})*sin(t)`,tMin:0,tMax:2*Math.PI},range:[-frame.a*1.1,frame.a*1.1,-frame.b*1.1,frame.b*1.1]});
    }catch{/* Invalid manual edits are reported by the geometry resolver. */}
  }
  return {...doc,planes,objects:doc.objects.map(o=>patches.get(o.id)??o)};
}
export function localTarget(set:DrawingSolutionSet,p:Vec3) {return local(p,set.placement);}
/** Finite bounds for fitting the complete displayed locus, not just its driver. */
export function constraintLocusPoints(doc:DrawingDocument):Vec3[] {
  const objects=new Map(doc.objects.map(o=>[o.id,o])),points:Vec3[]=[];
  for(const obj of doc.objects)if(obj.kind === "spatialLocus"&&!obj.hidden&&obj.style.line!=="hidden"&&doc.edgeStyles[obj.id]!=="hidden") {
    const set=objects.get(obj.set);if(set?.kind!=="solutionSet"||set.hidden)continue;
    const locus=selectedBranch(set)?.loci.find(l=>l.point===obj.point);if(!displayableLocus(locus))continue;
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
  for(const polygon of conditionFaces(set.problem,selectedBranch(set).positions)) {
    const geometry=polygonGeometry(polygon.map(n=>constraintPoint(set,n)));
    faces.push(...geometry.triangles.map(triangle=>triangle.map(i=>names.indexOf(polygon[i])) as [number,number,number]));
  }
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

/** Repair missing declared surfaces in legacy scenes without replacing points,
 * user styling, external references, or constraint results. */
export function restoreConditionSurfaces(doc:DrawingDocument):DrawingDocument {
  if(doc.dimension!=="3d")return doc;
  let objects=[...doc.objects],edgeStyles={...doc.edgeStyles},changed=false;
  for(const set of doc.objects)if(set.kind==="solutionSet"&&!planarMode(set.problem)) {
    const ids=new Map(objects.filter((o):o is DrawingPoint=>o.kind==="point").flatMap(o=>{
      const name=constraintPointName(set,o);return name&&((o.constraintSet===set.id)||(o.construction.type==="constraint"&&o.construction.set===set.id))?[[name,o.id] as const]:[];
    }));
    const key=(names:string[])=>[...names].sort().join("|");
    for(const condition of set.problem.conditions.filter(c=>c.enabled)) {
      const boundaries=templateFaces({...set.problem,conditions:[condition]});
      const faces:string[]=[];
      for(const boundary of boundaries) {
        if(!boundary.every(n=>ids.has(n)))continue;
        const signature=key(boundary);let old=objects.find(o=>o.constraintSet===set.id&&o.constraintFace===signature);
        if(!old) {
          const id=crypto.randomUUID();old={id,name:`面 ${boundary.join("")}`,kind:"polygon",constraintSet:set.id,constraintFace:signature,points:boundary.map(n=>ids.get(n)!),style:defaultStyle()};
          objects.push(old);boundary.forEach((_,i)=>edgeStyles[`${id}:e:${i}`]="hidden");changed=true;
        }faces.push(old.id);
      }
      if(!["pyramid","prism","frustum","cube"].includes(condition.kind)||faces.length!==boundaries.length||faces.length<4)continue;
      if(objects.some(o=>o.kind==="solid"&&o.construction?.type==="faces"&&faces.every(id=>o.construction?.type==="faces"&&o.construction.faces.includes(id))))continue;
      const id=`${set.id}-body-${condition.id}`;if(objects.some(o=>o.id===id))continue;
      let symbol="S",i=1;while(objects.some(o=>o.symbol===symbol))symbol=`S_${i++}`;
      objects.push({id,symbol,name:`多面体 ${symbol}`,kind:"solid",shape:"prism",constraintSet:set.id,construction:{type:"faces",faces},origin:[0,0,0],rotation:[0,0,0],width:1,depth:1,height:1,radius:1,topRadius:0,sides:4,style:defaultStyle()});
      objects=objects.map(o=>faces.includes(o.id)?{...o,body:id}:o);changed=true;
    }
  }
  return changed?{...doc,objects,edgeStyles}:doc;
}
