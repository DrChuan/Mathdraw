import type { Vec3 } from "../types";
import type { ConstraintProblem, Positions } from "./types";
import { evaluator, flatten } from "./compile";
import { add, sub, mul, norm } from "./math";

const key=(a:string,b:string)=>JSON.stringify([a,b].sort());
const limit=256;
type Distances=Map<string,number>;
interface Angle { a:string; vertex:string; b:string; cosines:number[] }
export interface PrismConstruction { positions:Positions[]; candidates:number }

/** Finite straightedge/compass construction, independent of seeds and deadlines.
 * Only claim this route when all vertices are determined by SAS/SSS and circle
 * intersections. Underconstrained/unsupported networks use the numerical solver.
 * Coordinates still use floating point; every candidate is substituted back into
 * ALL original conditions, including simple-polygon and nondegeneracy checks.
 */
export function constructRightPrism(problem:ConstraintProblem):PrismConstruction|undefined {
  const conditions=problem.conditions.filter(c=>c.enabled),templates=conditions.filter(c=>c.kind==="prism");
  if(templates.length!==1)return;
  const names=templates[0].refs[0],n=names.length/2,base=names.slice(0,n),top=names.slice(n);
  if(names.length!==problem.points.length||problem.points.some(p=>!names.includes(p)))return;
  const index=new Map(names.map((name,i)=>[name,i])),baseName=(name:string)=>base[index.get(name)!%n];
  const lateral=(ref:string[])=>ref.length===2&&Math.abs(index.get(ref[0])!-index.get(ref[1])!)===n;
  const basePlane=(ref:string[])=>ref.length===3&&(ref.every(p=>base.includes(p))||ref.every(p=>top.includes(p)));
  const right=conditions.some(c=>c.kind==="perpendicular"&&
    (lateral(c.refs[0])&&basePlane(c.refs[1])||basePlane(c.refs[0])&&lateral(c.refs[1])))||
    conditions.some(c=>c.kind==="linePlaneAngle"&&c.value===90&&lateral(c.refs[0])&&basePlane(c.refs[1]));
  if(!right)return;
  const distances:Distances=new Map();let height:number|undefined;
  const planar=(ref:string[])=>ref.length===2&&(ref.every(p=>base.includes(p))||ref.every(p=>top.includes(p)));
  for(const c of conditions.filter(c=>c.kind==="distance")) {
    if(lateral(c.refs[0]))height??=c.value!;
    else if(planar(c.refs[0]))distances.set(key(...c.refs[0].map(baseName) as [string,string]),c.value!);
  }
  if(height===undefined)return;
  const angles:Angle[]=[];
  for(const c of conditions) {
    if(c.kind==="vertexAngle") {
      const [a,vertex,b]=c.refs.map(r=>baseName(r[0]));
      if(new Set([a,vertex,b]).size===3&&[c.refs[0][0],c.refs[2][0]].every(p=>
        (index.get(p)!<n)===(index.get(c.refs[1][0])!<n)))
        angles.push({a,vertex,b,cosines:[Math.cos(c.value!*Math.PI/180)]});
    } else if(c.kind==="lineAngle"&&c.refs.every(planar)) {
      const [first,second]=c.refs.map(r=>r.map(baseName)),vertex=first.find(p=>second.includes(p));
      if(!vertex)continue;
      const a=first.find(p=>p!==vertex)!,b=second.find(p=>p!==vertex)!;
      if(a===b)continue;
      // An unoriented 60-degree LINE angle also permits a 120-degree vertex.
      // Enumerate both signs instead of committing to one local minimum.
      const cosine=Math.cos(c.value!*Math.PI/180);
      angles.push({a,vertex,b,cosines:c.value===90?[0]:[cosine,-cosine]});
    }
  }
  let networks=[distances];
  for(let pass=0;pass<n*n;pass++) {
    let changed=false;const next:Distances[]=[];
    for(const network of networks) {
      const angle=angles.find(a=>!network.has(key(a.a,a.b))&&network.has(key(a.a,a.vertex))&&network.has(key(a.b,a.vertex)));
      if(!angle){next.push(network);continue;}
      changed=true;
      const a=network.get(key(angle.a,angle.vertex))!,b=network.get(key(angle.b,angle.vertex))!;
      for(const cosine of angle.cosines) {
        const length=Math.sqrt(Math.max(0,a*a+b*b-2*a*b*cosine));
        if(length>0)next.push(new Map([...network,[key(angle.a,angle.b),length]]));
      }
    }
    if(next.length>limit)return;
    networks=next;if(!changed)break;
  }
  const seeds:Positions[]=[];let exhausted=false,unsupported=false,candidates=0,visits=0;
  const place=(p:Positions,network:Distances)=>{
    if(exhausted||unsupported)return;
    if(++visits>limit*base.length){exhausted=true;return;}
    const pending=base.filter(name=>!p[name]);
    if(!pending.length){seeds.push(p);if(seeds.length>limit)exhausted=true;return;}
    for(const name of pending) {
      const anchors=base.filter(a=>p[a]&&network.has(key(a,name)));
      for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++) {
        const a=p[anchors[i]],b=p[anchors[j]],d=norm(sub(b,a));
        if(d<1e-12)continue;
        const ra=network.get(key(anchors[i],name))!,rb=network.get(key(anchors[j],name))!;
        const x=(ra*ra-rb*rb+d*d)/(2*d),h2=ra*ra-x*x,tolerance=1e-12*Math.max(ra*ra,rb*rb,d*d);
        if(h2 < -tolerance)return;
        const u=mul(sub(b,a),1/d),v:Vec3=[-u[1],u[0],0],h=Math.sqrt(Math.max(0,h2));
        for(const sign of h===0?[1]:[1,-1]) {
          const q=add(a,add(mul(u,x),mul(v,sign*h)));
          if(anchors.some(other=>Math.abs(norm(sub(q,p[other]))-network.get(key(other,name))!)>1e-8*Math.max(ra,rb,network.get(key(other,name))!)))continue;
          place({...p,[name]:q},network);
        }
        return;
      }
    }
    // Never discard a branch merely because this constructor cannot solve it.
    unsupported=true;
  };
  for(const network of networks) {
    const pair=base.flatMap((a,i)=>base.slice(i+1).map(b=>[a,b] as const)).find(([a,b])=>network.has(key(a,b)));
    if(!pair)return;
    place({[pair[0]]:[0,0,0],[pair[1]]:[network.get(key(...pair))!,0,0]},network);
    if(exhausted||unsupported)return;
  }
  const check=evaluator(problem),solutions:Positions[]=[];
  for(const seed of seeds)for(const sign of [1,-1]) {
    candidates++;
    const p={...seed};top.forEach((name,i)=>p[name]=add(seed[base[i]],[0,0,sign*height!]));
    if(check.verify(flatten(problem.points,p)).valid)solutions.push(p);
  }
  // Numerical tolerances cannot serve as an exact impossibility proof.
  return solutions.length?{positions:solutions,candidates}:undefined;
}
