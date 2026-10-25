import {planarRelationPattern,planarRelationReferences} from '../constraints/planarRelations';
import type {RecognizedQuestion,RecognitionItem} from './types';
import {isVariableSymbol,numericFunctions} from '../symbols';
import {splitRecognitionSource} from './model';
const identifier=/[A-Za-z][A-Za-z0-9_]*/g;
const mentions=(text:string,name:string)=>{const s=text.replace(/_\{([A-Za-z0-9]+)\}/g,'_$1');return [...s.matchAll(identifier)].some(m=>m[0]===name&&s[m.index!-1]!=='\\');};
/** Rename numerical identifiers only. Function names, point/curve arguments and
 * quoted annotations are independent bindings, even when they use the same text. */
function rewrite(source:string,aliases:Map<string,string>,points:Set<string>){
 const equation=/^[A-Za-z][A-Za-z0-9_]*\s*[:：]/.test(source),binding=source.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?::|：|=\s*(\(|([A-Za-z][A-Za-z0-9_]*)\s*\())/),bindingName=binding&&(!binding[3]||!numericFunctions.has(binding[3].toLowerCase()))?binding[1]:undefined;
 const relation=source.match(planarRelationPattern)?.[1].toLowerCase();
 const stack:{fn:string;arg:number}[]=[];let result='',at=0,quote='';
 const reference=(frame:{fn:string;arg:number},symbol:string)=>{
  const fn=frame.fn.toLowerCase();if(relation&&frame===stack[0])return frame.arg<planarRelationReferences[relation];if(!fn||numericFunctions.has(fn)&&!['e'].includes(fn))return false;
  if(['x','y','z','a','b','c','e','p','radius','eccentricity','focaldistance','length'].includes(fn))return true;
  if(['focus','vertex','directrix','asymptote','pointx','pointy','on','axispoint'].includes(fn))return frame.arg===0;
  if(fn==='inclination')return frame.arg===0;
  if(fn==='circle')return frame.arg===0||frame.arg===1&&points.has(symbol);
  if(fn==='distance')return frame.arg===0||frame.arg===1&&points.has(symbol);
  if(['ratio','lineangle','vertexangle','lineplaneangle','dihedral','division','pointlinedistance','pointplanedistance'].includes(fn))return frame.arg<2;
  return true;
 };
 while(at<source.length){const c=source[at];if(quote){result+=c;at++;if(c===quote&&source[at-2]!=='\\')quote='';continue;}if(c==='"'||c==="'"){quote=c;result+=c;at++;continue;}
  const token=source.slice(at).match(/^[A-Za-z][A-Za-z0-9_]*/);if(token){const name=token[0],call=/^\s*\(/.test(source.slice(at+name.length)),protectedRef=stack.some(f=>reference(f,name));result+=source[at-1]==='\\'||call||protectedRef||(at===0&&name===bindingName)||(equation&&['x','y','u','v'].includes(name))?name:aliases.get(name)??name;at+=name.length;continue;}
  if(c==='('){const fn=source.slice(0,at).match(/([A-Za-z][A-Za-z0-9_]*)\s*$/)?.[1]??'';stack.push({fn,arg:0});}else if(c===')')stack.pop();else if(c===','&&stack.length)stack.at(-1)!.arg++;
  result+=c;at++;
 }return result;
}
/** API output has item-local helper declarations, plus the explicit question
 * scope tree. Allocate helpers locally, then propagate aliases to descendant
 * scopes. Original quotes never change. Explicit original symbols take priority. */
export function repairRecognitionSymbols(q:RecognizedQuestion):RecognizedQuestion {
 if(q.mode!=='coordinate'||q.textOnly)return q;
 const points=new Set([...q.points.split(/[\s,，;；]+/).filter(Boolean),'O']),used=new Set(points);
 const objects=new Set(q.items.flatMap(i=>splitRecognitionSource(i.source).flatMap(row=>{const m=row.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?::|=\s*[A-Za-z]+\()/);return m?[m[1]]:[];})));
 for(const item of q.items)for(const token of item.source.match(identifier)??[])used.add(token);
 const scopes=new Map(q.scopes.map(s=>[s.id,s])),states=new Map<string,Map<string,{name:string;source:string;implicit?:boolean}>>(),done=new Set<string>(),items=new Map<string,RecognitionItem>(),warnings=[...q.warnings];
 const fresh=(name:string)=>{const base=/^[A-Za-z](?:_[A-Za-z0-9]+)?$/.test(name)?name:'t';let i=1,next=`${base}_${i}`;if(!isVariableSymbol(next))next=`t_${i}`;while(used.has(next)){i++;next=isVariableSymbol(`${base}_${i}`)?`${base}_${i}`:`t_${i}`;}used.add(next);return next;};
 const visit=(scope:string)=>{
  if(done.has(scope))return;const parent=scopes.get(scope)?.parent;if(parent)visit(parent);
  const state=new Map(parent?states.get(parent):undefined);
  for(const item of q.items.filter(i=>i.scope===scope)){
   const aliases=new Map([...state].map(([from,b])=>[from,b.name])),renames:{from:string;to:string}[]=[],rows:string[]=[];
   // A symbol explicitly written in this original phrase refers to the original
   // question binding, not an unrelated helper declared by a preceding item.
   for(const name of aliases.keys())if(mentions(item.quote??'',name))aliases.delete(name);
   for(const row of splitRecognitionSource(item.source)){
    const declaration=row.match(/^([A-Za-z](?:_[A-Za-z0-9]+)?)\s*=\s*\?$/);
    if(declaration){const name=declaration[1],previous=state.get(name),original=mentions(item.quote??'',name);
     if(!item.modified&&previous&&original&&previous.name===name){aliases.delete(name);continue;}
     const sameImplicit=previous?.implicit&&previous.source===item.id;
     const target=item.modified||sameImplicit?name:previous||points.has(name)||objects.has(name)||!(name==='e'||isVariableSymbol(name))?fresh(name):name;
     state.set(name,{name:target,source:item.id});aliases.set(name,target);if(target!==name)renames.push({from:name,to:target});
     rows.push(`${target}=?`);continue;
    }
    rows.push(item.modified?row:rewrite(row,aliases,points));
    const formula=row.match(/^[A-Za-z][A-Za-z0-9_]*\s*[:：]([\s\S]+)$/);
    if(formula)for(const token of formula[1].matchAll(identifier)){const name=token[0],before=formula[1].slice(0,token.index),call=/^\s*\(/.test(formula[1].slice(token.index!+name.length));if(!call&&!before.endsWith('\\')&&isVariableSymbol(name)&&!points.has(name)&&!objects.has(name)&&!state.has(name))state.set(name,{name,source:item.id,implicit:true});}

   }
   const source=item.modified?item.source:rows.join('\n'),changed=source!==item.source;
   const notes=renames.map(({from,to})=>`辅助参数 ${from} 与已有符号冲突，已自动改为 ${to}`);
   if(!source.trim()&&item.source.trim()){warnings.push('已合并重复的原题参数声明');items.set(item.id,{...item,enabled:false,originalSource:item.originalSource??item.source});}
   else items.set(item.id,{...item,source,...(changed?{originalSource:item.originalSource??item.source}:{}),...(renames.length?{symbolRenames:[...(item.symbolRenames??[]),...renames]}:{})});
   warnings.push(...notes);
  }
  states.set(scope,state);done.add(scope);
 };
 for(const scope of q.scopes)visit(scope.id);
 return {...q,items:q.items.map(i=>items.get(i.id)??i),warnings:[...new Set(warnings)].slice(0,100)};
}
