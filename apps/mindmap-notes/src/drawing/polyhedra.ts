import { defaultStyle, type DrawingDocument, type DrawingPolygon, type DrawingTriangle, type DrawingSolid } from "./types";
type Face=DrawingPolygon|DrawingTriangle;
const edgeKey=(a:string,b:string)=>JSON.stringify([a,b].sort());
export function shellTopology(faces:Face[]) {
  const vertices=[...new Set(faces.flatMap(f=>f.points))],index=new Map(vertices.map((id,i)=>[id,i]));
  const edges=new Map<string,{ends:[number,number];faces:number[]}>();
  faces.forEach((f,j)=>f.points.forEach((a,i)=>{
    const b=f.points[(i+1)%f.points.length],key=edgeKey(a,b),edge=edges.get(key)??{ends:[index.get(a)!,index.get(b)!],faces:[]};
    edge.faces.push(j);edges.set(key,edge);
  }));
  return {vertices,edges:[...edges.values()].map(e=>e.ends),closed:faces.length>=4&&vertices.length>=4&&[...edges.values()].every(e=>e.faces.length===2)};
}
/** Closed polygon shells become bodies; faces stay addressable by their IDs. */
export function groupClosedFaces(doc:DrawingDocument):DrawingDocument {
  if(doc.dimension!=="3d")return doc;
  const objects=doc.objects.map(o=>({...o}));
  const bodies=new Map(objects.filter((o):o is DrawingSolid=>o.kind==="solid"&&o.construction?.type==="faces").map(o=>[o.id,o]));
  for(const o of objects)if(o.body){const body=bodies.get(o.body);if(!body||body.construction?.type!=="faces"||!body.construction.faces.includes(o.id))delete o.body;}
  for(const body of bodies.values())if(body.construction?.type==="faces")for(const id of body.construction.faces){const face=objects.find(o=>o.id===id);if(face&&(face.kind==="polygon"||face.kind==="triangle")&&!face.body)face.body=body.id;}
  const faces=objects.filter((o):o is Face=>(o.kind==="polygon"||o.kind==="triangle")&&!o.auxiliary&&!o.body);
  const owners=new Map<string,number[]>();
  faces.forEach((f,j)=>f.points.forEach((a,i)=>{const key=edgeKey(a,f.points[(i+1)%f.points.length]),ids=owners.get(key)??[];ids.push(j);owners.set(key,ids);}));
  const neighbors=faces.map(()=>new Set<number>());
  for(const ids of owners.values())for(const a of ids)for(const b of ids)if(a!==b)neighbors[a].add(b);
  const visited=new Set<number>();
  for(let start=0;start<faces.length;start++) {
    if(visited.has(start))continue;
    const group:number[]=[],queue=[start];visited.add(start);
    for(let j=0;j<queue.length;j++){const n=queue[j];group.push(n);for(const k of neighbors[n])if(!visited.has(k)){visited.add(k);queue.push(k);}}
    const shell=group.map(i=>faces[i]);if(!shellTopology(shell).closed)continue;
    const id=crypto.randomUUID(),set=shell[0].constraintSet;
    let symbol="S",suffix=1;while(objects.some(o=>o.symbol===symbol))symbol=`S_${suffix++}`;
    const body:DrawingSolid={id,name:`多面体 ${symbol}`,symbol,kind:"solid",shape:"prism",construction:{type:"faces",faces:shell.map(f=>f.id)},
      ...(set&&shell.every(f=>f.constraintSet===set)?{constraintSet:set}:{}),style:defaultStyle(),origin:[0,0,0],rotation:[0,0,0],width:1,depth:1,height:1,radius:1,topRadius:0,sides:Math.max(3,Math.min(64,shell.length))};
    shell.forEach(f=>{f.body=id;});objects.push(body);
  }
  return {...doc,objects};
}
export function visibleInObjectList(o:DrawingDocument["objects"][number]) {
  return !o.auxiliary&&!((o.kind==="polygon"||o.kind==="triangle")&&o.body);
}
