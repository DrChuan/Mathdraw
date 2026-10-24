import type { ConstraintProblem, ConstraintResult, Pose } from "./constraints/types";
export type Vec2 = [number, number];
export type DrawingChange = (doc: DrawingDocument, history?: boolean, phase?: "continuous" | "complete") => boolean;
export type Vec3 = [number, number, number];
export type LineMode = "auto" | "solid" | "dashed" | "hidden";
export interface DrawingStyle {
  width: number;
  color?: string;
  line: LineMode;
  fontSize: number;
  italic: boolean;
}
export interface WorkPlane {
  id: string;
  name: string;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}
interface ObjectBase {
  id: string;
  name: string;
  hidden?: boolean;
  auxiliary?: boolean;
  symbol?: string;
  locked?: boolean;
  constraintSet?: string;
  /** Ownership only; fixed generated objects retain ordinary editing behavior. */
  constraintPointName?: string;
  constraintFace?: string;
  /** A face belongs to a closed polyhedron, but retains its ID for references. */
  body?: string;
  style: DrawingStyle;
  parameters?: {
    source: string;
    references: Record<string, string>;
    fields: Record<string, string | { coordinates: string[]; planeId?: string; direction?: boolean }>;
  };
}
export type PointConstruction =
  | { type:"rotation"; point:string;axis:string;angle:string }
  | { type:"planeOffset"; plane:DrawingPlaneSource; anchor:string; offset:Vec3 }
  | { type: "planeOrigin"; plane: DrawingPlaneSource }
  | { type: "planeNormal"; plane: DrawingPlaneSource }
  | { type: "constraint"; set: string; point: string }
  | { type: "origin" }
  | { type: "focus"; curve: string; index: number }
  | { type: "vertex"; curve: string; index: number }
  | { type: "curveCenter"; curve: string }
  | { type: "onAxis"; axis: "x" | "y" | "z"; parameter: number; planeId?: string }
  | { type: "free"; position: Vec3 }
  | { type: "alias"; point: string }
  | { type: "reflection"; point: string; axis: string }
  | { type: "angleDirection"; points: [string,string,string] }
  | { type: "onPath"; path: string; parameter: number; seed?: Vec2 }
  | {
      type: "curveCoordinate";
      curve: string;
      axis: "x" | "y";
      value: number;
      branch: number;
    }
  | { type: "intersection"; first: string; second: string; branch: number }
  | { type: "division"; a: string; b: string; t: number }
  | {
      type: "center";
      points: [string, string, string];
      center: "centroid" | "circumcenter" | "orthocenter" | "incenter";
    };
export interface DrawingPoint extends ObjectBase {
  kind: "point";
  dot?: "auto" | "show" | "hide";
  construction: PointConstruction;
  showName: boolean;
  coordinates: "none" | "full" | "axes";
  labelOffset: Vec2;
}
export interface DrawingSegment extends ObjectBase {
  kind: "segment" | "vector" | "line";
  points: [string, string];
  ray?: boolean;
  normalPlane?: DrawingPlaneSource;
  relation?: {
    type: "parallel" | "perpendicular" | "bisector";
    reference?: string;
    plane?: DrawingPlaneSource;
    planeId: string;
    showRightAngle?: boolean;
  };
}
export interface DrawingTriangle extends ObjectBase {
  kind: "triangle";
  points: [string, string, string];
}
export interface DrawingPolygon extends ObjectBase {
  kind: "polygon";
  points: string[];
  section?: { solid:string; plane:DrawingPlaneSource };
  fold?: { source:string;axis:string;angle:string;originalBody?:string };
}
export type DrawingPlaneSource =
  | { type:"points"; points:[string,string,string] }
  | { type:"lines"; lines:[string,string] }
  | { type:"linePoint"; line:string; point:string }
  | { type:"polygon"; polygon:string }
  | { type:"workplane"; planeId:string };
export type SolidConstruction =
  | { type:"roundPoints"; points:string[] }
  | { type: "faces"; faces: string[] }
  | { type: "extrusion"; base: string; direction: Vec3; vector?: string }
  | { type: "apex"; base: string; apex: string }
  | { type: "circumsphere"; vertices: string[]; source?: string }
  | { type: "insphere"; source: string };
export type ConicKind = "circle" | "ellipse" | "hyperbola" | "parabola";
export interface DrawingCurve extends ObjectBase {
  kind: "curve";
  planeId: string;
  equation: string;
  autoFoci?: boolean;
  declaration?:{id:string;points:string[]};
  derived?:
    | { type: "reflection"; source: string; axis: string }
    | { type: "tangent"; curve: string; point: string; branch: number }
    | { type: "perpendicularTangent"; curve:string; reference:string; branch:number }
    | { type: "conicFeature"; curve: string; feature: "directrix"|"asymptote"; index: number }
    | { type: "locus"; driver: string; follower: string; min: number; max: number; natural?:boolean };
  /** Computed samples only; never written by construction commands. */
  reflectionInput?: { source: DrawingCurve; a: Vec2; b: Vec2 };
  locusInput?: { document: DrawingDocument; driver:string; follower:string; min:number; max:number };
  resolvedDefinition?: string;
  locusRangeDescription?:string;
  parametric?: { x: string; y: string; tMin: number; tMax: number };
  limits?: { xMin?: number; xMax?: number; yMin?: number; yMax?: number };
  /** Resolved spatial curve plane; runtime only. */
  frame?: WorkPlane;
  circle?: {
    type: "centerPoint" | "centerRadius" | "threePoint" | "incircle";
    points: string[];
    radius?: number;
  };
  preset?: {
    type: ConicKind;
    h: number;
    k: number;
    a: number;
    b: number;
    angle: number;
  };
  range: [number, number, number, number];
  followView?: boolean;
}
export type SolidKind =
  | "cube"
  | "cuboid"
  | "prism"
  | "pyramid"
  | "frustum"
  | "cylinder"
  | "cone"
  | "coneFrustum"
  | "sphere";
export interface DrawingSolid extends ObjectBase {
  kind: "solid";
  shape: SolidKind;
  construction?: SolidConstruction;
  origin: Vec3;
  rotation: Vec3;
  basis?: [Vec3,Vec3,Vec3];
  width: number;
  depth: number;
  height: number;
  radius: number;
  topRadius: number;
  sides: number;
}
export interface DrawingLabel extends ObjectBase {
  kind: "label";
  position: Vec3;
  text: string;
  measurement?: {
    type: "length" | "angle" | "area" | "perimeter";
    references: string[];
    planeId: string;
    /** Screen-space radius; omitted in older drawings. */
    arcRadius?: number;
    angleName?: string;
    angleDisplay?: "both" | "name" | "value";
  };
}
export interface DrawingNumber extends ObjectBase {
  kind: "number";
  expression: string;
  references: Record<string, string>;
  value: number;
  slider: { min: number; max: number; step: number };
}
export interface DrawingSolutionSet extends ObjectBase {
  kind: "solutionSet";
  problem: ConstraintProblem;
  result: ConstraintResult;
  activeBranch: number;
  placement: Pose;
  driver?: string;
}
export interface DrawingSpatialLocus extends ObjectBase {
  kind: "spatialLocus";
  set: string;
  point: string;
}
export type GeometryObject =
  | DrawingSolutionSet
  | DrawingSpatialLocus
  | DrawingNumber
  | DrawingPoint
  | DrawingSegment
  | DrawingTriangle
  | DrawingPolygon
  | DrawingCurve
  | DrawingSolid
  | DrawingLabel;
export interface DrawingView {
  mode: "plane" | "space";
  planeId: string;
  angle: number;
  pitch?: number;
  projection?: "orthographic" | "oblique";
  scale: number;
  center: Vec2;
  axes: boolean;
  grid: boolean;
  camera?: Pose;
}
export interface DrawingDocument {
  schemaVersion: 1 | 2 | 3 | 4;
  type: "mindgrove-mathdraw";
  id: string;
  title: string;
  dimension: "2d" | "3d";
  objects: GeometryObject[];
  planes: WorkPlane[];
  edgeStyles: Record<string, LineMode>;
  lineWidth?: number;
  coordinateFrame?: { origin: Vec3; x: Vec3; y: Vec3; zSign: 1 | -1 };
  coordinateOriginId?: string;
  view: DrawingView;
  output: {
    width: number;
    background: "transparent" | "white";
    crop: "content" | "view" | "custom";
    bounds: [number, number, number, number];
  };
}
export interface DrawingFile {
  content: string;
  path: string | null;
  hash: string | null;
  savedContent?: string;
  uiDraft?: Record<string, string>;
  sourceVersion?: 1 | 2 | 3 | 4;
}
export interface DrawingAdapter {
  recover(): Promise<DrawingFile | null>;
  open(): Promise<DrawingFile | null>;
  save(
    content: string,
    path: string | null,
    hash: string | null,
    saveAs?: boolean,
  ): Promise<DrawingFile | null>;
  recoverSave(file: DrawingFile): Promise<void>;
  export(
    svg: string,
    format: "svg" | "png" | "clipboard",
    width: number,
  ): Promise<string | null>;
}
export const defaultStyle = (): DrawingStyle => ({
  width: 1.25,
  line: "auto",
  fontSize: 18,
  italic: true,
});
export const xyPlane = (): WorkPlane => ({
  id: "xy",
  name: "z=0",
  origin: [0, 0, 0],
  u: [1, 0, 0],
  v: [0, 1, 0],
});
export const originPoint = (): DrawingPoint => ({
  id: crypto.randomUUID(), name: "O", symbol: "O", kind: "point",
  construction: { type: "origin" }, style: defaultStyle(),
  showName: true, dot: "auto", coordinates: "none", labelOffset: [-17, 19],
});
export function newDrawing(): DrawingDocument {
  return {
    schemaVersion: 4,
    type: "mindgrove-mathdraw",
    id: crypto.randomUUID(),
    title: "未命名绘图",
    dimension: "2d",
    objects: [originPoint()],
    planes: [xyPlane()],
    edgeStyles: {},
    view: {
      mode: "plane",
      planeId: "xy",
      angle: 0,
      projection: "orthographic",
      scale: 48,
      center: [0, 0],
      axes: true,
      grid: false,
    },
    output: {
      width: 1600,
      background: "transparent",
      crop: "content",
      bounds: [-5, 5, -4, 4],
    },
  };
}
