import { describe,it,expect } from "vitest";
import { parseCondition } from "./input";
import { constructRightPrism } from "./construction";
import { solveConstraints } from "./solver";
import { evaluator,flatten } from "./compile";
import { solutionSetObject,validateSolutionSet } from "./document";
import type { ConstraintProblem,Positions } from "./types";

const names=["A","B","C","D","A_1","B_1","C_1","D_1"];
const sources=["prism(A,B,C,D,A_1,B_1,C_1,D_1)","perpendicular(A A_1,A B C)",
  "AD=\\sqrt{3}","AB=3","AA_1=3","BC=2","CD=2","lineAngle(AB,BC,60)"];
const problem=(conditions=sources,points=names):ConstraintProblem=>({points,segments:[],conditions:conditions.map(s=>parseCondition(s,points))});

describe("deterministic prism construction",()=>{
  it("accepts the screenshot's exact right trapezoidal prism as a witness",()=>{
    const r=Math.sqrt(3),p=problem(),positions:Positions={A:[0,0,0],B:[3,0,0],C:[2,r,0],D:[0,r,0],
      A_1:[0,0,3],B_1:[3,0,3],C_1:[2,r,3],D_1:[0,r,3]};
    expect(evaluator(p).verify(flatten(names,positions)).valid).toBe(true);
  });
  it("constructs the reported prism without a perpendicular condition and retains side-direction freedom",()=>{
    const p=problem(sources.filter((_,i)=>i!==1)),r=solveConstraints({id:1,problem:p,budget:1500,seed:17});
    expect(r.status,r.diagnostics.join("\n")).toBe("solved");expect(r.method).toBe("construction");expect(r.complete).toBe(false);
    expect(r.branches.length).toBeGreaterThan(0);
    for(const b of r.branches) {
      expect(evaluator(p).verify(flatten(names,b.positions)).valid).toBe(true);
      expect(b.dof).toBe(2);
    }
    const branch=r.branches.findIndex(b=>!b.reference.includes("A_1"));expect(branch).toBeGreaterThanOrEqual(0);
    const b=r.branches[branch],a=b.positions.A,target=[a[0]+1,a[1]+1,a[2]+Math.sqrt(7)] as [number,number,number];
    const moved=solveConstraints({id:2,problem:p,previous:r,budget:500,move:{point:"A_1",target,branch}});
    expect(evaluator(p).verify(flatten(names,moved.branches[branch].positions)).valid).toBe(true);
    moved.branches[branch].positions.A_1.forEach((value,i)=>expect(value).toBeCloseTo(target[i],8));
  });
  it("solves the screenshot without restarts, a time allowance or a random seed",()=>{
    const p=problem(),r=solveConstraints({id:1,problem:p,budget:30,seed:1});
    expect(r.method).toBe("construction");expect(r.status).toBe("solved");expect(r.complete).toBe(true);
    expect(r.branches).toHaveLength(2); // Two spatial mirror images, no crossed base.
    expect(solveConstraints({id:2,problem:p,budget:1000,seed:999}).branches).toEqual(r.branches);
    for(const b of r.branches) {
      expect(evaluator(p).verify(flatten(names,b.positions)).valid).toBe(true);
      expect(b.dof).toBe(0);expect(b.rigidityPending).toBe(false);expect(b.reference).toEqual(names);
      expect(b.positions.A).toEqual([0,0,0]);expect(b.positions.B[0]).toBeCloseTo(3,12);
      expect(b.positions.C[0]).toBeCloseTo(2,12);expect(b.positions.C[1]).toBeCloseTo(Math.sqrt(3),12);
      expect(b.positions.D[0]).toBeCloseTo(0,12);expect(b.positions.D[1]).toBeCloseTo(Math.sqrt(3),12);
      expect(Math.abs(b.positions.A_1[2])).toBeCloseTo(3,12);
      expect(b.residual).toBeLessThan(1e-12);
    }
    expect(r.branches[0].positions.A_1[2]*r.branches[1].positions.A_1[2]).toBeLessThan(0);
    expect(()=>validateSolutionSet(solutionSetObject(p,JSON.parse(JSON.stringify(r))))).not.toThrow();
  });
  it("respects the distinction between an unoriented line angle and a vertex angle",()=>{
    const acute=problem([...sources.slice(0,-1),"vertexAngle(A,B,C,60)"]);
    expect(constructRightPrism(acute)?.positions.length).toBeGreaterThan(0);
    // ABC=120 would put C at (4,sqrt(3)), too far from A for AD+DC.
    const obtuse=problem([...sources.slice(0,-1),"vertexAngle(A,B,C,120)"]);
    expect(constructRightPrism(obtuse)).toBeUndefined();
  });
  it("uses arbitrary names, top-face lengths, reversed refs and any lateral edge",()=>{
    const points=["P","Q","R","S","T","U"],p=problem([
      "prism(P,Q,R,S,T,U)","perpendicular(P Q R,R U)","ST=3","TU=5","US=4","QT=2",
    ],points),r=solveConstraints({id:1,problem:p,budget:30});
    expect(r.method).toBe("construction");expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
    for(const b of r.branches)expect(evaluator(p).verify(flatten(points,b.positions)).valid).toBe(true);
  });
  it("handles different length scales and rechecks extra constraints",()=>{
    for(const scale of [1e-4,1e4]) {
      const p=problem([sources[0],sources[1],`AD=${Math.sqrt(3)*scale}`,`AB=${3*scale}`,`AA_1=${3*scale}`,`BC=${2*scale}`,`CD=${2*scale}`,sources[7]]);
      const r=solveConstraints({id:1,problem:p,budget:30});expect(r.method).toBe("construction");
      expect(r.branches.length).toBeGreaterThan(0);
      for(const b of r.branches)expect(evaluator(p).verify(flatten(names,b.positions)).valid).toBe(true);
    }
    expect(constructRightPrism(problem([...sources,"AC=1"]))?.positions).toBeUndefined();
  });
  it("lets the general locus planner handle networks beyond the finite right-prism constructor",()=>{
    expect(constructRightPrism(problem(sources.slice(0,5)))).toBeUndefined();
    expect(constructRightPrism(problem(sources.filter((_,i)=>i!==1)))).toBeUndefined();
    expect(constructRightPrism(problem(sources,[...names,"P"]))).toBeUndefined();
    const p=problem(["prism(A,B,C,D,E,F)","AB=3","AC=4","BC=5","AD=2","angle(AD,ABC)=30"],["A","B","C","D","E","F"]);
    const r=solveConstraints({id:1,problem:p,budget:1000,seed:17});
    expect(r.method).toBe("construction");expect(r.complete).toBe(false);expect(r.status).toBe("solved");
    expect(r.branches[0].dof).toBeGreaterThan(0);
  });
});
