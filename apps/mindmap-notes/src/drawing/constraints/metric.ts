import { expandConditions } from "./compile";
import type { ConstraintProblem } from "./types";

export const distanceKey=(a:string,b:string)=>JSON.stringify([a,b].sort());
export type MetricNetwork=Map<string,number>;
/** Propagate lengths and SAS before placing any point. A line angle is
 * unoriented, so both cosine signs must survive until final verification. */
export function metricNetworks(problem:ConstraintProblem,cap=32):{networks:MetricNetwork[];exhaustive:boolean} {
  const primitives=expandConditions(problem),initial:MetricNetwork=new Map();
  for(const c of primitives)if(c.kind==="distance")initial.set(distanceKey(...c.refs[0] as [string,string]),c.value!);
  for(const c of primitives)if(c.kind==="vectorDot") {
    const [a,b]=c.refs;
    if(distanceKey(...a as [string,string])===distanceKey(...b as [string,string])) {
      const square=c.value!*(a[0]===b[0]?1:-1);if(square>0)initial.set(distanceKey(...a as [string,string]),Math.sqrt(square));
    }
  }
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
      const put=(a:string,b:string,value:number)=>{const key=distanceKey(a,b);if(!network.has(key)&&Number.isFinite(value)&&value>1e-12){network.set(key,value);changed=true;}};
      for(const c of problem.conditions.filter(c=>c.enabled)) {
        if(c.kind==="onCurve") {
          const curve=problem.curves?.find(k=>k.id===c.curve);
          if(curve?.type==="circle"&&curve.method!=="threePoint") {
            const radius=curve.method==="centerRadius"?curve.value:network.get(distanceKey(...curve.points as [string,string]));
            if(radius!==undefined)put(curve.points[0],c.refs[0][0],radius);
          }
        }
        if(c.kind==="area") {
          const p=c.refs[0],regular=problem.conditions.find(k=>k.enabled&&["regularPolygon","square"].includes(k.kind)&&k.refs[0].length===p.length&&k.refs[0].every(n=>p.includes(n)));
          if(regular)put(p[0],p[1],Math.sqrt(4*c.value!*Math.tan(Math.PI/p.length)/p.length));
          const rectangle=problem.conditions.find(k=>k.enabled&&["rectangle","square"].includes(k.kind)&&k.refs[0].length===p.length&&k.refs[0].every(n=>p.includes(n)));
          if(rectangle){const q=rectangle.refs[0],a=network.get(distanceKey(q[0],q[1])),b=network.get(distanceKey(q[1],q[2]));if(a)put(q[1],q[2],c.value!/a);if(b)put(q[0],q[1],c.value!/b);}
        }
        if(c.kind==="volume"&&["cylinder","cone","coneFrustum"].includes(c.solid!)) {
          const [o,t,a,b]=c.refs[0],r=network.get(distanceKey(o,a)),s=c.solid==="coneFrustum"?network.get(distanceKey(t,b)):r,h=network.get(distanceKey(o,t));
          if(r&&s)put(o,t,c.value!/(Math.PI*(c.solid==="cone"?r*r/3:c.solid==="coneFrustum"?(r*r+r*s+s*s)/3:r*r)));
          if(h&&c.solid!=="coneFrustum")put(o,a,Math.sqrt(c.value!*(c.solid==="cone"?3:1)/(Math.PI*h)));
        }
        if(c.kind==="volume"&&c.solid==="prism") {
          const cube=problem.conditions.find(k=>k.enabled&&k.kind==="cube"&&k.refs[0].length===c.refs[0].length&&k.refs[0].every(n=>c.refs[0].includes(n)));
          if(cube)put(cube.refs[0][0],cube.refs[0][1],Math.cbrt(c.value!));
        }
        if(c.kind==="circumradius"||c.kind==="concyclic"&&c.value!==undefined)for(const a of primitives.filter(k=>k.kind==="vertexAngle"&&k.refs.flat().every(n=>c.refs[0].includes(n)))) {
          const [x,,y]=a.refs.flat();put(x,y,2*c.value!*Math.sin(a.value!*Math.PI/180));
        }
      }
      for(const c of primitives.filter(c=>c.kind==="equal"||c.kind==="ratio")) {
        const [a,b]=c.refs.map(r=>distanceKey(...r as [string,string])),ratio=c.kind==="equal"?1:c.value!;
        if(network.has(a)&&!network.has(b)){network.set(b,network.get(a)!/ratio);changed=true;}
        if(network.has(b)&&!network.has(a)){network.set(a,network.get(b)!*ratio);changed=true;}
      }
      for(const c of primitives.filter(c=>c.kind==="similar")) {
        const [a,b]=c.refs,pairs=a.flatMap((_,i)=>a.slice(i+1).map((_,j)=>[distanceKey(a[i],a[i+j+1]),distanceKey(b[i],b[i+j+1])]));
        const known=pairs.find(([x,y])=>network.has(x)&&network.has(y));if(!known)continue;
        const ratio=network.get(known[0])!/network.get(known[1])!;
        for(const [x,y] of pairs) {
          if(network.has(x)&&!network.has(y)){network.set(y,network.get(x)!/ratio);changed=true;}
          if(network.has(y)&&!network.has(x)){network.set(x,network.get(y)!*ratio);changed=true;}
        }
      }
      for(const c of primitives.filter(c=>c.kind==="vectorDot")) {
        const [a,b]=c.refs,vertex=a.find(n=>b.includes(n));if(!vertex)continue;
        const x=a.find(n=>n!==vertex)!,y=b.find(n=>n!==vertex)!;
        if(x===y||network.has(distanceKey(x,y)))continue;
        const u=network.get(distanceKey(x,vertex)),v=network.get(distanceKey(y,vertex));if(u===undefined||v===undefined)continue;
        const product=c.value!*(a[0]===vertex?1:-1)*(b[0]===vertex?1:-1),square=u*u+v*v-2*product;
        if(square>0){network.set(distanceKey(x,y),Math.sqrt(square));changed=true;}
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
      let derived:{pair:[string,string];values:number[]}|undefined;
      for(const c of problem.conditions.filter(c=>c.enabled&&(c.kind==="area"&&c.refs[0].length===3||c.kind==="circumradius"))) {
        const p=c.refs[0];for(let i=0;i<3;i++) {
          const a=p[i],v=p[(i+1)%3],b=p[(i+2)%3],u=network.get(distanceKey(a,v)),w=network.get(distanceKey(b,v));
          if(u===undefined||w===undefined||network.has(distanceKey(a,b)))continue;
          if(c.kind==="area") {
            const sin=2*c.value!/(u*w);if(sin>1+1e-12)continue;
            const cosine=Math.sqrt(Math.max(0,1-sin*sin));derived={pair:[a,b],values:[1,-1].map(s=>Math.sqrt(Math.max(0,u*u+w*w-2*u*w*cosine*s)))};
          } else {
            const r=c.value!,x=1-w*w/(4*r*r),y=1-u*u/(4*r*r);if(x< -1e-12||y< -1e-12)continue;
            derived={pair:[a,b],values:[1,-1].map(s=>Math.abs(u*Math.sqrt(Math.max(0,x))+s*w*Math.sqrt(Math.max(0,y))))};
          }
          break;
        }
        if(derived)break;
      }
      if(derived){changed=true;for(const value of [...new Set(derived.values)].filter(v=>v>1e-12))next.push(new Map([...network,[distanceKey(...derived.pair),value]]));continue;}
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
