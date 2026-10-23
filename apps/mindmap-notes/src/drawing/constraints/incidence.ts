import type { ConstraintProblem,Positions } from "./types";
import { add,sub,mul,dot,norm,unit,perpendicular } from "./math";

/** Eliminate a division + segment-incidence loop with a perpendicular line.
 * This constructs a continuous family, rather than guessing all coordinates:
 * M=(1-lambda)A+lambda B, E in CM, AE perpendicular BC.
 * For any B with |AE| < projection_AB < |AE|/lambda and nonzero altitude,
 * C is the intersection of ME and the plane through B normal to AE.
 * Consequently E lies strictly between C and M. Two shape parameters remain
 * free (plus azimuth about AE); choosing one representative is not optimization.
 */
export function incidenceFrame(problem:ConstraintProblem,anchors:Positions) {
  const active=problem.conditions.filter(c=>c.enabled),same=(r:string[],a:string,b:string)=>r.length===2&&r.includes(a)&&r.includes(b);
  for(const division of active.filter(c=>c.kind==="division"))for(const reverse of [false,true]) {
    const m=division.refs[0][0],[a,b]=reverse?[...division.refs[1]].reverse():division.refs[1],t=division.value!/(1+division.value!),lambda=reverse?1-t:t;
    if(!anchors[a]||anchors[b]||anchors[m]||!(lambda>0&&lambda<1))continue;
    for(const incidence of active.filter(c=>c.kind==="onSegment"&&c.refs[1].includes(m))) {
      const e=incidence.refs[0][0],c=incidence.refs[1].find(n=>n!==m)!;
      if(!anchors[e]||anchors[c]||new Set([a,b,c,m,e]).size!==5)continue;
      const perpendicularCondition=active.find(k=>k.kind==="perpendicular"&&
        (same(k.refs[0],a,e)&&same(k.refs[1],b,c)||same(k.refs[1],a,e)&&same(k.refs[0],b,c)));
      if(!perpendicularCondition)continue;
      const origin=anchors[a],axis=sub(anchors[e],origin),length=norm(axis);if(length<1e-10)continue;
      const u=unit(axis),v=(problem.mode==='plane'||problem.mode==='coordinate')?[-u[1],u[0],0] as [number,number,number]:perpendicular(u),x=length*(1+1/lambda)/2;
      const pb=add(origin,add(mul(u,x),mul(v,length/2))),pm=add(origin,mul(sub(pb,origin),lambda)),direction=sub(anchors[e],pm),denominator=dot(direction,u);
      if(Math.abs(denominator)<1e-10)continue;
      const pc=add(pm,mul(direction,dot(sub(pb,pm),u)/denominator));
      return {positions:{...anchors,[b]:pb,[m]:pm,[c]:pc},steps:[
        `以 ${a}${e} 为固定长度参照，保留 ${b} 的投影与高度为连续参数，选择一个内部代表构型`,
        `按定比分点关系构造 ${m}；由 ${m}${e} 与过 ${b} 且垂直于 ${a}${e} 的辅助平面求交，构造 ${c}`,
        `所选参数范围保证 ${e} 在线段 ${c}${m} 内；全部条件仍须回代校验`,
      ]};
    }
  }
}
