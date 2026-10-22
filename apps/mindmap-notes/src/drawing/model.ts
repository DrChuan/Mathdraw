import { definitionInput, annotationArgument } from "./input";
import { locusDomain, dependsOn } from "./locus";
import { tangentCandidates } from "./advanced";
import {
  defaultStyle,
  originPoint,
  type DrawingDocument,
  type GeometryObject,
  type DrawingPoint,
  type DrawingSolid,
  type DrawingCurve,
  type Vec3,
  type DrawingPlaneSource,
} from "./types";
import {
  validateDrawing,
  invalidateGeometry,
  resolveGeometry,
  pointObject,
  fromPlane,
  dependencies, toPlane,
} from "./geometry";
import { equation, isLineEquation } from "./expression";
import { compactPresetEquation } from "./curves";
import { finiteScalar, numericReferences, renderReferences, replaceCoordinates, expressionNames } from "./parameters";
import { numericSource, numericFunctions, isVariableSymbol } from "./symbols";
import { axisId, axisReference } from "./axes";
import { conicFoci, circleCenter } from "./conics";
import { exactNumber } from "./exactNumber";
import { groupClosedFaces } from "./polyhedra";
import { foldPolygon } from "./fold";
const reserved = new Set([
  "x",
  "y",
  "z",
  "u",
  "v",
  "e",
  "pi",
  "sin",
  "cos",
  "tan",
  "sqrt",
  "ln",
  "log",
  "exp",
  "abs",
  "asin", "acos", "atan", "log10", "floor", "ceil", "sign", "min", "max",
]);
export const validSymbol = (s: string) =>
  /^[A-Za-z][A-Za-z0-9_]*$/.test(s) && !reserved.has(s.toLowerCase());
export function nextSymbol(
  doc: DrawingDocument,
  kind: GeometryObject["kind"],
  extra: string[] = [],
): string {
  const used = new Set([...doc.objects.map((o) => o.symbol), ...extra]);
  const prefix =
    kind === "point"
      ? "A"
      : kind === "curve"
        ? "c"
        : kind === "segment"
          ? "s"
          : kind === "line"
            ? "l"
            : kind === "vector"
              ? "vec"
              : kind === "solid"
                ? "S"
                : kind === "label"
                  ? "text"
                  : kind === "number" ? "a" : "p";
  if (kind === "point")
    for (let i = 0; i < 26; i++) {
      const n = String.fromCharCode(65 + i);
      if (!used.has(n) && validSymbol(n)) return n;
    }
  let n = 1,
    candidate = prefix;
  while (used.has(candidate) || !validSymbol(candidate))
    candidate = prefix + n++;
  return candidate;
}
export function normalizeDrawing(input: DrawingDocument): DrawingDocument {
  const doc = groupClosedFaces(structuredClone(input));
  if(doc.coordinateOriginId&&!doc.objects.some(o=>o.id===doc.coordinateOriginId!.split(":")[0]))delete doc.coordinateOriginId;
  validateDrawing(doc);
  doc.schemaVersion = 3;
  if (!doc.coordinateOriginId&&!doc.objects.some(o => o.kind === "point" && o.construction.type === "origin")) {
    const origin = originPoint();
    let originId = "__coordinate_origin__", suffix = 1;
    while (doc.objects.some(o => o.id === originId)) originId = `__coordinate_origin_${suffix++}__`;
    origin.id = originId;
    if (doc.objects.some(o => o.symbol === "O")) {
      let n = 1; while (doc.objects.some(o => o.symbol === `O_${n}`)) n++;
      origin.symbol = `O_${n}`;
    }
    doc.objects.unshift(origin);
  }
  // Construction handles stay private and are collected when their result is replaced/deleted.
  for(let pass=0;pass<128;pass++) {
    const usedIds=new Set([...doc.objects.flatMap(dependencies),...(doc.coordinateOriginId?[doc.coordinateOriginId.split(":")[0]]:[])]),before=doc.objects.length;
    doc.objects=doc.objects.filter(o=>!o.auxiliary||usedIds.has(o.id));
    if(before===doc.objects.length)break;
  }
  const used: string[] = [];
  for (const obj of doc.objects) {
    // Legacy origins disabled the point label and relied on the axis renderer.
    // The new dot preference also marks conversion to ordinary point labeling.
    if(obj.kind === "point" && obj.construction.type === "origin" && obj.dot === undefined) {
      obj.showName=true;obj.dot="auto";
    }
    if (obj.symbol && !validSymbol(obj.symbol))
      throw new Error(`符号 ${obj.symbol} 无效或已保留`);
    if (!obj.symbol) {
      obj.symbol =
        validSymbol(obj.name) &&
        !used.includes(obj.name) &&
        !doc.objects.some((o) => o.id !== obj.id && o.symbol === obj.name)
          ? obj.name
          : nextSymbol(
              { ...doc, objects: doc.objects.filter((o) => o.id !== obj.id) },
              obj.kind,
              used,
            );
    }
    if (obj.kind === "point" && obj.name === "新点") obj.name = obj.symbol!;
    if (obj.kind === "curve" && obj.preset) obj.equation = compactPresetEquation(obj);
    used.push(obj.symbol!);
  }
  // Earlier intersection batches all used the display name I despite distinct symbols.
  const legacyIntersections = doc.objects.filter(o => o.kind === "point" &&
    o.construction.type === "intersection" && o.name === "I");
  if (legacyIntersections.length > 1)
    for (const point of legacyIntersections) point.name = point.symbol!;
  const geometry = resolveGeometry(doc);
  for (const curve of geometry.curves.values()) {
    if (!curve.autoFoci) continue;
    if (circleCenter(curve.equation)) {
      const legacy = doc.objects.filter((o): o is DrawingPoint => o.kind === "point" &&
        o.construction.type === "focus" && o.construction.curve === curve.id);
      const existingCenter = curve.circle && ["centerPoint","centerRadius"].includes(curve.circle.type)
        ? doc.objects.find(o => o.id === curve.circle!.points[0] && o.kind === "point") as DrawingPoint | undefined : undefined;
      let center = existingCenter ?? doc.objects.find((o): o is DrawingPoint => o.kind === "point" &&
        o.construction.type === "curveCenter" && o.construction.curve === curve.id) ?? legacy[0];
      const centerSymbol = () => {
        let symbol = "C", n=1;
        while (doc.objects.some(o => o.id !== center?.id && o.symbol === symbol)) symbol = `C_${n++}`;
        return symbol;
      };
      if (!center) {
        center = pointObject(centerSymbol(),[0,0,0]); center.id = `${curve.id}-center`;
        let suffix=1; while (doc.objects.some(o => o.id === center!.id)) center.id = `${curve.id}-center-${suffix++}`;
        center.symbol = center.name; doc.objects.push(center);
      }
      if (!existingCenter) {
        if (center.construction.type === "focus") { center.symbol=centerSymbol(); center.name=center.symbol; }
        center.construction = { type: "curveCenter", curve: curve.id };
      }
      for (const old of legacy) {
        if (old.id === center.id) continue;
        if (doc.objects.some(o => o.id !== old.id && dependencies(o).includes(old.id))) {
          old.construction = { type: "alias", point: center.id }; old.hidden = true;
          let n=1; while (doc.objects.some(o => o.id !== old.id && o.symbol === `C_${n}`)) n++;
          old.symbol = `C_${n}`; old.name = old.symbol;
        } else doc.objects = doc.objects.filter(o => o.id !== old.id);
      }
      continue;
    }
    const foci = conicFoci(curve.equation, curve.preset);
    if (!foci) continue;
    for (let index = 0; index < foci.length; index++) {
      if (doc.objects.some(o => o.kind === "point" && o.construction.type === "focus" &&
        o.construction.curve === curve.id && o.construction.index === index)) continue;
      let symbol = foci.length === 1 ? "F" : `F_${index + 1}`;
      if (doc.objects.some(o => o.symbol === symbol)) {
        let n = 1; while (doc.objects.some(o => o.symbol === `F_${n}`)) n++;
        symbol = `F_${n}`;
      }
      const point = pointObject(symbol, [0,0,0]);
      let focusId = `${curve.id}-focus-${index}`, suffix = 1;
      while (doc.objects.some(o => o.id === focusId)) focusId = `${curve.id}-focus-${index}-${suffix++}`;
      point.id = focusId;
      point.symbol = symbol; point.construction = { type: "focus", curve: curve.id, index };
      if (foci.length === 2 && Math.hypot(foci[0][0]-foci[1][0],foci[0][1]-foci[1][1]) < 1e-8)
        point.labelOffset = index === 0 ? [-30,-12] : [9,-12];
      doc.objects.push(point);
    }
  }
  validateDrawing(doc);
  invalidateGeometry(doc);
  return doc;
}
export function splitArguments(text: string): string[] {
  let depth = 0,
    start = 0,
    quoted = false;
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"' && (()=>{let n=0,j=i;while(j>0&&text[--j]==="\\")n++;return n%2===0;})()) {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if ("({[".includes(text[i])) depth++;
    else if (")}]".includes(text[i])) depth--;
    else if ((text[i] === "," || text[i] === "，") && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
    if (depth < 0) throw new Error("括号不匹配");
  }
  if (depth !== 0 || quoted) throw new Error("括号或引号未闭合");
  out.push(text.slice(start).trim());
  return out;
}
const fmt = (n: number) => Number(n.toFixed(8)).toString();
export function referenceName(doc: DrawingDocument, id: string): string {
  const axis=axisReference(id);
  if(axis) return axis.planeId ? `Axis("${axis.axis}",${JSON.stringify(axis.planeId)})` : `${axis.axis}Axis`;
  const obj = doc.objects.find((o) => o.id === id);
  if (obj) return obj.symbol ?? obj.name;
  const match = id.match(/^([^:]+):(v|e):(\d+)$/);
  if (match)
    return `${referenceName(doc, match[1])}.${match[2] === "v" ? "vertex" : "edge"}(${Number(match[3]) + 1})`;
  return id;
}
export function definition(doc: DrawingDocument, obj: GeometryObject): string {
  const ref = (id: string) => referenceName(doc, id),
    symbol = obj.symbol ?? obj.name;
  if(obj.kind === "solutionSet")return `${symbol} = ConstraintSet(${obj.problem.points.join(", ")})`;
  if(obj.kind === "spatialLocus")return `${symbol} = SpatialLocus(${ref(obj.set)}, ${JSON.stringify(obj.point)})`;
  if (obj.kind === "number") return `${symbol} = ${renderReferences(doc, obj.expression, obj.references)}`;
  if (obj.parameters) return `${symbol}${obj.kind === "curve" && !obj.circle ? ": " : " = "}${renderReferences(doc, obj.parameters.source, obj.parameters.references)}`;
  let value = "";
  const planeArgs=(p:DrawingPlaneSource):string=>p.type==="points"?p.points.map(ref).join(", "):p.type==="lines"?p.lines.map(ref).join(", "):p.type==="linePoint"?`${ref(p.line)}, ${ref(p.point)}`:p.type==="polygon"?ref(p.polygon):JSON.stringify(p.planeId);
  if (obj.kind === "point") {
    const c = obj.construction;
    if (c.type === "origin") value = "Origin()";
    else if(c.type==="planeOrigin"||c.type==="planeNormal")value=`${c.type==="planeOrigin"?"PlaneOrigin":"NormalEndpoint"}(${planeArgs(c.plane)})`;
    else if(c.type === "constraint")value=`ConstraintPoint(${ref(c.set)}, ${JSON.stringify(c.point)})`;
    else if (c.type === "focus") value = `Focus(${ref(c.curve)}, ${c.index + 1})`;
    else if (c.type === "curveCenter") value = `CircleCenter(${ref(c.curve)})`;
    else if (c.type === "onAxis") value = `AxisPoint("${c.axis}", ${fmt(c.parameter)}${c.planeId ? `, ${JSON.stringify(c.planeId)}` : ""})`;
    else if (c.type === "free") {
      const p = doc.dimension === "2d" ? c.position.slice(0, 2) : c.position;
      value = `(${p.map(n=>exactNumber(n).source).join(", ")})`;
    } else if (c.type === "alias") value = `Point(${ref(c.point)})`;
    else if(c.type === "reflection") value=`Reflect(${ref(c.point)}, ${ref(c.axis)})`;
    else if(c.type === "rotation") value=`Rotate(${ref(c.point)}, ${ref(c.axis)}, ${ref(c.angle)})`;
    else if(c.type === "angleDirection") value=`AngleDirection(${c.points.map(ref).join(", ")})`;
    else if (c.type === "division")
      value =
        c.t === 0.5
          ? `Midpoint(${ref(c.a)}, ${ref(c.b)})`
          : `Divide(${ref(c.a)}, ${ref(c.b)}, ${fmt(c.t)})`;
    else if (c.type === "center")
      value = `${{ centroid: "Centroid", circumcenter: "Circumcenter", orthocenter: "Orthocenter", incenter: "Incenter" }[c.center]}(${c.points.map(ref).join(", ")})`;
    else if (c.type === "intersection")
      value = `Intersect(${ref(c.first)}, ${ref(c.second)}, ${c.branch + 1})`;
    else if (c.type === "curveCoordinate")
      value = `Point${c.axis.toUpperCase()}(${ref(c.curve)}, ${fmt(c.value)}, ${c.branch + 1})`;
    else
      value = `On(${ref(c.path)}, ${c.seed ? `(${c.seed.map(fmt).join(", ")})` : fmt(c.parameter)})`;
  } else if (
    obj.kind === "segment" ||
    obj.kind === "line" ||
    obj.kind === "vector"
  ) {
    if(obj.kind==="vector"&&obj.normalPlane)value=`Normal(${planeArgs(obj.normalPlane)})`;
    else if (obj.relation) {
      const c = obj.relation;
      value =
        c.type === "bisector"
          ? `PerpendicularBisector(${obj.points.map(ref).join(", ")})`
          : `${c.type === "parallel" ? "Parallel" : "Perpendicular"}(${ref(c.reference!)}, ${ref(obj.points[0])})`;
    } else
      value = `${obj.kind === "segment" ? "Segment" : obj.kind === "vector" ? "Vector" : obj.ray ? "Ray" : "Line"}(${obj.points.map(ref).join(", ")})`;
  } else if (obj.kind === "polygon" || obj.kind === "triangle")
    value = obj.kind==="polygon"&&obj.fold?`Fold(${ref(obj.fold.source)}, ${ref(obj.fold.axis)}, ${ref(obj.fold.angle)})`:obj.kind==="polygon"&&obj.section?`Section(${ref(obj.section.solid)}, ${planeArgs(obj.section.plane)})`:`${obj.kind === "polygon" ? "Polygon" : "Triangle"}(${obj.points.map(ref).join(", ")})`;
  else if (obj.kind === "curve") {
    if(obj.derived) {
      const c=obj.derived;
      value=c.type === "reflection" ? `Reflect(${ref(c.source)}, ${ref(c.axis)})` : c.type === "tangent" ? `Tangent(${ref(c.curve)}, ${ref(c.point)}, ${c.branch+1})` : `Locus(${ref(c.driver)}, ${ref(c.follower)}, ${fmt(c.min)}, ${fmt(c.max)})`;
    } else if(obj.parametric) value=`Parametric(${obj.parametric.x}, ${obj.parametric.y}, ${fmt(obj.parametric.tMin)}, ${fmt(obj.parametric.tMax)})`;
    else if (obj.circle) {
      const c = obj.circle;
      value = `${c.type === "threePoint" ? "Circle3" : c.type === "incircle" ? "Incircle" : "Circle"}(${c.points.map(ref).join(", ")}${c.type === "centerRadius" ? `, ${fmt(c.radius!)}` : ""})`;
    } else return `${symbol}: ${obj.equation}`;
  } else if (obj.kind === "label")
    value = obj.measurement ? `${{length:"Length",angle:"Angle",area:"Area",perimeter:"Perimeter"}[obj.measurement.type]}(${obj.measurement.references.map(ref).join(", ")})` : `Text(${JSON.stringify(obj.text)}, (${obj.position.map(fmt).join(", ")}))`;
  else if (obj.kind === "solid") {
    const c = obj.construction;
    if (!c)
      value = `${{ cube: "Cube", cuboid: "Cuboid", prism: "RegularPrism", pyramid: "RegularPyramid", frustum: "Frustum", cylinder: "Cylinder", cone: "Cone", coneFrustum: "ConeFrustum", sphere: "Sphere" }[obj.shape]}(${[obj.width, obj.depth, obj.height, obj.radius, obj.topRadius, obj.sides, ...obj.origin, ...obj.rotation].map(fmt).join(", ")})`;
    else if(c.type === "faces")value=`Polyhedron(${c.faces.map(ref).join(", ")})`;
    else
      value =
        c.type === "extrusion"
          ? `Prism(${ref(c.base)}, ${c.vector ? ref(c.vector) : `(${c.direction.map(fmt).join(", ")})`})`
          : c.type === "apex"
            ? `Pyramid(${ref(c.base)}, ${ref(c.apex)})`
            : c.type === "insphere"
              ? `Insphere(${ref(c.source)})`
              : `Circumsphere(${c.source ? ref(c.source) : c.vertices.map(ref).join(", ")})`;
  }
  return `${symbol} = ${value}`;
}
export const commandCatalog = [
  ["Fold", "翻折多边形", "多边形, 旋转轴, 可选角度变量（度）；省略时创建滑块"],
  ["Normal", "平面法向量", "平面多边形，或三个点；留空使用当前工作平面"],
  ["Section", "几何体截面", "几何体，三点 / 两条直线 / 直线与点"],
  ["Reflect", "轴对称", "图形, 对称轴"],
  ["Tangent", "过点切线", "曲线, 点, 可选序号"],
  ["Locus", "轨迹", "主动点, 从动点, 可选起点, 可选终点"],
  ["Length", "长度", "线段 或 两个点"],
  ["Angle", "角度", "点, 顶点, 点"],
  ["Area", "面积", "三角形、多边形或圆"],
  ["Perimeter", "周长", "三角形、多边形或圆"],
  ["AngleBisector", "角平分射线", "点, 顶点, 点"],
  ["AngleBisectorLine", "角平分直线", "点, 顶点, 点"],
  ["AngleDirection", "角平分方向点", "点, 顶点, 点"],
  ["Ray", "射线", "起点, 方向点"],
  ["Circumcircle", "三角形外接圆", "三角形 或 三个点"],
  ["Incircle", "三角形内切圆", "三角形 或 三个点"],
  ["Origin", "坐标原点", ""],
  ["CircleCenter", "圆心", "圆"],
  ["Parametric", "参数曲线", "x(t), y(t), t起点, t终点"],
  ["AxisPoint", "坐标轴上的点", '"x" 或 "y", 参数'],
  ["Focus", "焦点", "圆锥曲线, 序号"],
  ["Point", "引用点", "A"],
  ["Segment", "线段", "A, B"],
  ["Line", "直线", "A, B"],
  ["Vector", "向量", "A, B"],
  ["Triangle", "三角形", "A, B, C"],
  ["Polygon", "多边形", "A, B, C, …"],
  ["Circle", "圆", "圆心, 圆上一点或半径"],
  ["Circle3", "三点圆", "A, B, C"],
  ["Midpoint", "中点", "线段，或 A, B"],
  ["Divide", "等分点", "线段, 等分数，或 A, B, 比例"],
  ["Parallel", "平行线", "参考线, 经过的点"],
  ["Perpendicular", "垂线", "参考线, 经过的点"],
  ["PerpendicularBisector", "垂直平分线", "线段，或 A, B"],
  ["Intersect", "交点", "对象1, 对象2, 可选序号"],
  ["On", "对象上的点", "对象, 参数或局部坐标"],
  ["PointX", "指定横坐标", "曲线, 横坐标, 可选序号"],
  ["PointY", "指定纵坐标", "曲线, 纵坐标, 可选序号"],
  ["Centroid", "重心", "三角形，或三个点"],
  ["Circumcenter", "外心", "三角形，或三个点"],
  ["Orthocenter", "垂心", "三角形，或三个点"],
  ["Incenter", "内心", "三角形，或三个点"],
  ["Prism", "棱柱", "底面, 侧棱向量"],
  ["Pyramid", "棱锥", "底面, 顶点"],
  ["Polyhedron", "闭合多面体", "四个或更多构成闭合外壳的平面多边形"],
  ["Circumsphere", "外接球", "多面体，或四个以上顶点"],
  ["Insphere", "内切球", "多面体"],
  ["Text", "文字", '"内容", (x,y,z)'],
  ["Cube", "正方体", "可选尺寸参数"],
  ["Cuboid", "长方体", "可选尺寸参数"],
  ["RegularPrism", "正棱柱", "可选尺寸参数"],
  ["RegularPyramid", "正棱锥", "可选尺寸参数"],
  ["Frustum", "正棱台", "可选尺寸参数"],
  ["Cylinder", "圆柱", "可选尺寸参数"],
  ["Cone", "圆锥", "可选尺寸参数"],
  ["ConeFrustum", "圆台", "可选尺寸参数"],
  ["Sphere", "球", "可选尺寸参数"],
] as const;
export function resolveReference(doc: DrawingDocument, text: string): string {
  const axisName=text.trim().match(/^([xyz])(?:Axis|轴)$/i);
  if(axisName) return axisId(axisName[1].toLowerCase() as "x"|"y"|"z",doc.view.mode === "plane" ? doc.view.planeId : undefined);
  const axisCall=text.trim().match(/^Axis\("([xyz])",\s*"([^"]+)"\)$/);
  if(axisCall) return axisId(axisCall[1] as "x"|"y"|"z",axisCall[2]);
  const trimmed = text.trim(),
    object = doc.objects.find((o) => o.symbol === trimmed || o.id === trimmed);
  if (object) return object.id;
  const virtual = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_]*)\.(vertex|edge)\((\d+)\)$/,
  );
  if (virtual) {
    const parent = doc.objects.find((o) => o.symbol === virtual[1]);
    if (parent)
      return `${parent.id}:${virtual[2] === "vertex" ? "v" : "e"}:${Number(virtual[3]) - 1}`;
  }
  const matches = doc.objects.filter((o) => o.name === trimmed);
  if (matches.length === 1) return matches[0].id;
  if (/^[^:]+:(?:v|e):\d+$/.test(trimmed)) return trimmed;
  throw new Error(`找不到对象“${trimmed}”，请选择图形或使用补全`);
}
export function solidObject(
  shape: DrawingSolid["shape"] = "cube",
): DrawingSolid {
  return {
    id: crypto.randomUUID(),
    kind: "solid",
    name: "几何体",
    shape,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 3,
    depth: 2,
    height: 3,
    radius: 2,
    topRadius: 1,
    sides: 4,
    style: defaultStyle(),
  };
}
export function intersectionObjects(
  doc: DrawingDocument,
  first: string,
  second: string,
): DrawingPoint[] {
  const positions=resolveGeometry(doc).intersections(first,second);
  if (!positions.length) throw new Error("当前范围内没有交点");
  const used: string[] = [];
  return positions.map((_position,branch):DrawingPoint => {
    const symbol = nextSymbol(doc, "point", used);
    used.push(symbol);
    return { ...pointObject(symbol,[0,0,0]),symbol,
      construction: {type:"intersection",first,second,branch} };
  });
}
/** Compile a definition to an atomic document operation. All references are IDs after this boundary. */
export function applyDefinition(
  input: DrawingDocument,
  source: string,
  replaceId?: string,
): DrawingDocument {
  const doc = normalizeDrawing(input),
    old = doc.objects.find((o) => o.id === replaceId);
  if(old&&(old.kind === "solutionSet"||old.kind === "spatialLocus"||old.kind === "point"&&old.construction.type === "constraint"))
    throw new Error("此对象由条件解集管理，请打开“编辑条件”修改，避免破坏关联");
  let text = definitionInput(source.trim()).replace(/([A-Za-z])_\{([A-Za-z0-9]+)\}/g,"$1_$2 ");
  if (!text) throw new Error("请输入定义");
  let requested: string | undefined;
  const assignment = text.match(
    /^([A-Za-z][A-Za-z0-9_]*)\s*([=:])\s*([\s\S]+)$/,
  );
  if (assignment && !["x", "y", "u", "v"].includes(assignment[1])) {
    requested = assignment[1];
    text = assignment[3];
  }
  if (
    requested &&
    (!validSymbol(requested) ||
      doc.objects.some((o) => o.id !== replaceId && o.symbol === requested))
  )
    throw new Error("符号已被占用或保留，请使用其他符号");
  const initialCall=text.match(/^([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff]*)\s*\(([\s\S]*)\)$/);
  const callName=initialCall ? (commandCatalog.find(c => c[0].toLowerCase() === initialCall[1].toLowerCase() || c[1] === initialCall[1])?.[0] ?? initialCall[1]) : undefined, callArgs=initialCall ? splitArguments(initialCall[2]) : [];
  let pieces:string[]=[];
  if(callName === "Text") pieces=callArgs.slice(1);
  else if(text.includes("=") || text.startsWith("(")) pieces=[text];
  else if(callName === "Parametric") pieces=callArgs;
  else if(callName === "Circle" || callName === "On" || callName === "PointX" || callName === "PointY" || callName === "AxisPoint") pieces=callArgs.slice(1,2);
  else if(callName === "Locus") pieces=callArgs.slice(2);
  else if(callName === "Divide") pieces=callArgs.slice(2);
  else if(callName === "Prism" || callName === "Text") pieces=callArgs.slice(1);
  else if(callName === "Fold") pieces=callArgs.slice(2);
  else if(callName && ["Cube","Cuboid","Sphere","Cone","Cylinder","ConeFrustum","Frustum","RegularPrism","RegularPyramid"].includes(callName)) pieces=callArgs;
  else if(!callName || numericFunctions.has(callName.toLowerCase()) || ["x","y","z"].includes(callName)) pieces=[text];
  const knownNumbers=doc.objects.map(o=>o.symbol!);
  const names=new Set(pieces.flatMap(piece=>expressionNames(numericSource(piece.replace(/\b[xyz]\(\s*[A-Za-z][A-Za-z0-9_]*\s*\)/g,"0").replace(/"[^\"]*"/g,""),knownNumbers))));
  for(const name of names) if(isVariableSymbol(name) && !(callName === "Parametric" && name === "t") &&
    !doc.objects.some(o=>o.symbol === name) && name !== requested) {
    doc.objects.push({id:crypto.randomUUID(),kind:"number",name,symbol:name,expression:"1",references:{},value:1,
      slider:{min:-5,max:5,step:.1},style:defaultStyle()});
  }
  const geometry = resolveGeometry(doc),
    plane = doc.planes.find((p) => p.id === doc.view.planeId)!;
  const references: Record<string,string> = {}, fields: NonNullable<GeometryObject["parameters"]>["fields"] = {};
  const bind = (s: string) => { Object.assign(references, numericReferences(doc,s)); };
  const scope = Object.fromEntries(doc.objects.filter(o => o.kind === "number" && o.symbol && geometry.numbers.has(o.id))
    .map(o => [o.symbol!, geometry.numbers.get(o.id)!]));
  const scalar = (s: string, path?: string): number => {
    const refs = numericReferences(doc,s); bind(s);
    if (path && Object.keys(refs).length) fields[path] = s;
    return finiteScalar(replaceCoordinates(doc,s,refs,id=>{
      const point=geometry.points.get(id); if(!point) throw new Error("引用的点暂时失效"); return point.p;
    }), scope);
  };
  const ref = (s: string) => {
    const id = resolveReference(doc, s), root = s.trim().match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0];
    if (root && doc.objects.some(o => o.symbol === root)) references[root] = id.split(":")[0];
    return id;
  },
    point = (s: string) => {
      const id = ref(s);
      if (!geometry.points.has(id)) throw new Error(`“${s}”不是有效点`);
      return id;
    };
  const tuple = (s: string, path: string, direction = false): Vec3 => {
    const args = splitArguments(s.trim().replace(/^\(|\)$/g, "")),
      values = args.map(s => scalar(s));
    if (args.some(s => Object.keys(numericReferences(doc,s)).length)) fields[path] = {
      coordinates: args, planeId: args.length === 2 ? plane.id : undefined, direction,
    };
    if (values.length === 2) {
      const result = fromPlane(plane, values[0], values[1]);
      return direction ? result.map((v,i) => v - plane.origin[i]) as Vec3 : result;
    }
    if (values.length === 3) return values as Vec3;
    throw new Error("坐标需要两个或三个数值");
  };
  const ends = (s: string): [string, string] => {
    const id = ref(s),
      edge = geometry.edges.find((e) => e.id === id);
    if (!edge || geometry.objects.get(edge.owner)?.kind === "line")
      throw new Error("请选择线段、向量或多边形的一条边；直线没有端点");
    return [edge.a, edge.b];
  };
  const argsPoint = (args: string[], count?: number) => {
    if (count && args.length !== count) throw new Error(`需要 ${count} 个点`);
    return args.map(point);
  };
  const planeSource=(args:string[]):DrawingPlaneSource=>{
    if(args.length===0)return {type:"workplane",planeId:plane.id};
    if(args.length===1) {
      if(/^"/.test(args[0])) {const id=annotationArgument(args[0]);if(!doc.planes.some(p=>p.id===id))throw new Error("工作平面不存在");return {type:"workplane",planeId:id};}
      const id=ref(args[0]),o=geometry.objects.get(id);if(o?.kind!=="polygon"&&o?.kind!=="triangle")throw new Error("请选择平面多边形，或提供三个点");return {type:"polygon",polygon:id};
    }
    if(args.length===3)return {type:"points",points:argsPoint(args,3) as [string,string,string]};
    if(args.length===2) {
      const ids=args.map(ref),isPoint=ids.map(id=>geometry.points.has(id));
      if(isPoint.every(p=>!p))return {type:"lines",lines:ids as [string,string]};
      if(isPoint.filter(Boolean).length===1)return {type:"linePoint",point:ids[isPoint[0]?0:1],line:ids[isPoint[0]?1:0]};
    }
    throw new Error("用三个点、两条共面直线，或直线与线外一点确定平面");
  };
  let objects: GeometryObject[] = [];
  const makePoint = (
    construction: DrawingPoint["construction"],
  ): DrawingPoint => ({ ...pointObject("新点", [0, 0, 0]), construction });
  const makeCurve = (): DrawingCurve => ({
    id: crypto.randomUUID(),
    kind: "curve",
    name: "曲线",
    planeId: plane.id,
    equation: "x^2+y^2=1",
    autoFoci: true,
    range: [-5, 5, -5, 5],
    followView: true,
    style: defaultStyle(),
  });
  const call = text.match(
    /^([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff]*)\s*\(([\s\S]*)\)$/,
  );
  let numericValue: number | undefined;
  if (!text.includes("=") && assignment?.[2] !== ":" && !(text.startsWith("(") && text.endsWith(")") && splitArguments(text.slice(1,-1)).length >= 2)) {
    try { numericValue = scalar(text); } catch { /* geometric definition */ }
  }
  if (numericValue !== undefined) {
    if(requested && !isVariableSymbol(requested) && old?.kind !== "number") throw new Error("变量名使用单个字母，可附加任意长度下标，如 k、a_123");
    objects = [{ id: crypto.randomUUID(), kind: "number", name: requested ?? "数值", expression: text,
      references: numericReferences(doc,text), value: numericValue,
      slider: old?.kind === "number" ? { ...old.slider, min: Math.min(old.slider.min,Math.floor(numericValue)), max: Math.max(old.slider.max,Math.ceil(numericValue)) }
        : { min: Math.min(-5, Math.floor(numericValue)), max: Math.max(5, Math.ceil(numericValue)), step: .1 },
      style: defaultStyle() }];
  } else
  if (text.startsWith("(") && text.endsWith(")")) {
    const parts = splitArguments(text.slice(1, -1));
    let index = -1;
    if (parts.length === 2)
      index = parts.findIndex((x) =>
        doc.objects.some(
          (o) => o.kind === "curve" && (o.symbol === x || o.name === x),
        ),
      );
    if (index >= 0) {
      const id = ref(parts[index]);
      objects = Array.from({ length: 100 }, (_, branch) =>
        makePoint({
          type: "curveCoordinate",
          curve: id,
          axis: index === 1 ? "x" : "y",
          value: scalar(parts[1 - index], "construction.value"),
          branch,
        }),
      );
      const resolved = resolveGeometry({
        ...doc,
        objects: [...doc.objects, ...objects],
      });
      objects = objects.filter((o) => resolved.points.has(o.id));
      if (!objects.length) throw new Error("该坐标没有对应点");
    } else objects = [pointObject("新点", tuple(text, "construction.position"))];
  } else if (call) {
    const entry = commandCatalog.find(
      (c) => c[0].toLowerCase() === call[1].toLowerCase() || c[1] === call[1],
    );
    if (!entry) throw new Error(`未知构造 ${call[1]}`);
    const name = entry[0],
      args = call[2].trim() ? splitArguments(call[2]) : [];
    const count = (n: number) => {
      if (args.length !== n)
        throw new Error(`${entry[1]}需要 ${n} 个参数：${entry[2]}`);
    };
    if(name==="Fold") {
      if(args.length<2||args.length>3)throw new Error("翻折需要多边形、旋转轴和可选角度变量");
      const source=ref(args[0]),axis=ref(args[1]),polygon=geometry.objects.get(source);
      if(polygon?.kind!=="polygon"&&polygon?.kind!=="triangle")throw new Error("请选择多边形或三角形");
      const next=normalizeDrawing(foldPolygon(doc,source,axis,args[2]?ref(args[2]):undefined,polygon.points,id=>geometry.points.get(id)!.p,geometry.straightReference(axis),old?.id,requested));
      const folded=next.objects.find(o=>o.kind==="polygon"&&o.fold?.source===source&&!o.hidden&&(!old||o.id===old.id))!;
      const resolved=resolveGeometry(next);if(resolved.errors.has(folded.id))throw new Error(resolved.errors.get(folded.id));return next;
    } else if(name==="Normal") {
      const source=planeSource(args),a={...makePoint({type:"planeOrigin",plane:source}),hidden:true,auxiliary:true},b={...makePoint({type:"planeNormal",plane:source}),hidden:true,auxiliary:true};
      objects=[{id:crypto.randomUUID(),kind:"vector",name:"法向量",points:[a.id,b.id],normalPlane:source,style:defaultStyle()},a,b];
    } else if(name==="Section") {
      if(args.length<3||args.length>4)throw new Error("先指定几何体，再提供三个点、两直线或直线与点");
      const solid=ref(args[0]);if(geometry.objects.get(solid)?.kind!=="solid")throw new Error("请选择要截取的几何体");
      objects=[{id:crypto.randomUUID(),kind:"polygon",name:"截面",points:[],section:{solid,plane:planeSource(args.slice(1))},style:{...defaultStyle(),color:"#bd6d3f"}}];
    } else if(name === "Locus") {
      if(args.length!==2&&args.length!==4)throw new Error("轨迹需要主动点、从动点，以及可选扫描起止值");
      const driver=point(args[0]),follower=point(args[1]);
      if(!dependsOn(doc,follower,driver))throw new Error("从动点必须通过构造依赖主动点，不能是无关的自由点");
      const range=locusDomain(doc,driver),min=args[2]?scalar(args[2]):range[0],max=args[3]?scalar(args[3]):range[1];
      if(min>=max)throw new Error("扫描起点必须小于终点");
      objects=[{...makeCurve(),name:"轨迹",autoFoci:false,derived:{type:"locus",driver,follower,min,max},equation:"0",style:{...defaultStyle(),color:"#6955a5"}}];
    } else if(name === "Tangent") {
      if(args.length!==2&&args.length!==3)throw new Error("切线需要曲线、经过的点和可选序号");
      const curve=ref(args[0]),p=point(args[1]),original=geometry.curves.get(curve);
      if(!original)throw new Error("请选择曲线");
      const candidates=tangentCandidates(original,toPlane(plane,geometry.points.get(p)!.p));
      if(!candidates.length)throw new Error("没有实切线；圆内部的点不能向圆作切线");
      objects=candidates.slice(0,32).map((_c,i)=>({...makeCurve(),name:"切线",autoFoci:false,planeId:original.planeId,equation:"0",derived:{type:"tangent" as const,curve,point:p,branch:i}}));
      if(args[2])objects=objects.filter((_o,i)=>i===scalar(args[2])-1);
      if(!objects.length)throw new Error("没有该序号的切线");
    } else if(name === "Reflect") {
      count(2);const id=ref(args[0]),axis=ref(args[1]),source=geometry.objects.get(id),edge=geometry.edges.find(e=>e.id===axis);
      if(!edge && !((geometry.curves.get(axis) && !geometry.curves.get(axis)!.parametric && isLineEquation(geometry.curves.get(axis)!.equation))))throw new Error("请选择直线、坐标轴或直边作为对称轴");
      const reflect=(id:string)=>makePoint({type:"reflection",point:id,axis});
      if(geometry.points.has(id))objects=[reflect(id)];
      else if(source?.kind === "curve")objects=[{...makeCurve(),name:"对称曲线",autoFoci:false,planeId:source.planeId,derived:{type:"reflection",source:id,axis},style:{...source.style}}];
      else {
        const originalEdge=geometry.edges.find(e=>e.id===id);
        const ids=source?.kind==="triangle"||source?.kind==="polygon"?source.points : originalEdge?[originalEdge.a,originalEdge.b]:undefined;
        if(!ids)throw new Error("请选择点、线、圆、曲线、三角形或多边形");
        const helpers=ids.map(p=>({...reflect(p),hidden:true,auxiliary:true})),points=helpers.map(p=>p.id);
        const target={id:crypto.randomUUID(),kind:source?.kind??"segment",name:"对称图形",points,style:{...(source?.style??defaultStyle())},...(source&&"ray" in source?{ray:source.ray}:{})} as GeometryObject;
        if(!["line","segment","vector","triangle","polygon"].includes(target.kind))throw new Error("当前对象不支持轴对称");
        objects=[target,...helpers];
      }
    } else if(["Length","Angle","Area","Perimeter"].includes(name)) {
      if(name === "Angle")count(3);else if(name !== "Length")count(1);else if(args.length!==1&&args.length!==2)throw new Error("长度需要一条线段或两个点");
      const refs=name === "Angle"||args.length===2?args.map(point):[ref(args[0])];
      objects=[{id:crypto.randomUUID(),kind:"label",name:entry[1],text:"度量",position:[.15,.15,0],style:{...defaultStyle(),italic:false},measurement:{type:name.toLowerCase() as "length",references:refs,planeId:plane.id}}];
    } else if(name === "AngleBisector"||name === "AngleBisectorLine"||name === "AngleDirection") {
      count(3);const ps=argsPoint(args,3) as [string,string,string],helper=makePoint({type:"angleDirection",points:ps});
      if(name === "AngleDirection")objects=[helper];
      else objects=[{id:crypto.randomUUID(),kind:"line",name:entry[1],points:[ps[1],helper.id],ray:name === "AngleBisector",style:defaultStyle()}, {...helper,hidden:true,auxiliary:true}];
    } else if(name === "Circumcircle"||name === "Incircle") {
      const target=args.length===1?doc.objects.find(o=>o.id===ref(args[0])):undefined;
      const ps=target?.kind==="triangle"?target.points:argsPoint(args,3);
      objects=[{...makeCurve(),name:entry[1],circle:{type:name === "Incircle"?"incircle":"threePoint",points:ps}}];
    } else if (name === "Parametric") {
      count(4); const curve=makeCurve();
      bind(args[0]);bind(args[1]);
      const parse=(s:string)=>replaceCoordinates(doc,s,references,id=>geometry.points.get(id)!.p);
      equation(`y=${parse(args[0])}`, ["t",...Object.keys(scope)]); equation(`y=${parse(args[1])}`,["t",...Object.keys(scope)]);
      curve.parametric={x:args[0],y:args[1],tMin:scalar(args[2],"parametric.tMin"),tMax:scalar(args[3],"parametric.tMax")};
      if(curve.parametric.tMin>=curve.parametric.tMax) throw new Error("参数起点必须小于终点");
      curve.equation="0";curve.name="参数曲线";curve.autoFoci=false;
      if(Object.keys(numericReferences(doc,args[0])).length) fields["parametric.x"]=args[0];
      if(Object.keys(numericReferences(doc,args[1])).length) fields["parametric.y"]=args[1];
      objects=[curve];
    } else if (name === "Origin") {
      count(0); const origin = doc.objects.find(o => o.kind === "point" && o.construction.type === "origin")!;
      if(!origin)throw new Error(`当前原点由 ${doc.coordinateOriginId?referenceName(doc,doc.coordinateOriginId):"现有坐标系"} 表示，可直接引用该点`);
      if (old?.id !== origin.id) throw new Error("原点已经存在，可直接引用 O");
      objects = [origin];
    } else if (name === "AxisPoint") {
      if (args.length !== 2 && args.length !== 3) throw new Error("坐标轴点需要方向和坐标值");
      const axis = args[0].replace(/^["']|["']$/g, "");
      if (!["x","y","z"].includes(axis)) throw new Error("请选择 x、y 或 z 轴");
      const planeId = args[2] ? JSON.parse(args[2]) : doc.view.mode === "plane" ? plane.id : undefined;
      objects = [makePoint({ type: "onAxis", axis: axis as "x"|"y"|"z", parameter: scalar(args[1],"construction.parameter"), planeId })];
    } else if (name === "CircleCenter") {
      count(1); objects = [makePoint({ type: "curveCenter", curve: ref(args[0]) })];
    } else if (name === "Focus") {
      if (Object.keys(numericReferences(doc,args[1] ?? "")).length) throw new Error("焦点序号需为固定整数");
      count(2); objects = [makePoint({ type: "focus", curve: ref(args[0]), index: scalar(args[1]) - 1 })];
    } else if (["Segment", "Line", "Ray", "Vector", "Triangle", "Polygon"].includes(name)) {
      if (name === "Polygon") {
        if (args.length < 3) throw new Error("多边形至少需要三个点");
      } else count(name === "Triangle" ? 3 : 2);
      objects = [
        {
          id: crypto.randomUUID(),
          kind: name === "Ray" ? "line" : name.toLowerCase(),
          ...(name === "Ray" ? {ray:true} : {}),
          name: entry[1],
          points: argsPoint(args),
          style: defaultStyle(),
        } as GeometryObject,
      ];
    } else if (name === "Point") {
      count(1);
      objects = [makePoint({ type: "alias", point: point(args[0]) })];
    } else if (name === "Circle" || name === "Circle3") {
      count(name === "Circle3" ? 3 : 2);
      const c = makeCurve();
      if (name === "Circle3")
        c.circle = { type: "threePoint", points: argsPoint(args, 3) };
      else {
        const center = point(args[0]);
        let second: string | undefined;
        try {
          second = point(args[1]);
        } catch {}
        c.circle = second
          ? { type: "centerPoint", points: [center, second] }
          : { type: "centerRadius", points: [center], radius: scalar(args[1], "circle.radius") };
      }
      c.name = "圆";
      objects = [c];
    } else if (name === "Midpoint" || name === "Divide") {
      const ids =
        args.length === (name === "Midpoint" ? 1 : 2)
          ? ends(args[0])
          : argsPoint(args.slice(0, 2), 2);
      if (name === "Midpoint") {
        if (args.length !== 1 && args.length !== 2)
          throw new Error("中点需要一条边或两个点");
        objects = [
          makePoint({ type: "division", a: ids[0], b: ids[1], t: 0.5 }),
        ];
      } else if (args.length === 2) {
        if (Object.keys(numericReferences(doc,args[1])).length) throw new Error("等分数需为固定整数，可用 Divide(A,B,m) 调整分点比例");
        const n = scalar(args[1]);
        if (!Number.isInteger(n) || n < 2 || n > 1000)
          throw new Error("等分数须为 2～1000 的整数");
        objects = Array.from({ length: n - 1 }, (_, i) =>
          makePoint({ type: "division", a: ids[0], b: ids[1], t: (i + 1) / n }),
        );
      } else {
        count(3);
        objects = [
          makePoint({
            type: "division",
            a: ids[0],
            b: ids[1],
            t: scalar(args[2], "construction.t"),
          }),
        ];
      }
    } else if (
      ["Centroid", "Circumcenter", "Orthocenter", "Incenter"].includes(name)
    ) {
      const target =
        args.length === 1
          ? doc.objects.find((o) => o.id === ref(args[0]))
          : undefined;
      const ps =
        target?.kind === "triangle"
          ? target.points
          : (argsPoint(args, 3) as [string, string, string]);
      objects = [
        makePoint({
          type: "center",
          points: ps,
          center: name.toLowerCase() as "centroid",
        }),
      ];
    } else if (
      name === "Parallel" ||
      name === "Perpendicular" ||
      name === "PerpendicularBisector"
    ) {
      const bis = name === "PerpendicularBisector";
      if (!bis) count(2);
      const ps: [string, string] = bis
        ? args.length === 1
          ? ends(args[0])
          : (argsPoint(args, 2) as [string, string])
        : [point(args[1]), point(args[1])];
      objects = [
        {
          id: crypto.randomUUID(),
          kind: "line",
          name: entry[1],
          points: ps,
          relation: {
            type: bis
              ? "bisector"
              : name === "Parallel"
                ? "parallel"
                : "perpendicular",
            reference: bis ? undefined : ref(args[0]),
            planeId: plane.id,
          },
          style: defaultStyle(),
        },
      ];
    } else if (name === "Intersect") {
      if (args.length < 2 || args.length > 3)
        throw new Error("交点需要两个对象和可选序号");
      objects = intersectionObjects(doc, ref(args[0]), ref(args[1]));
      if (args[2]) {
        if (Object.keys(numericReferences(doc,args[2])).length) throw new Error("交点序号需为固定整数");
        const branch = scalar(args[2]) - 1;
        objects = objects.filter(
          (o) =>
            o.kind === "point" &&
            o.construction.type === "intersection" &&
            o.construction.branch === branch,
        );
        if (!objects.length) throw new Error("没有该序号的交点");
      }
    } else if (name === "PointX" || name === "PointY") {
      if (args.length < 2 || args.length > 3)
        throw new Error("请输入曲线、坐标和可选序号");
      const c = ref(args[0]);
      objects = Array.from({ length: 100 }, (_, branch) =>
        makePoint({
          type: "curveCoordinate",
          curve: c,
          axis: name === "PointX" ? "x" : "y",
          value: scalar(args[1], "construction.value"),
          branch,
        }),
      );
      const result = resolveGeometry({
        ...doc,
        objects: [...doc.objects, ...objects],
      });
      objects = objects.filter((o) => result.points.has(o.id));
      if (args[2])
        if (Object.keys(numericReferences(doc,args[2])).length) throw new Error("曲线分支序号需为固定整数");
      if (args[2])
        objects = objects.filter(
          (o) =>
            o.kind === "point" &&
            o.construction.type === "curveCoordinate" &&
            o.construction.branch === scalar(args[2]) - 1,
        );
      if (!objects.length) throw new Error("没有对应的曲线点");
    } else if (name === "On") {
      count(2);
      const path = ref(args[0]),
        seed = args[1].startsWith("(")
          ? splitArguments(args[1].slice(1, -1)).map(s => scalar(s))
          : undefined;
      if (seed && seed.length !== 2)
        throw new Error("隐式曲线位置需要局部坐标 (u,v)");
      if (seed && Object.keys(numericReferences(doc,args[1])).length)
        fields["construction.seed"] = { coordinates: splitArguments(args[1].slice(1,-1)) };
      objects = [
        makePoint({
          type: "onPath",
          path,
          parameter: seed ? seed[0] : scalar(args[1], "construction.parameter"),
          seed: seed as [number, number] | undefined,
        }),
      ];
    } else if(name === "Polyhedron") {
      if(args.length<4)throw new Error("闭合多面体至少需要四个面");
      const faces=args.map(ref);
      for(const id of faces){const face=doc.objects.find(o=>o.id===id);if(!face||!["polygon","triangle"].includes(face.kind))throw new Error("多面体需要平面多边形作为面");if(face.body&&face.body!==old?.id)throw new Error("所选面已经属于一个多面体，请编辑该多面体");}
      const solid=solidObject("prism");solid.construction={type:"faces",faces};objects=[solid];
    } else if (name === "Prism" || name === "Pyramid") {
      count(2);
      const s = solidObject(name === "Prism" ? "prism" : "pyramid"),
        base = ref(args[0]);
      const baseObject=doc.objects.find(o=>o.id===base);
      if(baseObject?.kind==="polygon"&&baseObject.section)throw new Error("请使用独立多边形作为底面；截面可继续用作工作平面或构造法向量");
      if (name === "Pyramid")
        s.construction = { type: "apex", base, apex: point(args[1]) };
      else {
        let vector: string | undefined;
        try {
          vector = ref(args[1]);
        } catch {}
        s.construction = {
          type: "extrusion",
          base,
          direction: vector ? [0, 0, 1] : tuple(args[1], "construction.direction", true),
          vector,
        };
      }
      s.name = entry[1];
      objects = [s];
    } else if (name === "Circumsphere" || name === "Insphere") {
      const s = solidObject("sphere");
      if (name === "Insphere") {
        count(1);
        s.construction = { type: "insphere", source: ref(args[0]) };
      } else {
        const one =
          args.length === 1
            ? doc.objects.find((o) => o.id === ref(args[0]))
            : undefined;
        s.construction =
          one?.kind === "solid"
            ? { type: "circumsphere", source: one.id, vertices: [] }
            : { type: "circumsphere", vertices: argsPoint(args) };
      }
      s.name = entry[1];
      objects = [s];
    } else if (name === "Text") {
      count(2);
      const t = annotationArgument(args[0]);
      if (typeof t !== "string") throw new Error("文字需要双引号");
      objects = [
        {
          id: crypto.randomUUID(),
          kind: "label",
          name: "文字",
          text: t,
          position: tuple(args[1], "position"),
          style: defaultStyle(),
        },
      ];
    } else {
      const shapes: Record<string, DrawingSolid["shape"]> = {
        Cube: "cube",
        Cuboid: "cuboid",
        RegularPrism: "prism",
        RegularPyramid: "pyramid",
        Frustum: "frustum",
        Cylinder: "cylinder",
        Cone: "cone",
        ConeFrustum: "coneFrustum",
        Sphere: "sphere",
      };
      const s = solidObject(shapes[name]);
      s.name = entry[1];
      if (args.length > 12) throw new Error("尺寸参数过多");
      const values = args.map(s => scalar(s)),
        keys = [
          "width",
          "depth",
          "height",
          "radius",
          "topRadius",
          "sides",
        ] as const;
      keys.forEach((k, i) => {
        if (values[i] !== undefined) s[k] = scalar(args[i], k);
      });
      args.slice(6).forEach((v,i) => scalar(v, `${i < 3 ? "origin" : "rotation"}.${i % 3}`));
      if (values.length > 6) s.origin = values.slice(6, 9) as Vec3;
      if (values.length > 9) s.rotation = values.slice(9, 12) as Vec3;
      objects = [s];
    }
  } else {
    bind(text);
    equation(replaceCoordinates(doc,text,references,id=>geometry.points.get(id)!.p), Object.keys(scope));
    if (Object.keys(numericReferences(doc,text)).length) fields.equation = text;
    objects = [{ ...makeCurve(), equation: text }];
  }
  if (old?.kind === "point" && old.construction.type === "origin" &&
    !objects.every(o => o.kind === "point" && o.construction.type === "origin"))
    throw new Error("原点由坐标系管理，请通过建立坐标系调整");
  if (Object.keys(fields).length) objects = objects.map(o => {
    let body = text;
    if (o.kind === "point" && o.construction.type === "curveCoordinate") {
      const c = o.construction, source = typeof fields["construction.value"] === "string" ? fields["construction.value"] as string : String(c.value);
      body = `Point${c.axis.toUpperCase()}(${referenceName(doc,c.curve)}, ${source}, ${c.branch+1})`;
    }
    return { ...o, parameters: { source: body, references: { ...references }, fields: structuredClone(fields) } };
  });
  if(objects[0] && ["Reflect","AngleBisector","AngleBisectorLine"].includes(callName??""))objects[0]={...objects[0],parameters:{source:text,references:{...references},fields:{}}};
  if (old && objects.length > 1 && !objects.some(o=>o.auxiliary)) {
    const same = objects.find(
      (o) =>
        o.kind === "point" &&
        old.kind === "point" &&
        JSON.stringify(o.construction) === JSON.stringify(old.construction),
    );
    objects = [same ?? objects[0]];
  }
  const used: string[] = [];
  objects = objects.map((o, i) => {
    let symbol = i === 0 ? (requested ?? old?.symbol) : undefined;
    if(o.auxiliary){let n=1;while(doc.objects.some(p=>p.symbol===`aux_${n}`)||used.includes(`aux_${n}`))n++;symbol=`aux_${n}`;}
    const result = {
      ...o,
      symbol:
        symbol ??
        nextSymbol(
          { ...doc, objects: doc.objects.filter((q) => q.id !== old?.id) },
          o.kind,
          used,
        ),
    };
    used.push(result.symbol!);
    if (result.kind === "point" && (result.name === "新点" ||
      (result.construction.type === "intersection" && o.name === o.symbol)))
      result.name = result.symbol!;
    if (i === 0 && old)
      return {
        ...result,
        id: old.id,
        name: old.name === old.symbol ? result.symbol! : old.name,
        style: old.style,
        hidden: old.hidden,
        locked: old.locked,
        constraintSet: old.constraintSet,
        constraintPointName: old.constraintPointName,
        constraintFace: old.constraintFace,
        body: old.body,
        ...(result.kind === "curve" && old.kind === "curve" ? {limits:old.limits,range:old.range,followView:old.followView} : {}),
        ...(result.kind === "solid" && old.kind === "solid" && old.basis ? {basis:old.basis} : {}),
        ...(result.kind === "line" && old.kind === "line" && result.relation && old.relation ? {relation:{...result.relation,showRightAngle:old.relation.showRightAngle}} : {}),
        ...(result.kind === "label" && old.kind === "label" && result.measurement?.type === "angle" && old.measurement?.type === "angle" ? {
          position:old.position,
          measurement:{...result.measurement,arcRadius:old.measurement.arcRadius,angleName:old.measurement.angleName,angleDisplay:old.measurement.angleDisplay},
        } : {}),
        ...(result.kind === "point" && old.kind === "point"
          ? {
              showName: old.showName,
              dot: old.dot,
              coordinates: old.coordinates,
              labelOffset: old.labelOffset,
            }
          : {}),
      };
    return result;
  });
  const next = normalizeDrawing({
    ...doc,
    objects: old
      ? [...doc.objects.map((o) => (o.id === old.id ? objects[0] : o)),...objects.slice(1)]
      : [...doc.objects, ...objects],
  });
  const resolved = resolveGeometry(next);
  for (const o of objects)
    if (resolved.errors.has(o.id)) throw new Error(resolved.errors.get(o.id));
  return next;
}
export function sourceIds(doc: DrawingDocument, id: string) {
  const obj = doc.objects.find((o) => o.id === id);
  return obj ? [...new Set(dependencies(obj).map((id) => axisReference(id) ? id : id.split(":")[0]))] : [];
}
export function resultText(doc: DrawingDocument, id: string): string {
  const r = resolveGeometry(doc),
    p = r.points.get(id);
  if (r.errors.has(id)) return r.errors.get(id)!;
  if (p)
    return `(${(doc.dimension === "2d" ? p.p.slice(0, 2) : p.p).map(fmt).join(", ")})`;
  return "";
}
