import { relationDirection } from "./spatial";
import {useConstraintMobility} from './useConstraintMobility';
import { ColorPalette } from "./ColorPalette";
import { useDrawingColors } from "./colors";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import Markdown from "../Markdown";
import { mathPreview } from "./mathPreview";
import {
  PanelLeftClose,
  PanelRightClose,
  Undo2,
  Redo2,
  Maximize,
  MousePointer2,
  Hand,
  HelpCircle,
  X,
} from "lucide-react";
import type {
  DrawingDocument,
  DrawingChange,
  DrawingPoint,
  GeometryObject,
  Vec2,
  Vec3,
  WorkPlane,
} from "./types";
import { defaultStyle } from "./types";
import {
  resolveGeometry,
  affectedObjects,
  project,
  toPlane,
  unprojectOnPlane,
  add,
  sub,
  mul,
  dot,
  cross,
  norm,
  unit,
  pointObject,
  planeFromEquation,
  planeFromPoints,
  frameFromDirections,
  triangleCenter,
  coordinateAxis,
} from "./geometry";
import { scalar, isLineEquation } from "./expression";
import { presetEquation, type CurveResult } from "./curves";
import {
  sceneFor,
  pathData,
  arrowData,
  labelTypography,
  type DrawingScene,
} from "./scene";
import {
  normalizeDrawing,
  applyDefinition,
  nextSymbol,
  referenceName,
  resolveReference,
  solidObject,
  sourceIds,
  splitArguments,
  intersectionObjects,
} from "./model";
import {
  initialTool,
  toolStep, toolTarget, wantsPoint, canSelectPoint,
  acceptPoint,
  rejectLastPoint,
  screenPoint,
  hitTest,
  toolHits,
  snapPoint,
  framePointSnap,
  stagedPoint,
  pointOnPath,
  selectRectangle,
  planeForHit,
  type Tool,
  type ToolState,
  type Hit,
  type Snap,
} from "./interaction";
import { ExpressionPanel, type ExpressionEditor } from "./ExpressionPanel";
import { NumberField, CurveLimits, AngleMeasurementControls } from "./controls";
import { axisReference } from "./axes";
import { ToolBar, toolGroups } from "./ToolBar";
import { insidePlot, plotBounds } from "./viewport";
import ConstraintWorkbench from "./ConstraintWorkbench";
import { applyCoordinateFrame } from "./constraints/rebase";
import { selectedBranch,constraintBinding } from "./constraints/document";
import { useConstraintMotion } from "./useConstraintMotion";
import { createLocusDrag, inverseLocus, type LocusDrag } from "./locusDrag";
import { PathProjectionError } from "./pathProjection";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const editTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest("input,textarea,select,[contenteditable=true]");
interface Props {
  fileActions: ReactNode;
  doc: DrawingDocument;
  scene: DrawingScene;
  curves: CurveResult[];
  size: Vec2;
  ready: boolean;
  fontsReady: boolean;
  pending: boolean;
  canvas: RefObject<HTMLDivElement | null>;
  svg: RefObject<SVGSVGElement | null>;
  flush: RefObject<(() => void) | null>;
  change: DrawingChange;
  historyCount: number;
  redoCount: number;
  undo: () => void;
  redo: () => void;
  mode: (dimension: "2d" | "3d") => void;
  fit: () => void;
  onError: (error: string) => void;
  loadFonts: () => Promise<void>;
  drafts: Record<string, string>;
  expressionPreview: GeometryObject[];
  expressionProblem: string;
  onDrafts: (drafts: Record<string, string>) => void;
}
export default function DrawingWorkbench(props: Props) {
  const {
    doc,
    scene,
    curves,
    size,
    ready,
    fontsReady,
    pending,
    canvas,
    svg,
    onError,
  } = props;
  const docRef = useRef(doc);
  const usedColors = useDrawingColors(doc);
  docRef.current = doc;
  const [state, setState] = useState<ToolState>(initialTool),
    stateRef = useRef(state);
  stateRef.current = state;
  const [selection, setSelection] = useState<string[]>([]),
    selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [hover, setHover] = useState<Hit | null>(null),
    [snap, setSnap] = useState<Snap | null>(null),
    [, setCursor] = useState<Vec2 | null>(null);
  const [left, setLeft] = useState(true),
    [right, setRight] = useState(false),
    [leftWidth, setLeftWidth] = useState(
      () => Number(localStorage.getItem("drawing.expressionWidth")) || 310,
    ),
    [gridSnap, setGridSnap] = useState(false);
  const [dragMode, setDragMode] = useState<"box" | "pan">("box");
  const [dragHint,setDragHint]=useState("");
  const [help, setHelp] = useState(false);
  const [constraintEditor,setConstraintEditor]=useState<string|null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hit?: Hit } | null>(
      null,
    ),
    [candidates, setCandidates] = useState<{
      x: number;
      y: number;
      hits: Hit[];
      q: Vec2;
    } | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null),
    [notice, setNotice] = useState(""),
    [box, setBox] = useState<{ start: Vec2; end: Vec2 } | null>(null);
  const [parameter, setParameter] = useState("3"),
    [parameterError, setParameterError] = useState(""),
    [manualParameter, setManualParameter] = useState(false),
    [zSign, setZSign] = useState<1 | -1>(1);
  const [pendingInput, setPendingInput] = useState<{
    title: string;
    value: string;
    help: string;
    confirm: (value: string) => void;
  } | null>(null);
  const editor = useRef<ExpressionEditor | null>(null),
    draftRef = useRef(props.drafts);
  draftRef.current = props.drafts;
  const geometry = useMemo(() => resolveGeometry(doc), [doc]);
  const object = doc.objects.find((o) => o.id === selection[0]),
    selectedPoint = geometry.points.get(selection[0]),
    edge = geometry.edges.find((e) => e.id === selection[0]);
  const selectedBinding=constraintBinding(doc,selectedPoint?.object);
  const selectedInverse=selectedPoint&&!selectedPoint.object?.locked&&!selectedBinding?inverseLocus(doc,selection[0]):undefined;
  const plane = doc.planes.find((p) => p.id === doc.view.planeId)!;
  const update = useCallback(
    (next: DrawingDocument, history = true, phase?: "continuous" | "complete") => {
      const ok = props.change(next, history, phase);
      if (ok) docRef.current = phase === "continuous" ? next : normalizeDrawing(next);
      return ok;
    },
    [props.change],
  );
  const setToolState = (next: ToolState) => {
    stateRef.current = next;
    setState(next);
  };
  const constraintMotion=useConstraintMotion(docRef,update,onError);
  useConstraintMobility(doc,docRef,update);
  const choose = (tool: Tool) => {
    if(tool==="axes")setZSign(1);
    setDragMode("box");
    editor.current?.flush();
    const next = initialTool(tool);
    if ((tool === "parallel" || tool === "perpendicular") && selectionRef.current.length === 1) {
      const id = selectionRef.current[0];
      if (geometry.points.has(id)) next.points = [id];
      else if (geometry.edges.some(e => e.id === id)||doc.dimension==="3d"&&["polygon","triangle"].includes(geometry.objects.get(id)?.kind??"")) next.references = [id];
    }
    setToolState(next);
    setMenu(null);
    setCandidates(null);
    setSnap(null);
    setParameterError("");
    setManualParameter(false);
    setParameter("3");
    parameterPoint.current = null;
    svg.current?.focus();
  };
  const patchView = (patch: Partial<DrawingDocument["view"]>) =>
    update(
      { ...docRef.current, view: { ...docRef.current.view, ...patch } },
      false,
    );
  const resetSpaceView = () => {
    const frame=docRef.current.coordinateFrame;
    setHover(null);setSnap(null);
    patchView({mode:"space",angle:0,pitch:0,camera:frame?{origin:frame.origin,x:frame.x,y:frame.y,z:mul(cross(frame.x,frame.y),frame.zSign)}:undefined});
    props.fit();
  };
  const pitchSpaceView = (pitch:number) => {
    const wasPlane=docRef.current.view.mode==="plane";
    setHover(null);setSnap(null);
    patchView({mode:"space",pitch});
    if(wasPlane)props.fit();
  };
  const select = (id: string, append = false) => {
    setSelection((v) =>
      append ? (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]) : [id],
    );
  };
  const patch = (id: string, patch: Partial<GeometryObject>, record = true) =>
    update(
      {
        ...docRef.current,
        objects: docRef.current.objects.map((o) =>
          o.id === id ? ({ ...o, ...patch } as GeometryObject) : o,
        ),
      },
      record,
    );
  const onDraft = (id: string, value?: string) => {
    const drafts = { ...draftRef.current };
    if (value === undefined) delete drafts[id];
    else drafts[id] = value;
    draftRef.current = drafts;
    props.onDrafts(drafts);
  };
  useEffect(() => {
    props.flush.current = () => {
      editor.current?.flush();
    };
    return () => {
      props.flush.current = null;
    };
  });
  useEffect(() => {
    setSelection([]);
    choose("select");
  }, [doc.id]);
  const commitObjects = (
    objects: GeometryObject[],
    staged = stateRef.current.staged,
    extra: Partial<DrawingDocument> = {},
    transform?: (drawing: DrawingDocument) => DrawingDocument,
  ) => {
    const base = docRef.current,
      prepared = normalizeDrawing({
        ...base,
        ...extra,
        objects: [...base.objects, ...staged, ...objects],
      }),
      next = transform ? transform(prepared) : prepared;
    const r = resolveGeometry(next);
    for (const o of [...staged, ...objects])
      if (r.errors.has(o.id)) throw new Error(r.errors.get(o.id));
    if (update(next)) {
      setSelection(
        objects.length
          ? [objects.at(-1)!.id]
          : staged.length
            ? [staged.at(-1)!.id]
            : [],
      );
      setToolState(initialTool(stateRef.current.tool));
      setSnap(null);
      setParameterError("");
      setManualParameter(false);
    }
  };
  const run = (source: string) => {
    try {
      const before = docRef.current,
        next = applyDefinition(before, source);
      if (update(next)) {
        const added = next.objects.filter(
          (o) => !before.objects.some((p) => p.id === o.id),
        );
        if (added.length) setSelection(added.map((o) => o.id));
      }
    } catch (e) {
      setNotice(msg(e));
    }
  };
  const deleteSelection = (ids: string[] = selectionRef.current) => {
    const planarMember=docRef.current.objects.find(o=>ids.includes(o.id)&&o.constraintSet&&!ids.includes(o.constraintSet)&&docRef.current.objects.some(s=>s.id===o.constraintSet&&s.kind==='solutionSet'&&(s.problem.mode==='plane'||s.problem.mode==='coordinate')));
    if(planarMember?.constraintSet){setConstraintEditor(planarMember.constraintSet);return;}
    const managedPoint=docRef.current.objects.find(o=>ids.includes(o.id)&&o.kind === "point"&&o.construction.type === "constraint"&&!ids.includes(o.construction.set));
    if(managedPoint?.kind === "point"&&managedPoint.construction.type === "constraint"){
      setConstraintEditor(managedPoint.construction.set);return;
    }
    const roots = [...new Set(ids.map((id) => id.split(":")[0]))].filter((id) =>
      docRef.current.objects.some((o) => o.id === id && !(o.kind === "point" &&
        ["origin", "focus"].includes(o.construction.type))),
    );
    if (roots.length) setDeleteIds(roots);
    else if (ids.some(id => axisReference(id))) onError("坐标轴由坐标系管理，可通过上方“坐标系”按钮隐藏");
    else if (ids.length) onError("原点和自动焦点由来源管理；可隐藏焦点，或删除来源圆锥曲线");
  };
  const openParam = (
    title: string,
    help: string,
    confirm: (v: string) => void,
    value = "",
  ) => {
    setPendingInput({ title, help, confirm, value });
    setParameterError("");
  };
  const combined = (s = stateRef.current) =>
    !s.staged.length ? docRef.current : normalizeDrawing({
      ...docRef.current,
      objects: [...docRef.current.objects, ...s.staged],
    });
  const rname = (id: string, d = docRef.current) => referenceName(d, id);
  const selectAxisPlane=(p:WorkPlane,vertices?:string[])=>{
    const s=stateRef.current,r=resolveGeometry(combined(s));
    if(s.points.length!==2)throw new Error("请先选择坐标原点和 x 正方向");
    const origin=r.points.get(s.points[0])!.p,direction=r.points.get(s.points[1])!.p;
    if(norm(sub(direction,origin))<1e-9)throw new Error("x 轴方向点不能与原点重合");
    const x=unit(sub(direction,origin)),normal=unit(cross(p.u,p.v));
    if(Math.abs(dot(sub(origin,p.origin),normal))>1e-6||Math.abs(dot(x,normal))>1e-6)
      throw new Error("原点和 x 轴方向必须位于所选面所在的平面内，请重选平面或方向");
    setToolState({...s,axisPlane:{...p,id:`axes-plane-${crypto.randomUUID()}`},axisFace:vertices});
    patchView({mode:"space"});setSnap(null);
  };
  const finishPoints = (s: ToolState) => {
    try {
      const base = combined(s),
        refs = s.points.map((id) => rname(id, base)),
        t = s.tool;
      let source = "";
      if(t==="section3"||t==="sectionLinePoint") {
        const args=t==="section3"?refs:[rname(s.references[0],base),...refs];
        const next=applyDefinition(base,`Section(${rname(s.base!,base)},${args.join(",")})`);
        commitObjects(next.objects.filter(o=>!base.objects.some(p=>p.id===o.id)),s.staged);return;
      }
      if (t === "point") {
        commitObjects([], s.staged);
        if (!s.staged.length) setSelection(s.points);
        return;
      }
      if (["segment", "line", "vector", "triangle", "polygon"].includes(t))
        source = `${{ segment: "Segment", line: "Line", vector: "Vector", triangle: "Triangle", polygon: "Polygon" }[t as "line"]}(${refs.join(", ")})`;
      else if (t === "circle" || t === "circle3")
        source = `${t === "circle" ? "Circle" : "Circle3"}(${refs.join(", ")})`;
      else if(t === "locus") source=`Locus(${refs.join(", ")})`;
      else if(t === "length" || t === "angle" || t === "angleBisector" || t === "angleBisectorLine") source=`${{length:"Length",angle:"Angle",angleBisector:"AngleBisector",angleBisectorLine:"AngleBisectorLine"}[t]}(${refs.join(", ")})`;
      else if(t === "tangent") source=`Tangent(${rname(s.references[0],base)}, ${refs[0]})`;
      else if (t === "midpoint") source = `Midpoint(${refs.join(", ")})`;
      else if (t === "bisector")
        source = `PerpendicularBisector(${refs.join(", ")})`;
      else if (t === "parallel" || t === "perpendicular")
        source = `${t === "parallel" ? "Parallel" : "Perpendicular"}(${rname(s.references[0], base)}, ${refs[0]})`;
      else if (t === "circleRadius") {
        openParam(
          "圆的半径",
          "请输入正数或数值算式",
          (value) => {
            const next = applyDefinition(base, `Circle(${refs[0]}, ${value})`);
            commitObjects(
              next.objects.filter(
                (o) => !base.objects.some((p) => p.id === o.id),
              ),
              s.staged,
            );
          },
          "2",
        );
        return;
      } else if (t === "divide") {
        openParam(
          "线段等分",
          "输入 2～1000 的整数",
          (value) => {
            const n = scalar(value);
            if (!Number.isInteger(n) || n < 2 || n > 1000)
              throw new Error("等分数须为 2～1000 的整数");
            const objects = Array.from(
              { length: n - 1 },
              (_, i): DrawingPoint => ({
                ...pointObject("新点", [0, 0, 0]),
                construction: {
                  type: "division",
                  a: s.points[0],
                  b: s.points[1],
                  t: (i + 1) / n,
                },
              }),
            );
            commitObjects(objects, s.staged);
          },
          "2",
        );
        return;
      } else if (t === "text") {
        openParam(
          "文字标注",
          "直接输入文字，不用加引号；公式使用 $…$ 或 $$…$$，支持文字与公式混排",
          (value) =>
            commitObjects(
              [
                {
                  id: crypto.randomUUID(),
                  kind: "label",
                  name: "文字",
                  text: value,
                  position: resolveGeometry(base).points.get(s.points[0])!.p,
                  style: defaultStyle(),
                },
              ],
              [],
            ),
          "A",
        );
        return;
      } else if (t === "plane3") {
        const r = resolveGeometry(base),
          ps = s.points.map((id) => r.points.get(id)!.p),
          p = planeFromPoints(
            ps[0],
            ps[1],
            ps[2],
            `平面 ${base.planes.length + 1}`,
          );
        commitObjects([], s.staged, {
          planes: [...base.planes, p],
          view: { ...base.view, planeId: p.id, mode: "plane", center: [0, 0] },
        });
        return;
      }
      if (source) {
        const next = applyDefinition(base, source),
          created = next.objects.filter(
            (o) => !base.objects.some((p) => p.id === o.id),
          );
        commitObjects(created, s.staged);
      }
    } catch (e) {
      onError(msg(e));
      if (s.points.length)
        setToolState(rejectLastPoint(s));
    }
  };
  const planeFromSelection = (hit: Hit) => {
    try {
      const p = planeForHit(docRef.current, hit);
      update({
        ...docRef.current,
        planes: [...docRef.current.planes, p],
        view: {
          ...docRef.current.view,
          mode: "plane",
          planeId: p.id,
          center: [0, 0],
        },
      });
      choose("select");
    } catch (e) {
      onError(msg(e));
    }
  };
  const prismStart = useRef<Vec2 | null>(null),
    constructionPlane = useRef<WorkPlane | null>(null),
    parameterPoint = useRef<string | null>(null);
  const solidPreview = (s: ToolState, source: string) => {
    const base = combined(s);
    const next = applyDefinition(
      base,
      `${s.tool === "prism" ? "Prism" : "Pyramid"}(${rname(s.base!, base)}, ${source})`,
    );
    return next.objects.filter((o) => !base.objects.some((p) => p.id === o.id));
  };
  const setSolidParameter = (text: string) => {
    setParameter(text);
    setManualParameter(true);
    try {
      const s = {
          ...stateRef.current,
          staged: stateRef.current.staged.filter(
            (o) => o.id !== parameterPoint.current,
          ),
        },
        base = combined(s);
      if (!s.base) return;
      let arg = text.trim();
      if (s.tool === "prism" && !arg.startsWith("(")) {
        try {
          resolveReference(base, arg);
        } catch {
          const p =
              constructionPlane.current ??
              docRef.current.planes.find(
                (p) => p.id === docRef.current.view.planeId,
              )!,
            normal = unit(cross(p.u, p.v));
          arg = `(${mul(normal, scalar(text)).join(",")})`;
        }
      }
      if (s.tool === "pyramid" && arg.startsWith("(")) {
        const p = pointObject("新点", [0, 0, 0]),
          values = splitArguments(arg.slice(1, -1)).map(scalar);
        if (values.length !== 3) throw new Error("空间顶点需要三个坐标");
        p.construction = { type: "free", position: values as Vec3 };
        p.symbol = nextSymbol(base, "point");
        p.name = p.symbol;
        parameterPoint.current = p.id;
        const staged = [...s.staged, p],
          temp = { ...s, staged };
        const objects = solidPreview(temp, rname(p.id, combined(temp)));
        setToolState({ ...temp, preview: objects });
      } else setToolState({ ...s, preview: solidPreview(s, arg) });
      setParameterError("");
    } catch (e) {
      setParameterError(msg(e));
      setToolState({ ...stateRef.current, preview: [] });
    }
  };
  const confirmPreview = () => {
    const s = stateRef.current;
    if (s.preview.length)
      try {
        commitObjects(
          s.preview,
          s.staged,
        );
      } catch (e) {
        onError(msg(e));
      }
  };
  const accept = (hit: Hit | undefined, q: Vec2, alt = false) => {
    try {
      const s = stateRef.current,
        t = s.tool;
      if (t === "select") {
        if (hit) select(hit.id);
        else setSelection([]);
        return;
      }
      if(t==="fold") {
        if(!s.base) {
          const polygon=hit?.kind==="face"?geometry.objects.get(hit.id):undefined;
          if(polygon?.kind!=="polygon"&&polygon?.kind!=="triangle")throw new Error("请选择已创建的多边形或三角形；几何体模板的面可先描出为多边形");
          setToolState({...s,base:polygon.id});setSelection([polygon.id]);return;
        }
        if(!hit||(hit.kind!=="edge"&&hit.kind!=="curve"))throw new Error("请选择旋转轴：直线、坐标轴或多边形的边");
        geometry.straightReference(hit.id);
        const next=applyDefinition(docRef.current,`Fold(${rname(s.base)},${rname(hit.id)})`);
        if(update(next)){setSelection(next.objects.filter(o=>o.kind==="polygon"&&o.fold?.source===s.base&&!o.hidden).map(o=>o.id));setToolState(initialTool("fold"));setSnap(null);}return;
      }
      if(t==="normal") {
        if(hit?.kind!=="face"||!hit.vertices)throw new Error("请选择平面多边形或几何体的平面面");
        const target=geometry.objects.get(hit.id),vertices=hit.vertices;
        let third=2;while(third<vertices.length&&norm(cross(sub(geometry.points.get(vertices[1])!.p,geometry.points.get(vertices[0])!.p),sub(geometry.points.get(vertices[third])!.p,geometry.points.get(vertices[0])!.p)))<1e-9)third++;
        if(third>=vertices.length)throw new Error("平面退化");
        run(target?.kind==="polygon"||target?.kind==="triangle"?`Normal(${rname(hit.id)})`:`Normal(${[vertices[0],vertices[1],vertices[third]].map(id=>rname(id)).join(",")})`);return;
      }
      if(t.startsWith("section")&&!s.base) {
        const root=hit?.kind==="face"?(docRef.current.objects.find(o=>o.id===hit.owner)?.body??hit.owner):hit?.owner;
        if(!root||geometry.objects.get(root)?.kind!=="solid")throw new Error("请先选择要截取的几何体");
        setToolState({...s,base:root});setSelection([root]);return;
      }
      if(t==="sectionLines"||t==="sectionLinePoint"&&!s.references.length) {
        if(hit?.kind!=="edge"&&!(hit?.kind==="curve"&&geometry.curves.get(hit.id)&&!geometry.curves.get(hit.id)!.parametric&&isLineEquation(geometry.curves.get(hit.id)!.equation)))throw new Error("请选择一条直线、线段或几何体的棱");
        if(s.references.includes(hit.id))throw new Error("请选择另一条直线");
        const references=[...s.references,hit.id];
        if(t==="sectionLines"&&references.length===2) {
          const base=combined(s),next=applyDefinition(base,`Section(${rname(s.base!,base)},${references.map(id=>rname(id,base)).join(",")})`);
          commitObjects(next.objects.filter(o=>!base.objects.some(p=>p.id===o.id)),s.staged);
        }
        else setToolState({...s,references});return;
      }
      if(t === "reflect") {
        if(!s.references.length) {
          if(hit?.kind!=="edge" && !(hit?.kind === "curve" && geometry.curves.get(hit.id) && !geometry.curves.get(hit.id)!.parametric && isLineEquation(geometry.curves.get(hit.id)!.equation)))throw new Error("请选择直线、坐标轴或直边作为对称轴");
          setToolState({...s,references:[hit.id]});setSelection([hit.id]);return;
        }
        if(!hit)throw new Error("请选择需要对称的图形");
        const target=hit.kind === "face" ? hit.owner : hit.id;
        if(target===s.references[0])throw new Error("请选择对称轴以外的图形");
        const next=applyDefinition(combined(s),`Reflect(${rname(target)},${rname(s.references[0])})`);
        commitObjects(next.objects.filter(o=>!docRef.current.objects.some(p=>p.id===o.id)),s.staged);return;
      }
      if(t === "perpendicularTangent") {
        if(!s.references.length){if(hit?.kind!=='curve')throw Error('请先选择圆锥曲线');setToolState({...s,references:[hit.id]});setSelection([hit.id]);return;}
        if(!hit||!['curve','edge'].includes(hit.kind))throw Error('请选择参考直线');const base=combined(s),next=applyDefinition(base,`PerpendicularTangent(${rname(s.references[0],base)},${rname(hit.id,base)})`);commitObjects(next.objects.filter(o=>!docRef.current.objects.some(p=>p.id===o.id)),s.staged);return;
      }
      if(t === "tangent" && !s.references.length) {
        if(hit?.kind!=="curve")throw new Error("请先选择曲线");
        setToolState({...s,references:[hit.id]});setSelection([hit.id]);return;
      }
      if(t === "locus") {
        if(hit?.kind!=="point")throw new Error("请依次选择已创建的主动点和从动点");
        const next=acceptPoint(s,hit.id);setToolState(next.state);if(next.ready)finishPoints(next.state);return;
      }
      if(t === "area"||t === "perimeter"||(t === "length"&&!s.points.length&&hit?.kind==="edge")) {
        if(!hit)throw new Error("请选择要度量的图形");
        let target=t==='length'?hit.id:hit.owner,base=docRef.current,helper:GeometryObject|undefined;
        if(hit.kind==='face'&&hit.vertices&&!geometry.objects.has(hit.id)) {
          helper={id:crypto.randomUUID(),kind:'polygon',name:'度量参考面',symbol:nextSymbol(base,'polygon'),points:hit.vertices,hidden:true,style:defaultStyle()};
          target=helper.id;base=normalizeDrawing({...base,objects:[...base.objects,helper]});
        }
        const next=applyDefinition(base,`${{area:"Area",perimeter:"Perimeter",length:"Length"}[t]}(${rname(target,base)})`);
        commitObjects(next.objects.filter(o=>!docRef.current.objects.some(p=>p.id===o.id)).map(o=>o.id===helper?.id?{...o,auxiliary:true}:o));return;
      }
      if (t === "axes" && s.points.length === 2) {
        if (s.axisPlane) {
          const r = resolveGeometry(combined(s));
          const origin = r.points.get(s.points[0])!.p;
          const xPoint = r.points.get(s.points[1])!.p;
          const planeDoc = { ...docRef.current, planes: [...docRef.current.planes, s.axisPlane],
            view: { ...docRef.current.view, planeId: s.axisPlane.id } };
          const position = framePointSnap(planeDoc,curves,size,q,s.points,s.axisPlane,alt).position;
          const frame=frameFromDirections(origin,xPoint,position,s.axisPlane);
          constraintMotion.begin();
          commitObjects([], s.staged, { coordinateFrame: { ...frame, zSign },coordinateOriginId:s.points[0],
            view: { ...docRef.current.view, axes: true, mode: "space" } }, applyCoordinateFrame);
          choose("select");
          setSnap(null);
          return;
        }
        if (hit?.kind !== "face") { onError("请选择几何体的平面面作为 xOy 平面"); return; }
        selectAxisPlane(planeForHit(docRef.current,hit),hit.vertices);
        return;
      }
      if (t === "planeFace") {
        if (hit?.kind === "face") planeFromSelection(hit);
        else onError("请点击平面多边形内部或几何体的平面面");
        return;
      }
      if (t === "intersect") {
        const paths = hitTest(docRef.current, curves, size, q).filter(
          (h) => h.kind === "edge" || h.kind === "curve",
        );
        if (!s.references.length && paths.length >= 2) {
          const ps = intersectionObjects(
              docRef.current,
              paths[0].id,
              paths[1].id,
            ),
            r = resolveGeometry({
              ...docRef.current,
              objects: [...docRef.current.objects, ...ps],
            });
          const near = ps.sort((a, b) => {
            const pa = screenPoint(docRef.current, size, r.points.get(a.id)!.p),
              pb = screenPoint(docRef.current, size, r.points.get(b.id)!.p);
            return (
              Math.hypot(pa[0] - q[0], pa[1] - q[1]) -
              Math.hypot(pb[0] - q[0], pb[1] - q[1])
            );
          })[0];
          commitObjects([near], []);
          return;
        }
        if (!hit || !["edge", "curve"].includes(hit.kind)) return;
        if (!s.references.length) setToolState({ ...s, references: [hit.id] });
        else if (s.references[0] !== hit.id)
          commitObjects(intersectionObjects(
              docRef.current,
              s.references[0],
              hit.id,
            ), []);
        return;
      }
      if ((t === "parallel" || t === "perpendicular") && !s.references.length) {
        if(doc.dimension==='3d'&&hit?.kind==='face'&&hit.vertices) {
          const original=docRef.current.objects.find(o=>o.id===hit.id);
          const face:GeometryObject=original&&(original.kind==='polygon'||original.kind==='triangle')?original:{id:crypto.randomUUID(),kind:'polygon',name:'参考平面',symbol:nextSymbol(combined(s),'polygon'),points:hit.vertices,hidden:true,style:defaultStyle()};
          const next={...s,references:[face.id],staged:face===original?s.staged:[...s.staged,face]};
          if(next.points.length)finishPoints(next);else setToolState(next);return;
        }
        const candidate = s.points.length ? null : snapPoint(combined(s),curves,size,q,alt,gridSnap);
        const crossing = candidate?.construction?.type === "intersection" || candidate?.construction?.type === "curveCoordinate";
        if (hit?.kind === "edge" && !crossing) {
          const next = {...s,references:[hit.id]};
          if(next.points.length) finishPoints(next); else setToolState(next);
          return;
        }
        if(s.points.length) { onError("已选点，请选择参考直线、坐标轴、边或平面"); return; }
        // With no reference yet, points (including implicit intersections) are staged first.
        if(hit && hit.kind !== "point" && !crossing && hit.kind !== "curve") {
          onError("请选择经过的点或参考线"); return;
        }
      }

      if (
        ["midpoint", "divide", "bisector"].includes(t) &&
        !s.points.length &&
        hit?.kind === "edge"
      ) {
        const edge = geometry.edges.find((e) => e.id === hit.id)!;
        if (geometry.objects.get(edge.owner)?.kind === "line") {
          onError("请选择线段或一条边；直线没有端点");
          return;
        }
        finishPoints({ ...s, points: [edge.a, edge.b] });
        return;
      }
      if (t === "prism" || t === "pyramid") {
        if (!s.base) {
          if (hit?.kind !== "face") {
            onError("请点击底面多边形内部或几何体平面面");
            return;
          }
          const base = docRef.current.objects.find((o) => o.id === hit.id);
          let id = base?.id,
            staged: GeometryObject[] = [];
          if (!base) {
            const p: GeometryObject = {
              id: crypto.randomUUID(),
              kind: "polygon",
              name: "底面",
              symbol: nextSymbol(docRef.current, "polygon"),
              points: hit.vertices!,
              hidden: true,
              style: defaultStyle(),
            };
            id = p.id;
            staged = [p];
          }
          const p = planeForHit(docRef.current, hit);
          constructionPlane.current = p;
          const next = { ...s, base: id!, staged };
          setToolState(next);
          prismStart.current = q;
          update(
            {
              ...docRef.current,
              view: { ...docRef.current.view, mode: "space" },
            },
            false,
          );
          if (t === "prism") {
            const direction = mul(unit(cross(p.u, p.v)), 3),
              baseDoc = normalizeDrawing({
                ...docRef.current,
                objects: [...docRef.current.objects, ...staged],
              });
            const nextDoc = applyDefinition(
              baseDoc,
              `Prism(${rname(id!, baseDoc)}, (${direction.join(",")}))`,
            );
            setToolState({
              ...next,
              preview: nextDoc.objects.filter(
                (o) => !baseDoc.objects.some((p) => p.id === o.id),
              ),
            });
          }
          setParameter(t === "prism" ? "3" : "");
          return;
        }
        if (t === "prism" || manualParameter) {
          confirmPreview();
          return;
        }
        const snap =
          hit?.kind === "point"
            ? { position: hit.position!, hint: "顶点", existing: hit.id }
            : snapPoint(combined(s), curves, size, q, alt, gridSnap);
        const point = stagedPoint(docRef.current, s, snap),
          next = { ...point.state, points: [point.id] };
        const source = rname(point.id, combined(next));
        commitObjects(solidPreview(next, source), next.staged);
        return;
      }
      const d = combined(s);
      const pointSnap: Snap =
        hit?.kind === "point"
          ? { existing: hit.id, position: hit.position!, hint: "使用已有点" }
          : t==="axes"?framePointSnap(d,curves,size,q,s.points,undefined,alt)
          : t.startsWith("section")&&hit?.kind==="edge"&&hit.position&&!alt?{position:hit.position,construction:pointOnPath(d,hit.id,hit.position),hint:"棱或直线上的点（建立关联）"}
          :snapPoint(d, curves, size, q, alt, gridSnap);
      const staged = stagedPoint(docRef.current, s, pointSnap),
        step = acceptPoint(staged.state, staged.id);
      setToolState(step.state);
      if (step.ready) finishPoints(step.state);
    } catch (e) {
      onError(msg(e));
    }
  };
  const pointer = useRef<{
    kind: "pan" | "box" | "point" | "label" | "annotation" | "locus";
    locus?:LocusDrag;
    pointerId?:number;
    start: Vec2;
    before: DrawingDocument;
    id?: string;
    old?: Vec3;
    offset?: Vec2;
    shift?: boolean;
    moved: boolean;
  } | null>(null);
  const space = useRef(false),
    panelResize = useRef<{ x: number; width: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svg.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * size[0]) / r.width,
      ((e.clientY - r.top) * size[1]) / r.height,
    ];
  };
  const pickHits = (q: Vec2) =>
    toolHits(stateRef.current,hitTest(
      docRef.current,
      curves,
      size,
      q,
      ["planeFace", "prism", "pyramid", "axes", "reflect", "area", "perimeter", "normal", "fold", "section3", "sectionLines", "sectionLinePoint", "parallel", "perpendicular"].includes(stateRef.current.tool) ||
        stateRef.current.tool === "select",
    ));
  const executeSelection = (
    hit: Hit | undefined,
    e: ReactPointerEvent,
    q: Vec2,
  ) => {
    if (e.shiftKey && editor.current && hit) {
      e.preventDefault();
      editor.current.insert(rname(hit.id));
      return;
    }
    if (stateRef.current.tool !== "select") {
      accept(hit, q, e.altKey);
      return;
    }
    const face=hit?.kind==="face"?docRef.current.objects.find(o=>o.id===hit.id):undefined;
    if(face?.body&&!e.altKey){select(face.body,e.shiftKey);return;}
    if (!hit) {
      if (!e.shiftKey) setSelection([]);
      pointer.current = {
        kind: "box",
        start: q,
        before: docRef.current,
        shift: e.shiftKey,
        moved: false,
      };
      setBox({ start: q, end: q });
      svg.current?.setPointerCapture(e.pointerId);
      return;
    }
    select(hit.id, e.shiftKey);
    if (e.shiftKey) return;
    const obj = docRef.current.objects.find((o) => o.id === hit.id),
      p = geometry.points.get(hit.id);
    if (obj?.locked) return;
    const textTarget = (e.target as Element)
      .closest("[data-owner]")
      ?.getAttribute("data-owner");
    const trace=p&&hit.kind!=="label"&&!constraintBinding(docRef.current,p.object)?inverseLocus(docRef.current,hit.id):undefined;
    const kind =
      hit.kind === "label"
        ? p
          ? "label"
          : "annotation"
        : trace ? "locus" : p &&
            (p.object?.construction.type === "free" ||
              p.object?.construction.type === "constraint" ||
              p.object?.construction.type === "onPath" || p.object?.construction.type === "onAxis")
          ? "point"
          : null;
    if (!kind) return;
    if (p?.object?.locked) return;
    const binding=constraintBinding(docRef.current,p?.object);
    if(kind!=="label"&&binding&&!binding.movable)return;
    setDragHint("");
    let locus:LocusDrag|undefined;
    if(kind==="locus") {
      try{locus=createLocusDrag(docRef.current,trace!,size);setDragHint("沿轨迹拖动从动点，反向调整主动点");}
      catch(error){onError(msg(error));return;}
    }
    if (kind === "point" && p?.object?.parameters && !binding) {
      onError("此点的坐标引用了数值对象，请调整数值滑块或编辑定义"); return;
    }
    const old = p?.p ?? (obj?.kind === "label" ? obj.position : undefined);
    if (
      kind === "point" &&
      !binding &&
      old &&
      Math.abs(dot(sub(old, plane.origin), cross(plane.u, plane.v))) > 1e-6
    ) {
      onError("该点不在当前工作平面，请先切换平面，或在表达式中修改空间坐标");
      return;
    }
    pointer.current = {
      kind,
      locus,
      pointerId:e.pointerId,
      start: q,
      before: docRef.current,
      id: textTarget ?? hit.id,
      old,
      offset: p?.object?.labelOffset,
      moved: false,
    };
    if(kind === "point"&&binding) {
      constraintMotion.begin();
    }
    svg.current?.setPointerCapture(e.pointerId);
  };
  const draggablePoint=(hit:Hit)=>{
    if(hit.kind!=="point")return false;
    const p=geometry.points.get(hit.id),o=p?.object;
    if(!o||o.locked)return false;
    const binding=constraintBinding(docRef.current,o);if(binding)return binding.movable;
    if(inverseLocus(docRef.current,hit.id))return true;
    if(o.parameters)return false;
    const c=o.construction;
    if(c.type==="constraint") {
      const set=docRef.current.objects.find(o=>o.id===c.set);
      return set?.kind==="solutionSet"&&!selectedBranch(set).reference.includes(c.point);
    }
    return ["free","onPath","onAxis"].includes(c.type)&&!!p&&Math.abs(dot(sub(p.p,plane.origin),cross(plane.u,plane.v)))<=1e-6;
  };
  const pointRole=(hit:Hit)=>{
    const p=geometry.points.get(hit.id)?.object;
    const binding=constraintBinding(docRef.current,p);
    if(binding)return binding.reference?"固定参照点":binding.movable?(binding.set.driver===binding.point?"当前动点":"动点"):"约束确定的点";
    const trace=inverseLocus(docRef.current,hit.id);
    if(trace?.derived?.type==="locus")return `轨迹从动点 · 反向调整 ${rname(trace.derived.driver)}`;
    if(!p||p.construction.type!=="constraint")return draggablePoint(hit)?"可拖动":"参照 / 派生点";
    const c=p.construction,set=docRef.current.objects.find(o=>o.id===c.set);
    return set?.kind==="solutionSet"&&set.driver===c.point?"当前动点":"动点";
  };
  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    e.stopPropagation();
    setMenu(null);
    setCandidates(null);
    const q = local(e);
    setCursor(q);
    if (e.button === 1 || space.current || (dragMode === "pan" && stateRef.current.tool === "select")) {
      e.preventDefault();
      pointer.current = {
        kind: "pan",
        start: q,
        before: docRef.current,
        moved: false,
      };
      svg.current?.setPointerCapture(e.pointerId);
      return;
    }
    let hits = pickHits(q);
    const text = (e.target as Element)
      .closest("[data-owner]")
      ?.getAttribute("data-owner");
    const pickingFramePlane=stateRef.current.tool==="axes" && stateRef.current.points.length===2 && !stateRef.current.axisPlane;
    if (text && text !== "axis" && !pickingFramePlane) {
      const p = geometry.points.get(text),
        obj = doc.objects.find((o) => o.id === text);
      hits = [
        {
          kind: stateRef.current.tool !== "select" && p ? "point" : "label",
          id: text,
          owner: text,
          distance: 0,
          position: p?.p ?? (obj?.kind === "label" ? obj.position : undefined),
        },
      ];
    }
    if (e.shiftKey && editor.current && hits[0]) {
      e.preventDefault();
      editor.current.insert(rname(hits[0].id));
      return;
    }
    const s = stateRef.current;
    if (s.tool !== "select" && !insidePlot(size,q)) return;
    if (s.tool === "prism" && s.base && s.preview.length) {
      confirmPreview();
      return;
    }
    if(s.tool==="axes"&&!(s.points.length===2&&!s.axisPlane)&&!e.altKey) {
      const snapped=framePointSnap(combined(s),curves,size,q,s.points,s.axisPlane);
      if(snapped.existing){accept({kind:"point",id:snapped.existing,owner:snapped.existing,distance:0,position:snapped.position},q);svg.current?.focus();return;}
    }
    if ((["point","segment","line","vector","triangle","polygon","circle","circle3","circleRadius","plane3","length","angle","angleBisector","angleBisectorLine"].includes(s.tool) ||
      (((s.tool === "parallel" || s.tool === "perpendicular") && !s.points.length) || (s.tool === "tangent" && s.references.length > 0))) && !e.altKey) {
      const snapped=snapPoint(combined(s),curves,size,q);
      if (snapped.construction?.type === "intersection" || snapped.construction?.type === "curveCoordinate") {
        accept(undefined,q,false); svg.current?.focus(); return;
      }
    }
    let overlap = hits.filter((h) => h.kind === hits[0]?.kind);
    if(s.tool==="select"&&overlap[0]?.kind==="face"&&!e.altKey) {
      const seen=new Set<string>();overlap=overlap.filter(h=>{const owner=docRef.current.objects.find(o=>o.id===h.id)?.body??h.id;if(seen.has(owner))return false;seen.add(owner);return true;});
    }
    if(s.tool==="select"&&!text&&!e.shiftKey&&overlap[0]?.kind==="point"&&overlap.length>1&&!e.altKey) {
      const movable=overlap.filter(draggablePoint),selected=movable.find(h=>selectionRef.current.includes(h.id)),preferred=movable.filter(h=>pointRole(h)==="当前动点"),dynamic=movable.filter(h=>pointRole(h)==="动点");
      const hit=selected??(preferred.length===1?preferred[0]:dynamic.length===1?dynamic[0]:movable.length===1?movable[0]:undefined);
      if(hit){executeSelection(hit,e,q);svg.current?.focus();return;}
    }
    if (overlap.length > 1 && s.tool !== "intersect" && (!e.altKey||s.tool==="select")) {
      const r = svg.current!.getBoundingClientRect();
      setCandidates({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        hits: overlap,
        q,
      });
      return;
    }
    executeSelection(hits[0], e, q);
    svg.current?.focus();
  };
  const move = (e: ReactPointerEvent) => {
    const q = local(e);
    setCursor(q);
    const drag = pointer.current,
      s = stateRef.current;
    if (drag) {
      // Pointer capture delivers positions outside the SVG as well. Keep the
      // last valid point until the cursor re-enters, including on pointer-up.
      if((drag.kind === "point"||drag.kind === "locus")&&!insidePlot(size,q))return;
      const dx = q[0] - drag.start[0],
        dy = q[1] - drag.start[1];
      if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
      drag.moved = true;
      if (drag.kind === "pan")
        update(
          {
            ...drag.before,
            view: {
              ...drag.before.view,
              center: [
                drag.before.view.center[0] - dx / drag.before.view.scale,
                drag.before.view.center[1] - dy / drag.before.view.scale,
              ],
            },
          },
          false,
          "continuous",
        );
      else if (drag.kind === "box") setBox({ start: drag.start, end: q });
      else if(drag.kind === "locus"&&drag.locus&&drag.old) {
        const start=screenPoint(drag.before,size,drag.old);
        const result=drag.locus.move([start[0]+dx,start[1]+dy]);
        setDragHint(result.hint);
        if(result.document)update(result.document,false,"continuous");
      }
      else if (drag.id)
        try {
          const obj = drag.before.objects.find((o) => o.id === drag.id);
          if (!obj || obj.locked) return;
          let patch: Partial<GeometryObject> = {};
          if (drag.kind === "label" && obj.kind === "point")
            patch = {
              labelOffset: [
                (drag.offset?.[0] ?? 0) + dx,
                (drag.offset?.[1] ?? 0) + dy,
              ],
            };
          else if (drag.old) {
            const old = project(drag.old, drag.before),
              position = unprojectOnPlane(
                [
                  old[0] + dx / drag.before.view.scale,
                  old[1] + dy / drag.before.view.scale,
                ],
                drag.old,
                drag.before,
              );
            if (obj.kind === "label") patch = { position };
            else if(obj.kind === "point"&&constraintBinding(docRef.current,obj)) {
              const binding=constraintBinding(docRef.current,obj)!;
              if(binding.movable)constraintMotion.move(binding.set.id,binding.point,position);return;
            }
            else if (obj.kind === "point" && obj.construction.type === "onAxis") {
              const c=obj.construction, axis=coordinateAxis(drag.before,c.axis,c.planeId);
              const parameter=dot(sub(position,axis.origin),axis.direction);
              patch={construction:{...c,parameter:drag.before.dimension === "3d" ? Math.max(0,parameter) : parameter}};
            }
            else if (obj.kind === "point"&&obj.construction.type === "onPath") {
              const current=docRef.current.objects.find(o=>o.id===obj.id);
              const previous=current?.kind==="point"&&current.construction.type==="onPath"
                ?current.construction.parameter:obj.construction.parameter;
              patch={construction:pointOnPath(docRef.current,obj.construction.path,position,previous)};
            }
            else if (obj.kind === "point")patch={construction:{type:"free",position}};
          }
          update(
            {
              ...drag.before,
              objects: drag.before.objects.map((o) =>
                o.id === drag.id ? ({ ...o, ...patch } as GeometryObject) : o,
              ),
            },
            false,
            "continuous",
          );
          if(drag.kind==="point")setDragHint("");
        } catch (e) {
          if(drag.kind==="point"&&e instanceof PathProjectionError)
            setDragHint("此处无法沿原曲线继续拖动，已保留上一有效位置");
          else onError(msg(e));
        }
      return;
    }
    const hits = pickHits(q);
    const movable=hits.filter(h=>h.kind==="point"&&draggablePoint(h)),preferred=movable.filter(h=>pointRole(h)==="当前动点"),dynamic=movable.filter(h=>pointRole(h)==="动点");
    const priority=stateRef.current.tool==="select"&&!e.altKey?(movable.find(h=>selectionRef.current.includes(h.id))??(preferred.length===1?preferred[0]:dynamic.length===1?dynamic[0]:movable.length===1?movable[0]:undefined)):undefined;
    setHover(priority??hits[0]??null);
    if (s.tool === "axes" && s.axisPlane) {
      try {
        const planeDoc = { ...docRef.current, planes: [...docRef.current.planes,s.axisPlane],
          view: { ...docRef.current.view, planeId: s.axisPlane.id } };
        setSnap(framePointSnap(planeDoc,curves,size,q,s.points,s.axisPlane,e.altKey));
      } catch { setSnap(null); }
      return;
    }
    if (wantsPoint(s))
      try {
        setSnap(s.tool==="axes"?framePointSnap(combined(s),curves,size,q,s.points,undefined,e.altKey)
          :s.tool.startsWith("section")&&hits[0]?.kind==="edge"&&hits[0].position&&!e.altKey?{position:hits[0].position,construction:pointOnPath(combined(s),hits[0].id,hits[0].position),hint:"棱或直线上的点（建立关联）"}
          :snapPoint(combined(s), curves, size, q, e.altKey, gridSnap));
      } catch {
        setSnap(null);
      }
    else setSnap(null);
    if (
      s.tool === "prism" &&
      s.base &&
      !manualParameter &&
      prismStart.current
    ) {
      const p =
          constructionPlane.current ??
          docRef.current.planes.find(
            (p) => p.id === docRef.current.view.planeId,
          )!,
        normal = unit(cross(p.u, p.v)),
        a = screenPoint(docRef.current, size, p.origin),
        b = screenPoint(docRef.current, size, add(p.origin, normal)),
        v: Vec2 = [b[0] - a[0], b[1] - a[1]],
        length = v[0] ** 2 + v[1] ** 2;
      if (length < 1e-8) {
        setParameterError("该方向在当前视角中不可拖动，请输入高度或侧棱向量");
        return;
      }
      const height =
        3 +
        ((q[0] - prismStart.current[0]) * v[0] +
          (q[1] - prismStart.current[1]) * v[1]) /
          length;
      if (Math.abs(height) > 0.05)
        try {
          const vector = mul(unit(cross(p.u, p.v)), height),
            objects = solidPreview(s, `(${vector.join(",")})`);
          setParameter(Number(height.toFixed(3)).toString());
          setToolState({ ...s, preview: objects });
          setParameterError("");
        } catch (e) {
          setParameterError(msg(e));
        }
    }
  };
  const moveHandler = useRef(move);
  moveHandler.current = move;
  const moveFrame = useRef<number | null>(null), latestMove = useRef<ReactPointerEvent | null>(null);
  const cancelMove = () => {
    if(moveFrame.current!==null)cancelAnimationFrame(moveFrame.current);
    moveFrame.current=null;latestMove.current=null;
  };
  useEffect(()=>cancelMove,[doc.id]);
  const scheduleMove = (e:ReactPointerEvent) => {
    const drag=pointer.current;
    // Do not replace an unprocessed in-canvas sample with an outside event.
    if(drag&&(drag.kind==="point"||drag.kind==="locus")&&!insidePlot(size,local(e)))return;
    latestMove.current=e;
    if(moveFrame.current!==null)return;
    moveFrame.current=requestAnimationFrame(()=>{
      moveFrame.current=null;
      const event=latestMove.current;latestMove.current=null;
      if(event)moveHandler.current(event);
    });
  };
  const up = (e: ReactPointerEvent) => {
    const pending=latestMove.current;
    cancelMove();
    const drag = pointer.current;
    if (!drag) return;
    if(pending&&(drag.kind==="point"||drag.kind==="locus"))move(pending);
    move(e);
    pointer.current = null;
    setDragHint("");
    try {
      svg.current?.releasePointerCapture(e.pointerId);
    } catch {}
    const draggedPoint=drag.before.objects.find(o=>o.id===drag.id);
    if(drag.kind === "point"&&draggedPoint?.kind === "point"&&constraintBinding(docRef.current,draggedPoint))return;
    if (drag.kind === "box") {
      const end = local(e);
      if (drag.moved) {
        const ids = selectRectangle(docRef.current, size, drag.start, end);
        setSelection((current) =>
          drag.shift ? [...new Set([...current, ...ids])] : ids,
        );
      }
      setBox(null);
    } else if (
      drag.moved &&
      drag.kind !== "pan" &&
      JSON.stringify(drag.before) !== JSON.stringify(docRef.current)
    ) {
      const after = docRef.current;
      update(drag.before, false);
      update(after, true, "complete");
    }
    else update(docRef.current,false,"complete");
  };
  const actions = useRef({
    choose,
    confirmPreview,
    deleteSelection,
    finishPoints,
  });
  actions.current = { choose, confirmPreview, deleteSelection, finishPoints };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (deleteIds || notice) {
        if (e.key === "Escape") {
          setDeleteIds(null);
          setNotice("");
        }
        return;
      }
      if (e.key === "Escape") {
        if (editTarget(e.target)) return;
        if(pointer.current?.kind==="locus") {
          const drag=pointer.current;pointer.current=null;cancelMove();
          if(drag.pointerId!==undefined&&svg.current?.hasPointerCapture(drag.pointerId))svg.current.releasePointerCapture(drag.pointerId);
          update(drag.before,false,"complete");setDragHint("");e.preventDefault();return;
        }
        if (menu || candidates) {
          setMenu(null);
          setCandidates(null);
          return;
        }
        if (pendingInput) {
          setPendingInput(null);
          return;
        }
        const s = stateRef.current;
        if (
          s.points.length ||
          s.references.length ||
          s.staged.length ||
          s.base ||
          s.preview.length
        ) {
          setToolState(initialTool(s.tool));
          setSnap(null);
        } else {
          actions.current.choose("select");
          setSelection([]);
        }
        e.preventDefault();
        return;
      }
      if (editTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) props.redo();
        else props.undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        actions.current.deleteSelection();
      } else if (e.key === "Enter") {
        const s = stateRef.current;
        if (s.preview.length) {
          e.preventDefault();
          actions.current.confirmPreview();
        } else if (s.tool === "polygon" && s.points.length >= 3) {
          e.preventDefault();
          actions.current.finishPoints(s);
        }
      }
    };
    const release = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", release);
    const blur = () => {
      space.current = false;
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, [menu, candidates, pendingInput, deleteIds, notice, props.undo, props.redo]);
  const allPreview = useMemo(() => [...state.preview, ...props.expressionPreview],
    [state.preview, props.expressionPreview]);
  const previewGeometry = useMemo(() => {
    try {
      return !state.staged.length && !allPreview.length ? geometry : resolveGeometry({
        ...doc,
        objects: [...doc.objects, ...state.staged, ...allPreview],
      });
    } catch {
      return null;
    }
  }, [doc, state.staged, allPreview, geometry]);
  const previewScene = useMemo(
    () =>
      allPreview.length
        ? sceneFor(
            {
              ...doc,
              objects: [...doc.objects, ...state.staged, ...allPreview],
            },
            curves,
            size,
          )
        : null,
    [doc, state.staged, allPreview, curves, size],
  );
  const previewLines: Vec2[][] = [];
  if (state.tool === "pyramid" && state.base && snap && !manualParameter) {
    const base =
      doc.objects.find((o) => o.id === state.base) ??
      state.staged.find((o) => o.id === state.base);
    if (base && (base.kind === "polygon" || base.kind === "triangle"))
      for (const id of base.points) {
        const p = (previewGeometry ?? geometry).points.get(id)?.p;
        if (p)
          previewLines.push([
            screenPoint(doc, size, p),
            screenPoint(doc, size, snap.position),
          ]);
      }
  }
  const overlayPoints = previewGeometry ?? geometry;
  const livePoints = state.points
    .map((id) => overlayPoints.points.get(id)?.p)
    .filter((p): p is Vec3 => !!p);
  if (livePoints.length && state.tool !== "axes") {
    const path = [...livePoints, ...(snap ? [snap.position] : [])];
    previewLines.push(path.map((p) => screenPoint(doc, size, p)));
    if ((state.tool === "circle" || state.tool === "circleRadius") && snap) {
      const c = livePoints[0],
        plane = doc.planes.find((p) => p.id === doc.view.planeId)!,
        radius = norm(sub(snap.position, c));
      previewLines.length = 0;
      previewLines.push(
        Array.from({ length: 81 }, (_, i) =>
          screenPoint(
            doc,
            size,
            add(
              c,
              add(
                mul(plane.u, radius * Math.cos((i / 80) * Math.PI * 2)),
                mul(plane.v, radius * Math.sin((i / 80) * Math.PI * 2)),
              ),
            ),
          ),
        ),
      );
    }
  }
  let axisPreview: DrawingDocument["coordinateFrame"];
  if (state.tool === "axes" && state.axisPlane && !axisPreview && livePoints.length === 2 && snap) {
    try {
      axisPreview=frameFromDirections(livePoints[0],livePoints[1],snap.position,state.axisPlane);
    } catch { /* A cursor on the x axis has no y direction yet. */ }
  }
  if (state.tool === "circle3" && livePoints.length === 2 && snap)
    try {
      const c = triangleCenter(
          livePoints[0],
          livePoints[1],
          snap.position,
          "circumcenter",
        ),
        r = norm(sub(c, livePoints[0]));
      previewLines.length = 0;
      previewLines.push(
        Array.from({ length: 81 }, (_, i) =>
          screenPoint(
            doc,
            size,
            add(
              c,
              add(
                mul(plane.u, r * Math.cos((i / 80) * Math.PI * 2)),
                mul(plane.v, r * Math.sin((i / 80) * Math.PI * 2)),
              ),
            ),
          ),
        ),
      );
    } catch {}
  if((state.tool==='parallel'||state.tool==='perpendicular')&&((state.references.length&&snap)||(state.points.length&&(hover?.kind==='edge'||hover?.kind==='face'))))try {
    const base=combined(state),ref=state.references[0]??hover!.id;
    const position=state.points.length?overlayPoints.points.get(state.points[0])!.p:snap!.position;
    const face=geometry.objects.get(ref),planeSource=face&&(face.kind==='polygon'||face.kind==='triangle')?{type:'polygon' as const,polygon:ref}:undefined;
    const direction=relationDirection(state.tool,position,planeSource?undefined:resolveGeometry(base).straightReference(ref),planeSource?resolveGeometry(base).plane(planeSource):undefined,plane,doc.dimension==='3d');
    const center=screenPoint(doc,size,position),q=screenPoint(doc,size,add(position,direction)),dx=q[0]-center[0],dy=q[1]-center[1],length=Math.hypot(dx,dy);
    if(length>1e-8){const extent=Math.hypot(...size)/length;previewLines.push([[center[0]-dx*extent,center[1]-dy*extent],[center[0]+dx*extent,center[1]+dy*extent]]);}
  }catch{/* Invalid or non-unique constructions have no misleading preview. */}
  const handleRefs = new Set<string>();
  for (const id of selection) {
    if (axisReference(id)) continue;
    const o = geometry.objects.get(id);
    if (geometry.points.has(id)) handleRefs.add(id);
    else if (
      o &&
      (o.kind === "polygon" ||
        o.kind === "triangle" ||
        o.kind === "line" ||
        o.kind === "vector" ||
        o.kind === "segment")
    )
      o.points.forEach((id) => handleRefs.add(id));
    else if (o?.kind === "solid") {
      const mesh=geometry.meshes.find(m=>m.id===id&&!m.round);
      mesh?.vertices.forEach((_,i)=>handleRefs.add(mesh.vertexIds?.[i]??`${id}:v:${i}`));
    }
    else {
      const e = geometry.edges.find((e) => e.id === id);
      if (e) {
        handleRefs.add(e.a);
        handleRefs.add(e.b);
      }
    }
  }
  if (hover?.kind === "point" && canSelectPoint(state)) handleRefs.add(hover.id);
  const selectedRoots = [...new Set(selection.map((id) => id.split(":")[0]))],
    selectedRoot = doc.objects.find((o) => o.id === selectedRoots[0]);
  const hitLabel = (h: Hit) =>
    h.kind === "face"
      ? `${rname(h.owner)} · ${h.id.includes(":face:")
        ? `面 ${Number(h.id.split(":face:")[1]) + 1}` : "多边形面"}`
      : h.kind === "edge"
        ? `${rname(h.id)} · 边`
        : rname(h.id);
  const surfaceActions = () => {
    const last = selection[0],
      reference = edge?.id;
    const symbol = reference ? rname(reference) : "";
    const buttons: [string, () => void][] = [];
    if (reference) {
      if (geometry.objects.get(edge!.owner)?.kind !== "line") buttons.push(
        ["中点", () => run(`Midpoint(${symbol})`)],
        [
          "等分",
          () =>
            openParam(
              "线段等分",
              "输入等分数",
              (value) => {
                const next = applyDefinition(
                  docRef.current,
                  `Divide(${symbol},${value})`,
                );
                update(next);
              },
              "2",
            ),
        ],
        ["垂直平分线", () => run(`PerpendicularBisector(${symbol})`)],
        ["长度",()=>run(`Length(${symbol})`)],
      );
      buttons.push(
        [
          "平行线",
          () => {
            choose("parallel");
            setToolState({
              ...initialTool("parallel"),
              references: [reference],
            });
          },
        ],
        [
          "垂线",
          () => {
            choose("perpendicular");
            setToolState({
              ...initialTool("perpendicular"),
              references: [reference],
            });
          },
        ],
      );
    }
    if (object?.kind === "triangle")
      for (const [command, label] of [
        ["Centroid", "重心"],
        ["Circumcenter", "外心"],
        ["Orthocenter", "垂心"],
        ["Incenter", "内心"],
        ["Circumcircle", "外接圆"], ["Incircle", "内切圆"], ["Area", "面积"], ["Perimeter", "周长"],
      ])
        buttons.push([label, () => run(`${command}(${rname(object.id)})`)]);
    if (object?.kind === "curve")
      for (const [command, label] of [
        ["PointX", "指定横坐标"],
        ["PointY", "指定纵坐标"],
      ])
        buttons.push([
          label,
          () =>
            openParam(
              label,
              "输入坐标数值，直接创建全部符合条件的点",
              (value) => {
                const base = docRef.current,
                  next = applyDefinition(
                    base,
                    `${command}(${rname(object.id)},${value})`,
                  );
                commitObjects(next.objects.filter(
                    (o) => !base.objects.some((p) => p.id === o.id),
                  ), []);
              },
              "1",
            ),
        ]);
    if (
      object?.kind === "solid" &&
      !["sphere", "cylinder", "cone", "coneFrustum"].includes(object.shape)
    )
      buttons.push(
        ["外接球", () => run(`Circumsphere(${rname(object.id)})`)],
        ["内切球", () => run(`Insphere(${rname(object.id)})`)],
      );
    if (
      selection.length >= 4 &&
      selection.every((id) => geometry.points.has(id))
    )
      buttons.push([
        "外接球",
        () =>
          run(`Circumsphere(${selection.map((id) => rname(id)).join(",")})`),
      ]);
    if (
      (object?.kind === "polygon" || object?.kind === "triangle") &&
      doc.dimension === "3d"
    )
      buttons.push(
        [
          "作为工作平面",
          () =>
            planeFromSelection({
              kind: "face",
              id: object.id,
              owner: object.id,
              distance: 0,
              vertices: (geometry.objects.get(object.id) as typeof object).points,
            }),
        ],
        ["法向量",()=>run(`Normal(${rname(object.id)})`)],
        ["翻折",()=>{choose("fold");setToolState({...initialTool("fold"),base:object.id});}],
        [
          "棱柱",
          () => {
            choose("prism");
            accept({ kind: "face", id: object.id, owner: object.id,
              distance: 0, vertices: object.points },
              screenPoint(doc, size, geometry.points.get(object.points[0])?.p ?? plane.origin));
          },
        ],
        ["棱锥", () => {
          choose("pyramid");
          accept({ kind: "face", id: object.id, owner: object.id,
            distance: 0, vertices: object.points },
            screenPoint(doc, size, geometry.points.get(object.points[0])?.p ?? plane.origin));
        }],
      );
    if (selectedPoint && !selectedPoint.object)
      buttons.push(["标记顶点", () => run(`Point(${rname(last)})`)]);
    return object?.kind==="polygon"&&object.section?buttons.filter(([label])=>label!=="棱柱"&&label!=="棱锥"):buttons;
  };
  const contextActions = surfaceActions();
  if (object?.kind === "curve") contextActions.push(["取值范围", () => setRight(true)]);
  if (object?.kind === "label" && object.measurement?.type === "angle") contextActions.push(["角度标记", () => setRight(true)]);
  const perpendicularOption = object?.kind === "line" && object.relation?.type === "perpendicular" ? (
    <label className="perpendicular-option"><input type="checkbox" checked={!!object.relation.showRightAngle}
      onChange={e => patch(object.id, {relation:{...object.relation!, showRightAngle:e.target.checked}})} />显示垂直符号</label>
  ) : null;
  const actionPoint =
    selectedPoint?.p ??
    (edge ? geometry.points.get(edge.a)?.p : undefined) ??
    (object?.kind === "label" ? object.position : undefined);
  const actionPosition = actionPoint
    ? screenPoint(doc, size, actionPoint)
    : scene.paths.find(
        (p) => selection.includes(p.id) || selection.includes(p.owner),
      )?.points[0];

  const resizeDown = (e: ReactPointerEvent) => {
    panelResize.current = { x: e.clientX, width: leftWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  return (
    <>
      <div className="draw-toolbar workbench-toolbar" role="toolbar" aria-label="选择与视图">
        <button
          aria-label={left ? "收起表达式列表" : "展开表达式列表"}
          onClick={() => setLeft(!left)}
        >
          <PanelLeftClose size={15} /> 对象
        </button>
        <select
          aria-label="平面或立体模式"
            title="切换平面 / 立体将创建新画布"
          value={doc.dimension}
          onChange={(e) => props.mode(e.target.value as "2d" | "3d")}
        >
          <option value="2d">平面几何</option>
          <option value="3d">立体几何</option>
        </select>
        <button onClick={()=>{editor.current?.flush();choose("select");setConstraintEditor("new");}}>按条件作图</button>
        <i />
        <div className="canvas-drag-modes" role="group" aria-label="鼠标拖动方式">
          <button aria-pressed={state.tool === "select" && dragMode === "box"}
            className={state.tool === "select" && dragMode === "box" ? "active" : ""}
            title="点击选对象；空白处拖动框选；拖动自由点可修改位置"
            onClick={() => { choose("select"); setDragMode("box"); }}>
            <MousePointer2 size={15} /> 选择 / 框选
          </button>
          <button aria-pressed={dragMode === "pan"} className={dragMode === "pan" ? "active" : ""}
            title="拖动画布，不移动图形；也可随时按住空格或使用中键"
            onClick={() => { choose("select"); setDragMode("pan"); }}>
            <Hand size={15} /> 平移画布
          </button>
        </div>
        <span className="draw-flex" />
        {props.fileActions}
        <button aria-label="撤销绘图操作" title="撤销 ⌘ / Ctrl + Z" disabled={!props.historyCount} onClick={props.undo}>
          <Undo2 size={15} />
        </button>
        <button aria-label="重做绘图操作" title="重做 ⌘ / Ctrl + Shift + Z" disabled={!props.redoCount} onClick={props.redo}>
          <Redo2 size={15} />
        </button>
        <button onClick={props.fit} title="缩放至全部有限图形"><Maximize size={14} /> 全图</button>
        <button aria-label={doc.view.axes ? "隐藏坐标系" : "显示坐标系"}
          aria-pressed={doc.view.axes} onClick={() => patchView({ axes: !doc.view.axes })}>
          坐标系 {doc.view.axes ? "开" : "关"}
        </button>
        <details className="view-options">
          <summary>显示 ▾</summary>
          <div>
            <label><input type="checkbox" checked={doc.view.grid} onChange={e => patchView({ grid: e.target.checked })} />辅助网格</label>
            <label><input type="checkbox" checked={gridSnap} onChange={e => setGridSnap(e.target.checked)} />网格吸附</label>
            <button onClick={e => { setRight(true); e.currentTarget.closest("details")?.removeAttribute("open"); }}>图面与导出设置</button>
          </div>
        </details>
        <button aria-label="显示或隐藏属性栏" onClick={() => setRight(!right)}><PanelRightClose size={15} /> 属性</button>
        <button aria-label="绘图操作指南" aria-pressed={help} onClick={() => setHelp(!help)}><HelpCircle size={15} /> 指南</button>
      </div>
      {help && <section className="drawing-quick-guide" aria-label="绘图入门">
        <strong>从这里开始</strong>
        <span><b>1. 选工具</b> 在下方分组中选择点、线段或图形。</span>
        <span><b>2. 跟随提示</b> 在画布逐点点击，下方会说明下一步。</span>
        <span><b>3. 精确调整</b> 在左侧改定义，或选中图形后点“属性”。</span>
        <small>滚轮缩放 · 空格拖动临时平移 · Esc 取消当前步骤，再按返回选择</small>
        <button onClick={() => setHelp(false)} aria-label="关闭绘图指南"><X size={14} /></button>
      </section>}
        <ToolBar
          tool={state.tool}
          choose={choose}
          dimension={doc.dimension}
          parametric={() => openParam("参数曲线", "依次输入 x(t)、y(t)、t 起点、t 终点，用逗号分隔。支持 LaTeX；例如 cos(t), sin(t), 0, 2*pi", value => {
            const before = docRef.current, next = applyDefinition(before, `Parametric(${value})`);
            if (update(next)) { const added = next.objects.filter(o => !before.objects.some(p => p.id === o.id)); setSelection(added.filter(o => o.kind === "curve").map(o => o.id)); }
          }, "cos(t), sin(t), 0, 2*pi")}
          preset={(type, id) => {
            try {
              if (type === "solid") {
                const o = solidObject(id as Parameters<typeof solidObject>[0]);
                o.name = {
                  cube: "正方体",
                  cuboid: "长方体",
                  prism: "正棱柱",
                  pyramid: "正棱锥",
                  frustum: "正棱台",
                  cylinder: "圆柱",
                  cone: "圆锥",
                  coneFrustum: "圆台",
                  sphere: "球",
                }[id as "cube"];
                commitObjects([o], [], {
                  view: { ...docRef.current.view, mode: "space" },
                });
              } else {
                const preset = {
                  type: id as "circle",
                  h: 0,
                  k: 0,
                  a: 3,
                  b: 2,
                  angle: 0,
                };
                commitObjects(
                  [
                    {
                      id: crypto.randomUUID(),
                      kind: "curve",
                      name: {
                        circle: "圆",
                        ellipse: "椭圆",
                        hyperbola: "双曲线",
                        parabola: "抛物线",
                      }[id as "circle"],
                      planeId: plane.id,
                      equation: presetEquation(preset),
                      autoFoci: true,
                      preset,
                      range: [-5, 5, -5, 5],
                      followView: true,
                      style: defaultStyle(),
                    },
                  ],
                  [],
                );
              }
            } catch (e) {
              onError(msg(e));
            }
          }}
        />
      {doc.dimension === "3d" && (
        <div className="draw-plane-bar compact-plane-bar">
          <span title="鼠标创建的新点落在这个平面上">作图平面</span>
          <select
            aria-label="当前工作平面"
            value={doc.view.planeId}
            onChange={(e) =>
              patchView({
                planeId: e.target.value,
                mode: "plane",
                center: [0, 0],
              })
            }
          >
            {doc.planes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <details className="view-options plane-create-menu">
            <summary>新建平面 ▾</summary>
            <div onClick={e => { if ((e.target as HTMLElement).closest("button")) e.currentTarget.closest("details")?.removeAttribute("open"); }}>
              <button onClick={() => choose("planeFace")}>选择已有面</button>
              <button onClick={() => choose("plane3")}>选择三个点</button>
          <button
            onClick={() =>
              openParam(
                "平面方程",
                "输入 a,b,c,d，表示 ax+by+cz+d=0",
                (value) => {
                  const n = splitArguments(value).map(scalar);
                  if (n.length !== 4) throw new Error("需要四个系数");
                  const p = planeFromEquation(n[0], n[1], n[2], n[3]);
                  update({
                    ...docRef.current,
                    planes: [...docRef.current.planes, p],
                    view: {
                      ...docRef.current.view,
                      planeId: p.id,
                      mode: "plane",
                      center: [0, 0],
                    },
                  });
                },
                "0,0,1,0",
              )
            }
          >
            输入平面方程…
          </button>
            </div>
          </details>
          <i />
          <span>观察</span>
          <button
            className={doc.view.mode === "plane" ? "active" : ""}
            onClick={() => patchView({ mode: "plane", center: [0, 0] })}
          >
            正视平面
          </button>
          <button
            className={doc.view.mode === "space" ? "active" : ""}
            onClick={() => patchView({ mode: "space", center: [0, 0] })}
          >
            空间总览
          </button>
          {doc.view.mode === "space" && (
            <>
              <select
                aria-label="空间投影方式"
                value={doc.view.projection ?? "oblique"}
                onChange={(e) =>
                  patchView({
                    projection: e.target.value as "orthographic" | "oblique",
                  })
                }
              >
                <option value="orthographic">正交轴测</option>
                <option value="oblique">斜二测</option>
              </select>
              <NumberField
                label="绕 z 轴"
                value={doc.view.angle}
                change={(angle) => patchView({ angle })}
                error={onError}
              />
              <input type="range" className="rotation-slider" aria-label="绕 z 轴旋转滑块"
                min={-180} max={180} step={1}
                value={doc.view.angle === 180 ? 180 : ((doc.view.angle + 180) % 360 + 360) % 360 - 180}
                onChange={e => patchView({ angle: Number(e.target.value) })} />

            </>
          )}
        </div>
      )}
      {constraintEditor!==null&&<ConstraintWorkbench key={`${doc.id}:${constraintEditor}`} docRef={docRef}
        existing={doc.objects.find((o):o is import("./types").DrawingSolutionSet=>o.id===constraintEditor&&o.kind==="solutionSet")}
        change={update} close={()=>setConstraintEditor(null)} highlight={setSelection}/>}
      <main className="draw-workspace">
        {left && (
          <>
            <div className="expressions-width" style={{ width: leftWidth }}>
              <ExpressionPanel
                doc={doc}
                selected={selection}
                select={select}
                change={update}
                drafts={props.drafts}
                previewProblem={props.expressionProblem}
                onDraft={onDraft}
                editor={editor}
                onContext={(id, x, y) => {
                  setSelection([id]);
                  setMenu({ x, y });
                }}
                onConstraintEdit={id=>setConstraintEditor(id)}
              />
            </div>
            <div
              role="separator"
              tabIndex={0}
              aria-label="调整表达式列表宽度"
              className="drawing-splitter"
              onPointerDown={resizeDown}
              onPointerMove={(e) => {
                if (panelResize.current)
                  setLeftWidth(
                    Math.max(
                      235,
                      Math.min(
                        520,
                        panelResize.current.width +
                          e.clientX -
                          panelResize.current.x,
                      ),
                    ),
                  );
              }}
              onPointerUp={() => {
                panelResize.current = null;
                localStorage.setItem(
                  "drawing.expressionWidth",
                  String(leftWidth),
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setLeftWidth((v) =>
                    Math.max(
                      235,
                      Math.min(520, v + (e.key === "ArrowLeft" ? -10 : 10)),
                    ),
                  );
                }
              }}
            />
          </>
        )}
        <div className="draw-canvas" ref={canvas}>
          {doc.dimension === "3d" && <div className="draw-pitch-control" role="group" aria-label="空间视角" onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
            <span title="相对标准空间视角的俯仰角">俯仰</span>
            <output>{Math.round(doc.view.pitch??0)}°</output>
            <input type="range" aria-label="画布俯仰角" aria-orientation="vertical" title="拖动调整俯仰，自动进入空间观察" min={-85} max={85} step={1} value={doc.view.pitch??0} onChange={e=>pitchSpaceView(Number(e.target.value))}/>
            <button title="恢复当前所建坐标系的 z 轴朝上；不改变几何坐标" aria-label="重置为所建 z 轴朝上" onClick={resetSpaceView}>z 轴朝上</button>
          </div>}

          {state.tool !== "select" && <div className="active-tool-prompt" role="status" aria-live="polite"><span>{toolGroups.flatMap(g=>g.items).find(([id])=>id===state.tool)?.[1]}</span><strong>请选择：<mark>{toolTarget(state)}</mark></strong><small>{toolStep(state)}</small><button onClick={()=>choose("select")} aria-label="退出当前作图工具">Esc 退出</button></div>}
          {doc.dimension === "3d" && (
            <div className="draw-plane-hint">
              {doc.view.mode === "plane" ? "正在正视" : "作图仍位于"}{" "}
              {plane.name} · u → / v ↑
            </div>
          )}
          {state.tool === "select" && selection.length > 0 && (
            <div
              className="selection-actions"
              style={
                actionPosition
                  ? {
                      left: Math.max(
                        12,
                        Math.min(size[0] - 300, actionPosition[0]),
                      ),
                      top: Math.max(
                        12,
                        Math.min(size[1] - 80, actionPosition[1] - 50),
                      ),
                    }
                  : undefined
              }
              role="toolbar"
              aria-label="选中对象操作"
            >
              <span>
                {selection.length > 1
                  ? `已选 ${selection.length} 项`
                  : (selectedPoint?.name ?? selectedRoot?.name ?? geometry.objects.get(selection[0])?.name ?? "已选对象")}
              </span>
              {contextActions.map(([label, action]) => (
                <button key={label} onClick={action}>
                  {label}
                </button>
              ))}
              {perpendicularOption}
              <button onClick={() => setRight(true)}>属性</button>
              {selectedRoot && (
                <button
                  onClick={() =>
                    patch(selectedRoot.id, { hidden: !selectedRoot.hidden })
                  }
                >
                  隐藏
                </button>
              )}
            </div>
          )}
          <svg
            ref={svg}
            className={`draw-svg tool-${state.tool} drag-${dragMode}`}
            aria-label="数学绘图画布"
            tabIndex={0}
            width="100%"
            height="100%"
            viewBox={`0 0 ${size[0]} ${size[1]}`}
            onPointerDown={down}
            onDragStart={e => e.preventDefault()}
            onPointerMove={scheduleMove}
            onPointerUp={up}
            onPointerCancel={() => {
              cancelMove();
              update(docRef.current,false,"complete");
              const d = pointer.current;
              pointer.current = null;
              setDragHint("");
              setBox(null);
              if (d && d.kind !== "pan") update(d.before, false);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const q = local(e),
                hits = pickHits(q);
              setSelection(hits[0] ? [hits[0].id] : []);
              setMenu({ x: e.clientX, y: e.clientY, hit: hits[0] });
            }}
            onWheel={(e) => {
              e.preventDefault();
              const r = svg.current!.getBoundingClientRect(),
                q: Vec2 = [e.clientX - r.left, e.clientY - r.top],
                before = docRef.current,
                scale = Math.max(
                  2,
                  Math.min(
                    2000,
                    before.view.scale * Math.exp(-e.deltaY * 0.0015),
                  ),
                );
              patchView({
                scale,
                center: [
                  before.view.center[0] +
                    (q[0] - size[0] / 2) * (1 / before.view.scale - 1 / scale),
                  before.view.center[1] +
                    (q[1] - size[1] / 2) * (1 / before.view.scale - 1 / scale),
                ],
              });
            }}
          >
            {doc.view.grid && (
              <>
                <defs>
                  <pattern
                    id="drawing-grid"
                    width={doc.view.scale}
                    height={doc.view.scale}
                    patternUnits="userSpaceOnUse"
                    x={size[0] / 2 - doc.view.center[0] * doc.view.scale}
                    y={size[1] / 2 - doc.view.center[1] * doc.view.scale}
                  >
                    <path
                      d={`M ${doc.view.scale} 0 L 0 0 0 ${doc.view.scale}`}
                      fill="none"
                      stroke="#e0e6e2"
                      strokeWidth=".6"
                    />
                  </pattern>
                </defs>
                <rect x={plotBounds(size)[0]} y={plotBounds(size)[2]}
                  width={plotBounds(size)[1]-plotBounds(size)[0]} height={plotBounds(size)[3]-plotBounds(size)[2]} fill="url(#drawing-grid)" />
              </>
            )}
            <g
              fill="none"
              stroke="black"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {scene.paths.map((p, i) => (
                <g key={`${p.id}:${i}`}>
                  <path
                    d={pathData(p.points)}
                    stroke={p.color ?? "#161b22"}
                    strokeWidth={p.width}
                    strokeDasharray={p.dashed ? "5 4" : undefined}
                  />
                  {p.arrow && (
                    <path
                      d={arrowData(p.points, p.width)}
                      fill={p.color ?? "#161b22"}
                      stroke="none"
                    />
                  )}
                  {(selection.includes(p.id) ||
                    selection.includes(p.owner) ||
                    hover?.id === p.id) &&
                    p.owner !== "axis" && (
                      <path
                        d={pathData(p.points)}
                        stroke="#368a71"
                        strokeWidth={p.width + 5}
                        opacity=".25"
                      />
                    )}
                </g>
              ))}
            </g>
            {scene.dots.map((d) => (
              <circle
                key={d.id}
                cx={d.p[0]}
                cy={d.p[1]}
                r={d.radius}
                fill={d.color ?? "#161b22"}
              />
            ))}
            {fontsReady && (
              <g fontFamily="Mindgrove Times">
                {scene.texts.map((t) => (
                  <text
                    data-owner={t.owner}
                    data-draw-text="true"
                    key={t.id}
                    x={t.p[0]}
                    y={t.p[1]}
                    fill={t.color ?? "#161b22"}
                    fontSize={t.fontSize}
                    fontStyle="normal"
                    className={t.owner !== "axis" ? "draw-label" : ""}
                  >
                    {(t.literal ? [{text:t.text,script:"normal",italic:t.italic}] : labelTypography(t.text, t.italic)).map((r, i) => (
                      <tspan
                        key={i}
                        fontStyle={r.italic ? "italic" : "normal"}
                        baselineShift={
                          r.script === "normal"
                            ? "baseline"
                            : r.script === "sub"
                              ? "sub"
                              : "super"
                        }
                        fontSize={r.script === "normal" ? "100%" : "70%"}
                      >
                        {r.text}
                      </tspan>
                    ))}
                  </text>
                ))}
              </g>
            )}
            <g
              className="drawing-overlays"
              pointerEvents="none"
              aria-hidden="true"
            >
              {handleRefs.size > 0 &&
                [...handleRefs].map((id) => {
                  const p = geometry.points.get(id);
                  if (!p) return null;
                  const q = screenPoint(doc, size, p.p);
                  return (
                    <circle
                      key={id}
                      cx={q[0]}
                      cy={q[1]}
                      r={5}
                      fill={selection.includes(id) ? "#3b8e77" : "white"}
                      stroke="#3b8e77"
                      strokeWidth="1.5"
                    />
                  );
                })}
              {hover?.kind === "face" && hover.vertices && (
                <polygon
                  points={hover.vertices
                    .map((id) =>
                      screenPoint(doc, size, geometry.points.get(id)!.p).join(
                        ",",
                      ),
                    )
                    .join(" ")}
                  fill="#68a48a"
                  opacity=".2"
                  stroke="#3b8e77"
                />
              )}
              {state.tool === "axes" && state.axisFace && <polygon
                points={state.axisFace.flatMap(id => {
                  const p = overlayPoints.points.get(id)?.p;
                  return p ? [screenPoint(doc,size,p).join(",")] : [];
                }).join(" ")} fill="#68a48a" fillOpacity=".13" stroke="#3b8e77" strokeDasharray="4 3" />}
              {state.tool === "axes" && axisPreview && (() => {
                const f = axisPreview, extent = Math.max(...size) / doc.view.scale * .4;
                const a = screenPoint(doc,size,f.origin);
                const axes = [f.x, f.y, mul(cross(f.x,f.y),zSign)];
                return axes.map((dir,i) => {
                  const b = screenPoint(doc,size,add(f.origin,mul(dir,extent))), color = ["#2879c8","#ad5b98","#3b8e77"][i];
                  return <g key={i}><path d={pathData([a,b])} stroke={color} strokeWidth="2" />
                    <path d={arrowData([a,b],2)} fill={color} /><text x={b[0]+8} y={b[1]-8} fill={color}>{["x","y","z"][i]}</text></g>;
                });
              })()}
              {state.tool === "axes" && !axisPreview && livePoints.length >= 1 && (() => {
                const origin = livePoints[0],
                  x = livePoints[1] ?? snap?.position;
                const directions = [
                  ...(x && norm(sub(x,origin)) > 1e-8 ? [{ end: add(origin,mul(unit(sub(x,origin)),Math.max(...size)/doc.view.scale*.4)), name: "x", color: "#2879c8" }] : []),
                ];
                const a = screenPoint(doc, size, origin);
                return directions.map(({ end, name, color }) => {
                  const b = screenPoint(doc, size, end);
                  return <g key={name}>
                    <path d={pathData([a, b])} stroke={color} strokeWidth="2" />
                    <path d={arrowData([a, b], 2)} fill={color} />
                    <text x={b[0] + 8} y={b[1] - 8} fill={color}>{name}</text>
                  </g>;
                });
              })()}
              {previewLines.map((line, i) => (
                <path
                  key={i}
                  d={pathData(line)}
                  fill="none"
                  stroke="#3b8e77"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                />
              ))}
              {previewScene?.paths
                .filter((p) => allPreview.some((o) => o.id === p.owner))
                .map((p, i) => (
                  <path
                    key={`preview${i}`}
                    d={pathData(p.points)}
                    fill="none"
                    stroke="#3b8e77"
                    strokeWidth="1.5"
                    strokeDasharray={p.dashed ? "3 3" : "6 3"}
                  />
                ))}
              {allPreview
                .filter((o) => o.kind === "point")
                .map((o) => {
                  const p = previewGeometry?.points.get(o.id);
                  if (!p) return null;
                  const q = screenPoint(doc, size, p.p);
                  return (
                    <g key={o.id}>
                    <circle
                      cx={q[0]}
                      cy={q[1]}
                      r={6}
                      stroke="#3b8e77"
                      strokeWidth="2"
                      fill="#e7f2e9"
                    />
                    {state.preview.length > 1 && state.preview.some(p => p.id === o.id) &&
                      <text x={q[0] + 9} y={q[1] - 9} fill="#287558" stroke="none">
                        {state.preview.findIndex(p => p.id === o.id) + 1}
                      </text>}
                    </g>
                  );
                })}
              {snap && wantsPoint(state) && (state.tool !== "locus" || snap.existing) && (
                <circle
                  cx={screenPoint(doc, size, snap.position)[0]}
                  cy={screenPoint(doc, size, snap.position)[1]}
                  r={5}
                  fill="#e5f4e8"
                  stroke="#27815f"
                  strokeWidth="2"
                />
              )}
              {box && (
                <rect
                  x={Math.min(box.start[0], box.end[0])}
                  y={Math.min(box.start[1], box.end[1])}
                  width={Math.abs(box.start[0] - box.end[0])}
                  height={Math.abs(box.start[1] - box.end[1])}
                  fill="#72a98c22"
                  stroke="#4b9476"
                  strokeDasharray="4 3"
                />
              )}
            </g>
          </svg>
          {candidates && (
            <div
              className="hit-candidates"
              style={{
                left: Math.min(size[0] - 220, candidates.x),
                top: Math.min(size[1] - 200, candidates.y),
              }}
            >
              <strong>选择重叠对象</strong>
              {state.tool==="select"&&candidates.hits.some(draggablePoint)&&<small>按住可拖动的点名，直接拖出菜单</small>}
              {candidates.hits.map((h) => (
                <button
                  key={h.id}
                  onPointerEnter={() => setHover(h)}
                  onPointerDown={e=>{
                    e.stopPropagation();
                    if(e.button===0&&stateRef.current.tool==="select"&&draggablePoint(h)){
                      e.preventDefault();setCandidates(null);executeSelection(h,e,local(e));svg.current?.focus();
                    }
                  }}
                  onClick={(e) => {
                    setCandidates(null);
                    if (stateRef.current.tool === "select") {
                      const body=h.kind==="face"?docRef.current.objects.find(o=>o.id===h.id)?.body:undefined;
                      select(body&&!e.altKey?body:h.id);
                    }
                    else accept(h, candidates.q);
                    svg.current?.focus();
                  }}
                >
                  {hitLabel(h)}
                  {h.kind==="point"&&state.tool==="select"&&<small> · {pointRole(h)}</small>}
                </button>
              ))}
              <button onClick={() => setCandidates(null)}>取消</button>
            </div>
          )}
          {(state.preview.length > 0 ||
            state.base ||
            state.tool === "axes") && (
            <div className="construction-preview-controls">
              <strong>
                {state.tool === "axes"
                  ? "空间坐标系"
                  : state.tool === "prism"
                      ? "棱柱预览"
                      : "棱锥预览"}
              </strong>
              {state.tool === "axes" && <>
                <ol className="axes-steps">
                  {["原点", "x 正方向", "xOy 面", "y 正方向"].map((label,i) => {
                    const step = state.axisPlane ? 3 : state.points.length;
                    return <li key={label} className={i === step ? "current" : i < step ? "done" : ""}
                      aria-current={i === step ? "step" : undefined}>{i < step ? "✓" : i+1} {label}</li>;
                  })}
                </ol>
                {state.points.length===2&&!state.axisPlane&&<label>xOy 工作平面
                  <select aria-label="坐标系 xOy 工作平面" value="" onChange={e=>{
                    const selected=docRef.current.planes.find(p=>p.id===e.target.value);
                    if(selected)try{selectAxisPlane(selected);}catch(error){onError(msg(error));}
                  }}><option value="">点击图中面，或选择已有工作平面</option>{doc.planes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </label>}
                {state.axisPlane && <small>
                  点击面内的点或空白处，决定 y 轴朝向哪一侧。y 始终与 x 垂直；方向点不必恰好在 y 轴上。
                </small>}
              </>}
              {state.base && (
                <>
                  <label>
                    {state.tool === "prism"
                      ? "高度 / 向量 (x,y,z) / 向量名"
                      : "顶点名或坐标 (x,y,z)"}
                    <input
                      aria-label="构造预览参数"
                      value={parameter}
                      onChange={(e) => setSolidParameter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmPreview();
                        }
                      }}
                    />
                  </label>
                  {state.tool === "pyramid" && !state.preview.length && (
                    <small>也可直接点击图上的顶点。</small>
                  )}
                </>
              )}
              {state.tool === "axes" && (
                <label>
                  z 正方向
                  <select
                    value={zSign}
                    onChange={(e) => setZSign(Number(e.target.value) as 1 | -1)}
                  >
                    <option value={1}>右手系：z = x × y</option>
                    <option value={-1}>左手系：z = −(x × y)</option>
                  </select>
                </label>
              )}
              {state.tool === "axes" && <small>
                右手四指从 x 正向弯向 y 正向，拇指指向 z 正向。翻转 z 保持 x、y 不动。
              </small>}
              {state.tool === "axes" && axisPreview && <small className="axis-vector-readout">
                z = ({mul(cross(axisPreview.x,axisPreview.y),zSign).map(v => Number(v.toFixed(4))).join(", ")})
                （原空间坐标）
              </small>}
              {parameterError && (
                <small role="alert" className="expression-problem">
                  {parameterError}
                </small>
              )}
              {state.preview.length > 0 && (
                <button onClick={confirmPreview}>创建（Enter）</button>
              )}
              {state.tool === "axes" && state.points.length > 0 && <button onClick={() => {
                if (state.axisPlane) setToolState({ ...state, axisPlane: undefined, axisFace: undefined });
                else setToolState(rejectLastPoint(state));
                setSnap(null); setParameterError(""); svg.current?.focus();
              }}>上一步</button>}
              <button
                onClick={() => {
                  setToolState(initialTool(state.tool));
                  setSnap(null);
                }}
              >
                取消（Esc）
              </button>
            </div>
          )}
          {pending && <span className="draw-calculating">正在计算曲线…</span>}
          {!ready && <div className="draw-loading">正在恢复绘图…</div>}
        </div>
        {right && (
          <aside className="draw-right workbench-inspector">
            <div className="inspector-heading">
              <strong>
                {selectedPoint?.name ?? object?.name ?? "图面与导出"}
              </strong>
              <button aria-label="收起属性栏" onClick={() => setRight(false)}>
                <X size={14} />
              </button>
            </div>
            <section>
              {object && (
                <>
                  <label>
                    显示名称
                    <input
                      aria-label="对象显示名称"
                      key={object.id + object.name}
                      defaultValue={object.name}
                      onBlur={(e) => patch(object.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!object.locked}
                      onChange={(e) =>
                        patch(object.id, { locked: e.target.checked })
                      }
                    />
                    锁定位置
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!object.hidden}
                      onChange={(e) =>
                        patch(object.id, { hidden: e.target.checked })
                      }
                    />
                    隐藏对象
                  </label>
                  <ColorPalette key={object.id} value={object.style.color ?? "#161b22"} used={usedColors} change={color=>patch(object.id,{style:{...object.style,color}})}/>
                  <label>
                    线型
                    <select
                      value={object.style.line}
                      onChange={(e) =>
                        patch(object.id, {
                          style: {
                            ...object.style,
                            line: e.target.value as "auto",
                          },
                        })
                      }
                    >
                      {["auto", "solid", "dashed", "hidden"].map((x, i) => (
                        <option key={x} value={x}>
                          {["自动", "实线", "虚线", "隐藏"][i]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="字号"
                    value={object.style.fontSize}
                    error={onError}
                    change={(fontSize) =>
                      patch(object.id, { style: { ...object.style, fontSize } })
                    }
                  />
                </>
              )}
              {object?.kind === "label" && object.measurement?.type === "angle" && <AngleMeasurementControls label={object} change={measurement=>patch(object.id,{measurement})} error={onError}/>}
              {selectedPoint && (
                <>
                  <p>
                    空间坐标 (
                    {selectedPoint.p
                      .map((v) => Number(v.toFixed(5)))
                      .join(", ")}
                    )
                  </p>
                  <p>
                    平面坐标 (
                    {toPlane(plane, selectedPoint.p)
                      .map((v) => Number(v.toFixed(5)))
                      .join(", ")}
                    )
                  </p>
                  {selectedPoint.object?.construction.type === "free" && !selectedPoint.object.parameters && !selectedBinding &&
                    selectedPoint.p.map((v, i) => (
                      <NumberField
                        key={i}
                        label={["x", "y", "z"][i]}
                        value={v}
                        error={onError}
                        change={(value) => {
                          const position = [...selectedPoint.p] as Vec3;
                          position[i] = value;
                          patch(selectedPoint.id, {
                            construction: { type: "free", position },
                          });
                        }}
                      />
                    ))}
                  {selectedPoint.object && (
                    <>
                      <label>圆点显示
                        <select aria-label="圆点显示" value={selectedPoint.object.dot ?? "auto"}
                          onChange={e=>patch(selectedPoint.id,{dot:e.target.value as "auto"|"show"|"hide"})}>
                          <option value="auto">自动（交叉点、端点隐藏）</option>
                          <option value="show">始终显示</option>
                          <option value="hide">始终隐藏</option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedPoint.object.showName}
                          onChange={(e) =>
                            patch(selectedPoint.id, {
                              showName: e.target.checked,
                            })
                          }
                        />
                        显示点名
                      </label>
                      <label>
                        坐标标注
                        <select
                          value={selectedPoint.object.coordinates}
                          onChange={(e) =>
                            patch(selectedPoint.id, {
                              coordinates: e.target.value as "none",
                            })
                          }
                        >
                          <option value="none">不显示</option>
                          <option value="full">完整坐标</option>
                          <option value="axes">向轴投影</option>
                        </select>
                      </label>
                    </>
                  )}
                  {(selectedBinding||selectedPoint.object?.construction.type !== "free") && (
                    <small>{selectedBinding?.reference?"固定参照点；如需改变参照，请在条件解集中切换参照结构。":selectedBinding?"此点受条件管理；拖动会联动求解并校验全部条件，不能独立改动坐标。":"此点由来源构造，拖动不会改为自由点。"}</small>
                  )}
                </>
              )}
              {perpendicularOption}
              {edge && (
                <label>
                  此边线型
                  <select
                    value={doc.edgeStyles[edge.id] ?? "auto"}
                    onChange={(e) =>
                      update({
                        ...doc,
                        edgeStyles: {
                          ...doc.edgeStyles,
                          [edge.id]: e.target.value as "auto",
                        },
                      })
                    }
                  >
                    {["auto", "solid", "dashed", "hidden"].map((v, i) => (
                      <option key={v} value={v}>
                        {["自动", "实线", "虚线", "隐藏"][i]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {object?.kind === "solid" && !object.construction && (
                <>
                  <h3>尺寸</h3>
                  {(
                    [
                      "width",
                      "depth",
                      "height",
                      "radius",
                      "topRadius",
                      "sides",
                    ] as const
                  ).map((k, i) => (
                    <NumberField
                      key={k}
                      label={
                        [
                          "宽 / 棱长",
                          "深度",
                          "高度",
                          "半径",
                          "上底半径",
                          "边数",
                        ][i]
                      }
                      value={object[k]}
                      error={onError}
                      change={(value) => patch(object.id, { [k]: value })}
                    />
                  ))}
                  <h3>位置与朝向</h3>
                  {(["origin", "rotation"] as const).flatMap((k) =>
                    object[k].map((v, i) => (
                      <NumberField
                        key={k + i}
                        label={`${k === "origin" ? "位置" : "绕"} ${["x", "y", "z"][i]}`}
                        value={v}
                        error={onError}
                        change={(value) => {
                          const values = [...object[k]] as Vec3;
                          values[i] = value;
                          patch(object.id, { [k]: values });
                        }}
                      />
                    )),
                  )}
                </>
              )}
              {object?.kind === "curve" &&
                object.preset &&
                (["h", "k", "a", "b", "angle"] as const).map((k, i) => (
                  <NumberField
                    key={k}
                    label={
                      [
                        "中心 / 顶点 u",
                        "中心 / 顶点 v",
                        "半轴 / 参数 a",
                        "半轴 b",
                        "旋转角",
                      ][i]
                    }
                    value={object.preset![k]}
                    error={onError}
                    change={(v) => {
                      const preset = { ...object.preset!, [k]: v };
                      patch(object.id, {
                        preset,
                        equation: presetEquation(preset),
                      });
                    }}
                  />
                ))}
              {object?.kind === "curve" && <CurveLimits key={object.id} curve={object} change={limits => patch(object.id, {limits})} error={onError} />}
              {object?.kind === "curve" && object.parametric && <p className="field-hint">参数范围：{object.parametric.tMin} ≤ t ≤ {object.parametric.tMax}。在左侧定义行修改 x(t)、y(t) 和 t 的起止值。</p>}
              {object && sourceIds(doc, object.id).length > 0 && (
                <div className="source-links">
                  <h3>来源</h3>
                  {sourceIds(doc, object.id).map((id) => (
                    <button key={id} onClick={() => select(id)}>
                      定位 {rname(id)}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section>
              <NumberField
                label="图面统一线宽"
                value={doc.lineWidth ?? 1.25}
                error={onError}
                change={(lineWidth) => update({ ...doc, lineWidth })}
              />
              <h3>导出设置</h3>
              <NumberField
                label="PNG / 剪贴板宽度"
                value={doc.output.width}
                error={onError}
                change={(width) =>
                  update({ ...doc, output: { ...doc.output, width } }, false)
                }
              />
              <label>
                背景
                <select
                  value={doc.output.background}
                  onChange={(e) =>
                    update(
                      {
                        ...doc,
                        output: {
                          ...doc.output,
                          background: e.target.value as "white",
                        },
                      },
                      false,
                    )
                  }
                >
                  <option value="transparent">透明</option>
                  <option value="white">白色</option>
                </select>
              </label>
              <label>
                范围
                <select
                  value={doc.output.crop}
                  onChange={(e) =>
                    update(
                      {
                        ...doc,
                        output: {
                          ...doc.output,
                          crop: e.target.value as "view",
                        },
                      },
                      false,
                    )
                  }
                >
                  <option value="content">图形自动裁切</option>
                  <option value="view">完整视图</option>
                  <option value="custom">指定投影范围</option>
                </select>
              </label>
              {doc.output.crop === "custom" &&
                doc.output.bounds.map((v, i) => (
                  <NumberField
                    key={i}
                    label={["x 最小", "x 最大", "y 最小", "y 最大"][i]}
                    value={v}
                    error={onError}
                    change={(n) => {
                      const bounds = [
                        ...doc.output.bounds,
                      ] as typeof doc.output.bounds;
                      bounds[i] = n;
                      update(
                        { ...doc, output: { ...doc.output, bounds } },
                        false,
                      );
                    }}
                  />
                ))}
              <small>Times New Roman · 导出不包含选择和预览。</small>
              <button
                onClick={() =>
                  void invoke<boolean>("drawing_choose_fonts")
                    .then((ok) => {
                      if (ok) return props.loadFonts();
                    })
                    .catch((e) => onError(msg(e)))
                }
              >
                选择字体文件…
              </button>
            </section>
          </aside>
        )}
      </main>
      <div className="tool-instructions" role="status">
        <strong>{dragHint || (state.tool === "select" ? dragMode === "pan"
          ? "平移画布：按住鼠标拖动 · 滚轮缩放 · 点“选择 / 框选”返回编辑"
          : selectedInverse?.derived?.type==="locus" ? `拖动从动点 ${rname(selection[0])}，沿轨迹反向调整主动点 ${rname(selectedInverse.derived.driver)} · 拖动点名可调整标签`
          : "选择 / 框选：点击选对象 · 空白拖动框选 · 拖动自由点 · 空格临时平移"
          : `${toolGroups.flatMap(g => g.items).find(([id]) => id === state.tool)?.[1] ?? "作图"} · ${toolStep(state)}`)}</strong>
        <span>
          {snap && state.tool !== "select"
            ? snap.hint
            : hover
              ? hitLabel(hover)
              : ""}
        </span>
        {state.points.length > 0 && (
          <button onClick={() => choose(state.tool)}>取消当前构造</button>
        )}
      </div>
      {menu && (
        <>
          <div
            className="context-dismiss"
            onPointerDown={() => setMenu(null)}
          />
          <div
            className="drawing-context-menu"
            role="menu"
            style={{
              left: Math.min(window.innerWidth - 240, menu.x),
              top: Math.min(window.innerHeight - 420, menu.y),
            }}
          >
            {contextActions.map(([label, action]) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  action();
                }}
              >
                {label}
              </button>
            ))}
            {selectedRoot && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setRight(true);
                  }}
                >
                  属性与重命名
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    patch(selectedRoot.id, { hidden: !selectedRoot.hidden });
                    setMenu(null);
                  }}
                >
                  {selectedRoot.hidden ? "显示" : "隐藏"}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    patch(selectedRoot.id, { locked: !selectedRoot.locked });
                    setMenu(null);
                  }}
                >
                  {selectedRoot.locked ? "解除锁定" : "锁定位置"}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    deleteSelection();
                    setMenu(null);
                  }}
                >
                  删除{object ? "对象" : "所属对象"}…
                </button>
              </>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                props.fit();
              }}
            >
              查看全图
            </button>
          </div>
        </>
      )}
      {deleteIds && (
        <div className="draw-modal-shade">
          <div className="draw-modal" role="dialog" aria-label="删除对象与依赖">
            <h2>删除对象与相关构造？</h2>
            <p>
              将删除：
              {[
                ...new Set(
                  deleteIds.flatMap((id) => [...affectedObjects(doc, id)]),
                ),
              ]
                .map((id) => doc.objects.find((o) => o.id === id)?.name)
                .join("、")}
              。可以撤销恢复。
            </p>
            <div className="draw-button-row">
              <button onClick={() => setDeleteIds(null)}>取消</button>
              <button
                onClick={() => {
                  const ids = new Set(
                    deleteIds.flatMap((id) => [
                      ...affectedObjects(docRef.current, id),
                    ]),
                  );
                  update({
                    ...docRef.current,
                    objects: docRef.current.objects.filter(
                      (o) => !ids.has(o.id),
                    ),
                    edgeStyles: Object.fromEntries(
                      Object.entries(docRef.current.edgeStyles).filter(
                        ([id]) => !ids.has(id.split(":")[0]),
                      ),
                    ),
                  });
                  for (const id of ids) onDraft(id);
                  setSelection([]);
                  setDeleteIds(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingInput && (
        <div className="draw-modal-shade">
          <div
            className="draw-modal"
            role="dialog"
            aria-label={pendingInput.title}
          >
            <h2>{pendingInput.title}</h2>
            <p>{pendingInput.help}</p>
            <input autoCorrect="off" autoCapitalize="off" spellCheck={false}
              autoFocus
              aria-label="精确构造参数"
              value={pendingInput.value}
              onChange={(e) =>
                setPendingInput({ ...pendingInput, value: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") setPendingInput(null);
                if (e.key === "Enter")
                  try {
                    pendingInput.confirm(pendingInput.value);
                    setPendingInput(null);
                  } catch (e) {
                    setParameterError(msg(e));
                  }
              }}
            />
            {pendingInput.title === "文字标注" && <div className="annotation-preview"><strong>实时预览</strong><Markdown text={pendingInput.value}/></div>}
            {pendingInput.title === "参数曲线" && <div className="expression-preview"><Markdown text={`$${mathPreview(pendingInput.value)}$`} /></div>}
            {parameterError && (
              <p className="expression-problem">{parameterError}</p>
            )}
            <div className="draw-button-row">
              <button onClick={() => setPendingInput(null)}>取消</button>
              <button
                onClick={() => {
                  try {
                    pendingInput.confirm(pendingInput.value);
                    setPendingInput(null);
                  } catch (e) {
                    setParameterError(msg(e));
                  }
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="draw-modal-shade">
          <div className="draw-modal" role="alertdialog">
            <h2>构造提示</h2>
            <p>{notice}</p>
            <button onClick={() => setNotice("")}>确定</button>
          </div>
        </div>
      )}
    </>
  );
}
