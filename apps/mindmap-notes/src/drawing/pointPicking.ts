import type {resolveGeometry} from './geometry';
type Geometry=ReturnType<typeof resolveGeometry>;
/** A mesh vertex can be another reference to an existing point. Resolve only
 * construction identity; equal coordinates (or equal screen positions) never
 * make two independently defined points the same object. */
export function pickablePoints(geometry:Geometry){
 const roots=new Map<string,string>(),meshes=new Map(geometry.meshes.map(m=>[m.id,m]));
 const root=(id:string,seen=new Set<string>()):string=>{
  if(roots.has(id))return roots.get(id)!;
  if(seen.has(id))return id;seen.add(id);
  const point=geometry.points.get(id),object=point?.object;
  let reference:string|undefined;
  if(object?.construction.type==='alias')reference=object.construction.point;
  const virtual=id.match(/^([^:]+):v:(\d+)$/);
  if(virtual){const [,owner,index]=virtual,i=Number(index),mesh=meshes.get(owner),source=geometry.objects.get(owner);
   reference=mesh?.vertexIds?.[i];
   if(!reference&&source?.kind==='solid'){
    const c=source.construction;
    if(c?.type==='apex'||c?.type==='extrusion'){
     const base=geometry.objects.get(c.base);
     if(base?.kind==='polygon'||base?.kind==='triangle')reference=i<base.points.length?base.points[i]:c.type==='apex'&&i===base.points.length?c.apex:undefined;
    }
   }
   if(!reference&&source?.kind==='solutionSet'){
    const name=source.problem.points[i];
    reference=[...geometry.points.values()].find(p=>p.object&&(p.object.constraintSet===owner&&p.object.constraintPointName===name||p.object.construction.type==='constraint'&&p.object.construction.set===owner&&p.object.construction.point===name))?.id;
   }
  }
  const result=reference&&reference!==id?root(reference,seen):id;roots.set(id,result);return result;
 };
 const points=[...geometry.points.values()],named=new Set(points.filter(p=>p.object).map(p=>root(p.id))),virtuals=new Set<string>();
 return points.filter(p=>{
  if(p.object)return true;
  const key=root(p.id);
  // A hidden named source stays hidden; don't expose it via the body's alias.
  if(named.has(key)||virtuals.has(key))return false;
  virtuals.add(key);return true;
 });
}
