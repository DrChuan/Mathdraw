import type { ConstraintProblem, Positions } from "./types";
import { sub, cross, norm, unit, dot } from "./math";

/** Planar faces bounded by declared edges, including non-template solids.
 * Walk half-edges in each plane; the outer boundary of each component is its
 * face. Interior diagonals do not create overlapping copies of the same plane. */
export function conditionFaces(problem:ConstraintProblem,positions:Positions):string[][] {
  const result:string[][]=[],seen=new Set<string>(),planes=new Map<string,string[]>();
  const scale=Math.max(1,...Object.values(positions).map(p=>norm(p))),eps=scale*1e-7;
  const adjacency=new Map(problem.points.map(n=>[n,[] as string[]]));
  for(const [a,b] of problem.segments){adjacency.get(a)!.push(b);adjacency.get(b)!.push(a);}
  for(const a of problem.points) {
    const ns=adjacency.get(a)!;
    for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++) {
      const normal=cross(sub(positions[ns[i]],positions[a]),sub(positions[ns[j]],positions[a]));
      if(norm(normal)<eps*eps)continue;
      const axis=unit(normal),names=problem.points.filter(n=>Math.abs(dot(sub(positions[n],positions[a]),axis))<=eps);
      const key=[...names].sort().join("|");if(!planes.has(key))planes.set(key,names);
    }
  }
  for(const names of planes.values()) {
    const origin=positions[names[0]],second=names.find(n=>norm(sub(positions[n],origin))>eps);if(!second)continue;
    const u=unit(sub(positions[second],origin)),third=names.find(n=>norm(cross(u,sub(positions[n],origin)))>eps);if(!third)continue;
    const v=unit(cross(unit(cross(u,sub(positions[third],origin))),u));
    const coords=new Map(names.map(n=>{const d=sub(positions[n],origin);return [n,[dot(d,u),dot(d,v)]] as const;}));
    const graph=new Map(names.map(n=>[n,adjacency.get(n)!.filter(k=>coords.has(k))]));
    const entry=new Map<string,number>(),low=new Map<string,number>(),bridges=new Set<string>();let clock=0;
    const edgeKey=(a:string,b:string)=>[a,b].sort().join("|");
    const visit=(n:string,parent?:string)=>{
      entry.set(n,++clock);low.set(n,clock);
      for(const k of graph.get(n)!)if(k!==parent) {
        if(!entry.has(k)){visit(k,n);low.set(n,Math.min(low.get(n)!,low.get(k)!));if(low.get(k)!>entry.get(n)!)bridges.add(edgeKey(n,k));}
        else low.set(n,Math.min(low.get(n)!,entry.get(k)!));
      }
    };
    for(const n of names)if(!entry.has(n))visit(n);
    const neighbors=new Map(names.map(n=>[n,graph.get(n)!.filter(k=>!bridges.has(edgeKey(n,k))).sort((a,b)=>{
      const p=coords.get(n)!,q=coords.get(a)!,r=coords.get(b)!;
      return Math.atan2(q[1]-p[1],q[0]-p[0])-Math.atan2(r[1]-p[1],r[0]-p[0]);
    })]));
    const visited=new Set<string>();
    for(const a of names)for(const b of neighbors.get(a)!) {
      if(visited.has(`${a}|${b}`))continue;
      let from=a,to=b;const face:string[]=[];
      for(let count=0;count<=problem.segments.length*2;count++) {
        const key=`${from}|${to}`;if(visited.has(key))break;visited.add(key);face.push(from);
        const ns=neighbors.get(to)!,index=ns.indexOf(from),next=ns[(index+ns.length-1)%ns.length];
        from=to;to=next;if(from===a&&to===b)break;
      }
      if(from!==a||to!==b||face.length<3||new Set(face).size!==face.length)continue;
      const area=face.reduce((s,n,i)=>{const p=coords.get(n)!,q=coords.get(face[(i+1)%face.length])!;return s+p[0]*q[1]-p[1]*q[0];},0);
      if(area>=-eps*eps)continue;
      const key=[...face].sort().join("|");if(!seen.has(key)){seen.add(key);result.push(face);}
    }
  }
  // Explicit templates define faces even when their boundary lines were not
  // requested. The installer keeps those undeclared boundary edges hidden.
  for(const c of problem.conditions.filter(c=>c.enabled)) {
    const p=c.refs[0];let polygons:number[][]=[];
    if(c.kind==="cube")polygons=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    else if(c.kind==="prism"||c.kind==="frustum") {
      const n=p.length/2,bottom=Array.from({length:n},(_,i)=>i),top=bottom.map(i=>i+n);
      polygons=[bottom,top,...bottom.map(i=>[i,(i+1)%n,(i+1)%n+n,i+n])];
    } else if(c.kind==="pyramid") {
      const base=Array.from({length:p.length-1},(_,i)=>i+1);
      polygons=[base,...base.map((i,j)=>[0,i,base[(j+1)%base.length]])];
    } else if(c.kind==="regularPolygon")polygons=[p.map((_,i)=>i)];
    else if(["parallelogram","rectangle","rhombus","square"].includes(c.kind))polygons=[[0,1,2,3]];
    for(const polygon of polygons){const face=polygon.map(i=>p[i]),key=[...face].sort().join("|");if(!seen.has(key)){seen.add(key);result.push(face);}}
  }
  return result;
}
