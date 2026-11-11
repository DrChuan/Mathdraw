import {inputFields} from './constraints/inputs';
import type {Condition,ConstraintCurve,PlanarContext,PlanarEquation} from './constraints/types';
import type {GeometryObject} from './types';
import {defaultStyle} from './types';
import {addPlanarDefinition,contextPoints,objectSymbol,setUnknown,unknownValue} from './constraints/planarModel';
import {addLessonInput} from './constraints/planarLesson';
import {entity,pointNames,segmentsFrom,normalizeConditionNotation,validateProblem} from './constraints/input';
import {parsePlanarInput} from './constraints/planarExpressions';
import {applyDefinition,nextSymbol} from './model';
import {dependencies} from './geometry';
import {scalar} from './expression';
import {numericFunctions} from './symbols';
import {validatePlanarEquationSyntax} from './constraints/planarSyntax';

export type CoordinateDraft={context:PlanarContext;points:string;segments:string;conditions:Condition[];curves:ConstraintCurve[]};
export type CoordinateProposal={draft:CoordinateDraft;created:GeometryObject[];relations:(Condition|PlanarEquation)[];reused:string[]};
const names=(s:string)=>s.trim()?pointNames(s,2000):[];
export function addUnknownPoint(context:PlanarContext,name:string){
 const next=addPlanarDefinition(context,`${name}=(?, ?)`),o=next.document.objects.find(o=>objectSymbol(o)===name)!;
 const i=next.document.objects.filter(o=>o.kind==='point').length,t=i*2.399963229728653,seed=[Math.cos(t)*(2+i*.12),Math.sin(t)*(2+i*.12)];
 for(const u of next.unknowns.filter(u=>u.object===o.id)){const bounds=next.searchBounds?.[name];u.min=bounds?.[u.field==='x'?'xMin':'yMin'];u.max=bounds?.[u.field==='x'?'xMax':'yMax'];u.initial=Math.max(u.min??-Infinity,Math.min(u.max??Infinity,seed[u.field==='x'?0:1]));setUnknown(next.document,u,u.initial);}
 return next;
}
/** Legacy supplemental declarations are materialized once into the same source
 * document. Existing objects keep their IDs and all user-facing properties. */
export function normalizeCoordinateDraft(input:CoordinateDraft):CoordinateDraft {
 let context=structuredClone(input.context);const all=[...new Set([...names(input.points),...contextPoints(context)])];
 for(const name of all){const o=context.document.objects.find(o=>objectSymbol(o)===name);if(o&&o.kind!=='point')throw Error(`点名 ${name} 与${o.kind}对象冲突`);if(!o)context=addUnknownPoint(context,name);}
 for(const [a,b]of segmentsFrom(input.segments,all))context=addEdge(context,a,b);
 // A legacy circle remains owned by its original declaration. Its native
 // construction is registered for ordinary references, never a sampled copy.
 for(const curve of input.curves)if(curve.type==='circle'&&!context.document.objects.some(o=>objectSymbol(o)===curve.name))context=registerLegacyCircle(context,curve);
 return {...input,context,points:contextPoints(context).join(' '),segments:''};
}
function addEdge(context:PlanarContext,a:string,b:string){
 const points=[a,b].map(n=>context.document.objects.find(o=>o.kind==='point'&&objectSymbol(o)===n)!.id);
 if(context.document.objects.some(o=>o.kind==='segment'&&o.points.length===2&&o.points.every(id=>points.includes(id))))return context;
 return addPlanarDefinition(context,`${nextSymbol(context.document,'segment')}=Segment(${a},${b})`);
}
export function relationNames(row:Condition|PlanarEquation,context:PlanarContext):string[]{
 const found=new Set<string>('refs'in row?row.refs.flat():[]),points=contextPoints(context),symbols=new Set(context.document.objects.map(objectSymbol));
 for(const token of row.source.matchAll(/(?<![A-Za-z0-9_\\])[A-Za-z][A-Za-z0-9_]*/g)){
  if(/^\s*\(/.test(row.source.slice(token.index!+token[0].length)))continue;
  if(symbols.has(token[0]))found.add(token[0]);else try{entity(token[0],points).forEach(n=>found.add(n));}catch{/* Function names and numeric notation are not object references. */}
 }
 if('refs'in row)for(const o of context.document.objects){if(!['polygon','triangle','segment','line','vector'].includes(o.kind)||!('points'in o))continue;const vertices=o.points.map(id=>context.document.objects.find(p=>p.id===id)).filter((p):p is GeometryObject=>!!p).map(objectSymbol);if(row.refs.some(ref=>ref.length===vertices.length&&ref.every(n=>vertices.includes(n))))found.add(objectSymbol(o));}
 if('curve'in row&&row.curve){const c=context.document.objects.find(o=>o.id===row.curve);if(c)found.add(objectSymbol(c));}
 return [...found];
}
export function relatedRows(draft:CoordinateDraft,id:string){const o=draft.context.document.objects.find(o=>o.id===id);return o?[...draft.conditions,...draft.context.equations].filter(row=>relationNames(row,draft.context).includes(objectSymbol(o))||'curve'in row&&draft.curves.some(c=>c.id===row.curve&&c.name===objectSymbol(o))):[];}
export function objectDependents(draft:CoordinateDraft,id:string){return draft.context.document.objects.filter(o=>o.id!==id&&dependencies(o).includes(id));}
function relationKey(c:Condition){
 const refs=c.refs.map(r=>['distance','equal','parallel','perpendicular','ratio','onSegment'].includes(c.kind)&&r.length===2?[...r].sort():r);
 if(['equal','parallel','perpendicular'].includes(c.kind))refs.sort((a,b)=>a.join('|').localeCompare(b.join('|')));
 return JSON.stringify([c.kind,refs,c.value,c.alternateValue,c.coefficients,c.curve,c.solid,c.kind==='scalarEquation'||c.kind==='vectorRelation'?c.source.replace(/\s/g,''):'']);
}
function equationKey(source:string){
 const normalize=(s:string)=>{s=s.trim();try{return String(scalar(s));}catch{return s.replace(/\s/g,'').replace(/\beccentricity\(/g,'e(');}};
 const parts=source.replace(/＝/g,'=').split(/(<=|>=|<|>|=)/);if(parts.length!==3)return normalize(source);
 const sides=[normalize(parts[0]),normalize(parts[2])];if(parts[1]==='=')sides.sort();return sides.join(parts[1]);
}
export function mergeCoordinateRelations(draft:CoordinateDraft,conditions:Condition[],equations:PlanarEquation[]){
 const next=structuredClone(draft);for(const c of conditions){const old=next.conditions.find(o=>relationKey(o)===relationKey(c));if(old){if(c.enabled)old.enabled=true;}else next.conditions.push(c);}
 for(const c of equations){const old=next.context.equations.find(o=>equationKey(o.source)===equationKey(c.source));if(old){if(c.enabled)old.enabled=true;}else next.context.equations.push(c);}
 return next;
}
function proposal(before:CoordinateDraft,after:CoordinateDraft,reused:string[]=[]):CoordinateProposal {
 const draft=normalizeCoordinateDraft(after),oldIds=new Set(before.context.document.objects.map(o=>o.id)),oldRows=new Set([...before.conditions,...before.context.equations].map(c=>c.id));
 // Type-only registration of legacy curves for syntax checking. These
 // placeholders never enter the solver, saved document, or preview.
 const syntaxDocument={...draft.context.document,objects:[...draft.context.document.objects]};
 for(const c of draft.curves)if(!syntaxDocument.objects.some(o=>objectSymbol(o)===c.name))syntaxDocument.objects.push({id:c.id,name:c.name,symbol:c.name,kind:'curve',planeId:syntaxDocument.view.planeId,equation:'x^2+y^2=1',range:[-10,10,-10,10],style:defaultStyle()});
 for(const row of draft.context.equations)if(row.enabled)validatePlanarEquationSyntax(row.source,syntaxDocument,names(draft.points));
 validateProblem({mode:'coordinate',points:names(draft.points),segments:[],conditions:draft.conditions,curves:draft.curves,planar:draft.context});
 return {draft,created:draft.context.document.objects.filter(o=>!oldIds.has(o.id)),relations:[...draft.conditions,...draft.context.equations].filter(c=>!oldRows.has(c.id)),reused};
}
export function proposeCoordinateObjects(before:CoordinateDraft,source:string){
 const base=normalizeCoordinateDraft(before),added=addLessonInput(base.context,source,names(base.points),base.curves);
 const oldIds=new Set(base.context.document.objects.map(o=>o.id)),created=added.context.document.objects.filter(o=>o.kind==='point'&&o.construction.type==='free'&&!oldIds.has(o.id));
 if(created.length>1)for(const [index,point]of created.entries()){
  const phase=(base.context.document.objects.filter(o=>o.kind==='point').length+index+1)*2.399963229728653;
  for(const u of added.context.unknowns.filter(u=>u.object===point.id&&['x','y'].includes(u.field))){u.initial=(u.field==='x'?Math.cos(phase):Math.sin(phase))*(2+(index+1)*.12);setUnknown(added.context.document,u,u.initial);}
 }
 return proposal(before,mergeCoordinateRelations({...base,context:added.context,points:added.points.join(' ')},added.conditions,[]));
}
export function proposeCoordinateShape(before:CoordinateDraft,kind:string,source:string){
 const list=pointNames(source),count=['rectangle','square','parallelogram'].includes(kind)?4:kind==='triangle'?3:undefined;
 if(count&&list.length!==count||list.length<3)throw Error('顶点数量与所选图形不符');
 let draft=normalizeCoordinateDraft(before);const reused:string[]=[];
 for(const name of list){const o=draft.context.document.objects.find(o=>objectSymbol(o)===name);if(o){if(o.kind!=='point')throw Error(`名称 ${name} 已用于其他类型对象`);reused.push(name);}else draft={...draft,context:addUnknownPoint(draft.context,name)};}
 for(let i=0;i<list.length;i++)draft.context=addEdge(draft.context,list[i],list[(i+1)%list.length]);
 const ids=list.map(n=>draft.context.document.objects.find(o=>objectSymbol(o)===n)!.id);
 const existing=draft.context.document.objects.find(o=>(o.kind==='polygon'||o.kind==='triangle')&&o.points.length===ids.length&&o.points.every((id,i)=>id===ids[i]));
 if(existing)reused.push(objectSymbol(existing));else draft.context=addPlanarDefinition(draft.context,`${nextSymbol(draft.context.document,'polygon')}=${list.length===3?'Triangle':'Polygon'}(${list.join(',')})`);
 draft.points=contextPoints(draft.context).join(' ');
 if(kind!=='triangle'&&kind!=='polygon'){const parsed=parsePlanarInput(`${kind}(${list.join(',')})`,names(draft.points),draft.curves);draft=mergeCoordinateRelations(draft,parsed.conditions,parsed.equations);}
 return proposal(before,draft,reused);
}
/** Only unambiguous point notation and explicit parameter declarations may be
 * offered for completion. Unknown named curves/lines are never invented. */
export function proposeCoordinateRelations(before:CoordinateDraft,sources:string[]){
 let draft=normalizeCoordinateDraft(before);const candidates=new Set<string>(),blocked=new Set<string>(),endpointAllowed=new Set<string>(),declared:string[]=[];
 const known=new Set([...draft.context.document.objects.map(objectSymbol),...draft.curves.map(c=>c.name)]);
 const rows=sources.flatMap(s=>s.split(/[\n;；]+/).map(v=>v.trim()).filter(Boolean));
 for(const source of rows){const declaration=source.match(/^([A-Za-z](?:_[A-Za-z0-9]+)?)\s*=\s*\?$/);if(declaration){if(!known.has(declaration[1])){draft.context=addPlanarDefinition(draft.context,source);known.add(declaration[1]);declared.push(declaration[1]);}continue;}
  for(const m of source.matchAll(/\b(?:onCurve|onLine|focus|center|directrix|tangent|intersection)\s*\(([^()]*)\)/g)){
   const args=m[1].split(',').map(s=>s.trim()),fn=m[0].slice(0,m[0].indexOf('(')).trim();
   for(const ref of fn==='intersection'?args.slice(1,3):['tangent','directrix'].includes(fn)?args.slice(0,2):args.slice(1,2))if(!known.has(ref)){blocked.add(ref);if(fn==='intersection'||fn==='onLine'||fn==='directrix'&&ref===args[0]||fn==='tangent'&&ref===args[0])endpointAllowed.add(ref);}
  }
  for(const m of source.matchAll(/\b(?:a|b|c|e|p|radius|eccentricity|focalDistance)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g))if(!known.has(m[1]))blocked.add(m[1]);
  for(const m of source.matchAll(/\b[xy]\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g))if(!known.has(m[1]))candidates.add(m[1]);
  for(const m of source.matchAll(/(?<![A-Za-z0-9_\\])[A-Za-z][A-Za-z0-9_]*/g)){
   const token=m[0];if(/^[a-z](?:_[A-Za-z0-9]+)?$/.test(token)&&!known.has(token)&&!numericFunctions.has(token)&&!['x','y','z','u','v'].includes(token)&&!/^\s*\(/.test(source.slice(m.index!+token.length)))throw Error(`未定义对象或参数 ${token}；待求参数请显式声明 ${token}=?。`);if(known.has(token)||numericFunctions.has(token.toLowerCase())||/^\s*\(/.test(source.slice(m.index!+token.length))||!/^([A-Z](?:_\d+)?)+$/.test(token))continue;
   try{entity(token,[...known]);continue;}catch{/* Expand only conventional capital point names. */}
   for(const n of token.match(/[A-Z](?:_\d+)?/g)??[])if(!known.has(n))candidates.add(n);
  }
 }
 for(const ref of endpointAllowed)try{if(entity(ref,[...known,...candidates]).length===2)blocked.delete(ref);}catch{/* A named line still requires an actual definition. */}
 if(blocked.size)throw Error(`请先定义线或曲线：${[...blocked].join('、')}；不会猜测它们的方程。`);
 for(const name of candidates)draft.context=addUnknownPoint(draft.context,name);
 draft.points=contextPoints(draft.context).join(' ');
 for(const source of rows.filter(s=>!/^([A-Za-z](?:_[A-Za-z0-9]+)?)\s*=\s*\?$/.test(s))){
  const normalized=normalizeConditionNotation(expandCoordinateReferences(source,draft.context),names(draft.points)),parsed=parsePlanarInput(normalized,names(draft.points),draft.curves);
  draft=mergeCoordinateRelations(draft,parsed.conditions,parsed.equations.map(c=>({...c,source:parsed.equations.length===1?source:c.source})));
 }
 return {...proposal(before,draft),missing:[...candidates,...declared]};
}
export function coordinateDisplayDefinition(context:PlanarContext,o:GeometryObject,definition:string){
 const fields=context.unknowns.filter(u=>u.object===o.id).map(u=>u.field);
 if(o.kind==='number'&&fields.includes('value'))return `${objectSymbol(o)}=?`;
 if(o.kind==='point'&&o.construction.type==='free'&&fields.length){const match=definition.match(/^(.*?)\(([^,]+),([^,)]+)(?:,[^)]*)?\)$/);if(match)return `${match[1]}(${fields.includes('x')?'?':match[2]},${fields.includes('y')?'?':match[3]})`;}
 return definition;
}
export function removeCoordinateObject(draft:CoordinateDraft,id:string){
 const dependents=objectDependents(draft,id),relations=relatedRows(draft,id),o=draft.context.document.objects.find(o=>o.id===id),curveDependents=draft.curves.filter(c=>o&&c.points.includes(objectSymbol(o)));if(dependents.length||relations.length||curveDependents.length)throw Error('该对象仍被其他对象或关系引用，请先处理下列依赖。');
 const next=structuredClone(draft);next.context.document.objects=next.context.document.objects.filter(o=>o.id!==id);next.context.unknowns=next.context.unknowns.filter(u=>u.object!==id);next.context.inputs=next.context.inputs?.filter(i=>i.object!==id);next.points=contextPoints(next.context).join(' ');if(o)next.curves=next.curves.filter(c=>c.name!==objectSymbol(o));return next;
}
export function replaceCoordinateObject(context:PlanarContext,id:string,source:string){
 const next=structuredClone(context),old=next.document.objects.find(o=>o.id===id)!;
 next.document=applyDefinition(next.document,source.replace(/\?/g,'1'),id,true);
 next.unknowns=next.unknowns.filter(u=>u.object!==id);const object=next.document.objects.find(o=>o.id===id)!;
 if(source.includes('?')){
  if(object.kind==='number')next.unknowns.push({id:`${id}.value`,object:id,field:'value',initial:old.kind==='number'?old.value:1});
  else if(object.kind==='point'&&object.construction.type==='free'){const tuple=source.match(/=\s*\(([^,]+),([^,)]+)\)/);for(const [i,field]of ['x','y'].entries())if(tuple?.[i+1].includes('?'))next.unknowns.push({id:`${id}.${field}`,object:id,field,initial:old.kind==='point'&&old.construction.type==='free'?unknownValue(context.document,old,field):1});}
 }
 next.inputs=next.inputs?.map(i=>i.object===id?{...i,fields:i.fields.filter(f=>inputFields(object).includes(f)&&!next.unknowns.some(u=>u.object===id&&u.field===f))}:i).filter(i=>i.fields.length);
 return next;
}
export function proposeCoordinatePoints(before:CoordinateDraft,source:string){
 let draft=normalizeCoordinateDraft(before);const reused:string[]=[];
 for(const name of pointNames(source)){const o=draft.context.document.objects.find(o=>objectSymbol(o)===name);if(o){if(o.kind!=='point')throw Error(`${name} 已用于其他类型对象`);reused.push(name);}else draft.context=addUnknownPoint(draft.context,name);}
 draft.points=contextPoints(draft.context).join(' ');return proposal(before,draft,reused);
}
export function expandCoordinateReferences(source:string,context:PlanarContext){
 return source.replace(/\b(area|circumradius|rectangle|square|parallelogram|regularPolygon|convexPolygon|congruent|similar)\s*\(([^()]*)\)/g,(_,fn:string,args:string)=>`${fn}(${args.split(',').map(arg=>{const o=context.document.objects.find(o=>objectSymbol(o)===arg.trim());return o&&(o.kind==='triangle'||o.kind==='polygon')?o.points.map(id=>objectSymbol(context.document.objects.find(o=>o.id===id)!)).join(' '):arg;}).join(',')})`);
}

function legacyCircleSource(curve:ConstraintCurve){return `${curve.name}=${curve.method==='threePoint'?`Circle3(${curve.points.join(',')})`:curve.method==='centerPoint'?`Circle(${curve.points.join(',')})`:`Circle(${curve.points[0]},${curve.valueSource??curve.value})`}`;}
function registerLegacyCircle(context:PlanarContext,curve:ConstraintCurve,replaceId?:string){
 if(replaceId)return {...context,document:applyDefinition(context.document,legacyCircleSource(curve),replaceId,true)};
 const next=addLessonInput(context,legacyCircleSource(curve),contextPoints(context)).context,o=next.document.objects.find(o=>objectSymbol(o)===curve.name)!;
 if(!next.document.objects.some(other=>other!==o&&other.id===curve.id))o.id=curve.id;
 return next;
}
export function updateLegacyCurves(draft:CoordinateDraft,curves:ConstraintCurve[]){
 let context=structuredClone(draft.context);
 for(const curve of curves){const before=draft.curves.find(c=>c.id===curve.id);if(curve.type==='circle'&&JSON.stringify(before)!==JSON.stringify(curve)){if(before&&before.name!==curve.name&&context.equations.some(row=>new RegExp(`(?<![A-Za-z0-9_])${before.name}(?![A-Za-z0-9_])`).test(row.source)))throw Error('该曲线仍被坐标关系引用，请先处理相关关系再改名');const o=context.document.objects.find(o=>objectSymbol(o)===(before?.name??curve.name));context=registerLegacyCircle(context,curve,o?.id);}}
 return normalizeCoordinateDraft({...draft,context,curves});
}
