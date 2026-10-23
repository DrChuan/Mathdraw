import type { Vec3,DrawingDocument } from "../types";

export type ConstraintMode="spatial"|"plane"|"coordinate";
export interface PlanarUnknown {
  id:string;object:string;field:string;initial:number;min?:number;max?:number;
}
export interface PlanarEquation {id:string;source:string;enabled:boolean}
export interface PlanarContext {
  /** Source definitions, not a second scene. Objects retain these IDs on commit. */
  document:DrawingDocument;unknowns:PlanarUnknown[];equations:PlanarEquation[];
  absorbedSets?:string[];
  inheritedConditions?:Condition[];
  inheritedCurves?:ConstraintCurve[];
  searchScale?:number;
  searchBounds?:Record<string,{xMin?:number;xMax?:number;yMin?:number;yMax?:number}>;
}
export interface AlgebraicValue {polynomial:string[];interval:[number,number];approximate:number;expression?:string}

export const constraintKinds = ["distance","equal","ratio","lineAngle","vertexAngle","linePlaneAngle","dihedral",
  "parallel","perpendicular","collinear","onSegment","division","coplanar","parallelogram","rectangle","rhombus","square","prism","pyramid","frustum","regularPolygon","cube",
  "scalarEquation","vectorRelation","vectorDot","convexPolygon","congruent","similar",
  "area","volume","circumradius","concyclic","cospherical","onCurve","cylinder","cone","coneFrustum","sphere"] as const;
export type ConstraintKind = typeof constraintKinds[number];
export type VolumeShape="prism"|"pyramid"|"frustum"|"cylinder"|"cone"|"coneFrustum";
export interface ConstraintCurve {
  id:string; name:string; type:"circle"|"ellipse";
  method:"centerPoint"|"centerRadius"|"threePoint"|"foci";
  points:string[]; plane?:string[]; value?:number; valueSource?:string;
}
export interface Condition { id: string; kind: ConstraintKind; refs: string[][]; value?: number; alternateValue?: number; coefficients?:number[]; solid?:VolumeShape; curve?:string; enabled: boolean; source: string }
export interface ConstraintProblem { points: string[]; segments: [string,string][]; conditions: Condition[]; curves?:ConstraintCurve[];mode?:ConstraintMode;planar?:PlanarContext }
export interface Pose { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 }
export const identityPose = (): Pose => ({origin:[0,0,0],x:[1,0,0],y:[0,1,0],z:[0,0,1]});
export type Positions = Record<string,Vec3>;
export interface SpatialLocus {
  point: string; kind: "line"|"segment"|"circle"|"plane"|"sphere"|"sampled";
  origin: Vec3; u: Vec3; v: Vec3; radius: number;
  paths?: Vec3[][]; complete: boolean;
}
export interface SolutionBranch {
  positions: Positions; rigid: string[][]; reference: string[]; dof: number;
  loci: SpatialLocus[]; residual: number;
  rigidityPending?: boolean;
  motionDof?:number;
  mobility?:{version:1;linear:number;removed:number;checked:boolean};
  values?:Record<string,number>;
  exactValues?:Record<string,AlgebraicValue>;
}
export interface ConstraintResult {
  method?: "construction"|"hybrid"|"numerical";
  precision?:"construction"|"algebraic"|"approximate";
  constructionSteps?: string[];
  approximationReason?: string;
  branches: SolutionBranch[]; complete: boolean; attempts: number; elapsed: number;
  diagnostics: string[]; status: "solved"|"notFound"|"contradiction";
}
export interface SolveRequest {
  id: number; problem: ConstraintProblem; budget?: number; previous?: ConstraintResult;
  move?: {point:string; target:Vec3; branch:number}; seed?: number;
  reference?: {branch:number; points:string[]};
  parameter?: {variable:string;target:number;branch:number};
  refreshMobility?:boolean;
}
export interface SolveResponse { id: number; result?: ConstraintResult; error?: string }
