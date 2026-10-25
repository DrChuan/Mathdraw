import {splitArguments} from '../model';
import type {DrawingDocument} from '../types';
import {parseExpression} from '../expression';
import {planarRelationPattern,planarRelationCounts,namedAngleSyntaxHint} from './planarRelations';
import {angleDegrees} from './angles';
import {entity} from './input';
import {objectSymbol} from './planarModel';

/** Syntax/reference validation never evaluates the current pose: a valid unknown
 * point may start at a degenerate position, and must still be allowed to solve. */
export function validatePlanarEquationSyntax(raw:string,doc:DrawingDocument,names:string[]){
 namedAngleSyntaxHint(raw);
 const objects=new Map(doc.objects.map(o=>[objectSymbol(o),o]));
 const point=(s:string)=>{if(!names.includes(s))throw Error(`找不到对象 ${s}`);const refs=entity(s,names);if(refs.length!==1)throw Error(`需要一个点：${s}`);};
 const line=(s:string)=>{const o=objects.get(s);if(o&&['line','segment','vector','curve'].includes(o.kind))return;const refs=entity(s,names);if(refs.length!==2)throw Error(`找不到直线或曲线 ${s}`);};
 const curve=(s:string)=>{if(objects.get(s)?.kind!=='curve')throw Error(`找不到曲线 ${s}`);};
 const vars=doc.objects.filter(o=>o.kind==='number').map(objectSymbol);
 const numeric=(s:string)=>{
  s=s.replace(/\b(x|y|a|b|c|e|p|radius|eccentricity|focalDistance|length|Length)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,fn:string,ref:string)=>{if(fn==='x'||fn==='y')point(ref);else if(/length/i.test(fn))line(ref);else curve(ref);return '(1)';});
  s=s.replace(/\b(dot|sinAngle|cosAngle|tanAngle)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*,\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,_fn:string,a:string,b:string)=>{line(a);line(b);return '(1)';});
  s=s.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g,(token,offset:number)=>{if(vars.includes(token)||/^\s*\(/.test(s.slice(offset+token.length))||['pi','e'].includes(token))return token;try{if(entity(token,names).length===2)return '(1)';}catch{/* The expression parser reports unknown symbols. */}return token;});
  parseExpression(s,vars);
 };
 const source=raw.trim().replace(/\\(?:perp|bot)\b|⊥/g,'⟂').replace(/\\parallel\b|∥/g,'//');
 const infix=source.match(/^(.+?)\s*(⟂|\/\/)\s*(.+)$/);if(infix){line(infix[1].trim());line(infix[3].trim());return;}
 const call=source.match(planarRelationPattern);
 if(call){const fn=call[1].toLowerCase(),a=splitArguments(call[2]);
  const counts=planarRelationCounts;
  if(!counts[fn].includes(a.length)||a.some(s=>!s))throw Error(`${call[1]} 参数数量不正确`);
  if(fn==='oncurve'||fn==='online'){entity(a[0],names).forEach(point);line(a[1]);}
  else if(fn==='intersection'){point(a[0]);line(a[1]);line(a[2]);}
  else if(fn==='pointlinedistance'){point(a[0]);line(a[1]);numeric(a[2]);}
  else if(['center','focus'].includes(fn)){point(a[0]);curve(a[1]);if(a[2]){if(!/^[12]$/.test(a[2]))throw Error('焦点序号为 1 或 2');}}
  else if(fn==='directrix'){line(a[0]);curve(a[1]);if(a[2]&&!/^[12]$/.test(a[2]))throw Error('准线序号为 1 或 2');}
  else if(fn==='tangent'){line(a[0]);curve(a[1]);}
  else if(fn==='inclination'){line(a[0]);numeric(a[1].replace(/^rad\(([\s\S]*)\)$/i,'$1'));try{const degrees=angleDegrees(a[1]);if(degrees<0||degrees>=180)throw Error('倾斜角必须在 [0,180°) 内');}catch(e){if((e as Error).message.includes('倾斜角'))throw e;}}
  else if(fn==='lineangle'){line(a[0]);line(a[1]);numeric(a[2].replace(/^rad\(([\s\S]*)\)$/i,'$1'));let degrees:number|undefined;try{degrees=angleDegrees(a[2]);}catch{/* A parameter is checked during evaluation. */}if(degrees!==undefined&&(degrees<0||degrees>90))throw Error('线线夹角必须在 0～90° 内；倾斜角请用 inclination');}
  else if(fn==='distance'){line(a[0]);numeric(a[1]);}
  else {line(a[0]);line(a[1]);if(a[2])numeric(fn==='lineangle'?a[2].replace(/^rad\(([\s\S]*)\)$/i,'$1'):a[2]);}return;
 }
 if(/^vectorRelation\s*\(/i.test(source)||/\bvec\s*\(|\\(?:vec|overrightarrow)\b/.test(source)){
  const body=source.replace(/^vectorRelation\s*\(([\s\S]*)\)$/i,'$1').replace(/(?:vec\s*\(([^)]+)\)|\\(?:vec|overrightarrow)\s*\{([^{}]+)\})/g,(_,a:string,b:string)=>{line((a??b).trim());return '(1)';});
  const parts=body.split('=');if(parts.length!==2)throw Error('向量等式需要一个等号');parts.forEach(numeric);return;
 }
 const parts=source.replace(/＝/g,'=').replace(/\\(?:leq|le)\b|≤/g,'<=').replace(/\\(?:geq|ge)\b|≥/g,'>=').split(/<=|>=|<|>|=/);
 if(parts.length!==2||parts.some(p=>!p.trim()))throw Error('请输入一个有效等式或范围关系');parts.forEach(numeric);
}
