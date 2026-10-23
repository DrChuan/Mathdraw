import {jacobian,rowBasis,offRowSpace} from './math';

export interface LocalMobility {linear:number;dof:number;removed:number;checked:boolean}
const inner=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
const length=(a:number[])=>Math.hypot(...a);
/** Symmetric Jacobi eigensolver for the small tangent-space stress matrices. */
function eigen(matrix:number[][]){
  const n=matrix.length,a=matrix.map(r=>[...r]),vectors=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0 as number));
  for(let step=0;step<n*n*30;step++){
    let p=0,q=0,big=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(a[i][j])>big){big=Math.abs(a[i][j]);p=i;q=j;}
    if(big<1e-12)break;
    const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle),pp=a[p][p],qq=a[q][q],pq=a[p][q];
    for(let i=0;i<n;i++)if(i!==p&&i!==q){const u=a[i][p],v=a[i][q];a[i][p]=a[p][i]=c*u-s*v;a[i][q]=a[q][i]=s*u+c*v;}
    a[p][p]=c*c*pp-2*s*c*pq+s*s*qq;a[q][q]=s*s*pp+2*s*c*pq+c*c*qq;a[p][q]=a[q][p]=0;
    for(let i=0;i<n;i++){const u=vectors[i][p],v=vectors[i][q];vectors[i][p]=c*u-s*v;vectors[i][q]=s*u+c*v;}
  }
  return Array.from({length:n},(_,i)=>({value:a[i][i],vector:vectors.map(r=>r[i])}));
}
/** A Jacobian null vector is only an infinitesimal motion. At extrema and
 * tangencies it can violate constraints at second order. Project Hessians
 * outside im(J): a semidefinite stress is a necessary quadratic condition on
 * every real motion, so its nonzero eigendirections can safely be removed.
 * Indefinite/higher-order cases remain conservative; failed continuation alone
 * is never used as proof that a configuration is rigid. */
export function localMobility(f:(x:number[])=>number[],x:number[],scale:number|number[]=1,deadline=Infinity):LocalMobility {
  if(!x.length)return {linear:0,dof:0,removed:0,checked:true};
  const scales=x.map((_,i)=>Array.isArray(scale)?scale[i]:scale),zero=x.map(()=>0);
  const evaluate=(v:number[])=>f(x.map((n,i)=>n+v[i]*scales[i]));
  const base=evaluate(zero),j=jacobian(evaluate,zero,base),rows=rowBasis(j),linear=x.length-rows.length;
  const result:LocalMobility={linear,dof:linear,removed:0,checked:true};
  if(!linear||!base.length)return result;
  if(linear>12||Date.now()>deadline)return {...result,checked:false};
  const tangent:number[][]=[];
  for(let i=0;i<x.length;i++){const v=zero.map((_,k)=>i===k?1:0),p=offRowSpace(v,[...rows,...tangent]),n=length(p);if(n>1e-6)tangent.push(p.map(v=>v/n));}
  const columns=rowBasis(x.map((_,i)=>j.map(row=>row[i])));
  if(columns.length===base.length)return result;
  const k=tangent.length,forms=base.map(()=>Array.from({length:k},()=>Array(k).fill(0)));
  const sample=(u:number[],v:number[],a:number,b:number,h:number)=>evaluate(zero.map((_,i)=>h*(a*u[i]+b*v[i])));
  let reliable=true;
  for(let i=0;i<k;i++)for(let l=i;l<k;l++){
    if(Date.now()>deadline)return {...result,checked:false};
    const at=(h:number)=>{
      const u=tangent[i],v=tangent[l];let raw:number[];
      if(i===l){const p=sample(u,v,1,0,h),m=sample(u,v,-1,0,h);raw=base.map((b,r)=>(p[r]+m[r]-2*b)/(h*h));}
      else {const pp=sample(u,v,1,1,h),pm=sample(u,v,1,-1,h),mp=sample(u,v,-1,1,h),mm=sample(u,v,-1,-1,h);raw=base.map((_,r)=>(pp[r]-pm[r]-mp[r]+mm[r])/(4*h*h));}
      return offRowSpace(raw,columns);
    };
    const a=at(.001),b=at(.0005),error=length(a.map((v,r)=>v-b[r]));
    // Kinks (inequality boundaries, absolute values) are not smooth Hessians.
    // Never turn their one-sided feasible directions into fixed coordinates.
    if(!b.every(Number.isFinite)||error>Math.max(1e-5,.08*Math.max(length(a),length(b)))){reliable=false;continue;}
    b.forEach((n,r)=>forms[r][i][l]=forms[r][l][i]=n);
  }
  if(!reliable)return {...result,checked:false};
  const constraints=rowBasis(forms.map(m=>m.flat()),1e-5).map(r=>Array.from({length:k},(_,i)=>r.slice(i*k,(i+1)*k)));
  let allowed=Array.from({length:k},(_,i)=>Array.from({length:k},(_,l)=>i===l?1:0 as number));
  for(let iteration=0;iteration<k&&allowed.length;iteration++){
    const restricted:number[][]=[];
    for(const form of constraints){
      const reduced=allowed.map(a=>allowed.map(b=>inner(a,form.map(row=>inner(row,b))))),spectrum=eigen(reduced),magnitude=Math.max(0,...spectrum.map(e=>Math.abs(e.value)));
      if(magnitude<1e-5)continue;
      const signTolerance=1e-10+magnitude*1e-8,tolerance=Math.max(1e-8,magnitude*1e-6),positive=spectrum.every(e=>e.value>=-signTolerance),negative=spectrum.every(e=>e.value<=signTolerance);
      if(!positive&&!negative)continue;
      for(const e of spectrum)if(Math.abs(e.value)>tolerance)restricted.push(allowed[0].map((_,i)=>allowed.reduce((sum,a,l)=>sum+e.vector[l]*a[i],0)));
    }
    const blocked=rowBasis(restricted);if(!blocked.length)break;
    const next:number[][]=[];
    for(const a of allowed){const v=offRowSpace(a,[...blocked,...next]),n=length(v);if(n>1e-5)next.push(v.map(n=>n/length(v)));}
    if(next.length===allowed.length)break;allowed=next;
  }
  return {...result,dof:allowed.length,removed:linear-allowed.length};
}
