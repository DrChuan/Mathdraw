import { entity } from './input';

export type AngleTriple=[string,string,string];
/** Angles are pairs of distinct incident edges; reversing an angle is a duplicate.
 * Keep an adjacency graph and page lazily instead of building O(degree²) buttons. */
export function declaredAngleSuggestions(pointSource:string,segmentSource:string,extraEdges:readonly (readonly [string,string])[]=[]) {
  const names=[...new Set(pointSource.split(/[\s,，;；]+/).filter(n=>/^[A-Za-z][A-Za-z0-9_]*$/.test(n)))];
  const neighbors=new Map(names.map(n=>[n,new Set<string>()]));
  const add=(a:string,b:string)=>{if(a!==b&&neighbors.has(a)&&neighbors.has(b)){neighbors.get(a)!.add(b);neighbors.get(b)!.add(a);}};
  for(const source of segmentSource.split(/[,，;；\n]+/).filter(s=>s.trim()))try{const pair=entity(source,names);if(pair.length===2)add(pair[0],pair[1]);}catch{/* Keep valid edges while another declaration is being typed. */}
  extraEdges.forEach(([a,b])=>add(a,b));
  const order=new Map(names.map((n,i)=>[n,i]));
  const vertices=names.map(vertex=>({vertex,ends:[...neighbors.get(vertex)!].sort((a,b)=>order.get(a)!-order.get(b)!)}));
  const count=vertices.reduce((n,v)=>n+v.ends.length*(v.ends.length-1)/2,0);
  return {count,page:(offset:number,limit=32):AngleTriple[]=>{
    const result:AngleTriple[]=[];let skip=Math.max(0,Math.floor(offset));
    for(const {vertex,ends}of vertices){
      const size=ends.length*(ends.length-1)/2;if(skip>=size){skip-=size;continue;}
      for(let i=0;i<ends.length-1;i++){
        const row=ends.length-i-1;if(skip>=row){skip-=row;continue;}
        for(let j=i+1+skip;j<ends.length;j++){result.push([ends[i],vertex,ends[j]]);if(result.length>=limit)return result;}skip=0;
      }
    }return result;
  }};
}
