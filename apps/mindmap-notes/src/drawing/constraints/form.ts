import type { ConstraintKind,ConstraintCurve,VolumeShape } from "./types";
import { entity } from "./input";
import { angleKinds,angleSource,type AngleMode } from "./angles";

export const conditionGroups:{name:string;kinds:ConstraintKind[]}[]=[
  {name:"长度",kinds:["distance","pointLineDistance","pointPlaneDistance","equal","ratio","scalarEquation","circumradius","concyclic","cospherical"]},
  {name:"面积 / 体积",kinds:["area","volume"]},
  {name:"角度",kinds:["vertexAngle","lineAngle","linePlaneAngle","dihedral"]},
  {name:"位置关系",kinds:["parallel","perpendicular","collinear","coplanar","onSegment","division","onCurve","diameter"]},
  {name:"向量关系",kinds:["vectorRelation","vectorDot"]},
  {name:"平面图形",kinds:["convexPolygon","parallelogram","rectangle","rhombus","square","regularPolygon","congruent","similar"]},
  {name:"几何体",kinds:["prism","pyramid","frustum","cube","cylinder","cone","coneFrustum","sphere"]},
];
export const conditionFields:Record<ConstraintKind,{label:string;placeholder:string}[]>={
  diameter:[{label:"直径端点",placeholder:"AE"},{label:"圆名",placeholder:"O"}],
  scalarEquation:[{label:"等式",placeholder:"AB+BC=2AC"}],
  pointLineDistance:[{label:"点",placeholder:"P"},{label:"直线（两点或名称）",placeholder:"AB 或 l"}],pointPlaneDistance:[{label:"点",placeholder:"P"},{label:"平面（三个点）",placeholder:"ABC"}],
  distance:[{label:"线段",placeholder:"AB"}],equal:[{label:"第一条线段",placeholder:"AB"},{label:"第二条线段",placeholder:"CD"}],
  ratio:[{label:"分子线段",placeholder:"AB"},{label:"分母线段",placeholder:"CD"}],
  vertexAngle:[{label:"角（中间点为顶点）",placeholder:"ABC"}],
  lineAngle:[{label:"第一条直线",placeholder:"AB"},{label:"第二条直线",placeholder:"CD"}],
  linePlaneAngle:[{label:"直线",placeholder:"AB"},{label:"平面（三个点）",placeholder:"CDE"}],
  dihedral:[{label:"公共棱",placeholder:"BC"},{label:"第一侧的点",placeholder:"A"},{label:"第二侧的点",placeholder:"D"}],
  parallel:[{label:"第一个对象（线或面）",placeholder:"AB"},{label:"第二个对象（线或面）",placeholder:"CDE"}],
  perpendicular:[{label:"第一个对象（线或面）",placeholder:"AB"},{label:"第二个对象（线或面）",placeholder:"CDE"}],
  collinear:[{label:"三个点",placeholder:"ABC"}],coplanar:[{label:"四个点",placeholder:"ABCD"}],
  onSegment:[{label:"线段上的点",placeholder:"M"},{label:"线段",placeholder:"AB"}],
  division:[{label:"分点",placeholder:"M"},{label:"线段",placeholder:"AB"}],
  parallelogram:[{label:"顶点（按顺序）",placeholder:"ABCD"}],rectangle:[{label:"顶点（按顺序）",placeholder:"ABCD"}],
  rhombus:[{label:"顶点（按顺序）",placeholder:"ABCD"}],square:[{label:"顶点（按顺序）",placeholder:"ABCD"}],
  regularPolygon:[{label:"顶点（按顺序）",placeholder:"ABCDE"}],
  convexPolygon:[{label:"顶点（按环绕顺序）",placeholder:"ABCD"}],
  congruent:[{label:"第一个图形",placeholder:"ABC"},{label:"第二个图形（对应顺序）",placeholder:"DEF"}],
  similar:[{label:"第一个图形",placeholder:"ABCD"},{label:"第二个图形（对应顺序）",placeholder:"EFGH"}],
  vectorRelation:[{label:"左侧向量式",placeholder:"AB"},{label:"右侧向量式",placeholder:"2*AC - AD"}],
  vectorDot:[{label:"第一个向量",placeholder:"AB"},{label:"第二个向量",placeholder:"AC"}],
  prism:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
  frustum:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
  pyramid:[{label:"顶点",placeholder:"P"},{label:"底面顶点（按顺序）",placeholder:"ABCD"}],
  cube:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
  cylinder:[{label:"底面圆心",placeholder:"O"},{label:"顶面圆心",placeholder:"O_1"},{label:"底面圆上一点",placeholder:"A"}],
  cone:[{label:"底面圆心",placeholder:"O"},{label:"顶点",placeholder:"P"},{label:"底面圆上一点",placeholder:"A"}],
  coneFrustum:[{label:"底面圆心",placeholder:"O"},{label:"顶面圆心",placeholder:"O_1"},{label:"底面圆上一点",placeholder:"A"},{label:"顶面圆上一点",placeholder:"B"}],
  sphere:[{label:"球心",placeholder:"O"},{label:"球上一点",placeholder:"A"}],
  area:[{label:"多边形顶点（环绕顺序）",placeholder:"ABCD"}],volume:[],
  circumradius:[{label:"三角形",placeholder:"ABC"}],concyclic:[{label:"共圆的点",placeholder:"ABCD"}],cospherical:[{label:"共球的点",placeholder:"ABCDE"}],
  onCurve:[{label:"点",placeholder:"P"},{label:"曲线名",placeholder:"c"}],
};
export function formConditionSource(kind:ConstraintKind,fields:string[],names:string[],value:string,mode:AngleMode,range:"both"|"acute"|"obtuse",solid:VolumeShape="prism",curves:ConstraintCurve[]=[]) {
  if(kind==='scalarEquation')return fields[0]??'';
  if(kind==="vectorRelation")return `vectorRelation(${fields[0]} = ${fields[1]})`;
  if(kind==="onCurve"||kind==="diameter") {
    const curve=curves.find(c=>c.name===fields[1]);if(!curve)throw new Error("请选择已声明的曲线");
    return `${kind}(${entity(fields[0]??"",names).join(" ")},${curve.name})`;
  }
  const groups=(kind==="volume"?conditionFields[solid]:conditionFields[kind]).map((_,i)=>entity(fields[i]??"",names));
  if(kind==="volume")return `volume(${solid}(${groups.flat().join(",")}))=${value}`;
  if(kind==="vertexAngle"&&groups[0].length!==3)throw new Error("请填写三个点，如 ABC，B 为角的顶点");
  const refs=kind==="vertexAngle"?groups[0].join(","):groups.map(g=>g.join(" ")).join(",");
  if(angleKinds.includes(kind))return angleSource(kind,refs,value,mode,range);
  if(kind==="vectorDot")return `dot(${refs}) = ${value}`;
  return `${kind}(${refs}${["pointLineDistance","pointPlaneDistance","distance","ratio","division","area","circumradius"].includes(kind)||["concyclic","cospherical"].includes(kind)&&value.trim()?`, ${value}`:""})`;
}
