import type {ConstraintKind} from "./types";

export const conditionLabels:Record<ConstraintKind,string>={diameter:"线段是圆的直径",pointLineDistance:"点到直线距离",pointPlaneDistance:"点到平面距离",distance:"长度",equal:"等长",ratio:"长度比",lineAngle:"线线角",vertexAngle:"三点角",
  linePlaneAngle:"线面角",dihedral:"二面角",parallel:"平行",perpendicular:"垂直",collinear:"三点共线",onSegment:"点在线段上",division:"定比分点（默认中点）",
  coplanar:"四点共面",parallelogram:"平行四边形",rectangle:"矩形",rhombus:"菱形",square:"正方形",prism:"棱柱",pyramid:"棱锥",frustum:"棱台",regularPolygon:"正多边形",cube:"正方体",
  scalarEquation:"长度 / 角等式",vectorRelation:"向量线性关系",vectorDot:"向量数量积",convexPolygon:"凸多边形（按顺序）",congruent:"三角形 / 多边形全等",similar:"三角形 / 多边形相似",
  area:"多边形面积",volume:"几何体体积",circumradius:"三角形外接圆半径",concyclic:"若干点共圆",cospherical:"若干点共球",onCurve:"点在曲线上",cylinder:"圆柱",cone:"圆锥",coneFrustum:"圆台",sphere:"球"};
export const conditionExamples:Record<ConstraintKind,string>={diameter:"diameter(AE,O)",pointLineDistance:"pointLineDistance(P,AB)=2",pointPlaneDistance:"pointPlaneDistance(P,ABC)=2",distance:"AB = 3",equal:"AB = CD",ratio:"AB / CD = 2",lineAngle:"angle(AB, CD) = 60",
  vertexAngle:"angle(A, B, C) = 120",linePlaneAngle:"angle(AB, CDE) = 30",dihedral:"dihedral(AB, C, D) = 120",
  parallel:"AB // CD",perpendicular:"AB ⟂ CDE",collinear:"collinear(A, B, C)",onSegment:"onSegment(P, A, B)",
  division:"division(M, AB, 1)",coplanar:"coplanar(A, B, C, D)",parallelogram:"parallelogram(A, B, C, D)",rectangle:"rectangle(A, B, C, D)",rhombus:"rhombus(A, B, C, D)",
  square:"square(A, B, C, D)",prism:"prism(A, B, C, A_1, B_1, C_1)",pyramid:"pyramid(P, A, B, C, D)",frustum:"frustum(A, B, C, A_1, B_1, C_1)",regularPolygon:"regularPolygon(A, B, C, D, E)",cube:"cube(A, B, C, D, E, F, G, H)",
  scalarEquation:"AB+BC=2AC",vectorRelation:"vec(AB)=2*vec(AC)-vec(AD)",vectorDot:"dot(AB,AC)=1/2",convexPolygon:"convexPolygon(A,B,C,D)",congruent:"congruent(ABC,DEF)",similar:"similar(ABCD,EFGH)",
  area:"area(ABCD)=6",volume:"volume(pyramid(P,A,B,C,D))=3",circumradius:"circumradius(ABC)=2",concyclic:"concyclic(A,B,C,D)=2",cospherical:"cospherical(A,B,C,D,E)=3",onCurve:"onCurve(P,c)",cylinder:"cylinder(O,O_1,A)",cone:"cone(O,P,A)",coneFrustum:"coneFrustum(O,O_1,A,B)",sphere:"sphere(O,A)"};
