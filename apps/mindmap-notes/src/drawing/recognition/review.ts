import type {RecognitionItem} from './types';
import type {ConstraintCurve} from '../constraints/types';
import {parseConditions,entity} from '../constraints/input';
import {conditionStatement} from '../constraints/statement';
import {mathPreview,symbolLatex} from '../mathPreview';

/** Render what the compiler consumes, independently of the model's prose. */
export function recognizedStatement(item:RecognitionItem,names:string[],circleNames:string[]=[]):string {
 if(item.role==='goal'||item.role==='uncertain')return item.text;
 const source=item.source.trim();
 const distinct=source.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:!=|≠)\s*([A-Za-z][A-Za-z0-9_]*)$/);if(distinct)return `点 $${symbolLatex(distinct[1])},${symbolLatex(distinct[2])}$ 不重合`;
 if(source.includes('\n'))return source.split('\n').map(s=>recognizedStatement({...item,source:s},names,circleNames)).join('\n\n');
 try{
  const curve=source.match(/^(?:onCurve|diameter)\(([^,]+),([^,)]+)\)$/i);
  const curves:ConstraintCurve[]=curve?[{id:curve[2].trim(),name:curve[2].trim(),type:circleNames.includes(curve[2].trim())?'circle':'ellipse',method:'centerPoint',points:[]}]:[];
  return parseConditions(source,names,'readable',curves).map(c=>conditionStatement(c,curves).map(p=>'math'in p?`$${p.math}$`:p.text).join('')).join('；');
 }catch{/* Definitions and named-coordinate relations use a different grammar. */}
 const inclination=source.match(/^inclination\(\s*([^,]+),\s*(.+)\)$/i);if(inclination)return `直线 $${symbolLatex(inclination[1])}$ 的倾斜角为 $${mathPreview(inclination[2])}${/pi|rad\(/.test(inclination[2])?'':'^{\\circ}'}$`;
 const definition=source.match(/^([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)\s*=\s*([A-Za-z]+)\((.*)\)$/);
 const math=(s:string)=>`$${mathPreview(s)}$`;
 const words:Record<string,string>={Focus:'焦点',Vertex:'顶点',Directrix:'准线',Asymptote:'渐近线',CircleCenter:'圆心',Segment:'线段',Line:'直线',Vector:'向量',Triangle:'三角形',Polygon:'多边形',Circle:'圆（圆心＋圆上一点或半径）',Circle3:'三点圆',DiameterCircle:'直径圆',Midpoint:'中点',Intersect:'交点'};
 if(definition){const [,name,fn,args]=definition;if(fn==='DiameterCircle')return `${math(name)} 是以 ${math(args.split(',').join(''))} 为直径的圆`;if(words[fn])return `${math(name)}：${words[fn]}（${math(args)}）`;}
 const curve=source.match(/^([A-Za-z][A-Za-z0-9_]*)\s*[:：](.+)$/);if(curve)return `曲线 ${math(curve[1])}：${math(curve[2])}`;
 const call=source.match(/^(onCurve|onLine|intersection|parallel|perpendicular|tangent|focus|center|directrix)\(([^()]+)\)$/i);
 if(call){const a=call[2].split(',').map(x=>x.trim()),fn=call[1].toLowerCase();
  if(fn==='oncurve'||fn==='online')return `点 ${math(a[0])} 在${fn==='online'?'直线':'曲线'} ${math(a[1])} 上`;
  if(fn==='intersection')return `点 ${math(a[0])} 是 ${math(a[1])} 与 ${math(a[2])} 的交点`;
  if(fn==='parallel'||fn==='perpendicular')return `$${symbolLatex(a[0])}${fn==='parallel'?'\\parallel':'\\perp'} ${symbolLatex(a[1])}$`;
  if(fn==='tangent')return `直线 ${math(a[0])} 与曲线 ${math(a[1])} 相切`;
  return `${math(a[0])} 是曲线 ${math(a[1])} 的${({focus:'焦点',center:'中心',directrix:'准线'} as Record<string,string>)[fn]}${a[2]?`（序号 ${a[2]}）`:''}`;
 }
 if(/^[A-Za-z][A-Za-z0-9_]*\s*=\s*\?$/.test(source))return `${math(source.split('=')[0])} 为待求参数`;
 return math(source);
}

/** Only cut at written clause boundaries, never invent a more precise quote or
 * image box. Ambiguous shared prose stays explicitly shared for user review. */
export function alignRecognitionClauses(items:RecognitionItem[],names:string[]):RecognitionItem[]{
 const refs=(s:string)=>{
  const normalized=s.replace(/\\[A-Za-z]+/g,' ').replace(/_\{([A-Za-z0-9]+)\}/g,'_$1'),found=new Set<string>();
  for(const token of normalized.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)){if(/^\s*\(/.test(normalized.slice(token.index!+token[0].length)))continue;try{entity(token[0],names).forEach(n=>found.add(n));}catch{/* Prose and command names are not point references. */}}
  return [...found];
 };
 return items.flatMap(item=>{
  if(item.modified||!item.quote)return item;
  let depth=0,math=false,start=0;const chunks:string[]=[];
  for(let i=0;i<item.quote.length;i++){const c=item.quote[i];if(c==='$')math=!math;if('({['.includes(c))depth++;if(')}]'.includes(c))depth--;if(!math&&depth===0&&/[，；。]|且/.test(c)){chunks.push(item.quote.slice(start,i).trim());start=i+1;}}
  chunks.push(item.quote.slice(start).trim());const parts=chunks.filter(Boolean);if(parts.length<2)return item;
  if(item.source.includes('\n')){const children=alignRecognitionClauses(item.source.split('\n').filter(Boolean).map((source,n)=>({...item,id:`${item.id}-relation-${n+1}`,source})),names);if(children.every(child=>!child.sharedQuote))return children;}
  const needed=refs(item.source),scored=parts.map(quote=>({quote,hits:refs(quote).filter(n=>needed.includes(n)).length})).sort((a,b)=>b.hits-a.hits);
  // A unique maximum must contain all explicitly named references. Otherwise
  // keep the original source shared rather than guess which clause it means.
  if(needed.length&&scored[0].hits===needed.length&&scored[0].hits>(scored[1]?.hits??-1)){const next={...item,quote:scored[0].quote,sharedQuote:false} as RecognitionItem&{sourceBox?:unknown};delete next.sourceBox;return next;}
  return {...item,sharedQuote:true};
 });
}
