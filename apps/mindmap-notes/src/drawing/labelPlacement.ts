import type {Vec2} from './types';
type Box=[number,number,number,number];
/** Deterministic display-only placement. Explicit user offsets are never changed. */
export function labelPlacement(points:Vec2[],paths:{points:Vec2[]}[]){
 const boxes:Box[]=[];
 return (point:Vec2,text:string,size:number,offset:Vec2):Vec2=>{
  const width=Math.max(size*.7,Math.min(320,text.length*size*.56)),height=size*1.2;
  const rect=(p:Vec2):Box=>[p[0]-2,p[1]-height,p[0]+width+2,p[1]+4];
  const inside=(p:Vec2,b:Box)=>p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];
  const explicit=Math.abs(offset[0]-9)>1e-6||Math.abs(offset[1]+10)>1e-6;
  const candidates:Vec2[]=explicit?[offset]:[[9,-10],[9,size+8],[-width-9,-10],[-width-9,size+8],[-width/2,-18],[-width/2,size+20],[20,-24],[-width-20,-24]];
  const score=(p:Vec2,index:number)=>{const b=rect(p);let cost=index*.6;
   for(const a of boxes){const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])),h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));cost+=w*h*6;}
   for(const anchor of points)if(inside(anchor,b))cost+=600;
   for(const path of paths)for(let j=1;j<path.points.length;j++){const a=path.points[j-1],c=path.points[j];if(Math.max(a[0],c[0])<b[0]||Math.min(a[0],c[0])>b[2]||Math.max(a[1],c[1])<b[1]||Math.min(a[1],c[1])>b[3])continue;for(const t of [.25,.5,.75])if(inside([a[0]+t*(c[0]-a[0]),a[1]+t*(c[1]-a[1])],b))cost+=70;}
   return cost;
  };
  const at=candidates.map(d=>[point[0]+d[0],point[1]+d[1]] as Vec2).map((p,i)=>({p,score:score(p,i)})).sort((a,b)=>a.score-b.score)[0].p;
  boxes.push(rect(at));return at;
 };
}
