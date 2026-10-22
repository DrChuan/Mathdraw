import { angleDegrees,angleKinds,parseTrigCondition } from "./angles";
import { scalar } from "../expression";
import { constraintKinds, type Condition, type ConstraintKind, type ConstraintProblem } from "./types";

export const conditionLabels:Record<ConstraintKind,string>={distance:"长度",equal:"等长",ratio:"长度比",lineAngle:"线线角",vertexAngle:"三点角",
  linePlaneAngle:"线面角",dihedral:"二面角",parallel:"平行",perpendicular:"垂直",collinear:"三点共线",onSegment:"点在线段上",division:"定比分点（默认中点）",
  coplanar:"四点共面",parallelogram:"平行四边形",rectangle:"矩形",rhombus:"菱形",square:"正方形",prism:"棱柱",pyramid:"棱锥",frustum:"棱台",regularPolygon:"正多边形",cube:"正方体"};
export const conditionExamples:Record<ConstraintKind,string>={distance:"AB = 3",equal:"AB = CD",ratio:"AB / CD = 2",lineAngle:"angle(AB, CD) = 60",
  vertexAngle:"angle(A, B, C) = 120",linePlaneAngle:"angle(AB, CDE) = 30",dihedral:"dihedral(AB, C, D) = 120",
  parallel:"AB // CD",perpendicular:"AB ⟂ CDE",collinear:"collinear(A, B, C)",onSegment:"onSegment(P, A, B)",
  division:"division(M, AB, 1)",coplanar:"coplanar(A, B, C, D)",parallelogram:"parallelogram(A, B, C, D)",rectangle:"rectangle(A, B, C, D)",rhombus:"rhombus(A, B, C, D)",
  square:"square(A, B, C, D)",prism:"prism(A, B, C, A_1, B_1, C_1)",pyramid:"pyramid(P, A, B, C, D)",frustum:"frustum(A, B, C, A_1, B_1, C_1)",regularPolygon:"regularPolygon(A, B, C, D, E)",cube:"cube(A, B, C, D, E, F, G, H)"};
export function pointNames(source:string):string[] {
  const names=source.trim().split(/[\s,，;；]+/).filter(Boolean);
  if(!names.length||names.length>50||names.some(s=>s.length>64||!/^[A-Za-z][A-Za-z0-9_]*$/.test(s))||new Set(names).size!==names.length)
    throw new Error("请声明 1～50 个不重复点名，如 A B C P；点名使用字母、数字和下标");
  return names;
}
export function entity(source:string,names:string[]):string[] {
  source=source.trim().replace(/^plane\((.*)\)$/i,"$1").replace(/[()]/g,"");
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
export function validateCondition(c:Condition,names:string[]) {
  if(!constraintKinds.includes(c.kind)||typeof c.id!=="string"||!c.id||typeof c.source!=="string"||c.source.length>2048||typeof c.enabled!=="boolean"||
    !Array.isArray(c.refs)||c.refs.some(r=>!Array.isArray(r)||r.some(p=>!names.includes(p))||new Set(r).size!==r.length))throw new Error("条件数据或点引用无效");
  const sizes=c.refs.map(r=>r.length).join(",");
  const expected:Partial<Record<ConstraintKind,string>>={distance:"2",equal:"2,2",ratio:"2,2",lineAngle:"2,2",vertexAngle:"1,1,1",linePlaneAngle:"2,3",dihedral:"2,1,1",collinear:"3",onSegment:"1,2",division:"1,2",coplanar:"4",parallelogram:"4",rectangle:"4",rhombus:"4",square:"4",cube:"8"};
  if(c.kind==="prism"||c.kind==="frustum") {
    if(c.refs.length!==1||c.refs[0].length<6||c.refs[0].length>50||c.refs[0].length%2!==0)throw new Error(`${conditionLabels[c.kind]}先填写全部底面点，再填写对应的顶面点，两组数量相同且各至少三个`);
  } else if(c.kind==="pyramid") {
    if(c.refs.length!==1||c.refs[0].length<4||c.refs[0].length>50)throw new Error("棱锥先填写顶点，再按顺序填写至少三个底面点");
  } else if(c.kind==="regularPolygon") {
    if(c.refs.length!==1||c.refs[0].length<3||c.refs[0].length>49)throw new Error("正多边形需要按顺序填写至少三个顶点");
  } else if(c.kind==="parallel"||c.kind==="perpendicular") {if(!["2,2","2,3","3,2","3,3"].includes(sizes))throw new Error("平行/垂直需要两条线、线与面或两个面");}
  else if(sizes!==expected[c.kind])throw new Error(`${conditionLabels[c.kind]}的点数或对象格式不正确`);
  if(["distance","ratio","division","lineAngle","vertexAngle","linePlaneAngle","dihedral"].includes(c.kind)) {
    if(typeof c.value!=="number"||!Number.isFinite(c.value)||Math.abs(c.value)>1e6)throw new Error("条件数值无效");
    if(["distance","ratio","division"].includes(c.kind)&&c.value<=0)throw new Error("长度和长度比必须大于零");
    const max=["lineAngle","linePlaneAngle"].includes(c.kind)?90:180;
    if(!["distance","ratio","division"].includes(c.kind)&&(c.value<0||c.value>max))throw new Error(`角度必须在 0～${max}° 之间`);
  }
  if(c.alternateValue!==undefined&&(!["vertexAngle","dihedral"].includes(c.kind)||!Number.isFinite(c.alternateValue)||c.alternateValue<0||c.alternateValue>180))throw new Error("角的另一分支无效");
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
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b|\\(?:circ|degree)\b|°/g,"")
    .replace(/\\(sin|cos|tan)\b/g,"$1").replace(/\\[,;!]|\\quad\b|\\qquad\b/g," ");
  s=s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,(whole,a:string,b:string)=>{
    try{if(entity(a,names).length===2&&entity(b,names).length===2)return `${a}/${b}`;}catch{/* Numeric fractions retain their LaTeX. */}
    return whole;
  });
  const angle=(ref:string)=>{const points=entity(ref,names);if(points.length!==3)throw new Error("角需要三个点，如 \\angle ABC，B 为顶点");return `angle(${points.join(",")})`;};
  s=s.replace(/(?:\\angle|∠)\s*\{([^{}]+)\}/g,(_,ref:string)=>angle(ref))
    .replace(/(?:\\angle|∠)\s*([A-Za-z][A-Za-z0-9_\s]*)/g,(_,ref:string)=>angle(ref))
    .replace(/\\angle\s*(?=\()/g,"angle");
  const trig=s.match(/^(sin|cos|tan)\s*(angle\([^)]+\))\s*=\s*([\s\S]+)$/i);
  if(trig)s=`${trig[1]}(${trig[2]}) = ${trig[3]}`;
  return s;
}
export function parseCondition(source:string,names:string[],id:string=crypto.randomUUID()):Condition {
  if(source.length>2048)throw new Error("单条条件不能超过 2048 个字符");
  const original=source.trim();source=normalizeConditionNotation(original,names);const trig=parseTrigCondition(source);if(trig){const c=parseCondition(trig.inner,names,id);if(!angleKinds.includes(c.kind))throw new Error("三角函数条件需要引用一个角");c.value=trig.degrees;c.alternateValue=["vertexAngle","dihedral"].includes(c.kind)?trig.alternate:undefined;c.source=original;validateCondition(c,names);return c;}
  let kind:ConstraintKind,refs:string[][],value:number|undefined;
  const s=source.replace(/∥/g,"//").replace(/⊥/g,"⟂").replace(/＝/g,"=");
  const relation=s.match(/^(.*?)\s*(\/\/|⟂)\s*(.*?)$/);
  const call=conditionCall(s);
  if(relation) {kind=relation[2]==="//"?"parallel":"perpendicular";refs=[entity(relation[1],names),entity(relation[3],names)];}
  else if(call) {
    const args=splitArguments(call[2]),command=call[1].toLowerCase();
    if(command==="angle") {refs=args.map(a=>entity(a,names));kind=refs.length===3?"vertexAngle":refs.some(r=>r.length===3)?"linePlaneAngle":"lineAngle";if(kind==="linePlaneAngle"&&refs[0].length===3)refs.reverse();value=angleDegrees(call[3]??"");}
    else {
      const known=command==="midpoint"?"division":constraintKinds.find(k=>k.toLowerCase()===command);if(!known)throw new Error(`未知条件：${call[1]}`);kind=known;
      const numeric=["distance","ratio","division","lineAngle","vertexAngle","linePlaneAngle","dihedral"].includes(kind);
      if(command==="midpoint")value=1;
      else if(numeric)value=angleKinds.includes(kind)?angleDegrees(call[3]??args.pop()??""):scalar(kind==="division"&&args.length===2&&!call[3]?"1":call[3]??args.pop()??"");
      if(["collinear","coplanar","parallelogram","rectangle","rhombus","square","prism","pyramid","frustum","regularPolygon","cube"].includes(kind))refs=[args.flatMap(a=>entity(a,names))];
      else if(kind==="onSegment"||kind==="division") {const p=entity(args.shift()??"",names);refs=[p,args.flatMap(a=>entity(a,names))];}
      else if(kind==="distance")refs=[args.flatMap(a=>entity(a,names))];
      else if(kind==="vertexAngle")refs=args.map(a=>entity(a,names));
      else refs=args.map(a=>entity(a,names));
    }
  } else {
    const m=s.match(/^(.+?)\s*=\s*(.+)$/);if(!m)throw new Error("请输入条件，例如 AB=3、AB // CD 或 square(A,B,C,D)");
    const ratio=m[1].split("/");
    if(ratio.length===2){kind="ratio";refs=ratio.map(s=>entity(s,names));value=scalar(m[2]);}
    else {const a=entity(m[1],names);let b:string[]|undefined;try{b=entity(m[2],names);}catch{/* right side can be a numeric expression */}
      if(b?.length===2){kind="equal";refs=[a,b];}else{kind="distance";refs=[a];value=scalar(m[2]);}}
  }
  const c={id,kind,refs,value,source:original,enabled:true};validateCondition(c,names);return c;
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
export function parseConditions(source:string,names:string[],id:string=crypto.randomUUID()):Condition[] {
  if(source.length>2048)throw new Error("单条条件不能超过 2048 个字符");
  const parts=normalizeConditionNotation(source,names).replace(/＝/g,"=").split("=").map(s=>s.trim());
  if(parts.length<=2)return [parseCondition(source,names,id)];
  if(parts.some(s=>!s))throw new Error("连等的每一项都不能为空");
  // A numeric last term constrains every geometric term; otherwise successive
  // equalities preserve the meaning without inventing a numeric value.
  const numbers=parts.flatMap(source=>{try{return [{source,value:scalar(source)}];}catch{return [];}});
  if(numbers.length) {
    const first=numbers[0];if(numbers.some(n=>Math.abs(n.value-first.value)>1e-12*Math.max(1,Math.abs(first.value))))throw new Error("连等中给出的数值互不相等");
    const terms=parts.filter(p=>!numbers.some(n=>n.source===p));
    if(!terms.length)throw new Error("连等中需要包含几何对象");
    return terms.map((part,i)=>parseCondition(`${part} = ${first.source}`,names,i?crypto.randomUUID():id));
  }
  return parts.slice(0,-1).map((part,i)=>parseCondition(`${part} = ${parts[i+1]}`,names,i?crypto.randomUUID():id));
}
export function validateProblem(p:ConstraintProblem) {
  if(!p||!Array.isArray(p.points)||pointNames(p.points.join(" ")).length!==p.points.length||!Array.isArray(p.segments)||p.segments.length>200||
    p.segments.some(s=>!Array.isArray(s)||s.length!==2||s[0]===s[1]||s.some(n=>!p.points.includes(n)))||!Array.isArray(p.conditions)||p.conditions.length>200)
    throw new Error("约束作图数据无效（最多 50 个点、200 条条件或线段）");
  const ids=new Set<string>();for(const c of p.conditions){validateCondition(c,p.points);if(ids.has(c.id))throw new Error("条件 ID 重复");ids.add(c.id);}
}
