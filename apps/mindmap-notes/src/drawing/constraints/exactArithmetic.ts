import {parseExpression} from '../expression';
/** Exact rational/polynomial arithmetic. No decimal reconstruction is used to
 * certify an input literal or an algebraic root. All loops are budgeted. */
export class ExactLimit extends Error {
  constructor(public code:'timeout'|'complexity'|'unsupported', message:string){super(message);}
}
export class Budget {
  operations=0;
  constructor(public deadline=Date.now()+1000,public limit=150000){}
  tick(n=1){this.operations+=n;if(this.operations>this.limit)throw new ExactLimit('complexity','精确运算规模超限');if(Date.now()>this.deadline)throw new ExactLimit('timeout','精确计算时间预算耗尽');}
}
export type Q={n:bigint;d:bigint};
export const gcd=(a:bigint,b:bigint):bigint=>{while(b){[a,b]=[b,a%b];}return a<0n?-a:a;};
export function q(n:bigint,d=1n):Q {if(!d)throw Error('精确表达式除以零');const g=gcd(n,d);n/=g;d/=g;if(d<0n){n=-n;d=-d;}if(n.toString(2).length+d.toString(2).length>20000)throw new ExactLimit('complexity','有理系数过大');return {n,d};}
export const Z=q(0n),O=q(1n);
export const plus=(a:Q,b:Q)=>q(a.n*b.d+b.n*a.d,a.d*b.d),neg=(a:Q)=>q(-a.n,a.d),minus=(a:Q,b:Q)=>plus(a,neg(b)),times=(a:Q,b:Q)=>q(a.n*b.n,a.d*b.d),divide=(a:Q,b:Q)=>q(a.n*b.d,a.d*b.n);
export const sign=(a:Q)=>a.n<0n?-1:a.n>0n?1:0,cmp=(a:Q,b:Q)=>sign(minus(a,b)),str=(a:Q)=>a.d===1n?String(a.n):`${a.n}/${a.d}`;
export function num(a:Q):number {
 const n=Number(a.n),d=Number(a.d);if(Number.isFinite(n)&&Number.isFinite(d))return n/d;if(!a.n)return 0;
 const negative=a.n<0n,ns=(negative?-a.n:a.n).toString(),ds=a.d.toString(),np=ns.slice(0,17),dp=ds.slice(0,17);
 return (negative?-1:1)*(Number(np)/Number(dp))*10**(ns.length-np.length-ds.length+dp.length);
}
export function rational(s:string|number):Q {
  const source=String(s).replace(/[()\s]/g,'');
  if(source.includes('/')){const [a,b,...rest]=source.split('/');if(rest.length)throw Error('有理数格式错误');return divide(rational(a),rational(b));}
  const m=source.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!m||!(m[2]||m[3]))throw Error('有理数格式错误');
  const exponent=Number(m[4]??0)-(m[3]?.length??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>4000)throw new ExactLimit('complexity','十进制指数超限');
  const n=BigInt((m[1]??'')+(m[2]||'0')+(m[3]??''));return exponent>=0?q(n*10n**BigInt(exponent)):q(n,10n**BigInt(-exponent));
}
export type U=Q[];
export const trim=(p:U):U=>{while(p.length>1&&!p.at(-1)!.n)p.pop();return p;};
export const ua=(a:U,b:U)=>trim(Array.from({length:Math.max(a.length,b.length)},(_,i)=>plus(a[i]??Z,b[i]??Z)));
export const us=(a:U,b:U)=>ua(a,b.map(neg));
export function um(a:U,b:U):U {if(a.length+b.length>100)throw new ExactLimit('complexity','多项式次数超限');const p=Array(a.length+b.length-1).fill(Z) as U;a.forEach((x,i)=>b.forEach((y,j)=>p[i+j]=plus(p[i+j],times(x,y))));return trim(p);}
export function udiv(a:U,b:U):{quotient:U;remainder:U}{if(!b.some(x=>x.n))throw Error('零多项式除数');let r=[...a];const out=Array(Math.max(1,a.length-b.length+1)).fill(Z) as U;while(r.length>=b.length&&r.some(x=>x.n)){const k=r.length-b.length,c=divide(r.at(-1)!,b.at(-1)!);out[k]=plus(out[k],c);b.forEach((v,i)=>r[k+i]=minus(r[k+i],times(c,v)));r=trim(r);}return {quotient:trim(out),remainder:r};}
export function ugcd(a:U,b:U):U {while(b.some(x=>x.n)){const r=udiv(a,b).remainder;a=b;b=r;}return a.some(x=>x.n)?a.map(x=>divide(x,a.at(-1)!)):[Z];}
export const uat=(p:U,x:Q)=>p.reduceRight((s,v)=>plus(times(s,x),v),Z);
export const derivative=(p:U)=>p.length<2?[Z]:p.slice(1).map((v,i)=>times(v,q(BigInt(i+1))));
export function integerPolynomial(p:U):string[]{p=trim([...p]);const common=p.reduce((n,v)=>n*v.d/gcd(n,v.d),1n),ints=p.map(v=>v.n*(common/v.d)),g=ints.reduce(gcd)||1n,flip=ints.at(-1)!<0n?-1n:1n;return ints.map(v=>String(v/g*flip));}
export function sturm(p:U,budget:Budget):U[]{const chain=[p,derivative(p)];while(chain.at(-1)!.length>1){budget.tick();const r=udiv(chain.at(-2)!,chain.at(-1)!).remainder.map(neg);if(!r.some(x=>x.n))break;chain.push(r);}return chain;}
export function variations(chain:U[],x:Q){let last=0,n=0;for(const p of chain){const s=sign(uat(p,x));if(s&&last&&s!==last)n++;if(s)last=s;}return n;}
export type Root={polynomial:string[];interval:[number,number];rationalInterval:[string,string];approximate:number;expression?:string};
export function rootInterval(root:Root):[Q,Q]{return root.rationalInterval.map(rational) as [Q,Q];}
export function refineRoot(root:Root,budget:Budget){budget.tick();const p=root.polynomial.map(rational),[a,b]=rootInterval(root);if(cmp(a,b)===0)return;
 const mid=divide(plus(a,b),q(2n));if(!uat(p,mid).n){root.rationalInterval=[str(mid),str(mid)];root.interval=[num(mid),num(mid)];root.approximate=num(mid);root.expression=str(mid);return;}
 const chain=sturm(p,budget),left=variations(chain,a)-variations(chain,mid),next:[Q,Q]=left?[a,mid]:[mid,b];root.rationalInterval=next.map(str) as [string,string];root.interval=next.map(num) as [number,number];root.approximate=num(divide(plus(...next),q(2n)));
}
export function isolate(p:U,budget:Budget):Root[]|undefined {
 p=trim([...p]);if(p.length===1)return p[0].n?[]:undefined;
 p=udiv(p,ugcd(p,derivative(p))).quotient;
 if(p.length===2){const x=divide(neg(p[0]),p[1]);return [{polynomial:integerPolynomial(p),interval:[num(x),num(x)],rationalInterval:[str(x),str(x)],approximate:num(x),expression:str(x)}];}
 const chain=sturm(p,budget);let bound=2n;for(const c of p.slice(0,-1)){const v=divide(c,p.at(-1)!);const b=(v.n<0n?-v.n:v.n)/v.d+3n;if(b>bound)bound=b;}
 const a=q(-bound),b=q(bound),queue:[Q,Q,number][]=[[a,b,variations(chain,a)-variations(chain,b)]],out:Root[]=[];
 while(queue.length){budget.tick();const [lo,hi,count]=queue.pop()!;if(!count)continue;
  if(count===1&&num(minus(hi,lo))<1e-13*Math.max(p[0].n?0:1,Math.abs(num(lo)),Math.abs(num(hi)))&&(!p[0].n||!(sign(lo)<=0&&sign(hi)>=0))){
   const root:Root={polynomial:integerPolynomial(p),interval:[num(lo),num(hi)],rationalInterval:[str(lo),str(hi)],approximate:num(divide(plus(lo,hi),q(2n)))};
   if(p.length===3){const [c,b,a]=p,D=minus(times(b,b),times(q(4n),times(a,c))),den=times(q(2n),a);const plusValue=(-num(b)+Math.sqrt(num(D)))/num(den),minusValue=(-num(b)-Math.sqrt(num(D)))/num(den);root.expression=`(-(${str(b)})${Math.abs(plusValue-root.approximate)<Math.abs(minusValue-root.approximate)?'+':'-'}sqrt(${str(D)}))/(${str(den)})`;}
   // Recognize only candidates verified by exact substitution.
   for(let d=1;d<=128;d++){const x=q(BigInt(Math.round(root.approximate*d)),BigInt(d));if(cmp(x,lo)>0&&cmp(x,hi)<=0&&!uat(p,x).n){root.rationalInterval=[str(x),str(x)];root.interval=[num(x),num(x)];root.approximate=num(x);root.expression=str(x);break;}}
   out.push(root);continue;
  }
  const mid=divide(plus(lo,hi),q(2n)),left=variations(chain,lo)-variations(chain,mid);queue.push([mid,hi,count-left],[lo,mid,left]);
 }
 return out.sort((a,b)=>cmp(rootInterval(a)[0],rootInterval(b)[0]));
}
export type Interval=[Q,Q];
export const ia=(a:Interval,b:Interval):Interval=>[plus(a[0],b[0]),plus(a[1],b[1])];
export function im(a:Interval,b:Interval):Interval{const values=[times(a[0],b[0]),times(a[0],b[1]),times(a[1],b[0]),times(a[1],b[1])].sort(cmp);return [values[0],values[3]];}
export function ui(p:U,x:Interval):Interval{return p.reduceRight<Interval>((s,c)=>ia(im(s,x),[c,c]),[Z,Z]);}
export function signAt(p:U,root:Root,budget:Budget):number {
 const poly=root.polynomial.map(rational);p=udiv(p,poly).remainder;if(!p.some(x=>x.n))return 0;
 const [a,b]=rootInterval(root);if(cmp(a,b)===0)return sign(uat(p,a));
 const common=ugcd(poly,p);if(common.length>1){const chain=sturm(common,budget);if(variations(chain,a)-variations(chain,b))return 0;}
 for(let i=0;i<512;i++){budget.tick();const r=ui(p,rootInterval(root));if(sign(r[0])>0)return 1;if(sign(r[1])<0)return -1;refineRoot(root,budget);}
 throw new ExactLimit('complexity','代数符号判定未完成');
}
export function validateRoot(value:unknown,budget=new Budget(Date.now()+500)):asserts value is Root {
 const r=value as Root;if(!r||!Array.isArray(r.polynomial)||r.polynomial.length<2||r.polynomial.length>100||r.polynomial.some(c=>typeof c!=='string'||!/^[-+]?\d{1,7000}$/.test(c))||BigInt(r.polynomial.at(-1)!)===0n||!Array.isArray(r.interval)||r.interval.length!==2||r.interval.some(v=>!Number.isFinite(v))||!Number.isFinite(r.approximate))throw Error('代数根数据无效');
 if(r.expression!==undefined){if(typeof r.expression!=='string'||r.expression.length>32768)throw Error('代数根显示表达式无效');parseExpression(r.expression,[],{length:32768,nodes:8192,depth:128});}
 const bounds=r.rationalInterval??r.interval.map(String);if(!Array.isArray(bounds)||bounds.length!==2||bounds.some(s=>typeof s!=='string'||s.length>15000))throw Error('根隔离区间无效');
 const [a,b]=bounds.map(rational),p=r.polynomial.map(rational);if(cmp(a,b)>0||r.approximate< num(a)-1e-14*Math.max(1,Math.abs(num(a)))||r.approximate>num(b)+1e-14*Math.max(1,Math.abs(num(b))))throw Error('根近似值不在隔离区间内');
 if(cmp(a,b)===0){if(uat(p,a).n)throw Error('有理根不满足多项式');}
 else{const sf=udiv(p,ugcd(p,derivative(p))).quotient,chain=sturm(sf,budget);if(variations(chain,a)-variations(chain,b)!==1)throw Error('区间没有隔离唯一实根');}
 if(Math.abs(r.interval[0]-num(a))>1e-14*Math.max(1,Math.abs(num(a)))||Math.abs(r.interval[1]-num(b))>1e-14*Math.max(1,Math.abs(num(b))))throw Error('根区间缓存不一致');
}
