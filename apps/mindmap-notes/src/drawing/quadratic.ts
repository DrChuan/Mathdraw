import type { conicCoefficients } from "./conics";
import type { Vec2 } from "./types";

export type Quadratic = NonNullable<ReturnType<typeof conicCoefficients>>;
const add = (a:number[], b:number[], sign=1) => Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]??0)+sign*(b[i]??0));
const mul = (a:number[], b:number[]) => {
  const out = Array(a.length+b.length-1).fill(0);
  a.forEach((x,i)=>b.forEach((y,j)=>out[i+j]+=x*y));
  return out as number[];
};
const value = (p:number[], x:number) => p.reduceRight((v,c)=>v*x+c,0);
const magnitude = (p:number[], x:number) => p.reduceRight((v,c)=>v*Math.abs(x)+Math.abs(c),0);

/** Isolate real polynomial roots at derivative roots, retaining even multiplicities. */
export function polynomialRoots(coefficients:number[]):number[] {
  const scale = Math.max(...coefficients.map(Math.abs));
  if (!scale || !Number.isFinite(scale)) return [];
  const p = coefficients.map(v=>v/scale);
  while (p.length>1 && p.at(-1)===0) p.pop();
  if (p.length===1) return [];
  if (p.length===2) return [-p[0]/p[1]];
  if (p.length===3) {
    const [c,b,a]=p,discriminant=b*b-4*a*c,tolerance=1e-12*(b*b+Math.abs(4*a*c));
    if(discriminant < -tolerance)return [];
    if(Math.abs(discriminant)<=tolerance)return [-b/(2*a)];
    const q=-.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));
    return [q/a,c/q].sort((a,b)=>a-b);
  }
  const bound = 1+Math.max(...p.slice(0,-1).map(v=>Math.abs(v/p.at(-1)!)));
  const critical = polynomialRoots(p.slice(1).map((v,i)=>v*(i+1))).filter(x=>Math.abs(x)<bound);
  const stops = [-bound,...critical,bound], out:number[] = [];
  const accept = (x:number) => {
    if (!out.some(t=>Math.abs(t-x)<1e-8*Math.max(1,Math.abs(x)))) out.push(x);
  };
  for (const x of critical) if (Math.abs(value(p,x))<=1e-12*magnitude(p,x)) accept(x);
  for (let i=1;i<stops.length;i++) {
    let lo=stops[i-1],hi=stops[i],f=value(p,lo),g=value(p,hi);
    if (Math.abs(f)<=1e-12*magnitude(p,lo)) {accept(lo);f=0;}
    if (Math.abs(g)<=1e-12*magnitude(p,hi)) {accept(hi);g=0;}
    if ((f<0)===(g<0) || f===0 || g===0) continue;
    for (let k=0;k<100;k++) {
      const mid=(lo+hi)/2,v=value(p,mid);
      if (v===0) {lo=hi=mid;break;}
      if ((f<0)===(v<0)) {lo=mid;f=v;} else hi=mid;
      if (hi-lo<1e-12*Math.max(1,Math.abs(mid))) break;
    }
    accept((lo+hi)/2);
  }
  return out.sort((a,b)=>a-b);
}

const residual = ([A,B,C,D,E,F]:Quadratic,[x,y]:Vec2) => A*x*x+B*x*y+C*y*y+D*x+E*y+F;
const onConic = (q:Quadratic,p:Vec2) => {
  const [A,B,C,D,E,F]=q,[x,y]=p;
  return Math.abs(residual(q,p))<=1e-9*Math.max(1,Math.abs(A*x*x)+Math.abs(B*x*y)+Math.abs(C*y*y)+Math.abs(D*x)+Math.abs(E*y)+Math.abs(F));
};
function refine(first:Quadratic,second:Quadratic,point:Vec2):Vec2 {
  let [x,y]=point;
  const [A,B,C,D,E]=first,[G,H,I,J,K]=second;
  for(let i=0;i<16;i++) {
    const a=2*A*x+B*y+D,b=B*x+2*C*y+E,c=2*G*x+H*y+J,d=H*x+2*I*y+K,det=a*d-b*c;
    if(Math.abs(det)<1e-24)break;
    const f=residual(first,[x,y]),g=residual(second,[x,y]),dx=(d*f-b*g)/det,dy=(a*g-c*f)/det;
    if(!Number.isFinite(dx+dy))break;
    x-=dx;y-=dy;
    if(Math.abs(dx)+Math.abs(dy)<1e-12)break;
  }
  return [x,y];
}

/** Substitution along a normalized line avoids all search rectangles and Newton seeds. */
export function lineConic(q:Quadratic, a:number,b:number,c:number):Vec2[] {
  const n=Math.hypot(a,b);
  if (n<1e-14) return [];
  a/=n;b/=n;c/=n;
  const x=-a*c,y=-b*c,u=-b,v=a,[A,B,C,D,E,F]=q;
  const p=[A*x*x+B*x*y+C*y*y+D*x+E*y+F,
    2*A*x*u+B*(x*v+y*u)+2*C*y*v+D*u+E*v,A*u*u+B*u*v+C*v*v];
  const sizes=[Math.abs(A*x*x)+Math.abs(B*x*y)+Math.abs(C*y*y)+Math.abs(D*x)+Math.abs(E*y)+Math.abs(F),
    Math.abs(2*A*x*u)+Math.abs(B*x*v)+Math.abs(B*y*u)+Math.abs(2*C*y*v)+Math.abs(D*u)+Math.abs(E*v),
    Math.abs(A*u*u)+Math.abs(B*u*v)+Math.abs(C*v*v)];
  if (p.every((v,i)=>Math.abs(v)<=1e-14*sizes[i])) throw new Error("两个图形重合，交点无法唯一确定");
  return polynomialRoots(p).map(t=>[x+u*t,y+v*t] as Vec2).filter(p=>onConic(q,p));
}

/** Resultant eliminates one coordinate; solve both orientations to handle vertical tangencies. */
export function conicIntersections(first:Quadratic,second:Quadratic):Vec2[] {
  if (first.slice(0,3).every(v=>v===0)) return lineConic(second,...first.slice(3) as [number,number,number]);
  if (second.slice(0,3).every(v=>v===0)) return lineConic(first,...second.slice(3) as [number,number,number]);
  const out:Vec2[]=[];
  let isolated=false;
  for (const swap of [false,true]) {
    const orient=([A,B,C,D,E,F]:Quadratic):Quadratic=>swap?[C,B,A,E,D,F]:[A,B,C,D,E,F];
    const p=orient(first),q=orient(second);
    const [A,B,C,D,E,F]=p,[G,H,I,J,K,L]=q;
    const a=[C],b=[E,B],c=[F,D,A],d=[I],e=[K,H],f=[L,J,G];
    const afcd=add(mul(a,f),mul(c,d),-1),aebd=add(mul(a,e),mul(b,d),-1),bfce=add(mul(b,f),mul(c,e),-1);
    const r=C===0 && I===0 ? bfce : add(mul(afcd,afcd),mul(aebd,bfce),-1);
    if (r.every(v=>v===0)) continue;
    isolated=true;
    for (const x of polynomialRoots(r)) {
      const ys=[...polynomialRoots([value(c,x),value(b,x),C]),...polynomialRoots([value(f,x),value(e,x),I])];
      for (const y of ys) {
        const point=refine(first,second,swap?[y,x]:[x,y]);
        if (point.every(Number.isFinite) && onConic(first,point) && onConic(second,point) &&
          !out.some(p=>Math.hypot(p[0]-point[0],p[1]-point[1])<1e-6)) out.push(point);
      }
    }
  }
  if (!isolated) throw new Error("两个图形重合或含公共分支，交点无法唯一确定");
  return out.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}
