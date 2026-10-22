import type { Vec3 } from "../types";

export const constraintKinds = ["distance","equal","ratio","lineAngle","vertexAngle","linePlaneAngle","dihedral",
  "parallel","perpendicular","collinear","onSegment","division","coplanar","parallelogram","rectangle","rhombus","square","prism","pyramid","frustum","regularPolygon","cube"] as const;
export type ConstraintKind = typeof constraintKinds[number];
export interface Condition { id: string; kind: ConstraintKind; refs: string[][]; value?: number; alternateValue?: number; enabled: boolean; source: string }
export interface ConstraintProblem { points: string[]; segments: [string,string][]; conditions: Condition[] }
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
}
export interface ConstraintResult {
  method?: "construction"|"hybrid"|"numerical";
  constructionSteps?: string[];
  approximationReason?: string;
  branches: SolutionBranch[]; complete: boolean; attempts: number; elapsed: number;
  diagnostics: string[]; status: "solved"|"notFound"|"contradiction";
}
export interface SolveRequest {
  id: number; problem: ConstraintProblem; budget?: number; previous?: ConstraintResult;
  move?: {point:string; target:Vec3; branch:number}; seed?: number;
  reference?: {branch:number; points:string[]};
}
export interface SolveResponse { id: number; result?: ConstraintResult; error?: string }
