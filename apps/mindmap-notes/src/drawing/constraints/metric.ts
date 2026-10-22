import { expandConditions } from "./compile";
import type { ConstraintProblem } from "./types";

export const distanceKey=(a:string,b:string)=>JSON.stringify([a,b].sort());
export type MetricNetwork=Map<string,number>;
/** Propagate lengths and SAS before placing any point. A line angle is
 * unoriented, so both cosine signs must survive until final verification. */
export function metricNetworks(problem:ConstraintProblem,cap=32):{networks:MetricNetwork[];exhaustive:boolean} {
  const primitives=expandConditions(problem),initial:MetricNetwork=new Map();
  for(const c of primitives)if(c.kind==="distance")initial.set(distanceKey(...c.refs[0] as [string,string]),c.value!);
  const angles:{a:string;v:string;b:string;cosines:number[]}[]=[];
  for(const c of primitives) {
    if(c.kind==="vertexAngle")angles.push({a:c.refs[0][0],v:c.refs[1][0],b:c.refs[2][0],cosines:[Math.cos(c.value!*Math.PI/180)]});
    if((c.kind==="lineAngle"||c.kind==="perpendicular"||c.kind==="parallel")&&c.refs.every(r=>r.length===2)) {
      const v=c.refs[0].find(p=>c.refs[1].includes(p));if(!v)continue;
      const a=c.refs[0].find(p=>p!==v)!,b=c.refs[1].find(p=>p!==v)!;if(a===b)continue;
      const value=c.kind==="perpendicular"?90:c.kind==="parallel"?0:c.value!;
      const cosine=Math.cos(value*Math.PI/180);angles.push({a,v,b,cosines:value===90?[0]:[cosine,-cosine]});
    }
  }
  let networks=[initial],exhaustive=true;
  for(let pass=0;pass<problem.points.length**2;pass++) {
    let changed=false;const next:MetricNetwork[]=[];
    for(const network of networks) {
      for(const c of primitives.filter(c=>c.kind==="equal"||c.kind==="ratio")) {
        const [a,b]=c.refs.map(r=>distanceKey(...r as [string,string])),ratio=c.kind==="equal"?1:c.value!;
        if(network.has(a)&&!network.has(b)){network.set(b,network.get(a)!/ratio);changed=true;}
        if(network.has(b)&&!network.has(a)){network.set(a,network.get(b)!*ratio);changed=true;}
      }
      // Corresponding face edges of a prism have identical lengths.
      for(const c of problem.conditions.filter(c=>c.enabled&&c.kind==="prism")) {
        const names=c.refs[0],n=names.length/2;
        for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
          const a=distanceKey(names[i],names[j]),b=distanceKey(names[i+n],names[j+n]);
          if(network.has(a)&&!network.has(b)){network.set(b,network.get(a)!);changed=true;}
          if(network.has(b)&&!network.has(a)){network.set(a,network.get(b)!);changed=true;}
        }
        const sides=Array.from({length:n},(_,i)=>distanceKey(names[i],names[i+n])),known=sides.find(k=>network.has(k));
        if(known)for(const side of sides)if(!network.has(side)){network.set(side,network.get(known)!);changed=true;}
      }
      const angle=angles.find(c=>!network.has(distanceKey(c.a,c.b))&&network.has(distanceKey(c.a,c.v))&&network.has(distanceKey(c.b,c.v)));
      if(!angle){next.push(network);continue;}
      changed=true;const a=network.get(distanceKey(angle.a,angle.v))!,b=network.get(distanceKey(angle.b,angle.v))!;
      for(const cosine of angle.cosines) {
        const length=Math.sqrt(Math.max(0,a*a+b*b-2*a*b*cosine));
        if(length>0)next.push(new Map([...network,[distanceKey(angle.a,angle.b),length]]));
      }
    }
    if(next.length>cap)exhaustive=false;
    networks=next.slice(0,cap);if(!changed)break;
  }
  return {networks,exhaustive};
}
