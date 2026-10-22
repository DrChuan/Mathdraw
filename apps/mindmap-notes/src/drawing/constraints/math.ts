import type { Vec3 } from "../types";
import type { Pose } from "./types";
export const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul=(a:Vec3,t:number):Vec3=>[a[0]*t,a[1]*t,a[2]*t];
export const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=(a:Vec3)=>Math.hypot(...a);
export const unit=(a:Vec3):Vec3=>mul(a,1/Math.max(1e-14,norm(a)));
export const world=(p:Vec3,f:Pose)=>add(f.origin,add(mul(f.x,p[0]),add(mul(f.y,p[1]),mul(f.z,p[2]))));
export const local=(p:Vec3,f:Pose):Vec3=>[dot(sub(p,f.origin),f.x),dot(sub(p,f.origin),f.y),dot(sub(p,f.origin),f.z)];
export const perpendicular=(n:Vec3)=>unit(cross(n,Math.abs(n[0])<.8?[1,0,0]:[0,1,0]));
const inner=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
// Modified Gram-Schmidt with reorthogonalization, used only for the small
// constraint Jacobian's row/null spaces. No JᵀJ is formed.
export function rowBasis(rows:number[][], tolerance=2e-6):number[][] {
  const basis:number[][]=[];
  const ordered=rows.map(r=>[...r]).sort((a,b)=>inner(b,b)-inner(a,a));
  for(const row of ordered) {
    const original=Math.sqrt(inner(row,row)); if(original<1e-12)continue;
    for(let k=0;k<2;k++)for(const b of basis) {const c=inner(row,b);for(let i=0;i<row.length;i++)row[i]-=c*b[i];}
    const length=Math.sqrt(inner(row,row));
    if(length>tolerance*Math.max(1,original))basis.push(row.map(v=>v/length));
  }
  return basis;
}
export function offRowSpace(row:number[],basis:number[][]) {
  const r=[...row];for(let k=0;k<2;k++)for(const b of basis){const c=inner(r,b);for(let i=0;i<r.length;i++)r[i]-=c*b[i];}
  return r;
}
// Householder QR of the damped augmented system [J; sqrt(lambda) I].
export function dampedStep(j:number[][],r:number[],lambda:number):number[] {
  const n=j[0]?.length??0, m=j.length+n, a=j.map(row=>[...row]);
  const b=r.map(v=>-v);
  for(let i=0;i<n;i++){const row=new Array(n).fill(0);row[i]=Math.sqrt(lambda);a.push(row);b.push(0);}
  for(let k=0;k<n;k++) {
    let length=0;for(let i=k;i<m;i++)length=Math.hypot(length,a[i][k]);
    if(length<1e-16)continue;
    const alpha=a[k][k]>=0?-length:length, v=new Array(m-k);
    for(let i=k;i<m;i++)v[i-k]=a[i][k];v[0]-=alpha;
    const v2=inner(v,v);if(v2<1e-30)continue;
    for(let col=k;col<n;col++) {let c=0;for(let i=k;i<m;i++)c+=v[i-k]*a[i][col];c*=2/v2;for(let i=k;i<m;i++)a[i][col]-=c*v[i-k];}
    let c=0;for(let i=k;i<m;i++)c+=v[i-k]*b[i];c*=2/v2;for(let i=k;i<m;i++)b[i]-=c*v[i-k];
  }
  const x=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){let s=b[i];for(let k=i+1;k<n;k++)s-=a[i][k]*x[k];x[i]=Math.abs(a[i][i])>1e-15?s/a[i][i]:0;}
  return x;
}
export function jacobian(f:(x:number[])=>number[],x:number[],r=f(x)):number[][] {
  const j=r.map(()=>new Array(x.length).fill(0));
  for(let k=0;k<x.length;k++) {
    const h=2e-6*Math.max(1,Math.abs(x[k])), next=[...x];next[k]+=h;const plus=f(next);next[k]-=2*h;const minus=f(next);
    for(let i=0;i<r.length;i++)j[i][k]=(plus[i]-minus[i])/(2*h);
  }
  return j;
}
