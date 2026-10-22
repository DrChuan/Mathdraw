import type { DrawingDocument, GeometryObject, Vec3 } from "../types";
import { identityPose } from "./types";
import { add, sub, dot, cross, mul, norm, local } from "./math";
import { normalizeDrawing, definition } from "../model";

/** Re-express every stored world quantity, preserving construction dependencies. */
export function applyCoordinateFrame(input:DrawingDocument):DrawingDocument {
  const frame=input.coordinateFrame;if(!frame)throw new Error("请先使用空间坐标系工具建立所需坐标系");
  const basis=[frame.x,frame.y,mul(cross(frame.x,frame.y),frame.zSign)] as [Vec3,Vec3,Vec3];
  const pose={origin:frame.origin,x:basis[0],y:basis[1],z:basis[2]};
  const point=(p:Vec3)=>local(p,pose),direction=(v:Vec3):Vec3=>basis.map(axis=>dot(v,axis)) as Vec3;
  const doc=structuredClone(input);doc.schemaVersion=3;
  doc.planes=doc.planes.map(p=>({...p,origin:point(p.origin),u:direction(p.u),v:direction(p.v)}));
  const camera=doc.view.camera??identityPose();
  doc.view.camera={origin:point(camera.origin),x:direction(camera.x),y:direction(camera.y),z:direction(camera.z)};
  doc.coordinateFrame=undefined;
  const vectorExpression=(values:string[],offset:boolean)=>basis.map(axis=>axis.map((v,i)=>`(${v})*((${values[i]??"0"})${offset?`-(${frame.origin[i]})`:""})`).join("+"));
  doc.objects=doc.objects.map(original=>{
    const o=structuredClone(original);
    if(o.kind==="point"&&o.construction.type==="origin"&&doc.coordinateOriginId&&doc.coordinateOriginId!==o.id) {
      o.construction={type:"free",position:[0,0,0]};o.hidden=true;o.auxiliary=true;o.showName=false;
    }
    if(o.kind==="point"&&o.construction.type==="free")o.construction.position=point(o.construction.position);
    if(o.kind==="label")o.position=o.measurement?direction(o.position):point(o.position);
    if(o.kind==="solid") {
      o.origin=point(o.origin);o.basis=(o.basis??[[1,0,0],[0,1,0],[0,0,1]]).map(direction) as [Vec3,Vec3,Vec3];
      if(o.construction?.type==="extrusion")o.construction.direction=direction(o.construction.direction);
    }
    if(o.kind==="solutionSet")o.placement={origin:point(o.placement.origin),x:direction(o.placement.x),y:direction(o.placement.y),z:direction(o.placement.z)};
    if(o.parameters) {
      const fields=o.parameters.fields,old=original.parameters!.fields;
      for(const [path,source] of Object.entries(old))if(typeof source!=="string"&&!source.planeId&&path!=="construction.seed") {
        const offset=!(source.direction||path==="construction.direction"||path==="position"&&o.kind==="label"&&o.measurement);
        fields[path]={...source,coordinates:vectorExpression(source.coordinates,offset)};
      }
      // Solid origins historically used separate scalar parameter fields.
      if(o.kind==="solid"&&original.kind==="solid"&&[0,1,2].some(i=>typeof old[`origin.${i}`]==="string")) {
        const sources=[0,1,2].map(i=>typeof old[`origin.${i}`]==="string"?old[`origin.${i}`] as string:String(original.origin[i]));
        vectorExpression(sources,true).forEach((source,i)=>fields[`origin.${i}`]=source);
      }
      const raw={...o,parameters:undefined} as GeometryObject;
      if(o.kind==="point"&&o.construction.type==="free") {
        const coords=fields["construction.position"];
        o.parameters.source=typeof coords!=="string"&&coords?`(${coords.coordinates.join(", ")})`:definition(doc,raw).split(" = ").slice(1).join(" = ");
      } else if(o.kind==="label"&&!o.measurement) {
        const coords=fields.position;
        o.parameters.source=`Text(${JSON.stringify(o.text)}, (${typeof coords!=="string"&&coords?coords.coordinates.join(", "):o.position.join(", ")}))`;
      } else if(o.kind==="solid"&&!o.construction) {
        const number=(field:string,value:number)=>typeof fields[field]==="string"?fields[field] as string:String(value);
        const command={cube:"Cube",cuboid:"Cuboid",prism:"RegularPrism",pyramid:"RegularPyramid",frustum:"Frustum",cylinder:"Cylinder",cone:"Cone",coneFrustum:"ConeFrustum",sphere:"Sphere"}[o.shape];
        o.parameters.source=`${command}(${[
          ...(["width","depth","height","radius","topRadius","sides"] as const).map(field=>number(field,o[field])),
          ...o.origin.map((v,i)=>number(`origin.${i}`,v)),...o.rotation.map((v,i)=>number(`rotation.${i}`,v)),
        ].join(", ")})`;
      } else if(o.kind==="solid"&&o.construction?.type==="extrusion") {
        const c=o.construction,base=doc.objects.find(p=>p.id===c.base)?.symbol??c.base,vector=fields["construction.direction"];
        o.parameters.source=`Prism(${base}, ${c.vector?doc.objects.find(p=>p.id===c.vector)?.symbol??c.vector:`(${typeof vector!=="string"&&vector?vector.coordinates.join(", "):c.direction.join(", ")})`})`;
      }
      // Other definitions retain local dimensions/angles; the additional body
      // basis records the change of world coordinates without freezing sliders.
    }
    return o;
  });
  // In a plane view, the transformed workplane already preserves the picture.
  // Camera coordinates preserve an arbitrary spatial view and its rotation.
  return normalizeDrawing(doc);
}

export function frameRoundTripError(p:Vec3,input:DrawingDocument) {
  const f=input.coordinateFrame;if(!f)return 0;
  const q=local(p,{...f,z:mul(cross(f.x,f.y),f.zSign)});
  return norm(sub(p,add(f.origin,add(mul(f.x,q[0]),add(mul(f.y,q[1]),mul(cross(f.x,f.y),q[2]*f.zSign))))));
}
