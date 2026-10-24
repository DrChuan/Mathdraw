import type { DrawingDocument,DrawingSolutionSet,GeometryObject,Vec3 } from '../types';
import { newDrawing,defaultStyle } from '../types';
import type { ConstraintProblem,PlanarContext,PlanarUnknown,Positions } from './types';
import { fromPlane,toPlane,resolveGeometry,validateDrawing,sub,dot,cross,add,mul } from '../geometry';
import { definition,applyDefinition } from '../model';
import { curveGeometry } from './measures';
import { numericFunctions } from '../symbols';

export const planarMode=(p:ConstraintProblem)=>p.mode==='plane'||p.mode==='coordinate';
export function coordinatePlane(d:DrawingDocument) {
  return d.coordinateFrame?{id:d.view.planeId,name:'坐标平面',origin:d.coordinateFrame.origin,u:d.coordinateFrame.x,v:d.coordinateFrame.y}:d.planes.find(p=>p.id===d.view.planeId)!;
}
export function objectSymbol(o:GeometryObject) {return o.symbol??o.name;}
export function planarContext(doc:DrawingDocument):PlanarContext {
  const document=structuredClone(doc);document.dimension='2d';document.view.mode='plane';
  const context:PlanarContext={document,unknowns:[],equations:[],absorbedSets:[],inheritedConditions:[],inheritedCurves:[]};
  const geometry=resolveGeometry(doc),aliases=new Map<string,string>();
  for(const root of doc.objects){if(root.kind!=='solutionSet'||!planarMode(root.problem))continue;
    context.absorbedSets!.push(root.id);const branch=root.result.branches[root.activeBranch],source=materializePlanar(root.problem,branch.values,branch.positions,root.id),definitions=new Map(source.objects.map(o=>[o.id,o]));
    const symbols:Record<string,string>={},curveIds:Record<string,string>={};for(const o of doc.objects)if(o.constraintSet===root.id){if(o.constraintPointName)symbols[o.constraintPointName]=objectSymbol(o);else if(o.kind==='curve'){const c=root.problem.curves?.find(c=>c.id===o.id||`${root.id}-curve-${c.id}`===o.id);if(c){symbols[c.name]=objectSymbol(o);curveIds[c.id]=o.id;}}}
    context.unknowns.push(...(root.problem.planar?.unknowns??[]).map(u=>({...u,initial:branch.values?.[u.id]??u.initial})));
    context.equations.push(...(root.problem.planar?.equations??[]).map((e,i)=>({...structuredClone(e),id:`${root.id}-equation-${i}`})));context.inheritedConditions!.push(...root.problem.conditions.map((c,i)=>({...structuredClone(c),id:`${root.id}-condition-${i}`,curve:c.curve?curveIds[c.curve]??c.curve:undefined,refs:c.refs.map(r=>r.map(n=>symbols[n]??n)),source:renamePlanarSymbols(c.source,symbols,root.problem.points)})));context.inheritedCurves!.push(...(root.problem.curves??[]).map(c=>({...structuredClone(c),id:curveIds[c.id]??c.id,name:symbols[c.name]??c.name,points:c.points.map(n=>symbols[n]??n),plane:c.plane?.map(n=>symbols[n]??n)})));
    document.objects=document.objects.filter(o=>o.id!==root.id&&!(o.kind==='spatialLocus'&&o.set===root.id)).map(o=>{
      if(o.constraintSet!==root.id)return o;
      const original=definitions.get(o.id),next={...(original??o),id:o.id,name:o.name,symbol:o.symbol,style:o.style,hidden:root.hidden?true:o.hidden} as GeometryObject;
      if(next.kind==='point'&&root.problem.mode==='plane'){const p=geometry.points.get(o.id)?.p;if(p)next.construction={type:'free',position:p};}
      delete next.constraintSet;delete next.constraintPointName;delete next.constraintFace;return next;
    });
    root.problem.points.forEach((n,i)=>{const child=doc.objects.find(o=>o.kind==='point'&&o.constraintSet===root.id&&o.constraintPointName===n);if(child)aliases.set(`${root.id}:v:${i}`,child.id);});
    const rebind=(value:unknown):unknown=>typeof value==='string'?aliases.get(value)??value:Array.isArray(value)?value.map(rebind):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebind(v)])):value;
    document.objects=document.objects.map(o=>rebind(o) as GeometryObject);
  }
  return context;
}
export function unknownFields(o:GeometryObject):string[] {
  if(o.kind==='number'&&!Object.keys(o.references).length)return ['value'];
  if(o.kind==='point'&&o.construction.type==='free'&&!o.parameters)return ['x','y'];
  if(o.kind==='curve'&&o.preset&&!o.parameters)return Object.keys(o.preset).filter(n=>n!=='type').map(n=>'preset.'+n);
  if(o.kind==='curve'&&o.circle?.type==='centerRadius'&&!o.parameters)return ['circle.radius'];
  return [];
}
export function unknownValue(d:DrawingDocument,o:GeometryObject,field:string) {
  if(o.kind==='point'&&o.construction.type==='free')return toPlane(coordinatePlane(d),o.construction.position)[field==='x'?0:1];
  if(o.kind==='number')return o.value;
  const [parent,key]=field.split('.');return Number((o as unknown as Record<string,Record<string,unknown>>)[parent]?.[key]);
}
export function setUnknown(d:DrawingDocument,u:PlanarUnknown,value:number) {
  const o=d.objects.find(o=>o.id===u.object);if(!o)throw Error('待求对象不存在');
  if(o.kind==='point'&&o.construction.type==='free'){
    const plane=coordinatePlane(d),p=toPlane(plane,o.construction.position),n=cross(plane.u,plane.v),depth=dot(sub(o.construction.position,plane.origin),n);p[u.field==='x'?0:1]=value;o.construction={type:'free',position:add(fromPlane(plane,...p),mul(n,depth))};
  }else if(o.kind==='number'){o.value=value;o.expression=String(value);o.references={};}
  else {const [parent,key]=u.field.split('.');(o as unknown as Record<string,Record<string,unknown>>)[parent][key]=value;}
}
export function applyValues(context:PlanarContext,values:Record<string,number>={}) {
  const d=structuredClone(context.document);
  for(const u of context.unknowns)setUnknown(d,u,values[u.id]??u.initial);
  return d;
}
export function addPlanarDefinition(context:PlanarContext,source:string):PlanarContext {
  const next=structuredClone(context),before=new Set(next.document.objects.map(o=>o.id));
  const pending=source.includes('?'),clean=source.replace(/\?/g,'1');
  next.document=applyDefinition(next.document,clean,undefined,true);
  const tuple=source.match(/=\s*\(([^,]+),([^,)]+)\)\s*$/);
  if(pending)for(const o of next.document.objects.filter(o=>!before.has(o.id)))for(const field of unknownFields(o)) {
    if(tuple&&['x','y'].includes(field)&&!tuple[field==='x'?1:2].includes('?'))continue;
    const initial=unknownValue(next.document,o,field);next.unknowns.push({id:`${o.id}.${field}`,object:o.id,field,initial,min:undefined,max:undefined});
  }
  return next;
}
export function contextPoints(context:PlanarContext) {return context.document.objects.filter(o=>o.kind==='point').map(objectSymbol);}
export function materializePlanar(problem:ConstraintProblem,values:Record<string,number>={},positions?:Positions,namespace='planar') {
  const d=problem.planar?applyValues(problem.planar,values):newDrawing();
  if(!problem.planar)d.objects=[];
  const plane=coordinatePlane(d),symbols=new Map(d.objects.map(o=>[objectSymbol(o),o]));
  for(const name of problem.points)if(!symbols.has(name)){
    const p=positions?.[name]??[0,0,0];
    const o:GeometryObject={id:`${namespace}-point-${name}`,name,symbol:name,kind:'point',construction:{type:'free',position:fromPlane(plane,p[0],p[1])},style:defaultStyle(),showName:true,dot:'auto',coordinates:'none',labelOffset:[9,-10]};d.objects.push(o);symbols.set(name,o);
  }
  for(const [a,b] of problem.segments){const pair=[symbols.get(a)!.id,symbols.get(b)!.id] as [string,string];
    if(!d.objects.some(o=>o.kind==='segment'&&o.points.every(id=>pair.includes(id))))d.objects.push({id:`${namespace}-edge-${a}-${b}`,kind:'segment',name:a+b,points:pair,style:defaultStyle()});
  }
  if(positions)for(const c of problem.curves??[]){
    if(d.objects.some(o=>o.kind==='curve'&&objectSymbol(o)===c.name))continue;
    const frame=curveGeometry(c,positions),p=toPlane(plane,fromPlane(plane,frame.center[0],frame.center[1]));
    d.objects.push({id:`${namespace}-curve-${c.id}`,name:c.name,symbol:c.name,kind:'curve',planeId:plane.id,equation:`(x-(${p[0]}))^2+(y-(${p[1]}))^2=(${frame.radius})^2`,circle:c.method==='threePoint'?{type:'threePoint',points:c.points.map(n=>symbols.get(n)!.id)}:c.method==='centerPoint'?{type:'centerPoint',points:c.points.map(n=>symbols.get(n)!.id)}:{type:'centerRadius',points:c.points.map(n=>symbols.get(n)!.id),radius:c.value},range:[-10,10,-10,10],followView:true,style:defaultStyle()});
  }
  return d;
}
export function planarPositions(problem:ConstraintProblem,doc:DrawingDocument,allowInvalid=false):Positions {
  const resolved=resolveGeometry(doc),plane=coordinatePlane(doc);
  return Object.fromEntries(problem.points.map(n=>{const o=doc.objects.find(o=>o.kind==='point'&&objectSymbol(o)===n),q=o&&resolved.points.get(o.id);if(!q&&allowInvalid)return [n,[0,0,0] as Vec3];if(!q)throw Error(`${n}：${o&&resolved.errors.get(o.id)||'点定义失效'}`);const p=toPlane(plane,q.p);return [n,[...p,0] as Vec3];}));
}
let contextValidationDepth=0;
export function validatePlanarContext(p:ConstraintProblem) {
  if(!planarMode(p))return;
  const forbidden=new Set(['pointPlaneDistance','volume','linePlaneAngle','dihedral','coplanar','cospherical','prism','pyramid','frustum','cube','cylinder','cone','coneFrustum','sphere']);
  if(p.conditions.some(c=>forbidden.has(c.kind)||['parallel','perpendicular'].includes(c.kind)&&c.refs.some(r=>r.length!==2)))throw Error('平面模式不支持空间条件');
  if(p.mode==='plane'&&p.curves?.some(c=>c.type!=='circle'))throw Error('无坐标模式暂只支持圆');
  const c=p.planar;if(!c){if(p.mode==='coordinate')throw Error('缺少坐标对象定义');return;}
  if(p.mode==='coordinate'&&c.document?.objects?.some(o=>o.kind!=='point'&&p.points.includes(objectSymbol(o))))throw Error('点名与已有线、曲线或数值对象重名，请使用不同的符号');
  if(contextValidationDepth>=8)throw Error('条件对象定义嵌套过深');
  contextValidationDepth++;try{validateDrawing(c.document);}finally{contextValidationDepth--;}
  if(c.document.dimension!=='2d'||c.document.objects.some(o=>o.kind==='solid')||!Array.isArray(c.unknowns)||c.unknowns.length>100||!Array.isArray(c.equations)||c.equations.length>200)throw Error('二维对象或未知量配置无效');
  const ids=new Set<string>();for(const u of c.unknowns){const o=c.document.objects.find(o=>o.id===u.object);if(!o||!unknownFields(o).includes(u.field)||u.id!==`${u.object}.${u.field}`||ids.has(u.id)||!Number.isFinite(u.initial)||[u.min,u.max].some(v=>v!==undefined&&(!Number.isFinite(v)||Math.abs(v)>1e9))||u.min!==undefined&&u.max!==undefined&&u.min>=u.max)throw Error('待求量或取值范围无效');ids.add(u.id);}
  for(const e of c.equations)if(!e||typeof e.id!=='string'||typeof e.enabled!=='boolean'||typeof e.source!=='string'||e.source.length>2048)throw Error('坐标条件无效');
  if(c.automaticSearch!==undefined&&typeof c.automaticSearch!=='boolean')throw Error('自动搜索设置无效');
  if(c.searchScale!==undefined&&(!Number.isFinite(c.searchScale)||c.searchScale<=0||c.searchScale>1e6))throw Error('近似搜索尺度无效');
  for(const [name,b]of Object.entries(c.searchBounds??{})){
    if(!p.points.includes(name)||!b||Object.values(b).some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)||b.xMin!==undefined&&b.xMax!==undefined&&b.xMin>=b.xMax||b.yMin!==undefined&&b.yMax!==undefined&&b.yMin>=b.yMax)throw Error('点的近似搜索范围无效');
  }
}
export function installPlanarSolution(doc:DrawingDocument,set:DrawingSolutionSet) {
  const branch=set.result.branches[set.activeBranch],problem=set.problem;
  const d=materializePlanar(problem,branch.values,branch.positions,set.id);
  // Bind logical points before restoring display symbols (E may be displayed as E_1).
  const pointNamesById=new Map(d.objects.filter(o=>o.kind==='point').map(o=>[o.id,objectSymbol(o)]));
  const current=new Map(doc.objects.map(o=>[o.id,o]));
  const previous=current.get(set.id),motion=previous?.kind==='solutionSet'&&previous.problem===set.problem;
  d.objects=d.objects.map(o=>{const old=current.get(o.id);return old?{...o,style:old.style,hidden:old.hidden,locked:old.locked,...(motion?{name:old.name,symbol:old.symbol}:{}),...(o.kind==='number'&&old.kind==='number'?{slider:old.slider}:{}),...(o.kind==='point'&&old.kind==='point'?{dot:old.dot,showName:old.showName,coordinates:old.coordinates,labelOffset:old.labelOffset}:{})}:o;});
  const memberIds=new Set([...(problem.planar?.document.objects.map(o=>o.id)??[]),...doc.objects.filter(o=>o.constraintSet===set.id).map(o=>o.id)]);
  const sourceSymbols=new Map(d.objects.map(o=>[pointNamesById.get(o.id)??objectSymbol(o),o]));
  for(const name of problem.points){const o=sourceSymbols.get(name);if(o?.kind!=='point')continue;
    o.constraintSet=set.id;o.constraintPointName=name;
    // Keep constructors and parameters. The resolver uses the solution as the
    // authoritative position; the source graph remains available to the worker.
  }
  for(const o of d.objects)o.constraintSet=set.id;
  if(problem.mode==='plane'){
    const used=new Set(doc.objects.filter(o=>o.id!==set.id&&o.constraintSet!==set.id).map(objectSymbol));
    for(const o of d.objects)if(o.symbol){const base=o.symbol;let symbol=base,index=1;while(used.has(symbol)||['x','y','z','u','v','pi','e'].includes(symbol.toLowerCase())||numericFunctions.has(symbol.toLowerCase()))symbol=`${base}_${index++}`;o.symbol=symbol;used.add(symbol);}
  }
  const absorbed=new Set(problem.planar?.absorbedSets??[]);
  const objects=[...doc.objects.filter(o=>o.id!==set.id&&!memberIds.has(o.id)&&!absorbed.has(o.id)&&!(o.kind==='spatialLocus'&&absorbed.has(o.set))),...d.objects,set];
  for(const l of branch.loci)if(l.kind!=='plane'&&l.kind!=='sphere'&&!objects.some(o=>o.kind==='spatialLocus'&&o.set===set.id&&o.point===l.point))objects.push({id:crypto.randomUUID(),kind:'spatialLocus',set:set.id,point:l.point,name:`${l.point} 的条件轨迹`,style:{...defaultStyle(),color:'#5475a6'}});
  const byId=new Map(objects.map(o=>[o.id,o]));
  return {...doc,schemaVersion:4 as const,dimension:'2d' as const,objects:[...byId.values()],planes:[...new Map([...doc.planes,...d.planes].map(p=>[p.id,p])).values()],view:{...doc.view,mode:'plane' as const,axes:problem.mode==='coordinate'},coordinateFrame:problem.mode==='coordinate'?d.coordinateFrame:doc.coordinateFrame};
}
export function planarDefinition(d:DrawingDocument,o:GeometryObject){try{return definition(d,o);}catch{return objectSymbol(o);}}

/** Rename bound symbols in editable statements, including compact AB notation.
 * Function names and LaTeX commands are syntax, not object references. */
export function renamePlanarSource(source:string,from:string,to:string,points:string[]) {
  return renamePlanarSymbols(source,{[from]:to},points);
}
export function renamePlanarSymbols(source:string,symbols:Record<string,string>,points:string[]) {
  return source.replace(/[A-Za-z][A-Za-z0-9_]*/g,(token,offset:number)=>{
    if(source[offset-1]==='\\'||/^\s*\(/.test(source.slice(offset+token.length)))return token;
    if(symbols[token])return symbols[token];
    const find=(s:string):string[]|undefined=>{if(points.includes(s))return[s];for(const n of points.filter(n=>s.startsWith(n)).sort((a,b)=>b.length-a.length)){const tail=find(s.slice(n.length));if(tail)return[n,...tail];}if(!s)return[];};
    const refs=find(token);return refs?.some(n=>symbols[n]&&symbols[n]!==n)?refs.map(n=>symbols[n]??n).join(' '):token;
  });
}
