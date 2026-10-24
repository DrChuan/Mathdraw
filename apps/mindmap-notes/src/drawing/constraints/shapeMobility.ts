import {localMobility} from './mobility';
import {offRowSpace,rowBasis} from './math';

/** A local slice transverse to the actual Euclidean orbit. Do not subtract a
 * constant six: a single point has three orbit dimensions, a collinear set
 * five, and a non-collinear set six. Centering/scaling keeps the rank stable
 * under a change of position, orientation, or units.
 *
 * The slice fixes only the overall pose, not the distances of a reference
 * block. Thus a different choice of fixed points cannot change shape DOF.
 * Running the finite-mobility check on the slice also retains the second-order
 * rigidity checks at tangencies/extrema instead of trusting Jacobian nullity.
 */
function orbitBasis(x:number[],scale:number){
  const count=x.length/3,center=[0,1,2].map(k=>x.reduce((sum,v,i)=>sum+(i%3===k?v:0),0)/Math.max(1,count));
  const offsets=Array.from({length:count},(_,i)=>[0,1,2].map(k=>(x[i*3+k]-center[k])/scale));
  const extent=Math.max(1e-12,...offsets.map(p=>Math.hypot(...p)));
  return rowBasis([
    ...[0,1,2].map(k=>x.map((_,i)=>i%3===k?1:0)),
    ...[0,1,2].map(k=>offsets.flatMap(([a,b,c])=>(k===0?[0,-c,b]:k===1?[c,0,-a]:[-b,a,0]).map(v=>v/extent))),
  ]);
}
export function shapeMobility(f:(x:number[])=>number[],x:number[],scale:number,deadline=Infinity){
  const orbit=orbitBasis(x,scale);
  const slice:number[][]=[];
  for(let i=0;i<x.length;i++){
    const v=offRowSpace(x.map((_,k)=>i===k?1:0),[...orbit,...slice]),length=Math.hypot(...v);
    if(length>1e-6)slice.push(v.map(n=>n/length));
  }
  const mobility=localMobility(v=>f(x.map((n,i)=>n+scale*slice.reduce((sum,b,k)=>sum+b[i]*v[k],0))),slice.map(()=>0),1,deadline,orbit.length<6);
  // At a collinear configuration rotations about its axis fix every point,
  // but act on possible bending directions. Quotient this residual stabilizer
  // too: two transverse bending components describe one shape parameter, not
  // two. If constraints keep the set collinear (or rigid), no such action is
  // removed. The same rank-aware rule handles coincident configurations.
  let stabilizer=0;
  if(orbit.length<6&&mobility.dof){
    const directions=mobility.directions??[];
    const probes=[...directions,...[1,2,3].map(seed=>slice.map((_,k)=>directions.reduce((sum,d,i)=>sum+d[k]*Math.sin((i+1)*seed),0)))];
    for(const v of probes){
      const q=x.map((n,i)=>n+scale*slice.reduce((sum,b,k)=>sum+b[i]*v[k],0));
      stabilizer=Math.max(stabilizer,orbitBasis(q,scale).length-orbit.length);
      if(stabilizer===6-orbit.length)break;
    }
  }
  const {directions:_,...count}=mobility;
  stabilizer=Math.min(stabilizer,mobility.dof);
  return {...count,linear:count.linear-stabilizer,dof:count.dof-stabilizer,rigid:orbit.length,stabilizer};
}
