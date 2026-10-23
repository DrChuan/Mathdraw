import { parseExpression,evaluate } from "./expression";
import { expressionText } from "./advanced";
type Ast=ReturnType<typeof parseExpression>;
type Poly=number[];
export interface Rational { numerator:Poly;denominator:Poly }
const magnitude=(p:Poly)=>Math.max(0,...p.map(Math.abs));
const clean=(p:Poly,tolerance=0):Poly=>{const q=p.map(v=>Math.abs(v)<=tolerance?0:v);while(q.length>1&&q.at(-1)===0)q.pop();return q;};
const sum=(a:Poly,b:Poly,sign=1)=>clean(Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]??0)+sign*(b[i]??0)),Math.max(magnitude(a),magnitude(b))*2e-13);
const times=(a:Poly,b:Poly):Poly=>{
  if(a.length+b.length>98)throw Error("轨迹代数次数过高");
  const out=Array(a.length+b.length-1).fill(0);a.forEach((x,i)=>b.forEach((y,j)=>out[i+j]+=x*y));return clean(out);
};
const scale=(a:Poly,k:number)=>clean(a.map(v=>v*k));
function divide(a:Poly,b:Poly):{quotient:Poly;remainder:Poly} {
  if(!magnitude(b))throw Error("轨迹构造分母恒为零");
  let r=[...a];const q=Array(Math.max(1,a.length-b.length+1)).fill(0),tolerance=Math.max(magnitude(a),magnitude(b))*1e-11;
  while(r.length>=b.length&&magnitude(r)>tolerance) {
    const degree=r.length-b.length,k=r.at(-1)!/b.at(-1)!;q[degree]=k;
    b.forEach((v,i)=>r[i+degree]-=k*v);r=clean(r,tolerance);
  }
  return {quotient:clean(q),remainder:clean(r,tolerance)};
}
function reduce(n:Poly,d:Poly):Rational {
  if(![...n,...d].every(Number.isFinite)||!magnitude(d))throw Error("无效的轨迹分母");
  if(!magnitude(n))return {numerator:[0],denominator:[1]};
  let a=scale(n,1/n.at(-1)!),b=scale(d,1/d.at(-1)!);
  for(let i=0;i<48&&magnitude(b);i++){const r=divide(a,b).remainder;a=b;b=magnitude(r)?scale(r,1/r.at(-1)!):[0];}
  if(a.length>1) {
    const x=divide(n,a),y=divide(d,a);
    if(!magnitude(x.remainder)&&!magnitude(y.remainder)){n=x.quotient;d=y.quotient;}
  }
  const k=1/d.at(-1)!;return {numerator:scale(n,k),denominator:scale(d,k)};
}
export function rationalExpression(source:string):Rational|null {
  const walk=(a:Ast):Rational=>{
    if(a.type==="number")return {numerator:[a.value],denominator:[1]};
    if(a.type==="variable"){if(a.name!=="t")throw Error();return {numerator:[0,1],denominator:[1]};}
    if(a.type==="unary"){const p=walk(a.value);return {...p,numerator:scale(p.numerator,a.sign)};}
    if(a.type==="call"){const n=evaluate(a);if(!Number.isFinite(n))throw Error();return {numerator:[n],denominator:[1]};}
    const p=walk(a.left),q=walk(a.right),[n,d,x,y]=[p.numerator,p.denominator,q.numerator,q.denominator];
    if(a.op==="+"||a.op==="-")return reduce(sum(times(n,y),times(x,d),a.op==="+"?1:-1),times(d,y));
    if(a.op==="*")return reduce(times(n,x),times(d,y));
    if(a.op==="/")return reduce(times(n,y),times(d,x));
    if(x.length!==1||y.length!==1)throw Error();const power=x[0]/y[0];
    if(!Number.isInteger(power)||Math.abs(power)>12)throw Error();
    let numerator=[1],denominator=[1];
    for(let i=0;i<Math.abs(power);i++){numerator=times(numerator,power<0?d:n);denominator=times(denominator,power<0?n:d);}
    return reduce(numerator,denominator);
  };
  try{return walk(parseExpression(source,["t"]));}catch{return null;}
}
function polynomialText(p:Poly,name="t"):string {
  let text="";
  p.forEach((v,i)=>{if(!v)return;const k=Number(Math.abs(v).toPrecision(14)),body=i?`${k===1?"":`${k}*`}${name}${i>1?`^${i}`:""}`:String(k);text+=`${v<0?"-":text?"+":""}${body}`;});
  return text||"0";
}
export function simplifyLocusExpression(source:string):string {
  const r=rationalExpression(source);
  if(r){const n=polynomialText(r.numerator);return r.denominator.length===1&&r.denominator[0]===1?n:`(${n})/(${polynomialText(r.denominator)})`;}
  return expressionText(parseExpression(source,["t"]));
}

/** tan(s) covers the real line. Homogenize with sin/cos so a bounded locus
 * remains well conditioned at s=±pi/2 instead of evaluating huge powers. */
export function compactLocusParameter(xy:[string,string]):[string,string]|undefined {
  const result=xy.map(source=>{
    const r=rationalExpression(source);if(!r)return;
    const degree=Math.max(r.numerator.length,r.denominator.length)-1;
    const text=(p:Poly)=>p.flatMap((v,i)=>v?[`(${Number(v.toPrecision(14))})${i?`*sin(t)^${i}`:""}${degree-i?`*cos(t)^${degree-i}`:""}`]:[]).join("+")||"0";
    const expression=`(${text(r.numerator)})/(${text(r.denominator)})`;
    return expression.length<1900?expression:undefined;
  });
  return result.every((s):s is string=>!!s)?result as [string,string]:undefined;
}

/** Find a polynomial identity in x,y by coefficient elimination, not by fitting
 * sampled points. The six columns are x²,xy,y²,x,y,1 after clearing denominators. */
export function rationalConicLocus(xy:[string,string]):string|undefined {
  const a=rationalExpression(xy[0]),b=rationalExpression(xy[1]);if(!a||!b)return;
  try {
    const [n,d,m,e]=[a.numerator,a.denominator,b.numerator,b.denominator],d2=times(d,d),e2=times(e,e);
    const columns=[times(times(n,n),e2),times(times(n,m),times(d,e)),times(times(m,m),d2),times(times(n,d),e2),times(times(m,e),d2),times(d2,e2)];
    const solve=(indices:number[])=>{
      const scales=indices.map(i=>magnitude(columns[i])||1),height=Math.max(...columns.map(c=>c.length));
      const rows=Array.from({length:height},(_,r)=>indices.map((i,k)=>(columns[i][r]??0)/scales[k]));
      let rank=0;const pivots:number[]=[];
      for(let col=0;col<indices.length&&rank<height;col++) {
        let best=rank;for(let i=rank+1;i<height;i++)if(Math.abs(rows[i][col])>Math.abs(rows[best][col]))best=i;
        if(Math.abs(rows[best][col])<1e-10)continue;
        [rows[best],rows[rank]]=[rows[rank],rows[best]];const p=rows[rank][col];rows[rank]=rows[rank].map(v=>v/p);
        for(let i=0;i<height;i++)if(i!==rank){const factor=rows[i][col];rows[i]=rows[i].map((v,j)=>v-factor*rows[rank][j]);}
        pivots.push(col);rank++;
      }
      const free=indices.map((_,i)=>i).filter(i=>!pivots.includes(i));if(free.length!==1)return;
      const coefficients=Array(indices.length).fill(0);coefficients[free[0]]=1;
      pivots.forEach((col,r)=>coefficients[col]=-rows[r][free[0]]);
      const result=Array(6).fill(0);indices.forEach((i,k)=>result[i]=coefficients[k]/scales[k]);
      const error=Array.from({length:height},(_,r)=>result.reduce((s,k,i)=>s+k*(columns[i][r]??0),0));
      const bound=result.reduce((s,k,i)=>s+Math.abs(k)*magnitude(columns[i]),0);
      return magnitude(error)<=bound*1e-9?result:undefined;
    };
    const values=solve([3,4,5])??solve([0,1,2,3,4,5]);if(!values)return;
    const largest=magnitude(values),nonzero=values.filter(v=>Math.abs(v)>largest*1e-10),normal=Math.min(...nonzero.map(Math.abs))*(nonzero[0]<0?-1:1);
    const labels=["x^2","x*y","y^2","x","y",""];let text="";
    values.forEach((v,i)=>{if(Math.abs(v)<=largest*1e-10)return;const k=Number((Math.abs(v)/Math.abs(normal)).toPrecision(12)),body=`${k===1&&labels[i]?"":k}${k!==1&&labels[i]?"*":""}${labels[i]}`;text+=`${v/normal<0?"-":text?"+":""}${body}`;});
    return text?`${text}=0`:undefined;
  }catch{return;}
}
