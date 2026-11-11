import type {DrawingDocument} from '../types';
import {objectSymbol} from './planarModel';
import {validSymbol} from '../model';
import {splitArguments} from '../model';
/** One visible operation: independent circle coordinates and an optional
 * positive radius, followed by precisely the selected tangency relations. */
export function unknownCircleSource(document:DrawingDocument,name:string,x:string,y:string,radius:string,lines:string[]=[]){
 const used=new Set(document.objects.map(objectSymbol));used.add(name);
 const fresh=(base:string)=>{let n=base,i=1;while(used.has(n)||!validSymbol(n))n=`${base}_${i++}`;used.add(n);return n;};
 const center=fresh('C'),r=fresh('r');
 const rows=[`${center}=(${x.trim()||'?'},${y.trim()||'?'})`,`${r}=${radius.trim()||'?'}`,`${name}=Circle(${center},${r})`,`${r}>0`];
 return [...rows,...tangencySources(lines.join(','),name)].join('\n');
}
export function tangencySources(lines:string,curve:string){
 const refs=[...new Set(splitArguments(lines.replace(/，/g,',')).map(s=>s.trim()).filter(Boolean))];
 if(!refs.length||!curve.trim())return [];
 return refs.map(line=>`tangent(${line},${curve.trim()})`);
}
