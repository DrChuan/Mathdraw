import { parseExpression, evaluate } from "./expression";
import type { DrawingCurve, Vec2 } from "./types";
const cache=new WeakMap<DrawingCurve,{x:ReturnType<typeof parseExpression>;y:ReturnType<typeof parseExpression>}>();
export function pointAt(curve:DrawingCurve,t:number):Vec2 {
  if(!curve.parametric) throw new Error("不是参数曲线");
  let ast=cache.get(curve);
  if(!ast) {ast={x:parseExpression(curve.parametric.x,["t"]),y:parseExpression(curve.parametric.y,["t"])};cache.set(curve,ast);}
  return [evaluate(ast.x,{t}),evaluate(ast.y,{t})];
}
export function withinCurve(curve:DrawingCurve,[x,y]:Vec2):boolean {
  const l=curve.limits;
  if(!(Number.isFinite(x)&&Number.isFinite(y)&&x>=(l?.xMin??-Infinity)-1e-8&&x<=(l?.xMax??Infinity)+1e-8&&y>=(l?.yMin??-Infinity)-1e-8&&y<=(l?.yMax??Infinity)+1e-8))return false;
  const r=curve.reflectionInput;if(!r)return true;
  const dx=r.b[0]-r.a[0],dy=r.b[1]-r.a[1],t=((x-r.a[0])*dx+(y-r.a[1])*dy)/(dx*dx+dy*dy),q:Vec2=[2*(r.a[0]+t*dx)-x,2*(r.a[1]+t*dy)-y],s=r.source;
  return (s.followView!==false||(q[0]>=s.range[0]-1e-8&&q[0]<=s.range[1]+1e-8&&q[1]>=s.range[2]-1e-8&&q[1]<=s.range[3]+1e-8))&&withinCurve(s,q);
}

export function nearestParameter(curve:DrawingCurve,p:Vec2,previous?:number):number {
  const c=curve.parametric!;
  const span=c.tMax-c.tMin;
  const lo=previous===undefined?c.tMin:Math.max(c.tMin,previous-span*.15),hi=previous===undefined?c.tMax:Math.min(c.tMax,previous+span*.15);
  const dist=(t:number)=>{const q=pointAt(curve,t);return Math.hypot(q[0]-p[0],q[1]-p[1]);};
  let best=lo,score=Infinity;
  for(let i=0;i<=256;i++){const t=lo+(hi-lo)*i/256,d=dist(t);if(d<score){score=d;best=t;}}
  if(!Number.isFinite(score)) throw new Error("参数曲线在此区间暂时失效");
  let a=Math.max(lo,best-(hi-lo)/256),b=Math.min(hi,best+(hi-lo)/256);
  for(let i=0;i<40;i++){const u=a+(b-a)/3,v=b-(b-a)/3;if(dist(u)<dist(v))b=v;else a=u;}
  return (a+b)/2;
}
export function sampleParametric(curve:DrawingCurve,range:number[],budgetMs:number,resolution=180):Vec2[][] {
  const c=curve.parametric!,started=performance.now(),span=Math.max(range[1]-range[0],range[3]-range[2],1e-6);
  const paths:Vec2[][]=[];let path:Vec2[]=[],steps=0;
  const flush=()=>{if(path.length>1)paths.push(path);path=[];};
  const part=(a:number,b:number,pa:Vec2,pb:Vec2,depth:number)=>{
    if(++steps>50000 || (steps%64===0 && performance.now()-started>budgetMs))throw new Error("参数曲线计算超时，请缩小参数区间");
    const mid=(a+b)/2,pm=pointAt(curve,mid),valid=[...pa,...pb,...pm].every(Number.isFinite);
    const jump=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]),bend=Math.hypot(pm[0]-(pa[0]+pb[0])/2,pm[1]-(pa[1]+pb[1])/2);
    if((!valid||jump>span*.15||bend>span*(resolution<180?.006:.002))&&depth<10){part(a,mid,pa,pm,depth+1);part(mid,b,pm,pb,depth+1);return;}
    if(!valid||jump>span*.5){flush();return;}
    if(!path.length)path.push(pa);path.push(pb);
  };
  const count=Math.max(32,resolution);
  for(let i=0;i<count;i++){const a=c.tMin+(c.tMax-c.tMin)*i/count,b=c.tMin+(c.tMax-c.tMin)*(i+1)/count;part(a,b,pointAt(curve,a),pointAt(curve,b),0);}
  flush();return paths;
}
export function parameterCrossings(a:DrawingCurve,b:DrawingCurve):Vec2[] {
  const A=a.parametric!,B=b.parametric!,n=128,found:Vec2[]=[];
  const ap=Array.from({length:n+1},(_,i)=>pointAt(a,A.tMin+(A.tMax-A.tMin)*i/n));
  const bp=Array.from({length:n+1},(_,i)=>pointAt(b,B.tMin+(B.tMax-B.tMin)*i/n));
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const p=ap[i],q=ap[i+1],r=bp[j],s=bp[j+1];
    if(![...p,...q,...r,...s].every(Number.isFinite)||Math.max(p[0],q[0])<Math.min(r[0],s[0])-1e-6||Math.min(p[0],q[0])>Math.max(r[0],s[0])+1e-6||Math.max(p[1],q[1])<Math.min(r[1],s[1])-1e-6||Math.min(p[1],q[1])>Math.max(r[1],s[1])+1e-6)continue;
    let t=A.tMin+(A.tMax-A.tMin)*(i+.5)/n,u=B.tMin+(B.tMax-B.tMin)*(j+.5)/n;
    for(let k=0;k<16;k++){
      const x=pointAt(a,t),y=pointAt(b,u),h=1e-6,dx=pointAt(a,t+h),dy=pointAt(b,u+h);
      const ax=(dx[0]-x[0])/h,ay=(dx[1]-x[1])/h,bx=(dy[0]-y[0])/h,by=(dy[1]-y[1])/h,det=ay*bx-ax*by;
      if(Math.abs(det)<1e-12)break;
      const fx=x[0]-y[0],fy=x[1]-y[1];t+=(fx*by-fy*bx)/det;u+=(ay*fx-ax*fy)/det;
    }
    const x=pointAt(a,t),y=pointAt(b,u);
    if(t>=A.tMin-1e-8&&t<=A.tMax+1e-8&&u>=B.tMin-1e-8&&u<=B.tMax+1e-8&&Math.hypot(x[0]-y[0],x[1]-y[1])<1e-6&&withinCurve(a,x)&&withinCurve(b,x)&&!found.some(p=>Math.hypot(p[0]-x[0],p[1]-x[1])<1e-5))found.push(x);
  }
  return found;
}
