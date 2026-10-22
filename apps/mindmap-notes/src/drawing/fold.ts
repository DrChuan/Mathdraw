import { defaultStyle,type DrawingDocument,type DrawingPoint,type DrawingPolygon,type Vec3 } from "./types";
import { add,sub,mul,dot,cross,norm,unit } from "./constraints/math";

export function rotateAboutAxis(point:Vec3,a:Vec3,b:Vec3,degrees:number):Vec3 {
  const direction=unit(sub(b,a)),p=sub(point,a),angle=degrees*Math.PI/180;
  return add(a,add(mul(p,Math.cos(angle)),add(mul(cross(direction,p),Math.sin(angle)),mul(direction,dot(direction,p)*(1-Math.cos(angle))))));
}
/** One document transaction: private source, dependent rotated vertices, slider. */
export function foldPolygon(input:DrawingDocument,sourceId:string,axis:string,angleId:string|undefined,vertices:string[],point:(id:string)=>Vec3,line:{a:Vec3;b:Vec3},replaceId?:string,symbol?:string):DrawingDocument {
  if(input.dimension!=="3d")throw new Error("翻折请在立体几何模式使用");
  if(norm(sub(line.b,line.a))<1e-9)throw new Error("旋转轴方向失效");
  const doc=structuredClone(input),source=doc.objects.find(o=>o.id===sourceId),old=doc.objects.find(o=>o.id===replaceId);
  if(source?.kind!=="polygon"&&source?.kind!=="triangle")throw new Error("请选择一个多边形或三角形");
  if(sourceId===replaceId)throw new Error("不能把翻折结果本身作为来源，请选择原多边形");
  const reserved=symbol??old?.symbol??source.symbol;
  const fresh=(base:string)=>{let s=base,n=1;while(s===reserved||doc.objects.some(o=>o.symbol===s))s=`${base}_${n++}`;return s;};
  const style={...source.style},name=source.name,sourceSymbol=source.symbol!;
  let originalBody=old?.kind==="polygon"?old.fold?.originalBody:undefined;
  const body=doc.objects.find(o=>o.id===source.body);
  if(body?.kind==="solid"&&body.construction?.type==="faces") {
    originalBody=body.id;
    const ids=body.construction.faces.map(id=>{
      const face=doc.objects.find(o=>o.id===id)!;
      const clone={...structuredClone(face),id:crypto.randomUUID(),symbol:fresh("aux"),hidden:true,auxiliary:true,body:undefined,constraintSet:undefined,constraintFace:undefined};
      doc.objects.push(clone);delete face.body;return clone.id;
    });
    body.construction.faces=ids;body.hidden=true;body.auxiliary=true;delete body.constraintSet;
  }
  source.hidden=true;source.auxiliary=true;delete source.body;delete source.constraintSet;delete source.constraintFace;
  if(!old)source.symbol=fresh("aux");
  if(!angleId) {
    const s=fresh("t");angleId=crypto.randomUUID();doc.objects.push({id:angleId,kind:"number",symbol:s,name:s,expression:"90",references:{},value:90,slider:{min:-180,max:180,step:1},style:defaultStyle()});
  }
  const angle=doc.objects.find(o=>o.id===angleId);if(angle?.kind!=="number")throw new Error("翻折角需要引用一个数值对象（角度单位：度）");
  const axisDirection=sub(line.b,line.a),length=norm(axisDirection);
  const points=vertices.map(id=>{
    if(norm(cross(sub(point(id),line.a),axisDirection))<=1e-8*length)return id;
    const original=doc.objects.find(o=>o.id===id),label=original?.name??`P_${vertices.indexOf(id)+1}`,s=fresh("aux");
    const p:DrawingPoint={id:crypto.randomUUID(),symbol:s,name:`${label}′`,kind:"point",construction:{type:"rotation",point:id,axis,angle:angleId!},auxiliary:true,showName:true,dot:"auto",coordinates:"none",labelOffset:[9,-10],style:defaultStyle()};doc.objects.push(p);return p.id;
  });
  for(const id of vertices.filter(id=>!points.includes(id))) {
    const vertex=doc.objects.find(o=>o.id===id);
    if(vertex?.kind!=="point"||vertex.construction.type==="origin"||doc.coordinateOriginId===id)continue;
    const shared=doc.objects.some(o=>o.id!==id&&o.id!==replaceId&&!o.hidden&&!o.auxiliary&&JSON.stringify(o).includes(JSON.stringify(id)));
    if(!shared){vertex.hidden=true;vertex.auxiliary=true;}
  }
  const polygon:DrawingPolygon={id:replaceId??crypto.randomUUID(),symbol:symbol??old?.symbol??sourceSymbol,name:old?.name??name,kind:"polygon",points,fold:{source:sourceId,axis,angle:angleId,originalBody},style:old?.style??style};
  doc.objects=doc.objects.filter(o=>o.id!==replaceId);doc.objects.push(polygon);
  return doc;
}
