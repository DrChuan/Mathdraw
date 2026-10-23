import { parseExpression } from '../expression';
import type { AlgebraicValue } from './types';
type Q={n:bigint;d:bigint};type P=Q[];
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a<0n?-a:a;
const q=(n:bigint,d=1n):Q=>{if(!d)throw Error('除数为零');const g=gcd(n,d);return {n:(d<0n?-n:n)/g,d:(d<0n?-d:d)/g};};
const zero=q(0n),one=q(1n),plus=(a:Q,b:Q)=>q(a.n*b.d+b.n*a.d,a.d*b.d),neg=(a:Q)=>q(-a.n,a.d),times=(a:Q,b:Q)=>q(a.n*b.n,a.d*b.d),div=(a:Q,b:Q)=>q(a.n*b.d,a.d*b.n);
const number=(x:Q)=>Number(x.n)/Number(x.d),text=(x:Q)=>x.d===1n?String(x.n):`(${x.n}/${x.d})`;
function decimal(v:number):Q {const [mantissa,exponent='0']=String(v).toLowerCase().split('e'),digits=mantissa.split('.'),scale=(digits[1]?.length??0)-Number(exponent),n=BigInt(digits.join(''));return scale>=0?q(n,10n**BigInt(scale)):q(n*10n**BigInt(-scale));}
const clean=(p:P)=>{while(p.length>1&&!p.at(-1)!.n)p.pop();return p;};
const add=(a:P,b:P)=>clean(Array.from({length:Math.max(a.length,b.length)},(_,i)=>plus(a[i]??zero,b[i]??zero)));
const mul=(a:P,b:P)=>{if(a.length+b.length>20)throw Error('精确多项式次数超限');const p=Array(a.length+b.length-1).fill(zero) as P;a.forEach((v,i)=>b.forEach((w,j)=>p[i+j]=plus(p[i+j],times(v,w))));return clean(p);};
function remainder(a:P,b:P){let r=[...a];while(r.length>=b.length&&r.some(v=>v.n)){const k=r.length-b.length,c=div(r.at(-1)!,b.at(-1)!);b.forEach((v,i)=>r[k+i]=plus(r[k+i],neg(times(c,v))));r=clean(r);}return r;}
function quotient(a:P,b:P){let r=[...a];const out=Array(Math.max(1,a.length-b.length+1)).fill(zero) as P;while(r.length>=b.length&&r.some(v=>v.n)){const k=r.length-b.length,c=div(r.at(-1)!,b.at(-1)!);out[k]=c;b.forEach((v,i)=>r[k+i]=plus(r[k+i],neg(times(c,v))));r=clean(r);}if(r.some(v=>v.n))throw Error('不能整除');return clean(out);}
function polynomialGcd(a:P,b:P){while(b.some(v=>v.n)){const r=remainder(a,b);a=b;b=r;}return a;}
const at=(p:P,x:Q)=>p.reduceRight((s,v)=>plus(times(s,x),v),zero);
/** Rational AST interpretation followed by an exact Sturm chain. No sampled
 * rational/radical recognition is used to certify a numerical answer. */
export function algebraicRoots(source:string,variable:string,constants:Record<string,number>={},deadline=Date.now()+500):AlgebraicValue[]|undefined {
  try {
    if(/\\pi\b|\bpi\b|\b(?:sin|cos|tan|exp|ln|log)\b/.test(source))return;
    const parts=source.split('=');if(parts.length!==2||/[<>]/.test(source))return;
    type R={n:P;d:P};
    const walk=(a:ReturnType<typeof parseExpression>):R=>{
      if(a.type==='number')return {n:[decimal(a.value)],d:[one]};
      if(a.type==='variable'){if(a.name===variable)return {n:[zero,one],d:[one]};if(a.name in constants)return {n:[decimal(constants[a.name])],d:[one]};throw Error('未知符号');}
      if(a.type==='call')throw Error('非有理函数');
      if(a.type==='unary'){const r=walk(a.value);return {n:r.n.map(v=>times(v,q(BigInt(a.sign)))),d:r.d};}
      const x=walk(a.left),y=walk(a.right);
      if(a.op==='+'||a.op==='-')return {n:add(mul(x.n,y.d),mul(y.n,x.d).map(v=>a.op==='-'?neg(v):v)),d:mul(x.d,y.d)};
      if(a.op==='*')return {n:mul(x.n,y.n),d:mul(x.d,y.d)};
      if(a.op==='/')return {n:mul(x.n,y.d),d:mul(x.d,y.n)};
      if(y.n.length!==1||y.d.length!==1)throw Error('非整数幂');const power=number(div(y.n[0],y.d[0]));if(!Number.isInteger(power)||Math.abs(power)>8)throw Error('幂次超限');let n:P=[one],d:P=[one];for(let i=0;i<Math.abs(power);i++){n=mul(n,power<0?x.d:x.n);d=mul(d,power<0?x.n:x.d);}return {n,d};
    };
    const variables=[variable,...Object.keys(constants)],left=walk(parseExpression(parts[0],variables)),right=walk(parseExpression(parts[1],variables)),den=mul(left.d,right.d);
    let p=add(mul(left.n,right.d),mul(right.n,left.d).map(neg));
    if(p.length===1)return p[0].n?[]:undefined;
    if(p.length>10)return;
    // Every root shared with a denominator is excluded, including repeated
    // roots; a near-pole floating evaluation must never reintroduce it.
    for(let i=0;i<10;i++){const common=polynomialGcd(p,den);if(common.length<2)break;p=quotient(p,common);}
    if(p.length<2)return [];
    // Square-free reduction is essential when an isolating boundary lands on
    // a repeated root (resultants routinely contain such multiplicities).
    const repeated=polynomialGcd(p,p.slice(1).map((v,i)=>times(v,q(BigInt(i+1)))));
    if(repeated.length>1)p=quotient(p,repeated);
    const derivative=p.slice(1).map((v,i)=>times(v,q(BigInt(i+1)))),chain=[p,derivative];
    while(chain.at(-1)!.length>1){if(Date.now()>deadline)return;const r=remainder(chain.at(-2)!,chain.at(-1)!).map(neg);if(!r.some(v=>v.n))break;chain.push(r);}
    const variations=(x:Q)=>{let last=0,n=0;for(const c of chain){const value=at(c,x).n,sign=value<0n?-1:value>0n?1:0;if(sign&&last&&sign!==last)n++;if(sign)last=sign;}return n;};
    const bound=Math.ceil(2+Math.max(...p.slice(0,-1).map(v=>Math.abs(number(div(v,p.at(-1)!))))));if(!Number.isFinite(bound)||bound>1e9)return;
    const common=p.reduce((n,v)=>n*v.d/gcd(n,v.d),1n),ints=p.map(v=>v.n*(common/v.d)),factor=ints.reduce(gcd),coefficients=ints.map(v=>String(v/factor));
    const roots:AlgebraicValue[]=[],queue:[Q,Q,number][]=[[q(BigInt(-bound)),q(BigInt(bound)),variations(q(BigInt(-bound)))-variations(q(BigInt(bound)))]];
    let count=0;
    while(queue.length){if(Date.now()>deadline||++count>4000)return;const [lo,hi,n]=queue.pop()!;if(!n)continue;const a=number(lo),b=number(hi);
      if(n===1&&b-a<1e-12*Math.max(1,Math.abs(a),Math.abs(b))&&!(a<=0&&b>=0&&p[0].n)){const x=(a+b)/2;
        let expression:string|undefined;if(p.length===2)expression=text(neg(div(p[0],p[1])));
        if(p.length===3){const discriminant=plus(times(p[1],p[1]),neg(times(q(4n),times(p[2],p[0])))),a2=times(q(2n),p[2]),s=Math.sqrt(number(discriminant)),sign=Math.abs(number(div(plus(neg(p[1]),decimal(s)),a2))-x)<Math.abs(number(div(plus(neg(p[1]),decimal(-s)),a2))-x)?'+':'-';expression=`(-(${text(p[1])})${sign}sqrt(${text(discriminant)}))/(${text(a2)})`;}
        roots.push({polynomial:coefficients,interval:[a,b],approximate:x,expression});continue;}
      const mid=div(plus(lo,hi),q(2n)),leftCount=variations(lo)-variations(mid);queue.push([mid,hi,n-leftCount],[lo,mid,leftCount]);
    }
    const rational=new Map<AlgebraicValue,Q>();
    for(const root of roots)for(let denominator=1;denominator<=512;denominator++){
      const candidate=q(BigInt(Math.round(root.approximate*denominator)),BigInt(denominator));
      if(number(candidate)>=root.interval[0]&&number(candidate)<=root.interval[1]&&!at(p,candidate).n){root.expression=text(candidate);root.approximate=number(candidate);rational.set(root,candidate);break;}
    }
    for(const root of roots)if(!rational.has(root)){
      let factor=p;for(const candidate of rational.values())if(factor.length>2)factor=quotient(factor,[neg(candidate),one]);
      if(factor.length===3){const [c,b,a]=factor;if(!b.n)root.expression=`${root.approximate<0?'-':''}sqrt(${text(neg(div(c,a)))})`;}
    }
    return roots.sort((a,b)=>a.approximate-b.approximate);
  } catch {return;}
}

/** Exact bivariate rational elimination. Small Sylvester determinants cover
 * quadratic curves and rational parameter conditions without shape-specific
 * formulas. Higher-degree/transcendental systems explicitly fall back. */
export function algebraicSystem(sources:string[],variables:[string,string],constants:Record<string,number>={},deadline=Date.now()+600):[AlgebraicValue,AlgebraicValue][]|undefined {
  type B=Map<string,Q>;type R={n:B;d:B};
  const constant=(v:Q):B=>new Map([['0,0',v]]),tidy=(p:B)=>new Map([...p].filter(([,v])=>v.n));
  const sum=(a:B,b:B,sign=1)=>{const p=new Map(a);for(const [k,v]of b)p.set(k,plus(p.get(k)??zero,sign===1?v:neg(v)));return tidy(p);};
  const product=(a:B,b:B)=>{const p:B=new Map();for(const [ka,x]of a)for(const [kb,y]of b){const i=ka.split(',').map(Number),j=kb.split(',').map(Number),u=i[0]+j[0],v=i[1]+j[1];if(u+v>12||Date.now()>deadline)throw Error('消元预算耗尽');const k=`${u},${v}`;p.set(k,plus(p.get(k)??zero,times(x,y)));}return tidy(p);};
  const walk=(a:ReturnType<typeof parseExpression>):R=>{
    if(a.type==='number')return {n:constant(decimal(a.value)),d:constant(one)};
    if(a.type==='variable'){const i=variables.indexOf(a.name);if(i>=0)return{n:new Map([[i===0?'1,0':'0,1',one]]),d:constant(one)};if(a.name in constants)return {n:constant(decimal(constants[a.name])),d:constant(one)};throw Error('未知符号');}
    if(a.type==='call')throw Error('非有理表达式');
    if(a.type==='unary'){const r=walk(a.value);return {n:new Map([...r.n].map(([k,v])=>[k,times(v,q(BigInt(a.sign)))])),d:r.d};}
    const a0=walk(a.left),b0=walk(a.right);
    if(a.op==='+'||a.op==='-')return {n:sum(product(a0.n,b0.d),product(b0.n,a0.d),a.op==='+'?1:-1),d:product(a0.d,b0.d)};
    if(a.op==='*')return {n:product(a0.n,b0.n),d:product(a0.d,b0.d)};
    if(a.op==='/')return {n:product(a0.n,b0.d),d:product(a0.d,b0.n)};
    if([...b0.n.keys(),...b0.d.keys()].some(k=>k!=='0,0'))throw Error('非整数幂');const power=number(div(b0.n.get('0,0')??zero,b0.d.get('0,0')??zero));if(!Number.isInteger(power)||Math.abs(power)>6)throw Error('幂次超限');let n=constant(one),d=constant(one);for(let i=0;i<Math.abs(power);i++){n=product(n,power<0?a0.d:a0.n);d=product(d,power<0?a0.n:a0.d);}return {n,d};
  };
  const resultant=(a:B,b:B,swap=false):P=>{
    const group=(p:B)=>{const out:P[]=[];for(const [key,v]of p){let [i,j]=key.split(',').map(Number);if(swap)[i,j]=[j,i];out[j]??=[];out[j][i]=v;}for(let i=0;i<out.length;i++)out[i]=clean(Array.from({length:out[i]?.length??1},(_,j)=>out[i]?.[j]??zero));while(out.length>1&&!out.at(-1)!.some(v=>v.n))out.pop();return out;};
    const x=group(a),y=group(b),m=x.length-1,n=y.length-1,size=m+n;
    if(size===0)return [zero];if(size>6)throw Error('消元次数超限');
    const rows=Array.from({length:size},(_,r)=>Array.from({length:size},(_,c):P=>r<n?x[m-(c-r)]??[zero]:y[n-(c-(r-n))]??[zero]));
    const memo=new Map<number,P>();
    const det=(mask:number):P=>{if(Date.now()>deadline)throw Error('消元预算耗尽');if(mask===(1<<size)-1)return[one];const cached=memo.get(mask);if(cached)return cached;const row=mask.toString(2).replace(/0/g,'').length;let out:P=[zero],position=0;
      for(let c=0;c<size;c++)if(!(mask>>c&1)){const v=mul(rows[row][c],det(mask|1<<c));out=add(out,v.map(x=>position%2?neg(x):x));position++;}memo.set(mask,out);return out;};
    return clean(det(0));
  };
  try{
    const equations=sources.flatMap(source=>{if(/[<>]|\\pi\b|\bpi\b/.test(source))return [];const parts=source.split('=');if(parts.length!==2)return [];const a=walk(parseExpression(parts[0],[...variables,...Object.keys(constants)])),b=walk(parseExpression(parts[1],[...variables,...Object.keys(constants)]));return [{n:sum(product(a.n,b.d),product(b.n,a.d),-1),d:product(a.d,b.d)}];});
    for(let i=0;i<equations.length;i++)for(let j=i+1;j<equations.length;j++){
      const a=resultant(equations[i].n,equations[j].n),b=resultant(equations[i].n,equations[j].n,true);if(a.length<2||b.length<2)continue;
      const source=(p:P)=>`${p.map((v,k)=>`(${text(v)})${k?`*t^${k}`:''}`).join('+')}=0`;
      const xs=algebraicRoots(source(a),'t',{},deadline),ys=algebraicRoots(source(b),'t',{},deadline);if(!xs||!ys)return;
      const pairs:[AlgebraicValue,AlgebraicValue][]=[];
      for(const x of xs)for(const y of ys){
        const value=(p:B)=>[...p].reduce((s,[key,c])=>{const [i,j]=key.split(',').map(Number);return s+number(c)*x.approximate**i*y.approximate**j;},0);
        if(equations.every(e=>{const d=value(e.d),n=value(e.n);return Math.abs(d)>1e-10&&Math.abs(n/d)<1e-6;}))pairs.push([x,y]);
      }
      return pairs;
    }
  }catch{return;}
}
