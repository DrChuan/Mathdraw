import {parseExpression} from '../expression';
import {symbolicConicCoefficients} from './conicAlgebra';
import {q,rational,plus,minus,times,divide,neg,cmp,str,type Q} from './exactArithmetic';
type Ast=ReturnType<typeof parseExpression>;
const two=q(2n),four=q(4n);
const sq=(a:Q)=>times(a,a);
/** Constant source arithmetic, not a rational approximation of resolved pixels. */
function value(a:Ast):Q {
 if(a.type==='number')return rational(a.constant??a.literal??a.value);
 if(a.type==='unary')return a.sign<0?neg(value(a.value)):value(a.value);
 if(a.type==='binary'){
  const l=value(a.left),r=value(a.right);
  if(a.op==='+')return plus(l,r);if(a.op==='-')return minus(l,r);if(a.op==='*')return times(l,r);if(a.op==='/')return divide(l,r);
  if(r.d===1n&&r.n>=0n&&r.n<=12n){let v=q(1n);for(let i=0n;i<r.n;i++)v=times(v,l);return v;}
 }
 throw Error('系数并非已知有理表达式');
}
function root(n:bigint){if(n<0n)throw Error('负数开方');let a=0n,b=n+1n;while(b-a>1n){const m=(a+b)/2n;if(m*m<=n)a=m;else b=m;}return a*a===n?a:undefined;}
const radical=(a:Q)=>{const n=root(a.n),d=root(a.d);return n!==undefined&&d!==undefined?str(q(n,d)):`sqrt(${str(a)})`;};
/** Known axis-aligned conic features, including translated equations. Retain
 * radicals in source form; never freeze a parameter-dependent definition. */
export function knownConicFeature(source:string,feature:'focus'|'vertex'|'curveCenter'|'directrix'|'asymptote',index:number):{point?:[string,string];line?:string}|undefined {
 try{
  const [A,B,C,D,E,F]=symbolicConicCoefficients(source,[]).map(s=>value(parseExpression(s)));
  if(B.n||!Number.isInteger(index)||index<0)return;
  if(!A.n||!C.n){
   const axis=!A.n?0:1,curved=axis===0?C:A,linear=axis===0?D:E,other=axis===0?E:D;
   if(!curved.n||!linear.n||index!==0||!['focus','vertex','directrix'].includes(feature))return;
   const cross=divide(neg(other),times(two,curved)),along=divide(minus(divide(sq(other),times(four,curved)),F),linear),p=divide(neg(linear),times(four,curved));
   const center=[along,cross];if(axis)center.reverse();
   if(feature==='directrix')return {line:`${axis?'y':'x'}=(${str(minus(along,p))})`};
   if(feature==='focus')center[axis]=plus(center[axis],p);
   return {point:center.map(str) as [string,string]};
  }
  const h=divide(neg(D),times(two,A)),k=divide(neg(E),times(two,C)),K=minus(plus(divide(sq(D),times(four,A)),divide(sq(E),times(four,C))),F),r=[divide(K,A),divide(K,C)];
  if(!K.n)return;
  const ellipse=times(A,C).n>0n,axis=ellipse?(cmp(r[0],r[1])>=0?0:1):(r[0].n>0n?0:1),other=1-axis;
  if(r[axis].n<=0n||ellipse&&r[other].n<=0n)return;
  const c2=minus(r[axis],r[other]),center=[str(h),str(k)];
  if(feature==='curveCenter')return ellipse&&cmp(r[0],r[1])===0?{point:center as [string,string]}:undefined;
  if(feature==='vertex'){
   if(index>=(ellipse?4:2))return;const which=index<2?axis:other;
   center[which]=`(${center[which]})${index%2?'+':'-'}(${radical(r[which])})`;return {point:center as [string,string]};
  }
  if(feature==='asymptote'){
   if(ellipse||index>1)return;const slope=radical(divide(neg(r[other]),r[axis]));
   return {line:`(${other?'y':'x'}-(${center[other]}))=${(axis===0)===(index===0)?'-':''}(${slope})*(${axis?'y':'x'}-(${center[axis]}))`};
  }
  if(c2.n<=0n||index>1)return;
  if(feature==='focus'){center[axis]=`(${center[axis]})${index?'+':'-'}(${radical(c2)})`;return {point:center as [string,string]};}
  return {line:`${axis?'y':'x'}=(${center[axis]})${index?'+':'-'}((${str(r[axis])})/(${radical(c2)}))`};
 }catch{return;}
}
