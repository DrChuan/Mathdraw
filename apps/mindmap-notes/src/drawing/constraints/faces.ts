import type { ConstraintProblem, Positions } from "./types";
import { sub, cross, norm, unit, dot,add,mul } from "./math";
import { polygonGeometry } from "../constructions";

export function templateFaces(problem:ConstraintProblem):string[][] {
  const faces:string[][]=[];
  for(const c of problem.conditions.filter(c=>c.enabled)) {
    const p=c.refs[0];let polygons:number[][]=[];
    if(c.kind==="congruent"||c.kind==="similar"){faces.push(...c.refs);continue;}
    if(c.kind==="cube")polygons=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    else if(c.kind==="prism"||c.kind==="frustum") {
      const n=p.length/2,bottom=Array.from({length:n},(_,i)=>i),top=bottom.map(i=>i+n);
      polygons=[bottom,top,...bottom.map(i=>[i,(i+1)%n,(i+1)%n+n,i+n])];
    } else if(c.kind==="pyramid") {
      const base=Array.from({length:p.length-1},(_,i)=>i+1);
      polygons=[base,...base.map((i,j)=>[0,i,base[(j+1)%base.length]])];
    } else if(c.kind==="regularPolygon"||c.kind==="convexPolygon"||c.kind==="area")polygons=[p.map((_,i)=>i)];
    else if(["parallelogram","rectangle","rhombus","square"].includes(c.kind))polygons=[[0,1,2,3]];
    faces.push(...polygons.map(polygon=>polygon.map(i=>p[i])));
  }
  return faces;
}

/** Planar faces bounded by declared edges, including non-template solids.
 * Walk half-edges in each plane; the outer boundary of each component is its
 * face. At a shared articulation point, the bounded cells supply the separate
 * faces. Template boundaries use this same graph, avoiding overlapping copies. */
export function conditionFaces(problem:ConstraintProblem,positions:Positions):string[][] {
  const result:string[][]=[],seen=new Set<string>(),planes=new Map<string,string[]>();
  // Declared boundaries are authoritative. Interior chords, coincident points
  // and moving edge points must never remove a solid's original surface.
  for(const face of templateFaces(problem))try {
    polygonGeometry(face.map(n=>positions[n]));
    const key=[...face].sort().join("|");if(!seen.has(key)){seen.add(key);result.push(face);}
  }catch{/* Degenerate surfaces remain absent until their source recovers. */}
  const origin=positions[problem.points[0]],scale=Math.max(1,...Object.values(positions).map(p=>norm(sub(p,origin)))),eps=scale*1e-7;
  const adjacency=new Map(problem.points.map(n=>[n,[] as string[]])),edges=new Set<string>();
  const boundaries=templateFaces(problem).flatMap(face=>face.map((a,i)=>[a,face[(i+1)%face.length]] as [string,string]));
  const boundarySeen=new Set<string>(),junctions=[...new Set([...problem.segments,...boundaries].flat())];
  // A declared point on an existing segment is a graph vertex even when the
  // original segment was not manually split into AM and MB.
  for(const [a,b] of [...problem.segments,...boundaries]) {
    const key=[a,b].sort().join("|");if(boundarySeen.has(key))continue;boundarySeen.add(key);
    const delta=sub(positions[b],positions[a]),square=dot(delta,delta);if(square<=eps*eps)continue;
    const on=junctions.flatMap(n=>{
      const t=dot(sub(positions[n],positions[a]),delta)/square;
      return t>=-1e-8&&t<=1+1e-8&&norm(sub(positions[n],add(positions[a],mul(delta,t))))<=eps?[{n,t}]:[];
    }).sort((p,q)=>p.t-q.t);
    for(let i=1;i<on.length;i++) {
      const x=on[i-1].n,y=on[i].n,key=[x,y].sort().join("|");
      if(edges.has(key)||norm(sub(positions[x],positions[y]))<=eps)continue;
      edges.add(key);adjacency.get(x)!.push(y);adjacency.get(y)!.push(x);
    }
  }
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
    const components=new Map<string,string>();
    for(const a of names)if(!components.has(a)) {
      const pending=[a];components.set(a,a);
      while(pending.length){const n=pending.pop()!;for(const k of neighbors.get(n)!)if(!components.has(k)){components.set(k,a);pending.push(k);}}
    }
    const candidates=new Map<string,{face:string[];area:number}[]>(),visited=new Set<string>();
    for(const a of names)for(const b of neighbors.get(a)!) {
      if(visited.has(`${a}|${b}`))continue;
      let from=a,to=b;const face:string[]=[];
      for(let count=0;count<=edges.size*2;count++) {
        const key=`${from}|${to}`;if(visited.has(key))break;visited.add(key);face.push(from);
        const ns=neighbors.get(to)!,index=ns.indexOf(from),next=ns[(index+ns.length-1)%ns.length];
        from=to;to=next;if(from===a&&to===b)break;
      }
      if(from!==a||to!==b||face.length<3||new Set(face).size!==face.length)continue;
      const area=face.reduce((s,n,i)=>{const p=coords.get(n)!,q=coords.get(face[(i+1)%face.length])!;return s+p[0]*q[1]-p[1]*q[0];},0);
      if(Math.abs(area)<=eps*eps)continue;
      try{polygonGeometry(face.map(n=>positions[n]));}catch{continue;}
      const component=components.get(a)!,list=candidates.get(component)??[];list.push({face,area});candidates.set(component,list);
    }
    for(const list of candidates.values()) {
      const outer=list.filter(c=>c.area<0),faces=outer.length?outer:list.filter(c=>c.area>0);
      for(const {face} of faces){
        // Avoid adding tessellations over an already declared coplanar face.
        const covered=result.some(boundary=>{
          const poly=boundary.map(n=>coords.get(n));if(poly.some(p=>!p))return false;
          return face.every(n=>{
            const q=coords.get(n)!;let inside=false;
            for(let i=0,j=poly.length-1;i<poly.length;j=i++){
              const a=poly[j]!,b=poly[i]!,dx=b[0]-a[0],dy=b[1]-a[1],t=((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy);
              if(t>=-1e-8&&t<=1+1e-8&&Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy)<=eps)return true;
              if((a[1]>q[1])!==(b[1]>q[1])&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
            }return inside;
          });
        });if(covered)continue;
        const key=[...face].sort().join("|");if(!seen.has(key)){seen.add(key);result.push(face);}}
    }
  }
  return result;
}
