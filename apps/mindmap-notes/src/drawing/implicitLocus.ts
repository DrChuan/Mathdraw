import { evaluate, parseExpression } from "./expression";
type Ast=ReturnType<typeof parseExpression>;
type Poly=Map<string,number>;
type Basis="circular"|"hyperbolic"|"parabolic";
const constant=(v:number):Poly=>new Map([["0,0",v]]);
const scale=(p:Poly,n:number):Poly=>new Map([...p].map(([k,v])=>[k,v*n]));
function sum(a:Poly,b:Poly):Poly {const p=new Map(a);for(const [k,v] of b)p.set(k,(p.get(k)??0)+v);return p;}
function product(a:Poly,b:Poly):Poly|null {
 const p:Poly=new Map();for(const [ka,va] of a)for(const [kb,vb] of b){if(!va||!vb)continue;const [a,b]=ka.split(",").map(Number),[c,d]=kb.split(",").map(Number);if(a+b+c+d>4)return null;const k=`${a+c},${b+d}`;p.set(k,(p.get(k)??0)+va*vb);}return p;
}
function polynomial(a:Ast,basis:Basis):Poly|null {
 if(a.type==="number")return constant(a.value);
 if(a.type==="variable")return a.name==="t"&&basis==="parabolic"?new Map([["1,0",1]]):null;
 if(a.type==="unary"){const p=polynomial(a.value,basis);return p&&scale(p,a.sign);}
 if(a.type==="call"){
  const arg=a.args[0];
  if(a.args.length===1&&arg?.type==="variable"&&arg.name==="t"){
   if(basis==="circular"&&["cos","sin"].includes(a.name))return new Map([[a.name==="cos"?"1,0":"0,1",1]]);
   if(basis==="hyperbolic"&&a.name==="exp")return new Map([["1,0",1]]);
  }
  if(basis==="hyperbolic"&&a.name==="exp"&&arg?.type==="unary"&&arg.sign===-1&&arg.value.type==="variable"&&arg.value.name==="t")return new Map([["0,1",1]]);
  // Constant functions are safe; expressions containing the scan parameter are not constants.
  try{const v=evaluate(a);return Number.isFinite(v)?constant(v):null;}catch{return null;}
 }
 const p=polynomial(a.left,basis),q=polynomial(a.right,basis);if(!p||!q)return null;
 if(a.op==="+"||a.op==="-")return sum(p,scale(q,a.op==="+"?1:-1));
 if(a.op==="*")return product(p,q);
 if([...q].some(([k,v])=>k!=="0,0"&&v!==0))return null;
 const v=q.get("0,0")??0;
 if(a.op==="/")return v?scale(p,1/v):null;
 if(a.op==="^"&&Number.isInteger(v)&&v>=0&&v<=4){let r:Poly|null=constant(1);for(let i=0;i<v&&r;i++)r=product(r,p);return r;}
 return null;
}
function affine(p:Poly,basis:Basis):[number,number,number]|null {
 const keys=basis==="parabolic"?["0,0","1,0","2,0"]:["0,0","1,0","0,1"];
 if([...p].some(([k,v])=>!keys.includes(k)&&v!==0))return null;
 return keys.map(k=>p.get(k)??0) as [number,number,number];
}
function equationText(terms:number[]):string|undefined {
 if(!terms.every(Number.isFinite))return;
 const max=Math.max(...terms.map(Math.abs));if(!max)return;
 const nonzero=terms.filter(v=>Math.abs(v)>max*1e-12),normal=Math.min(...nonzero.map(Math.abs))*(nonzero[0]<0?-1:1);
 const labels=["x^2","x*y","y^2","x","y",""];let text="";
 terms.forEach((v,i)=>{if(Math.abs(v)<=max*1e-12)return;const n=Number((v/normal).toPrecision(12)),m=Math.abs(n),body=`${m===1&&labels[i]?"":m}${m!==1&&labels[i]?"*":""}${labels[i]}`;text+=`${n<0?"-":text?"+":""}${body}`;});
 return text?`${text}=0`:undefined;
}
/** Eliminate an invertible affine image of (cos t,sin t), (exp t,exp -t), or (t,t²).
 * Coefficients come from AST arithmetic, never from fitting sampled points. */
export function implicitConicLocus(xy:[string,string]):string|undefined {
 try {
  const ast=xy.map(s=>parseExpression(s,["t"]));
  for(const basis of ["circular","hyperbolic","parabolic"] as Basis[]){
   const ps=ast.map(a=>polynomial(a,basis));if(ps.some(p=>!p))continue;
   const ab=ps.map(p=>affine(p!,basis));if(ab.some(p=>!p))continue;
   const [a,b]=ab as [[number,number,number],[number,number,number]],det=a[1]*b[2]-a[2]*b[1];
   if(Math.abs(det)<=Number.EPSILON*32*Math.max(1,Math.abs(a[1]*b[2]),Math.abs(a[2]*b[1]))){
    // A rank-one image is a line (possibly just an interval on that line).
    const i=Math.hypot(a[1],b[1])>=Math.hypot(a[2],b[2])?1:2;
    if(Math.hypot(a[i],b[i])>1e-12)return equationText([0,0,0,b[i],-a[i],a[i]*b[0]-b[i]*a[0]]);
    continue;
   }
   const u=new Map([["1,0",b[2]],["0,1",-a[2]],["0,0",a[2]*b[0]-b[2]*a[0]]]);
   const v=new Map([["1,0",-b[1]],["0,1",a[1]],["0,0",b[1]*a[0]-a[1]*b[0]]]);
   const equation=basis==="circular"?sum(sum(product(u,u)!,product(v,v)!),constant(-det*det)):
    basis==="hyperbolic"?sum(product(u,v)!,constant(-det*det)):sum(scale(v,det),scale(product(u,u)!,-1));
   const terms=["2,0","1,1","0,2","1,0","0,1","0,0"].map(k=>equation.get(k)??0);
   const text=equationText(terms);if(text)return text;
  }
 }catch{/* Keep the exact parameterization when elimination is unsupported. */}
}
