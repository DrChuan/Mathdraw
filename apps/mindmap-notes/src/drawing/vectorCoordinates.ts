import type { DrawingDocument,DrawingPlaneSource,DrawingSegment,Vec3 } from "./types";
import { resolveGeometry,planeHasVariables,dependencies } from "./geometry";
import { parseExpression } from "./expression";
import { expressionText } from "./advanced";
import { renderReferences } from "./parameters";
import { exactNumber,exactCoordinates } from "./exactNumber";
import { cross,sub,norm } from "./constraints/math";
type Tuple=[string,string,string];
const number=(v:number)=>exactNumber(v).source;
const numbers=(p:Vec3)=>p.map(number) as Tuple;
export function vectorCoordinates(doc:DrawingDocument,vector:DrawingSegment):{value:Vec3;source:string;approximate:boolean}|undefined {
  if(vector.kind!=="vector")return;
  const g=resolveGeometry(doc),edge=g.edges.find(e=>e.id===vector.id),a=edge&&g.points.get(edge.a)?.p,b=edge&&g.points.get(edge.b)?.p;
  if(!a||!b||g.errors.has(vector.id))return;
  const value=sub(b,a),exact=exactCoordinates(doc.dimension==="2d"?value.slice(0,2):value);
  if(!vector.normalPlane||!planeHasVariables(doc,vector.normalPlane))return {value,...exact};
  const symbols=doc.objects.filter(o=>o.kind==="number"&&o.symbol).map(o=>o.symbol!);
  const simplify=(s:string)=>{
    try{return expressionText(parseExpression(s,symbols));}catch{return s;}
  };
  const op=(a:string,b:string,operator:string)=>a===b&&operator==="-"?"0":simplify(`(${a})${operator}(${b})`);
  const minus=(a:Tuple,b:Tuple)=>a.map((v,i)=>op(v,b[i],"-")) as Tuple;
  const plus=(a:Tuple,b:Tuple)=>a.map((v,i)=>op(v,b[i],"+")) as Tuple;
  const times=(a:Tuple,t:string)=>a.map(v=>op(v,t,"*")) as Tuple;
  const fromLocal=(values:string[],planeId:string):Tuple=>{
    const p=doc.planes.find(p=>p.id===planeId)!;return plus(numbers(p.origin),plus(times(numbers(p.u),values[0]),times(numbers(p.v),values[1])));
  };
  const active=new Set<string>();
  const point=(id:string):Tuple=>{
    const fallback=()=>numbers(g.points.get(id)!.p);
    if(active.has(id)||active.size>64)return fallback();active.add(id);
    try {
      const virtual=id.match(/^([^:]+):v:(\d+)$/),o=doc.objects.find(o=>o.id===(virtual?.[1]??id));
      if(virtual&&o?.kind==="solid") {
        const i=Number(virtual[2]),mesh=g.meshes.find(m=>m.id===o.id)!;
        if(mesh.vertexIds?.[i])return point(mesh.vertexIds[i]);
        const c=o.construction;
        if(c?.type==="extrusion"||c?.type==="apex") {
          const base=g.objects.get(c.base);if(base?.kind!=="polygon"&&base?.kind!=="triangle")return fallback();
          const n=base.points.length;if(i<n)return point(base.points[i]);
          if(c.type==="apex")return point(c.apex);
          const edge=c.vector?g.edges.find(e=>e.id===c.vector):undefined;
          const field=o.parameters?.fields["construction.direction"];
          const direction=edge?minus(point(edge.b),point(edge.a)):typeof field==="object"?field.coordinates.map(s=>renderReferences(doc,s,o.parameters!.references)) as Tuple:numbers(c.direction);
          return plus(point(base.points[i-n]),direction);
        }
        if(!c) {
          const field=(path:string,v:number)=>{const s=o.parameters?.fields[path];return typeof s==="string"?renderReferences(doc,s,o.parameters!.references):number(v);};
          let p:Tuple;
          if(o.shape==="cube"||o.shape==="cuboid") {
            const signs=[[-1,-1],[1,-1],[1,1],[-1,1]][i%4],w=field("width",o.width),d=o.shape==="cube"?w:field("depth",o.depth),h=o.shape==="cube"?w:field("height",o.height);
            p=[op(w,String(signs[0]/2),"*"),op(d,String(signs[1]/2),"*"),i<4?"0":h];
          } else if(o.shape!=="sphere") {
            const n=o.shape==="cone"||o.shape==="cylinder"||o.shape==="coneFrustum"?40:o.sides;
            const radius=i<n?field("radius",o.radius):o.shape==="pyramid"||o.shape==="cone"?"0":o.shape==="frustum"||o.shape==="coneFrustum"?field("topRadius",o.topRadius):field("radius",o.radius),angle=2*Math.PI*(i%n)/n;
            p=[op(radius,number(Math.cos(angle)),"*"),op(radius,number(Math.sin(angle)),"*"),i<n?"0":field("height",o.height)];
          } else return fallback();
          const rotatePair=(a:number,b:number,angle:string)=>{
            const radians=op(angle,"pi/180","*"),cos=angle==="0"?"1":`cos(${radians})`,sin=angle==="0"?"0":`sin(${radians})`,x=p[a],y=p[b];
            p[a]=op(op(x,cos,"*"),op(y,sin,"*"),"-");p[b]=op(op(x,sin,"*"),op(y,cos,"*"),"+");
          };
          rotatePair(1,2,field("rotation.0",o.rotation[0]));rotatePair(2,0,field("rotation.1",o.rotation[1]));rotatePair(0,1,field("rotation.2",o.rotation[2]));
          if(o.basis)p=o.basis[0].map((_,j)=>op(op(op(p[0],number(o.basis![0][j]),"*"),op(p[1],number(o.basis![1][j]),"*"),"+"),op(p[2],number(o.basis![2][j]),"*"),"+")) as Tuple;
          return plus(p,o.origin.map((v,i)=>field(`origin.${i}`,v)) as Tuple);
        }
        return fallback();
      }
      if(o?.kind!=="point")return fallback();
      const c=o.construction;
      if(c.type==="alias")return point(c.point);
      if(c.type==="division")return plus(point(c.a),times(minus(point(c.b),point(c.a)),typeof o.parameters?.fields["construction.t"]==="string"?renderReferences(doc,o.parameters.fields["construction.t"],o.parameters.references):number(c.t)));
      if(c.type==="center"&&c.center==="centroid")return times(c.points.map(point).reduce(plus),"1/3");
      if(c.type==="free") {
        const field=o.parameters?.fields["construction.position"];
        if(typeof field==="object") {
          const values=field.coordinates.map(s=>renderReferences(doc,s,o.parameters!.references).replace(/\b([xyz])\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_m,axis,name)=>{
            const source=doc.objects.find(o=>o.symbol===name);return source?`(${point(source.id)[axis==="x"?0:axis==="y"?1:2]})`:_m;
          }));
          return field.planeId?fromLocal(values,field.planeId):values as Tuple;
        }
      }
      return fallback();
    } finally {active.delete(id);}
  };
  const ends=(id:string):[Tuple,Tuple]=>{
    const e=g.edges.find(e=>e.id===id);if(e)return [point(e.a),point(e.b)];
    const r=g.straightReference(id);return [numbers(r.a),numbers(r.b)];
  };
  const plane=(p:DrawingPlaneSource):[Tuple,Tuple]=>{
    if(p.type==="workplane"){const r=doc.planes.find(v=>v.id===p.planeId)!;return [numbers(r.u),numbers(r.v)];}
    if(p.type==="polygon") {
      const object=doc.objects.find(o=>o.id===p.polygon);
      if(object?.kind==="polygon"&&object.section)return plane(object.section.plane);
    }
    if(p.type==="points"||p.type==="polygon") {
      const obj=p.type==="polygon"?g.objects.get(p.polygon):undefined,ids=p.type==="points"?p.points:obj&&(obj.kind==="polygon"||obj.kind==="triangle")?obj.points:[];
      const origin=g.points.get(ids[0])!.p,second=ids.find(id=>norm(sub(g.points.get(id)!.p,origin))>1e-9)!,u=sub(g.points.get(second)!.p,origin),third=ids.find(id=>norm(cross(u,sub(g.points.get(id)!.p,origin)))>1e-9*norm(u)*Math.max(norm(sub(g.points.get(id)!.p,origin)),1e-9))!;
      return [minus(point(second),point(ids[0])),minus(point(third),point(ids[0]))];
    }
    const [a,b]=ends(p.type==="lines"?p.lines[0]:p.line),u=minus(b,a);
    if(p.type==="linePoint")return [u,minus(point(p.point),a)];
    const [c,d]=ends(p.lines[1]),first=g.straightReference(p.lines[0]),second=g.straightReference(p.lines[1]);
    return [u,norm(cross(sub(first.b,first.a),sub(second.b,second.a)))>1e-9?minus(d,c):minus(c,a)];
  };
  try {
    const [u,v]=plane(vector.normalPlane),coordinates=[0,1,2].map(i=>op(op(u[(i+1)%3],v[(i+2)%3],"*"),op(u[(i+2)%3],v[(i+1)%3],"*"),"-"));
    const source=`(${coordinates.join(", ")})`;
    if(source.length>6000)return {value,...exact};
    const used=symbols.filter(s=>new RegExp(`\\b${s}\\b`).test(source));
    // Unsupported symbolic primitives still expose their true parameter
    // dependence instead of presenting a frozen numerical normal as exact.
    if(!used.length&&planeHasVariables(doc,vector.normalPlane)) {
      const seen=new Set<string>(),names=new Set<string>();const visit=(id:string)=>{id=id.split(":")[0];if(seen.has(id))return;seen.add(id);const o=doc.objects.find(o=>o.id===id);if(!o)return;if(o.kind==="number"&&o.symbol)names.add(o.symbol);dependencies(o).forEach(visit);};
      dependencies(vector).forEach(visit);
      if(names.size)return {value,source:`${exact.source}\\quad\\text{随 }${[...names].join(",")}\\text{ 更新}`,approximate:exact.approximate};
    }
    return {value,source,approximate:false};
  } catch {return {value,...exact};}
}
