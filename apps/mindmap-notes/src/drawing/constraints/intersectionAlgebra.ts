import {normalizeRationalExpression} from './exactSystem';
import {parseExpression,evaluate} from '../expression';
/** Ordered real intersections of a full line and quadratic. A chart is used
 * only when its pivots are known nonzero; unsupported exceptional charts are
 * left to the native intersection evaluator, never silently thrown away. */
export function lineConicPoint(q:string[],line:string[],branch:number,tokens:string[]){
 if(branch>1)throw Error('直线与二次曲线最多有两个交点');
 const guards:string[]=[],simp=(s:string)=>{const n=normalizeRationalExpression(s,tokens);n?.guards.forEach(g=>guards.push(g));return n?.source??s;};
 const known=(s:string)=>{try{const v=evaluate(parseExpression(s,tokens));return Number.isFinite(v)?v:undefined;}catch{return;}};
 const [A,B,C,D,E,F]=q,[u,v,w]=line.map(simp),kv=known(v),ku=known(u);
 let vertical=false,m:string,n:string;
 if(kv!==undefined&&kv!==0){m=simp(`-(${u})/(${v})`);n=simp(`-(${w})/(${v})`);}
 else if(kv===0&&ku!==undefined&&ku!==0){vertical=true;m='0';n=simp(`-(${w})/(${u})`);}
 else throw Error('交点的直线方向尚需多个代数分支，保留原生求交定义');
 const a=simp(vertical?C:`(${A})+(${B})*(${m})+(${C})*(${m})^2`),b=simp(vertical?`(${B})*(${n})+(${E})`:`(${B})*(${n})+2*(${C})*(${m})*(${n})+(${D})+(${E})*(${m})`),c=simp(vertical?`(${A})*(${n})^2+(${D})*(${n})+(${F})`:`(${C})*(${n})^2+(${E})*(${n})+(${F})`);
 const ka=known(a);let root:string;
 if(ka===0){const kb=known(b);if(kb===undefined||kb===0)throw Error('退化交点方程尚需分支判断');if(branch>0)guards.push('1=0');root=simp(`-(${c})/(${b})`);}
 else if(ka!==undefined){const disc=simp(`(${b})^2-4*(${a})*(${c})`);guards.push(`(${disc})${branch?'>':'>='}0`);root=simp(`-(${b})/(2*(${a}))${branch?'+':'-'}sqrt(${disc})/(2*abs(${a}))`);}
 else throw Error('交点的二次项可能退化，保留原生求交定义');
 return {point:(vertical?[n,root]:[root,simp(`(${m})*(${root})+(${n})`)]) as [string,string],guards};
}
