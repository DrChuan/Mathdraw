import {validateRecognition} from '../recognition/model';
import { scalarRelation } from './scalarRelations';
import { angleDegrees,angleKinds,parseTrigCondition } from "./angles";
import { scalar } from "../expression";
import { validatePlanarContext } from './planarModel';
import { parseVectorRelation,vectorDotSource } from "./vectors";
import { constraintKinds, type Condition, type ConstraintKind, type ConstraintProblem, type ConstraintCurve, type VolumeShape } from "./types";

import {conditionLabels} from "./catalog";
export {conditionLabels,conditionExamples} from "./catalog";
export function pointNames(source:string,maximum=50):string[] {
  const names=source.trim().split(/[\s,，;；]+/).filter(Boolean);
  if(!names.length||names.length>maximum||names.some(s=>s.length>64||!/^[A-Za-z][A-Za-z0-9_]*$/.test(s))||new Set(names).size!==names.length)
    throw new Error(`请声明 1～${maximum} 个不重复点名，如 A B C P；点名使用字母、数字和下标`);
  return names;
}
export function entity(source:string,names:string[]):string[] {
  source=source.trim();
  const shape=source.match(/^(Point|Segment|Line|Vector|Triangle|Polygon|Plane)\s*\(([^()]*)\)$/i);
  if(shape){const kind=shape[1].toLowerCase(),points=entity(shape[2],names),count=({point:1,segment:2,line:2,vector:2,triangle:3} as Record<string,number>)[kind];
    if(count!==undefined?points.length!==count:points.length<3)throw Error(`${shape[1]} 的顶点数量不正确`);
    return points;
  }
  if(/[A-Za-z]\s*\(/.test(source))throw Error(`不支持的图形引用“${source}”，请使用顶点或 Triangle/Polygon/Line 等引用`);
  source=source.replace(/[()]/g,"");
  if(names.includes(source))return [source];
  const explicit=source.split(/[\s,，]+/).filter(Boolean);
  if(explicit.length>1) {if(explicit.some(n=>!names.includes(n)))throw new Error(`引用了未声明的点：${source}`);return explicit;}
  if(source.length>2048)throw new Error("条件中的对象引用过长");
  const memo=new Map<number,string[][]>([[source.length,[[]]]]);
  for(let offset=source.length-1;offset>=0;offset--) {
    const tails:string[][]=[];
    for(const n of names)if(source.startsWith(n,offset)) {
      for(const tail of memo.get(offset+n.length)??[]) {tails.push([n,...tail]);if(tails.length>=2)break;}
      if(tails.length>=2)break;
    }
    memo.set(offset,tails);
  }
  const choices=memo.get(0)??[];
  if(choices.length!==1)throw new Error(`无法唯一识别“${source}”，请用空格分隔点名`);
  return choices[0];
}
export function segmentsFrom(source:string,names:string[]):[string,string][] {
  const result=source.split(/[;；\n,，]+/).map(s=>s.trim()).filter(Boolean).map(s=>entity(s,names));
  if(result.length>200||result.some(r=>r.length!==2||r[0]===r[1]))throw new Error("每条线段需要两个不同的已声明点，用逗号或分号分隔线段");
  const seen=new Set<string>();return result.filter(r=>{const k=[...r].sort().join("|");if(seen.has(k))return false;seen.add(k);return true;}) as [string,string][];
}
export function validateCondition(c:Condition,names:string[],curves?:ConstraintCurve[]) {
  if(!constraintKinds.includes(c.kind)||typeof c.id!=="string"||!c.id||typeof c.source!=="string"||c.source.length>2048||typeof c.enabled!=="boolean"||
    !Array.isArray(c.refs)||c.refs.some(r=>!Array.isArray(r)||r.some(p=>!names.includes(p))||new Set(r).size!==r.length))throw new Error("条件数据或点引用无效");
  if(c.coefficientSources!==undefined&&(!Array.isArray(c.coefficientSources)||c.coefficientSources.length!==c.coefficients?.length||c.coefficientSources.some((source,i)=>typeof source!=='string'||source.length>2048||Math.abs(scalar(source)-c.coefficients![i])>1e-10*Math.max(1,Math.abs(c.coefficients![i])))))throw Error('向量系数源码与数值不一致');
  const sizes=c.refs.map(r=>r.length).join(",");
  const expected:Partial<Record<ConstraintKind,string>>={pointLineDistance:"1,2",pointPlaneDistance:"1,3",distance:"2",equal:"2,2",ratio:"2,2",lineAngle:"2,2",vertexAngle:"1,1,1",linePlaneAngle:"2,3",dihedral:"2,1,1",collinear:"3",onSegment:"1,2",division:"1,2",coplanar:"4",parallelogram:"4",rectangle:"4",rhombus:"4",square:"4",cube:"8"};
  if(c.kind==="volume") {
    if(!["prism","pyramid","frustum","cylinder","cone","coneFrustum"].includes(c.solid??""))throw new Error("体积仅支持棱柱、棱锥、棱台、圆柱、圆锥和圆台");
    validateCondition({...c,kind:c.solid!,solid:undefined,value:undefined},names,curves);
  } else if(c.kind==="onCurve"||c.kind==="diameter") {
    if(c.refs.length!==1||(c.kind==='diameter'?c.refs[0].length!==2:c.refs[0].length<1||c.refs[0].length>50)||typeof c.curve!=="string"||curves&&!curves.some(k=>k.id===c.curve))throw new Error("点在曲线上需要一个已声明点和一条已声明曲线");
    if(c.kind==='diameter'&&curves?.find(k=>k.id===c.curve)?.type!=='circle')throw Error("直径需要引用圆对象");
  } else if(["area","circumradius","concyclic","cospherical"].includes(c.kind)) {
    const minimum=c.kind==="cospherical"?4:3;
    if(c.refs.length!==1||c.refs[0].length<minimum||c.refs[0].length>50||c.kind==="circumradius"&&c.refs[0].length!==3)throw new Error(`${conditionLabels[c.kind]}需要${c.kind==="circumradius"?"恰好三个":`至少 ${minimum} 个`}点`);
  } else if(["cylinder","cone","coneFrustum","sphere"].includes(c.kind)) {
    if(sizes!==({cylinder:"3",cone:"3",coneFrustum:"4",sphere:"2"} as Record<string,string>)[c.kind])throw new Error(`${conditionLabels[c.kind]}的定义点数量不正确`);
  } else if(c.kind==='scalarEquation') {
    const parsed=scalarRelation(c.source,names);
    if(JSON.stringify(parsed.refs)!==JSON.stringify(c.refs))throw Error('标量等式引用无效');
  } else if(c.kind==="vectorRelation") {
    if(!c.refs.length||c.refs.length>64||c.refs.some(r=>r.length!==2)||!Array.isArray(c.coefficients)||c.coefficients.length!==c.refs.length||c.coefficients.some(k=>typeof k!=="number"||!Number.isFinite(k)||Math.abs(k)>1e6))throw new Error("向量线性关系的向量或系数无效");
  } else if(c.kind==="vectorDot") {
    if(sizes!=="2,2"||typeof c.value!=="number"||!Number.isFinite(c.value)||Math.abs(c.value)>1e9)throw new Error("数量积需要两个向量及一个有限数值");
  } else if(c.kind==="congruent"||c.kind==="similar") {
    if(c.refs.length!==2||c.refs[0].length<3||c.refs[0].length>25||c.refs[1].length!==c.refs[0].length)throw new Error("全等或相似需要两个顶点数量相同的图形（3～25 个），按对应顺序填写");
  } else if(c.kind==="prism"||c.kind==="frustum") {
    if(c.refs.length!==1||c.refs[0].length<6||c.refs[0].length>50||c.refs[0].length%2!==0)throw new Error(`${conditionLabels[c.kind]}先填写全部底面点，再填写对应的顶面点，两组数量相同且各至少三个`);
  } else if(c.kind==="pyramid") {
    if(c.refs.length!==1||c.refs[0].length<4||c.refs[0].length>50)throw new Error("棱锥先填写顶点，再按顺序填写至少三个底面点");
  } else if(c.kind==="regularPolygon"||c.kind==="convexPolygon") {
    if(c.refs.length!==1||c.refs[0].length<3||c.refs[0].length>49)throw new Error("多边形需要按顺序填写至少三个顶点");
  } else if(c.kind==="parallel"||c.kind==="perpendicular") {if(!["2,2","2,3","3,2","3,3"].includes(sizes))throw new Error("平行/垂直需要两条线、线与面或两个面");}
  else if(sizes!==expected[c.kind])throw new Error(`${conditionLabels[c.kind]}的点数或对象格式不正确`);
  if(["pointLineDistance","pointPlaneDistance","distance","ratio","division","lineAngle","vertexAngle","linePlaneAngle","dihedral"].includes(c.kind)) {
    if(typeof c.value!=="number"||!Number.isFinite(c.value)||Math.abs(c.value)>1e6)throw new Error("条件数值无效");
    if(["distance","ratio","division"].includes(c.kind)&&c.value<=0)throw new Error("长度和长度比必须大于零");
    const max=["lineAngle","linePlaneAngle"].includes(c.kind)?90:180;
    if(["pointLineDistance","pointPlaneDistance"].includes(c.kind)&&c.value<0)throw Error("距离不能为负数");
    if(!["pointLineDistance","pointPlaneDistance","distance","ratio","division"].includes(c.kind)&&(c.value<0||c.value>max))throw new Error(`角度必须在 0～${max}° 之间`);
  }
  if(c.alternateValue!==undefined&&(!["vertexAngle","dihedral"].includes(c.kind)||!Number.isFinite(c.alternateValue)||c.alternateValue<0||c.alternateValue>180))throw new Error("角的另一分支无效");
  if(["area","volume","circumradius"].includes(c.kind)||["concyclic","cospherical"].includes(c.kind)&&c.value!==undefined)
    if(typeof c.value!=="number"||!Number.isFinite(c.value)||c.value<=0||c.value>1e18)throw new Error("面积、体积或半径必须为有限的正数，可用分数和根式");
  if(c.solid!==undefined&&c.kind!=="volume"||c.curve!==undefined&&!["onCurve","diameter"].includes(c.kind))throw new Error("条件的图形引用无效");
  if(c.kind==="vertexAngle"&&new Set(c.refs.flat()).size!==3)throw new Error("三点角需要三个不同的点");
  if(["onSegment","division"].includes(c.kind)&&c.refs[1].includes(c.refs[0][0]))throw new Error("线段上的动点应与端点不同");
  if(c.kind==="dihedral"&&new Set(c.refs.flat()).size!==4)throw new Error("二面角需要公共棱两端及两侧各一个不同的点");
}
/** Normalize geometric LaTeX without changing the stored editable source. */
export function normalizeConditionNotation(source:string,names:string[]):string {
  let s=source.trim().replace(/\\(?:dfrac|tfrac)\b/g,"\\frac").replace(/^\$\$?([\s\S]*?)\$\$?$/, "$1")
    .replace(/^\\\(([\s\S]*)\\\)$/, "$1")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:mathrm|mathit|mathbf|operatorname|text|overline|overrightarrow|vec)\s*\{([^{}]*)\}/g,"$1")
    .replace(/_\{([A-Za-z0-9]+)\}/g,"_$1")
    .replace(/\\(?:perp|bot)\b/g,"⟂").replace(/\\(?:parallel|Vert)\b/g,"//")
    .replace(/\\(?:cong|congruent)\b/g,"≅").replace(/\\sim\b/g,"~").replace(/\\triangle\b|△|▲/g,"")
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b|\\(?:circ|degree)\b|°/g,"")
    .replace(/\\(sin|cos|tan)\b/g," $1 ").replace(/\\[,;!]|\\quad\b|\\qquad\b/g," ");
  s=s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,(whole,a:string,b:string)=>{
    try{if(entity(a,names).length===2&&entity(b,names).length===2)return `${a}/${b}`;}catch{/* Numeric fractions retain their LaTeX. */}
    return whole;
  });
  const angle=(ref:string)=>{const points=entity(ref,names);if(points.length!==3)throw new Error("角需要三个点，如 \\angle ABC，B 为顶点");return `angle(${points.join(",")})`;};
  s=s.replace(/(?:\\angle|∠)\s*\{([^{}]+)\}/g,(_,ref:string)=>angle(ref))
    .replace(/(?:\\angle|∠)\s*([A-Za-z][A-Za-z0-9_\s]*)/g,(_,ref:string)=>angle(ref))
    .replace(/\\angle\s*(?=\()/g,"angle");
  // Parentheses around a geometric angle are optional, including in sums
  // and products. Keep the operation scoped to the angle, not the whole side.
  s=s.replace(/\b(sin|cos|tan)(?:\s*\^\s*(\{[^{}]+\}|[+-]?\d+(?:\.\d+)?))?\s*(\(\s*angle\([^)]+\)\s*\)|angle\([^)]+\))/gi,(_,fn:string,power:string|undefined,arg:string)=>{
    const inner=arg.startsWith('(')?arg.slice(1,-1).trim():arg;
    return `${fn.toLowerCase()}(${inner})${power?`^(${power.replace(/^\{(.*)\}$/,'$1')})`:''}`;
  });
  return s.trim();
}
export function parseCondition(source:string,names:string[],id:string=crypto.randomUUID(),curves:ConstraintCurve[]=[]):Condition {
  try{return parseGeometricCondition(source,names,id,curves);}
  catch(error){
    if(source.length>2048||/vectorRelation\s*\(|\b(?:vec|vector)\s*\(|\\(?:vec|overrightarrow)\b/i.test(source))throw error;
    const pair=normalizeConditionNotation(source,names).split('=');let numericLength=false;
    if(pair.length===2)try{numericLength=entity(pair[0],names).length===2&&Number.isFinite(scalar(pair[1]));}catch{}
    if(numericLength)throw error;
    try{const parsed=scalarRelation(source,names);return {id,kind:'scalarEquation',refs:parsed.refs,source:source.trim(),enabled:true};}
    catch{throw error;}
  }
}
function parseGeometricCondition(source:string,names:string[],id:string,curves:ConstraintCurve[]):Condition {
  if(source.length>2048)throw new Error("单条条件不能超过 2048 个字符");
  const original=source.trim(),resolve=(source:string)=>entity(source,names);
  const vectorDot=vectorDotSource(original,resolve),vectorBody=original.match(/^vectorRelation\s*\(([\s\S]*)\)$/i)?.[1];
  if(vectorDot||vectorBody!==undefined||/\\(?:vec|overrightarrow)\b|\b(?:vec|vector)\s*\(/i.test(original)) {
    const c={id,...(vectorDot??parseVectorRelation(vectorBody??original,resolve)),source:original,enabled:true};validateCondition(c,names);return c;
  }
  source=normalizeConditionNotation(original,names);const trig=parseTrigCondition(source);if(trig){const c=parseCondition(trig.inner,names,id,curves);if(!angleKinds.includes(c.kind))throw new Error("三角函数条件需要引用一个角");c.value=trig.degrees;c.alternateValue=["vertexAngle","dihedral"].includes(c.kind)?trig.alternate:undefined;c.source=original;validateCondition(c,names,curves);return c;}
  let kind:ConstraintKind,refs:string[][],value:number|undefined;
  const s=source.replace(/∥/g,"//").replace(/⊥/g,"⟂").replace(/＝/g,"=");
  const relation=s.match(/^(.*?)\s*(\/\/|⟂|≅|~)\s*(.*?)$/);
  const call=conditionCall(s);
  if(call&&call[1].toLowerCase()==="volume") {
    const args=splitArguments(call[2]),shape=conditionCall(args.shift()??"");
    if(!shape)throw new Error("请指定几何体，如 volume(prism(A,B,C,A_1,B_1,C_1))=6");
    const solid=constraintKinds.find(k=>k.toLowerCase()===shape[1].toLowerCase()) as VolumeShape;
    const c:Condition={id,kind:"volume",solid,refs:[splitArguments(shape[2]).flatMap(a=>entity(a,names))],value:scalar(call[3]??args.pop()??""),source:original,enabled:true};validateCondition(c,names,curves);return c;
  }
  if(call&&["oncurve","diameter"].includes(call[1].toLowerCase())) {
    const args=splitArguments(call[2]),curve=curves.find(c=>c.name===args.at(-1)||c.id===args.at(-1));
    if(!curve||args.length<2)throw new Error("请指定已声明曲线，如 onCurve(P,c)");
    const c:Condition={id,kind:call[1].toLowerCase()==="diameter"?"diameter":"onCurve",refs:[args.slice(0,-1).flatMap(arg=>entity(arg,names))],curve:curve.id,enabled:true,source:original};validateCondition(c,names,curves);return c;
  }
  if(relation) {kind=relation[2]==="//"?"parallel":relation[2]==="⟂"?"perpendicular":relation[2]==="≅"?"congruent":"similar";refs=[entity(relation[1],names),entity(relation[3],names)];}
  else if(call) {
    const args=splitArguments(call[2]),command=call[1].toLowerCase();
    if(command==="angle") {refs=args.map(a=>entity(a,names));kind=refs.length===3?"vertexAngle":refs.some(r=>r.length===3)?"linePlaneAngle":"lineAngle";if(kind==="linePlaneAngle"&&refs[0].length===3)refs.reverse();value=angleDegrees(call[3]??"");}
    else {
      const known=command==="midpoint"?"division":constraintKinds.find(k=>k.toLowerCase()===command);if(!known)throw new Error(`未知条件：${call[1]}`);kind=known;
      const numeric=["pointLineDistance","pointPlaneDistance","distance","ratio","division","lineAngle","vertexAngle","linePlaneAngle","dihedral","area","circumradius"].includes(kind);
      if(command==="midpoint")value=1;
      else if(numeric)value=angleKinds.includes(kind)?angleDegrees(call[3]??args.pop()??""):scalar(kind==="division"&&args.length===2&&!call[3]?"1":call[3]??args.pop()??"");
      if(kind==="concyclic"||kind==="cospherical") {
        if(call[3])value=scalar(call[3]);
        else if(args.length>1&&!names.includes(args.at(-1)!))try{value=scalar(args.at(-1)!);args.pop();}catch{/* Last argument is another point, not a radius. */}
      }
      if(["collinear","coplanar","parallelogram","rectangle","rhombus","square","prism","pyramid","frustum","regularPolygon","convexPolygon","cube","area","circumradius","concyclic","cospherical","cylinder","cone","coneFrustum","sphere"].includes(kind))refs=[args.flatMap(a=>entity(a,names))];
      else if(kind==="onSegment"||kind==="division") {const p=entity(args.shift()??"",names);refs=[p,args.flatMap(a=>entity(a,names))];}
      else if(kind==="distance")refs=[args.flatMap(a=>entity(a,names))];
      else if(kind==="vertexAngle")refs=args.map(a=>entity(a,names));
      else if(kind==="dihedral"&&args.length===4){const p=args.map(a=>entity(a,names));if(p.some(r=>r.length!==1))throw Error("四点式二面角须依次填写侧点、棱端点、棱端点、侧点");refs=[[...p[1],...p[2]],p[0],p[3]];}
      else refs=args.map(a=>entity(a,names));
    }
  } else {
    const m=s.match(/^(.+?)\s*=\s*(.+)$/);if(!m)throw new Error("请输入条件，例如 AB=3、AB // CD 或 square(A,B,C,D)");
    const ratio=m[1].split("/");
    if(ratio.length===2){kind="ratio";refs=ratio.map(s=>entity(s,names));value=scalar(m[2]);}
    else {const a=entity(m[1],names);let b:string[]|undefined;try{b=entity(m[2],names);}catch{/* right side can be a numeric expression */}
      if(b?.length===2){kind="equal";refs=[a,b];}else{kind="distance";refs=[a];value=scalar(m[2]);}}
  }
  const c={id,kind,refs,value,source:original,enabled:true};validateCondition(c,names,curves);return c;
}
/** Recover the written numeric operand instead of reconstructing it from a double. */
export function conditionValueSource(c:Condition):string|undefined {
  const normalized=normalizeConditionNotation(c.source,[...new Set(c.refs.flat())]),call=conditionCall(normalized);
  if(call){if(call[3])return call[3];const args=splitArguments(call[2]);if(call[1].toLowerCase()==='midpoint'||c.kind==='division'&&args.length===2)return '1';if(c.value!==undefined)return args.at(-1);}
  const equal=normalized.lastIndexOf('=');return equal>=0?normalized.slice(equal+1).trim():undefined;
}
function conditionCall(source:string):[string,string,string,string?]|undefined {
  const head=source.match(/^([A-Za-z]+)\s*\(/);if(!head)return;
  let depth=1;
  for(let i=head[0].length;i<source.length;i++) {
    if(source[i]==="(")depth++;
    if(source[i]===")"&&--depth===0) {
      const tail=source.slice(i+1).trim();if(tail&&!tail.startsWith("="))return;
      return [source,head[1],source.slice(head[0].length,i),tail?tail.slice(1).trim():undefined];
    }
  }
}
function splitArguments(source:string):string[] {
  let depth=0,start=0;const result:string[]=[];
  for(let i=0;i<source.length;i++) {
    if("({[".includes(source[i]))depth++;
    else if(")}]".includes(source[i]))depth--;
    else if(depth===0&&/[,，;；]/.test(source[i])){result.push(source.slice(start,i).trim());start=i+1;}
    if(depth<0)throw new Error("条件中的括号不匹配");
  }
  if(depth)throw new Error("条件中的括号不匹配");
  return [...result,source.slice(start).trim()];
}
/** Expand a chained equality atomically, retaining each exact numeric source. */
export function parseConditions(source:string,names:string[],id:string=crypto.randomUUID(),curves:ConstraintCurve[]=[]):Condition[] {
  if(source.length>2048)throw new Error("单条条件不能超过 2048 个字符");
  const relationPlane=conditionCall(normalizeConditionNotation(source,names));
  if(relationPlane&&['parallel','perpendicular'].includes(relationPlane[1].toLowerCase())){
    const args=splitArguments(relationPlane[2]);let groups:string[][]|undefined;try{groups=args.map(a=>entity(a,names));}catch{/* Named coordinate curves use the planar expression evaluator. */}
    if(groups?.length===2&&groups.some(g=>g.length>3)){
      const rows=groups.flatMap(g=>g.length>3?g.slice(3).map(p=>`coplanar(${[...g.slice(0,3),p].join(',')})`):[]);
      rows.push(`${relationPlane[1]}(${groups.map(g=>g.slice(0,3).join(' ')).join(',')})`);
      return rows.map((s,k)=>parseCondition(s,names,`${id}:face:${k}`,curves));
    }
  }
  const baseCircle=source.trim().match(/^onBaseCircle\(([^()]+)\)$/i);
  if(baseCircle){const refs=baseCircle[1].split(',').flatMap(s=>entity(s,names));if(refs.length!==4)throw Error('onBaseCircle 需要圆周点、圆心、轴向点和半径点');const [p,o,t,a]=refs;return [`${o} ${p}=${o} ${a}`,`perpendicular(${o} ${p},${o} ${t})`].map((s,k)=>parseCondition(s,names,`${id}:base:${k}`,curves));}
  const plane=source.trim().match(/^coplanar\(([^()]+)\)$/i);
  if(plane){const refs=plane[1].split(',').flatMap(s=>entity(s,names));if(refs.length>4)return refs.slice(3).map((p,k)=>parseCondition(`coplanar(${[...refs.slice(0,3),p].join(',')})`,names,`${id}:plane:${k}`,curves));}
  const vectorBody=source.trim().match(/^vectorRelation\s*\(([\s\S]*)\)$/i)?.[1];
  const marked=vectorBody!==undefined||/\\(?:vec|overrightarrow)\b|\b(?:vec|vector)\s*\(/i.test(source);
  const parts=(marked?(vectorBody??source.trim().replace(/^\$\$?([\s\S]*?)\$\$?$/,"$1")):normalizeConditionNotation(source,names)).replace(/＝/g,"=").split("=").map(s=>s.trim());
  if(parts.length<=2)return [parseCondition(source,names,id,curves)];
  const pair=(a:string,b:string,index:number)=>parseCondition(vectorBody!==undefined?`vectorRelation(${a} = ${b})`:`${a} = ${b}`,names,index?crypto.randomUUID():id,curves);
  if(parts.some(s=>!s))throw new Error("连等的每一项都不能为空");
  // A numeric last term constrains every geometric term; otherwise successive
  // equalities preserve the meaning without inventing a numeric value.
  const numbers=parts.flatMap(source=>{try{return [{source,value:scalar(source)}];}catch{return [];}});
  if(numbers.length) {
    const first=numbers[0];if(numbers.some(n=>Math.abs(n.value-first.value)>1e-12*Math.max(1,Math.abs(first.value))))throw new Error("连等中给出的数值互不相等");
    const terms=parts.filter(p=>!numbers.some(n=>n.source===p));
    if(!terms.length)throw new Error("连等中需要包含几何对象");
    return terms.map((part,i)=>pair(part,first.source,i));
  }
  return parts.slice(0,-1).map((part,i)=>pair(part,parts[i+1],i));
}
export function validateProblem(p:ConstraintProblem) {
  if(p?.recognition)validateRecognition(p.recognition);
  if(!p||!Array.isArray(p.points)||pointNames(p.points.join(" "),p.mode==='coordinate'?2000:50).length!==p.points.length||!Array.isArray(p.segments)||p.segments.length>200||
    p.segments.some(s=>!Array.isArray(s)||s.length!==2||s[0]===s[1]||s.some(n=>!p.points.includes(n)))||!Array.isArray(p.conditions)||p.conditions.length>200)
    throw new Error("约束作图数据无效（最多 50 个点、200 条条件或线段）");
  if(p.mode!==undefined&&!['spatial','plane','coordinate'].includes(p.mode))throw new Error('条件作图模式无效');
  validateCurves(p.curves??[],p.points,p.mode==='plane'||p.mode==='coordinate');
  validatePlanarContext(p);
  const ids=new Set<string>();for(const c of p.conditions){validateCondition(c,p.points,p.curves??[]);if(ids.has(c.id))throw new Error("条件 ID 重复");ids.add(c.id);}
}
export function validateCurves(curves:ConstraintCurve[],names:string[],planar=false) {
  if(!Array.isArray(curves)||curves.length>50)throw new Error("最多声明 50 条曲线");
  const ids=new Set<string>(),symbols=new Set<string>(names);
  for(const c of curves) {
    const count=c?.method==="threePoint"?3:c?.method==="centerRadius"?1:2;
    if(!c||typeof c.id!=="string"||!c.id||c.id.length>128||ids.has(c.id)||typeof c.name!=="string"||!c.name||c.name.length>64||!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.name)||(symbols.has(c.name)&&!(c.type==='circle'&&c.normalAxis&&c.name===c.points?.[0]))||!["circle","ellipse"].includes(c.type)||
      !(c.type==="ellipse"?c.method==="foci":["threePoint","centerPoint","centerRadius"].includes(c.method))||!Array.isArray(c.points)||c.points.length!==count||new Set(c.points).size!==count||c.points.some(n=>!names.includes(n))||
      c.method!=="threePoint"&&!c.normalAxis&&!(planar&&c.type==='circle'&&c.plane===undefined)&&(!Array.isArray(c.plane)||c.plane.length!==3||new Set(c.plane).size!==3||c.plane.some(n=>!names.includes(n))))throw new Error("曲线名称、定义点或所在平面无效；平面需三个不同点");
    for(const refs of [c.normalAxis,c.radiusSegment])if(refs!==undefined&&(!Array.isArray(refs)||refs.length!==2||refs[0]===refs[1]||refs.some(n=>!names.includes(n))))throw Error("圆的轴或半径引用无效");
    if(c.normalAxis&&(planar||c.type!=='circle'||c.method!=='centerPoint'||c.plane))throw Error("轴向底面圆只适用于空间圆");
    if(c.radiusSegment&&!c.normalAxis)throw Error("半径线段需要轴向圆定义");
    if(c.solid!==undefined&&(typeof c.solid!=='string'||!c.solid))throw Error("圆的几何体来源无效");
    if(c.type==="ellipse"||c.method==="centerRadius") {
      if(typeof c.value!=="number"||!Number.isFinite(c.value)||c.value<=0||c.value>1e9||typeof c.valueSource!=="string"||c.valueSource.length>1024||Math.abs(scalar(c.valueSource)-c.value)>1e-9*Math.max(1,c.value))throw new Error("曲线半径或长轴长无效");
    }
    ids.add(c.id);symbols.add(c.name);
  }
}
