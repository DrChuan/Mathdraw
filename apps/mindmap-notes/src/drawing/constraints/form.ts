import type { ConstraintKind } from "./types";
import { entity } from "./input";
import { angleKinds,angleSource,type AngleMode } from "./angles";

export const conditionGroups:{name:string;kinds:ConstraintKind[]}[]=[
  {name:"长度",kinds:["distance","equal","ratio"]},
  {name:"角度",kinds:["vertexAngle","lineAngle","linePlaneAngle","dihedral"]},
  {name:"位置关系",kinds:["parallel","perpendicular","collinear","coplanar","onSegment","division"]},
  {name:"平面图形",kinds:["parallelogram","rectangle","rhombus","square","regularPolygon"]},
  {name:"几何体",kinds:["prism","pyramid","frustum","cube"]},
];
export const conditionFields:Record<ConstraintKind,{label:string;placeholder:string}[]>={
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
  prism:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
  frustum:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
  pyramid:[{label:"顶点",placeholder:"P"},{label:"底面顶点（按顺序）",placeholder:"ABCD"}],
  cube:[{label:"底面顶点（按顺序）",placeholder:"ABCD"},{label:"对应的顶面顶点",placeholder:"A_1 B_1 C_1 D_1"}],
};
export function formConditionSource(kind:ConstraintKind,fields:string[],names:string[],value:string,mode:AngleMode,range:"both"|"acute"|"obtuse") {
  const groups=conditionFields[kind].map((_,i)=>entity(fields[i]??"",names));
  if(kind==="vertexAngle"&&groups[0].length!==3)throw new Error("请填写三个点，如 ABC，B 为角的顶点");
  const refs=kind==="vertexAngle"?groups[0].join(","):groups.map(g=>g.join(" ")).join(",");
  if(angleKinds.includes(kind))return angleSource(kind,refs,value,mode,range);
  return `${kind}(${refs}${["distance","ratio","division"].includes(kind)?`, ${value}`:""})`;
}
