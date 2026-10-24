import {parseExpression} from '../expression';
import {Budget,ExactLimit,type Q,type U,type Root,type Interval,Z,O,q,plus,minus,neg,times,divide,sign,cmp,num,str,rational,trim,udiv,uat,isolate,rootInterval,refineRoot,signAt,validateRoot,ia,im} from './exactArithmetic';

// Sparse multivariate polynomials, ordered lexicographically. Exponent vectors
// omit trailing zeros, so auxiliary variables can be introduced without copying.
type P=Map<string,Q>;
type R={n:P;d:P};
type Relation='='|'!='|'>'|'>='|'<'|'<=';
type Guard={p:P;op:Relation};
const key=(input:number[])=>{const e=Array.from({length:input.length},(_,i)=>input[i]??0);while(e.at(-1)===0)e.pop();return e.join(',');};
const exps=(k:string)=>k?k.split(',').map(Number):[];
const constant=(c:Q):P=>c.n?new Map([['',c]]):new Map();
const variable=(i:number):P=>new Map([[key(Array.from({length:i+1},(_,k)=>k===i?1:0)),O]]);
const one=()=>constant(O);
const scalar=(p:P,c:Q):P=>new Map([...p].map(([k,v])=>[k,times(v,c)] as const).filter(([,v])=>v.n));
const add=(a:P,b:P):P=>{const p=new Map(a);for(const [k,v]of b){const c=plus(p.get(k)??Z,v);if(c.n)p.set(k,c);else p.delete(k);}return p;};
const sub=(a:P,b:P)=>add(a,scalar(b,q(-1n)));
function product(a:P,b:P,budget:Budget):P {budget.tick(a.size*b.size);if(a.size*b.size>20000)throw new ExactLimit('complexity','多项式项数超限');const p:P=new Map();for(const [ka,x]of a)for(const [kb,y]of b){const u=exps(ka),v=exps(kb),w=Array.from({length:Math.max(u.length,v.length)},(_,i)=>(u[i]??0)+(v[i]??0));if(w.reduce((s,n)=>s+n,0)>32)throw new ExactLimit('complexity','代数次数超限');const k=key(w),c=plus(p.get(k)??Z,times(x,y));if(c.n)p.set(k,c);else p.delete(k);}return p;}
function power(p:P,n:number,budget:Budget):P{let out=one();for(let i=0;i<n;i++)out=product(out,p,budget);return out;}
const compare=(a:string,b:string)=>{const u=exps(a),v=exps(b);for(let i=0;i<Math.max(u.length,v.length);i++)if((u[i]??0)!==(v[i]??0))return (u[i]??0)-(v[i]??0);return 0;};
const lead=(p:P)=>[...p.keys()].sort((a,b)=>compare(b,a))[0];
const monoDivide=(a:string,b:string):string|undefined=>{const u=exps(a),v=exps(b),w=Array.from({length:Math.max(u.length,v.length)},(_,i)=>(u[i]??0)-(v[i]??0));return w.some(n=>n<0)?undefined:key(w);};
const support=(p:P)=>new Set([...p.keys()].flatMap(k=>exps(k).flatMap((n,i)=>n?[i]:[])));
const degree=(p:P)=>Math.max(0,...[...p.keys()].map(k=>exps(k).reduce((a,b)=>a+b,0)));
function substitute(p:P,replacements:Map<number,P>,budget:Budget):P{let out:P=new Map();for(const [k,c]of p){let term=constant(c);for(const [i,n]of exps(k).entries())if(n)term=product(term,power(replacements.get(i)??variable(i),n,budget),budget);out=add(out,term);}return out;}
function fractionAdd(a:R,b:R,budget:Budget):R{return {n:add(product(a.n,b.d,budget),product(b.n,a.d,budget)),d:product(a.d,b.d,budget)};}
function fractionProduct(a:R,b:R,budget:Budget):R{return {n:product(a.n,b.n,budget),d:product(a.d,b.d,budget)};}
function fractionSubstitute(p:P,replacements:Map<number,R>,budget:Budget,roots?:Map<number,Root>):R{const simplify=(r:R):R=>{
 if(roots)r={n:reduceByRoots(r.n,roots,budget),d:reduceByRoots(r.d,roots,budget)};
 if(!r.d.size)return r;
 const variables=[...new Set([...support(r.n),...support(r.d)])];
 if(variables.length===1){const i=variables[0],g=gcdU(univariate(r.n,i),univariate(r.d,i));if(g.length>1){const from=(p:U):P=>new Map(p.flatMap((c,k)=>c.n?[[key(Array.from({length:i+1},(_,j)=>j===i?k:0)),c] as [string,Q]]:[]));r={n:from(udiv(univariate(r.n,i),g).quotient),d:from(udiv(univariate(r.d,i),g).quotient)};}}
 const factor=divide(O,r.d.get(lead(r.d))!);return {n:scalar(r.n,factor),d:scalar(r.d,factor)};
 };let out:R={n:new Map(),d:one()};for(const [k,c]of p){let term:R={n:constant(c),d:one()};for(const [i,n]of exps(k).entries())if(n){const r=replacements.get(i)??{n:variable(i),d:one()};term=simplify(fractionProduct(term,simplify({n:power(r.n,n,budget),d:power(r.d,n,budget)}),budget));}out=simplify(fractionAdd(out,term,budget));}return out;}
function formula(p:P,names:string[]):string{return p.size?[...p].map(([k,c])=>`(${str(c)})${exps(k).map((n,i)=>n?`*${names[i]}${n===1?'':`^${n}`}`:'').join('')}`).join('+'):'0';}
const fractionFormula=(r:R,names:string[])=>`(${formula(r.n,names)})/(${formula(r.d,names)})`;
function univariate(p:P,index:number):U{if([...support(p)].some(i=>i!==index))throw Error('不是一元式');const out:U=[Z];for(const [k,c]of p){const n=exps(k)[index]??0;while(out.length<=n)out.push(Z);out[n]=plus(out[n],c);}return trim(out);}
const satisfied=(s:number,op:Relation)=>op==='='?s===0:op==='!='?s!==0:op==='>'?s>0:op==='>='?s>=0:op==='<'?s<0:s<=0;

class Compiler {
 names:string[];equations:P[]=[];guards:Guard[]=[];formal=new Map<string,number>();calls=new Map<string,number>();constantRadicals=new Map<number,Q>();
 constructor(names:string[],public budget:Budget){this.names=[...names];}
 parse(source:string):R{
  const ast=parseExpression(source,this.names,{length:32768,nodes:8192,depth:128});
  const walk=(a:ReturnType<typeof parseExpression>):R=>{
   this.budget.tick();
   if(a.type==='number'){if(a.constant){let index=this.formal.get(a.constant);if(index===undefined){index=this.names.length;this.formal.set(a.constant,index);this.names.push(`aux_${index}`);}return {n:variable(index),d:one()};}return {n:constant(rational(a.literal??a.value)),d:one()};}
   if(a.type==='variable'){const i=this.names.indexOf(a.name);if(i<0)throw new ExactLimit('unsupported','未知符号');return {n:variable(i),d:one()};}
   if(a.type==='unary'){const r=walk(a.value);return {n:scalar(r.n,q(BigInt(a.sign))),d:r.d};}
   if(a.type==='call'){
    if(['sin','cos','tan'].includes(a.name)){
      const arg=walk(a.args[0]),pi=this.formal.get('pi');
      if(pi!==undefined&&arg.n.size===1&&arg.d.size===1&&support(arg.d).size===0){
        const e=exps(lead(arg.n));if(e[pi]===1&&e.reduce((s,v)=>s+v,0)===1){
          const angle=times(divide(arg.n.get(lead(arg.n))!,arg.d.get('')!),q(180n));
          if(angle.d===1n){const deg=Number((angle.n%360n+360n)%360n),cos:Record<number,string>={0:'1',30:'sqrt(3)/2',45:'sqrt(2)/2',60:'1/2',90:'0',120:'-1/2',135:'-sqrt(2)/2',150:'-sqrt(3)/2',180:'-1',210:'-sqrt(3)/2',225:'-sqrt(2)/2',240:'-1/2',270:'0',300:'1/2',315:'sqrt(2)/2',330:'sqrt(3)/2'},c=cos[deg],s=cos[(90-deg+360)%360];
            if(c!==undefined&&s!==undefined)return walk(parseExpression(a.name==='cos'?c:a.name==='sin'?s:`(${s})/(${c})`,this.names));
          }
        }
      }
      throw new ExactLimit('unsupported','该三角表达式未覆盖精确常数化');
    }
    if(!['sqrt','abs'].includes(a.name))throw new ExactLimit('unsupported',`暂不支持函数 ${a.name} 的精确消元`);
    const r=walk(a.args[0]),signature=JSON.stringify([a.name,[...r.n].sort(([a],[b])=>compare(a,b)).map(([k,c])=>[k,str(c)]),[...r.d].sort(([a],[b])=>compare(a,b)).map(([k,c])=>[k,str(c)])]);
    const existing=this.calls.get(signature);if(existing!==undefined)return {n:variable(existing),d:one()};
    const i=this.names.length;this.names.push(`aux_${i}`);this.calls.set(signature,i);const v=variable(i);
    if(a.name==='sqrt'&&!support(r.n).size&&!support(r.d).size)this.constantRadicals.set(i,divide(r.n.get('')??Z,r.d.get('')??Z));
    this.guards.push({p:r.d,op:'!='},{p:v,op:'>='});
    this.equations.push(a.name==='sqrt'?sub(product(power(v,2,this.budget),r.d,this.budget),r.n):sub(product(power(v,2,this.budget),power(r.d,2,this.budget),this.budget),power(r.n,2,this.budget)));
    return {n:v,d:one()};
   }
   const x=walk(a.left),y=walk(a.right);
   if(a.op==='+')return fractionAdd(x,y,this.budget);
   if(a.op==='-')return fractionAdd(x,{n:scalar(y.n,q(-1n)),d:y.d},this.budget);
   if(a.op==='*')return fractionProduct(x,y,this.budget);
   if(a.op==='/'){this.guards.push({p:y.n,op:'!='});return fractionProduct(x,{n:y.d,d:y.n},this.budget);}
   if(support(y.n).size||support(y.d).size)throw new ExactLimit('unsupported','指数必须为常数整数');
   const n=divide(y.n.get('')??Z,y.d.get('')??Z);if(n.d!==1n||n.n>16n||n.n< -16n)throw new ExactLimit('unsupported','整数幂范围为 -16～16');
   if(n.n<0n)this.guards.push({p:x.n,op:'!='});return {n:power(n.n<0n?x.d:x.n,Number(n.n<0n?-n.n:n.n),this.budget),d:power(n.n<0n?x.n:x.d,Number(n.n<0n?-n.n:n.n),this.budget)};
  };
  return walk(ast);
 }
 normalize(){
  // π and e are positive and nonzero. Cancel only a common monomial factor;
  // a genuine coefficient such as x-π remains unsupported, never rationalized.
  const cancel=(p:P):P=>{
    for(const index of this.formal.values()){
      if(!p.size)continue;const minimum=Math.min(...[...p.keys()].map(k=>exps(k)[index]??0));
      if(minimum){const next:P=new Map();for(const [k,c]of p){const e=exps(k);e[index]-=minimum;next.set(key(e),c);}p=next;}
      if(support(p).has(index))throw new ExactLimit('unsupported','超越常数不能作为有理系数；仅支持合法的公共因子消去');
    }
    return p;
  };
  this.equations=this.equations.map(cancel);this.guards=this.guards.map(g=>({...g,p:cancel(g.p)}));
  for(const [index,value]of this.constantRadicals){
    const simplify=(p:P)=>{
      const coefficient=p.get(key(Array.from({length:index+1},(_,i)=>i===index?2:0)));
      if(coefficient&&[...support(p)].every(i=>i===index)&&p.size<=2&&str(p.get('')??Z)===str(neg(times(coefficient,value))))return p;
      let out:P=new Map();for(const [k,c]of p){const e=exps(k),n=e[index]??0;e[index]=n%2;let coefficient=c;for(let j=0;j<Math.floor(n/2);j++)coefficient=times(coefficient,value);out=add(out,new Map([[key(e),coefficient]]));}return out;
    };
    this.equations=this.equations.map(simplify);this.guards=this.guards.map(g=>({...g,p:simplify(g.p)}));
  }
  // These slots were bookkeeping for canceled formal factors, not unknowns.
  for(const index of this.formal.values())this.equations.push(sub(variable(index),one()));
 }
 relation(source:string){
  const normalized=source.replace(/＝/g,'=').replace(/≤/g,'<=').replace(/≥/g,'>=').replace(/≠/g,'!='),m=normalized.match(/^(.*?)(!=|>=|<=|=|>|<)(.*)$/);
  if(!m)throw new ExactLimit('unsupported','条件需要等号或不等号');
  const a=this.parse(m[1]),b=this.parse(m[3]),r=fractionAdd(a,{n:scalar(b.n,q(-1n)),d:b.d},this.budget);this.guards.push({p:r.d,op:'!='});
  if(m[2]==='=')this.equations.push(r.n);
  else this.guards.push({p:product(r.n,r.d,this.budget),op:m[2] as Relation});
 }
}
/** Real zero sets of semidefinite quadratic equations can be smaller than
 * their complex algebraic varieties. Exact completion of squares handles
 * tangency/extremum locks before a Jacobian or a complex elimination is used. */
function realQuadratic(p:P,budget:Budget):P[]{
 const signs=new Set([...p.values()].map(sign));
 if(p.size&&signs.size===1&&[...p.keys()].every(k=>exps(k).every(n=>n%2===0))){
  if(p.has(''))return [one()];
  return [...p.keys()].map(k=>new Map([[key(exps(k).map(n=>n?1:0)),O]]));
 }
 if(degree(p)!==2)return [p];let rest=p;const forms:P[]=[];let orientation=0;
 for(let pass=0;pass<100&&degree(rest)===2;pass++){
  const diagonal=[...rest.keys()].find(k=>{const e=exps(k);return e.reduce((a,b)=>a+b,0)===2&&e.some(n=>n===2);});if(diagonal===undefined)return [p];
  const index=exps(diagonal).findIndex(n=>n===2),coefficient=rest.get(diagonal)!,s=sign(coefficient);if(orientation&&orientation!==s)return [p];orientation=s;
  const derivative:P=new Map();for(const [k,c]of rest){const e=exps(k),n=e[index]??0;if(n){e[index]=n-1;derivative.set(key(e),times(c,q(BigInt(n))));}}
  const linear=scalar(derivative,divide(O,times(q(2n),coefficient)));forms.push(linear);rest=sub(rest,scalar(product(linear,linear,budget),coefficient));
 }
 if(support(rest).size)return [p];const c=sign(rest.get('')??Z);return c===0?forms:c===orientation?[one()]:[p];
}
function linearReduction(equations:P[],count:number,budget:Budget){
 const replacements=new Map<number,P>(Array.from({length:count},(_,i)=>[i,variable(i)]));let eq=equations;
 for(let pass=0;pass<count+1;pass++){
  budget.tick();const rows=eq.filter(p=>degree(p)<=1).map(p=>Array.from({length:count+1},(_,i)=>i===count?neg(p.get('')??Z):p.get(lead(variable(i)))??Z));
  const pivots:number[]=[];let rank=0;
  for(let col=0;col<count&&rank<rows.length;col++){
   const index=rows.findIndex((r,i)=>i>=rank&&r[col].n!==0n);if(index<0)continue;[rows[index],rows[rank]]=[rows[rank],rows[index]];
   const d=rows[rank][col];rows[rank]=rows[rank].map(x=>divide(x,d));
   for(let i=0;i<rows.length;i++)if(i!==rank&&rows[i][col].n){const c=rows[i][col];rows[i]=rows[i].map((x,j)=>minus(x,times(c,rows[rank][j])));budget.tick(count);}
   pivots.push(col);rank++;
  }
  if(rows.some(r=>r.slice(0,count).every(x=>!x.n)&&r[count].n))return {equations:[one()],replacements,inconsistent:true};
  if(!pivots.length)break;
  const next=new Map<number,P>();pivots.forEach((pivot,row)=>{let p=constant(rows[row][count]);for(let i=0;i<count;i++)if(i!==pivot&&rows[row][i].n)p=add(p,scalar(variable(i),neg(rows[row][i])));next.set(pivot,p);});
  eq=eq.map(p=>substitute(p,next,budget)).filter(p=>p.size);for(const [i,p]of replacements)replacements.set(i,substitute(p,next,budget));
 }
 return {equations:eq,replacements,inconsistent:false};
}
function reduce(p:P,basis:P[],budget:Budget):P{p=new Map(p);let remainder:P=new Map();while(p.size){budget.tick();const k=lead(p),c=p.get(k)!;let changed=false;for(const b of basis){const l=lead(b),d=monoDivide(k,l);if(d!==undefined){p=sub(p,product(new Map([[d,divide(c,b.get(l)!)]]),b,budget));changed=true;break;}}if(!changed){remainder.set(k,c);p.delete(k);}}return remainder;}
interface BasisTask {basis:P[];pairs:[number,number][];cursor:number;initial:number}
const basisTasks=new Map<string,BasisTask>();
function groebner(polynomials:P[],budget:Budget):P[]{
 const signature=JSON.stringify(polynomials.map(p=>[...p].sort(([a],[b])=>compare(a,b)).map(([k,c])=>[k,str(c)])));
 let task=basisTasks.get(signature);
 if(!task){if(basisTasks.size>=16)basisTasks.delete(basisTasks.keys().next().value!);task={basis:[],pairs:[],cursor:0,initial:0};basisTasks.set(signature,task);}
 const {basis,pairs}=task;
 const put=(p:P)=>{p=reduce(p,basis,budget);if(!p.size)return;const c=p.get(lead(p))!;p=scalar(p,divide(O,c));if(basis.length>=100){basisTasks.delete(signature);throw new ExactLimit('complexity','消元基规模超限');}for(let i=0;i<basis.length;i++)pairs.push([i,basis.length]);basis.push(p);};
 while(task.initial<polynomials.length){put(polynomials[task.initial]);task.initial++;}
 while(task.cursor<pairs.length){
  budget.tick();const [i,j]=pairs[task.cursor],a=basis[i],b=basis[j],ka=lead(a),kb=lead(b),u=exps(ka),v=exps(kb);
  if(!u.some((x,k)=>x&&(v[k]??0))){task.cursor++;continue;}
  const lcm=key(Array.from({length:Math.max(u.length,v.length)},(_,k)=>Math.max(u[k]??0,v[k]??0)));
  put(sub(product(new Map([[monoDivide(lcm,ka)!,O]]),a,budget),product(new Map([[monoDivide(lcm,kb)!,O]]),b,budget)));task.cursor++;
  if(basis.some(p=>degree(p)===0)){basisTasks.delete(signature);return [one()];}
 }
 const result=basis.map((p,i)=>reduce(p,basis.filter((_,j)=>j!==i),budget)).filter(p=>p.size);basisTasks.delete(signature);return result;
}

export interface ExactCertificate {
 version:1;variables:string[];sources:string[];auxiliary:string[];roots:Record<string,Root>;assignments:Record<string,string>;
}
export interface ExactFamily {parameters:string[];assignments:Record<string,string>;conditions:string[];implicit?:boolean}
export interface ExactCandidate {values:number[];certificate:ExactCertificate;exactValues:Record<string,Root>}
export interface ExactSystemResult {
 kind:'finite'|'family'|'unresolved';complete:boolean;candidates:ExactCandidate[];family?:ExactFamily;
 reason?:string;reasonCode?:string;operations:number;reducedVariables:number;cacheHit?:boolean;
}
const cache=new Map<string,ExactSystemResult>();
function copy<T>(x:T):T{return structuredClone(x);}
function rationalRoot(x:Q):Root{return {polynomial:[String(-x.n),String(x.d)],interval:[num(x),num(x)],rationalInterval:[str(x),str(x)],approximate:num(x),expression:str(x)};}
function evalFraction(r:R,roots:Map<number,Root>,budget:Budget):Q{
 const value=(p:P)=>{let out=Z;for(const [k,c]of p){let term=c;for(const [i,n]of exps(k).entries())if(n){const root=roots.get(i);if(!root)throw Error('缺少代数生成元');const [a,b]=rootInterval(root),x=divide(plus(a,b),q(2n));for(let j=0;j<n;j++)term=times(term,x);}out=plus(out,term);budget.tick();}return out;};
 return divide(value(r.n),value(r.d));
}
function reduceByRoots(p:P,roots:Map<number,Root>,budget:Budget):P{
 for(const [i,r]of roots){const f=r.polynomial.map(rational),m=f.length-1;let next:P=new Map();for(const [k,c]of p){const e=exps(k),n=e[i]??0;e[i]=0;const mon:U=Array(n+1).fill(Z);mon[n]=O;const rem=udiv(mon,f).remainder;for(const [j,a]of rem.entries())if(a.n){const powers=[...e];powers[i]=j;const t=key(powers);next=add(next,new Map([[t,times(c,a)]]));}budget.tick(m);}p=next;}return p;
}
function signWithRoots(p:P,roots:Map<number,Root>,budget:Budget):number{
 p=reduceByRoots(p,roots,budget);if(!p.size)return 0;const used=[...support(p)];if(!used.length)return sign(p.get('')??Z);
 if(used.length===1)return signAt(univariate(p,used[0]),roots.get(used[0])!,budget);
 for(let attempt=0;attempt<256;attempt++){
  let interval:Interval=[Z,Z];for(const [k,c]of p){let term:Interval=[c,c];for(const [i,n]of exps(k).entries())for(let j=0;j<n;j++)term=im(term,rootInterval(roots.get(i)!));interval=ia(interval,term);}
  if(sign(interval[0])>0)return 1;if(sign(interval[1])<0)return -1;for(const i of used)refineRoot(roots.get(i)!,budget);
 }
 throw new ExactLimit('complexity','多个代数生成元的符号判定未完成');
}
function components(equations:P[],variables:number[]):number[][]{
 const groups:number[][]=[];const pending=new Set(variables);
 while(pending.size){const first=pending.values().next().value!,group=new Set([first]);pending.delete(first);let changed=true;while(changed){changed=false;for(const p of equations){const vars=[...support(p)];if(vars.some(i=>group.has(i)))for(const i of vars)if(pending.delete(i)){group.add(i);changed=true;}}}groups.push([...group]);}return groups;
}
interface ComponentSolution {roots:Map<number,Root>;assignments:Map<number,R>}
function solveComponent(equations:P[],vars:number[],generator:number,budget:Budget):ComponentSolution[]|undefined{
 if(vars.length===1){let poly:U|undefined;for(const p of equations){const next=univariate(p,vars[0]);poly=poly?gcdU(poly,next):next;}const roots=isolate(poly??[Z],budget);return roots?.map(root=>({roots:new Map([[generator,root]]),assignments:new Map([[vars[0],{n:variable(generator),d:one()}]])}));}
 if(vars.length>6)throw new ExactLimit('complexity','耦合块超过六个非线性变量');
 for(let trial=1;trial<=4;trial++){
  budget.tick();let relation=variable(generator);vars.forEach((i,k)=>relation=sub(relation,scalar(variable(i),q(BigInt((k+1)**trial)))));
  const basis=groebner([...equations,relation],budget);if(basis.some(p=>degree(p)===0))return [];
  const polys=basis.filter(p=>[...support(p)].every(i=>i===generator)&&p.size);if(!polys.length)return;
  let f=univariate(polys[0],generator);for(const p of polys.slice(1))f=gcdU(f,univariate(p,generator));
  const roots=isolate(f,budget);if(!roots)return;
  const mappings=new Map<number,R>();
  for(const i of vars){
   const p=basis.find(p=>support(p).has(i)&&[...support(p)].every(j=>j===i||j===generator)&&[...p.keys()].every(k=>(exps(k)[i]??0)<=1));if(!p)break;
   let coefficient:P=new Map(),rest:P=new Map();for(const [k,c]of p){const e=exps(k);if(e[i]){e[i]=0;coefficient.set(key(e),c);}else rest.set(k,c);}mappings.set(i,{n:scalar(rest,q(-1n)),d:coefficient});
  }
  if(mappings.size!==vars.length)continue;
  const result:ComponentSolution[]=[];let exceptional=false;
  for(const root of roots){const scope=new Map([[generator,root]]);if([...mappings.values()].some(r=>signWithRoots(r.d,scope,budget)===0)){exceptional=true;break;}
   if(equations.every(p=>{const r=fractionSubstitute(p,mappings,budget,scope);return signWithRoots(r.n,scope,budget)===0&&signWithRoots(r.d,scope,budget)!==0;}))result.push({roots:scope,assignments:mappings});
  }
  if(!exceptional)return result;
 }
 throw new ExactLimit('complexity','代数分支不能在预算内分离，未丢弃异常分支');
}
function gcdU(a:U,b:U):U{while(b.some(x=>x.n)){const r=udiv(a,b).remainder;a=b;b=r;}return a;}

export function solveExactSystem(sources:string[],variables:string[],options:{deadline?:number;initial?:number[];maxCandidates?:number;sectionDepth?:number}={}):ExactSystemResult{
 const budget=new Budget(options.deadline??Date.now()+1500),cacheKey=JSON.stringify([sources,variables,options.maxCandidates??256]);
 const cached=cache.get(cacheKey);if(cached)return {...copy(cached),cacheHit:true,operations:0};
 const result:ExactSystemResult={kind:'unresolved',complete:false,candidates:[],operations:0,reducedVariables:variables.length};
 try{
  if(variables.length>100)throw new ExactLimit('complexity','待求变量过多');
  const compiler=new Compiler(variables,budget);for(const source of sources)compiler.relation(source);compiler.normalize();
  let reduced=linearReduction(compiler.equations.flatMap(p=>realQuadratic(p,budget)),compiler.names.length,budget);
  for(let pass=0;pass<2&&!reduced.inconsistent;pass++){
    const variables=[...new Set([...reduced.replacements.values()].flatMap(p=>[...support(p)]))],blocks=components(reduced.equations,variables),basis:P[]=[];
    for(const block of blocks){const eq=reduced.equations.filter(p=>[...support(p)].some(v=>block.includes(v)));basis.push(...(block.length>1&&block.length<=6?groebner(eq,budget):eq));}
    const next=linearReduction(basis.flatMap(p=>realQuadratic(p,budget)),compiler.names.length,budget),maps=new Map([...reduced.replacements].map(([i,p])=>[i,substitute(p,next.replacements,budget)]));
    const oldCount=variables.length,newCount=new Set([...maps.values()].flatMap(p=>[...support(p)])).size;reduced={...next,replacements:maps};if(newCount===oldCount)break;
  }
  const maps=reduced.replacements;
  const guards=compiler.guards.map(g=>({...g,p:substitute(g.p,maps,budget)}));
  const free=[...new Set([...maps.values()].flatMap(p=>[...support(p)]))];result.reducedVariables=free.length;
  if(reduced.inconsistent||reduced.equations.some(p=>!support(p).size&&p.size)){result.kind='finite';result.complete=true;return result;}
  const groups=components([...reduced.equations,...guards.map(g=>g.p)],free),blocks:ComponentSolution[][]=[];
  let family=false;
  for(const [i,group]of groups.entries()){
   const eq=reduced.equations.filter(p=>[...support(p)].some(v=>group.includes(v)));
   if(!eq.length){family=true;break;}
   const solved=solveComponent(eq,group,compiler.names.length+i,budget);if(!solved){family=true;break;}blocks.push(solved);
   if(!solved.length){result.kind='finite';result.complete=true;return result;}
  }
  if(family){
   result.kind='family';result.family={parameters:free.map(i=>compiler.names[i]),assignments:Object.fromEntries(variables.map((v,i)=>[v,formula(maps.get(i)!,compiler.names)])),conditions:[...reduced.equations.map(p=>formula(p,compiler.names)+'=0'),...guards.map(g=>formula(g.p,compiler.names)+g.op+'0')],implicit:reduced.equations.length>0};
   // An affine parameterization is exact; its feasible domain remains explicit.
   // Samples are previews only and never stand for the whole family.
   if(!reduced.equations.length){
    const trials=[options.initial??variables.map(()=>0),...[-1,0,1,2,-2,3,-3,5,-5,10].map(v=>compiler.names.map(()=>v))];
    for(const trial of trials){const repl=new Map(free.map(i=>[i,{n:constant(rational(trial[i]??0)),d:one()}])),scope=new Map<number,Root>();
     if(!guards.every(g=>{const r=fractionSubstitute(g.p,repl,budget);return satisfied(signWithRoots(r.n,scope,budget)*signWithRoots(r.d,scope,budget),g.op);} ))continue;
     const assignments=new Map([...maps].map(([i,p])=>[i,fractionSubstitute(p,repl,budget)]));result.candidates.push(makeCandidate(assignments,scope,sources,variables,compiler.names,budget));break;
    }
   }
   if(!result.candidates.length&&free.length<=6&&(options.sectionDepth??0)<3){
    const parameter=free.slice().sort((a,b)=>reduced.equations.filter(p=>support(p).has(b)).length-reduced.equations.filter(p=>support(p).has(a)).length)[0];
    if(parameter!==undefined)for(const value of [...new Set([options.initial?.[parameter]??0,1,-1,2])]){
      budget.tick();const section=solveExactSystem([...sources,`${compiler.names[parameter]}=${value}`],variables,{...options,sectionDepth:(options.sectionDepth??0)+1,maxCandidates:16});
      if(section.candidates.length){result.candidates=section.candidates.slice(0,2);break;}
    }
   }
   return result;
  }
  let combined:ComponentSolution[]=[{roots:new Map(),assignments:new Map()}];
  for(const block of blocks){const next:ComponentSolution[]=[];for(const a of combined)for(const b of block){if(next.length>=(options.maxCandidates??256))throw new ExactLimit('complexity','精确解组合超出计算上限，保留未完成状态');next.push({roots:new Map([...a.roots,...b.roots]),assignments:new Map([...a.assignments,...b.assignments])});}combined=next;}
  for(const branch of combined){
   const assignments=new Map([...maps].map(([i,p])=>[i,fractionSubstitute(p,branch.assignments,budget,branch.roots)]));
   if(!guards.every(g=>{const r=fractionSubstitute(g.p,branch.assignments,budget,branch.roots),d=signWithRoots(r.d,branch.roots,budget);return d!==0&&satisfied(signWithRoots(r.n,branch.roots,budget)*d,g.op);} ))continue;
   result.candidates.push(makeCandidate(assignments,branch.roots,sources,variables,compiler.names,budget));
  }
  result.kind='finite';result.complete=true;
 }catch(e){result.reasonCode=e instanceof ExactLimit?e.code:'unsupported';result.reason=(e as Error).message;result.complete=false;}
 finally{result.operations=budget.operations;if(result.kind!=='unresolved'&&result.complete){if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(cacheKey,copy(result));}}
 return result;
}
function makeCandidate(assignments:Map<number,R>,roots:Map<number,Root>,sources:string[],variables:string[],names:string[],budget:Budget):ExactCandidate{
 const rootNames=new Map([...roots.keys()].map((i,k)=>[i,`root_${k}`])),allNames=[...names];for(const [i,n]of rootNames)allNames[i]=n;
 const expressions=Object.fromEntries(names.map((v,i)=>[v,fractionFormula(assignments.get(i)!,allNames)]));
 const values=variables.map((_,i)=>num(evalFraction(assignments.get(i)!,roots,budget))),exactValues:Record<string,Root>={};
 for(const [i,v]of variables.entries()){
  const r=assignments.get(i)!;if(!support(r.n).size&&!support(r.d).size)exactValues[v]=rationalRoot(divide(r.n.get('')??Z,r.d.get('')??Z));
  else if(r.n.size===1&&r.d.size===1&&r.d.get('')?.n===1n&&r.d.get('')?.d===1n){const k=lead(r.n),e=exps(k),idx=e.findIndex(n=>n);if(e[idx]===1&&e.reduce((a,b)=>a+b,0)===1&&r.n.get(k)!.n===1n&&r.n.get(k)!.d===1n&&roots.has(idx))exactValues[v]=copy(roots.get(idx)!);}
 }
 return {values,exactValues,certificate:{version:1,variables:[...variables],sources:[...sources],auxiliary:names.slice(variables.length),roots:Object.fromEntries([...roots].map(([i,r])=>[rootNames.get(i)!,copy(r)])),assignments:expressions}};
}

const expressionEvidence=new Set<string>();
export function validateRootExpression(root:Root,deadline=Date.now()+1000){
 if(!root.expression)return;const signature=JSON.stringify([root.polynomial,root.rationalInterval??root.interval,root.expression]);if(expressionEvidence.has(signature))return;
 const [lo,hi]=root.rationalInterval??root.interval.map(String);
 try{const value=rational(root.expression),a=rational(lo),b=rational(hi);if(!uat(root.polynomial.map(rational),value).n&&(cmp(a,b)===0?cmp(value,a)===0:cmp(value,a)>0&&cmp(value,b)<=0)){expressionEvidence.add(signature);return;}}catch{/* Radical expressions are checked by exact elimination below. */}
 const polynomial=root.polynomial.reduceRight((out,c)=>`(${out})*x+(${c})`,'0');
 const result=solveExactSystem([`x=(${root.expression})`,`${polynomial}=0`,`x${lo===hi?'>=':'>'}(${lo})`,`x<=(${hi})`],['x'],{deadline});
 if(result.kind!=='finite'||!result.complete||result.candidates.length!==1)throw Error('代数根显示表达式未通过精确验证');
 if(expressionEvidence.size>=512)expressionEvidence.delete(expressionEvidence.values().next().value!);expressionEvidence.add(signature);
}
/** Recheck stored algebraic evidence, not just its decimal rendering. */
export function validateExactCertificate(c:ExactCertificate,values:number[],expectedSources:string[],variables:string[],deadline=Date.now()+1000):void{
 const budget=new Budget(deadline);if(!c||c.version!==1||(!Array.isArray(c.sources)||c.sources.length>500||JSON.stringify(c.sources.slice(0,expectedSources.length))!==JSON.stringify(expectedSources))||JSON.stringify(c.variables)!==JSON.stringify(variables)||!c.roots||!c.assignments||!Array.isArray(c.auxiliary)||c.auxiliary.some(n=>typeof n!=='string'||!/^aux_\d+$/.test(n))||Object.keys(c.assignments).length!==variables.length+c.auxiliary.length||Object.keys(c.roots).length>100)throw Error('精确解证书与当前问题不一致');
 const names=Object.keys(c.roots);if(names.some(n=>!/^root_\d+$/.test(n)))throw Error('代数生成元名称无效');
 const compiler=new Compiler(names,budget),scope=new Map<number,Root>();names.forEach((name,i)=>{validateRoot(c.roots[name],budget);validateRootExpression(c.roots[name],budget.deadline);scope.set(i,copy(c.roots[name]));});
 const maps=new Map<number,R>();[...variables,...c.auxiliary].forEach((v,i)=>{const source=c.assignments[v];if(typeof source!=='string'||source.length>32768)throw Error('精确坐标表达式无效');maps.set(i,compiler.parse(source));const r=maps.get(i)!,d=signWithRoots(r.d,scope,budget);if(!d)throw Error('精确坐标分母为零');const computed=num(evalFraction(r,scope,budget));if(i<variables.length&&(!Number.isFinite(values[i])||Math.abs(computed-values[i])>1e-11*Math.max(1,Math.abs(computed))))throw Error('坐标与精确证书不一致');});
 if(compiler.equations.length||compiler.names.length!==names.length)throw Error('证书坐标必须是生成元的有理式');
 const original=new Compiler(variables,budget);for(const source of c.sources)original.relation(source);original.normalize();
 if(JSON.stringify(original.names)!==JSON.stringify([...variables,...c.auxiliary]))throw Error('辅助变量与原始条件不一致');
 const check=(g:Guard)=>{const r=fractionSubstitute(g.p,maps,budget,scope);const d=signWithRoots(r.d,scope,budget);return d!==0&&satisfied(signWithRoots(r.n,scope,budget)*d,g.op);};
 if(!original.equations.every(p=>check({p,op:'='}))||!original.guards.every(check))throw Error('精确证书不满足原始条件');
}
