import { describe,it,expect } from "vitest";
import { parseCondition, segmentsFrom, pointNames } from "./input";
import { evaluator, flatten } from "./compile";
import { solveConstraints } from "./solver";
import { norm, sub } from "./math";
import { locusPoint } from "./loci";
import type { ConstraintProblem } from "./types";

const problem=(points:string,conditions:string[],segments=""):ConstraintProblem=>{
  const names=pointNames(points);return {points:names,segments:segmentsFrom(segments,names),conditions:conditions.map(s=>parseCondition(s,names))};
};
const solve=(p:ConstraintProblem,budget=500)=>solveConstraints({id:1,problem:p,budget,seed:17});
const valid=(p:ConstraintProblem,r:ReturnType<typeof solve>)=>{
  expect(r.branches.length,r.diagnostics.join("\n")).toBeGreaterThan(0);
  for(const b of r.branches)expect(evaluator(p).verify(flatten(p.points,b.positions)).valid).toBe(true);
};
describe("constraint input",()=>{
  it("parses all requested types and rejects undeclared points/ambiguous names",()=>{
    const names=pointNames("A B C D E F G H P");
    for(const text of ["AB=3","AB=CD","AB/CD=2","angle(AB,CD)=60","angle(A,B,C)=120","angle(AB,CDE)=30",
      "dihedral(AB,C,D)=120","AB // CD","AB ⟂ CDE","ABC // DEF","ABC ⟂ DEF","collinear(A,B,C)",
      "onSegment(P,A,B)","coplanar(A,B,C,D)","parallelogram(A,B,C,D)","rhombus(A,B,C,D)","square(A,B,C,D)",
      "prism(A,B,C,D,E,F)","cube(A,B,C,D,E,F,G,H)"])
      expect(parseCondition(text,names).enabled).toBe(true);
    expect(()=>parseCondition("AZ=2",names)).toThrow();
    expect(()=>parseCondition("AB=0",names)).toThrow();
    expect(()=>parseCondition("angle(AB,CD)=120",names)).toThrow();
    expect(segmentsFrom("AB, BC;AB",names)).toEqual([["A","B"],["B","C"]]);
  });
});
describe("joint constraint solving",()=>{
  it("solves SSS and detects a non-template rigid triangle",()=>{
    const p=problem("A B C",["AB=3","AC=4","BC=5"]),r=solve(p);valid(p,r);
    expect(r.branches[0].dof).toBe(0);expect(new Set(r.branches[0].reference)).toEqual(new Set(p.points));
  });
  it("keeps mirrored tetrahedron branches and accepts redundant conditions",()=>{
    const p=problem("A B C D",["AB=2","AC=2","AD=2","BC=2","BD=2","CD=2","BA=2"]),r=solve(p,900);valid(p,r);
    expect(r.branches).toHaveLength(2);expect(r.branches.every(b=>b.dof===0)).toBe(true);expect(r.complete).toBe(true);expect(r.method).toBe("construction");
  });
  it("proves elementary contradictions without reporting numerical failure as impossible",()=>{
    for(const p of [problem("A B",["AB=2","BA=3"]),problem("A B C",["AB=1","BC=1","AC=3"])]) {
      expect(solve(p).status).toBe("contradiction");expect(solve(p).complete).toBe(true);
    }
  });
  it("constructs a cube without implicit visible edges",()=>{
    const p=problem("A B C D E F G H",["cube(A,B,C,D,E,F,G,H)","AB=3"],"AB,BC"),r=solve(p,600);valid(p,r);
    expect(p.segments).toHaveLength(2);expect(r.branches[0].reference).toHaveLength(8);expect(r.branches[0].dof).toBe(0);
  });
  it("retains the hinge between two rigid non-template triangles",()=>{
    const p=problem("A B C D",["AB=2","AC=2","BC=2","AD=2","BD=2"]),r=solve(p,700);valid(p,r);
    const b=r.branches[0];expect(b.reference).toHaveLength(3);expect(b.dof).toBe(1);
    expect(b.rigid.map(g=>[...g].sort().join(""))).toEqual(expect.arrayContaining(["ABC","ABD"]));
    const locus=b.loci.find(l=>!b.reference.includes(l.point));expect(locus?.kind).toBe("circle");
    const result=solveConstraints({id:2,problem:p,previous:r,budget:400,move:{point:locus!.point,target:locusPoint(locus!,1),branch:0}});
    valid(p,result);for(const name of b.reference)expect(result.branches[0].positions[name]).toEqual(b.positions[name]);
    expect(norm(sub(result.branches[0].positions[locus!.point],locusPoint(locus!,1)))).toBeLessThan(1e-4);
  });
  it("represents a sphere when only distance to the reference point is fixed",()=>{
    // A rigid base determines space; P is constrained only by AP.
    const p=problem("A B C P",["AB=3","AC=4","BC=5","AP=2"]),r=solve(p,600);valid(p,r);
    const b=r.branches[0];expect(b.reference).toHaveLength(3);expect(b.dof).toBe(2);expect(b.loci.find(l=>l.point==="P")?.kind).toBe("sphere");
  });
  it("checks obtuse dihedral semantics, segment bounds and skew line angle",()=>{
    const p=problem("A B C D P",["dihedral(AB,C,D)=120","onSegment(P,A,B)","angle(AC,BD)=60"]);
    const e=evaluator(p);const good={A:[0,0,0],B:[1,0,0],C:[0,1,0],D:[0,-.5,Math.sqrt(3)/2],P:[.5,0,0]};
    const dihedralOnly={...p,conditions:[p.conditions[0]]};
    expect(evaluator(dihedralOnly).verify(flatten(p.points,good as never)).valid).toBe(true);
    const bounds={...p,conditions:[p.conditions[1]]};
    expect(evaluator(bounds).verify(flatten(p.points,{...good,P:[2,0,0]} as never)).valid).toBe(false);
    expect(e.values(flatten(p.points,good as never)).every(Number.isFinite)).toBe(true);
  });
  it("keeps scale freedom when a square has no length condition",()=>{
    const p=problem("A B C D",["square(A,B,C,D)"]),r=solve(p,600);valid(p,r);
    expect(r.branches[0].dof).toBeGreaterThan(0);expect(r.branches[0].reference.length).toBeLessThan(4);
  });
  it("infers rigidity from two lengths and a non-right vertex angle",()=>{
    const p=problem("A B C",["AB=2","BC=2","angle(A,B,C)=120"]),r=solve(p,600);valid(p,r);
    expect(r.branches[0].reference).toHaveLength(3);expect(r.branches[0].dof).toBe(0);
  });
  it("solves an oblique triangular prism without imposing right side edges",()=>{
    const p=problem("A B C D E F",["prism(A,B,C,D,E,F)","AB=3","AC=4","BC=5","AD=2","angle(AD,ABC)=30"]),r=solve(p,1000);valid(p,r);
    expect(Math.abs(r.branches[0].positions.D[2])).toBeCloseTo(1,4);
  });
  it("solves rhombi, parallelograms and a prescribed obtuse dihedral",()=>{
    for(const template of ["rhombus","parallelogram"]){const p=problem("A B C D",[`${template}(A,B,C,D)`,"AB=2","AD=2","angle(B,A,D)=60"]);valid(p,solve(p,500));}
    const p=problem("A B C D",["AB=2","AC=2","BC=2","AD=2","BD=2","dihedral(AB,C,D)=120"]);valid(p,solve(p,800));
  });
  it("solves bounded collinear division and plane/sphere intersection",()=>{
    const p=problem("A B P",["AB=2","AP=0.5","onSegment(P,A,B)","collinear(A,P,B)"]),r=solve(p,600);valid(p,r);
    expect(norm(sub(r.branches[0].positions.B,r.branches[0].positions.P))).toBeCloseTo(1.5,4);
    const q=problem("A B C P",["AB=3","AC=4","BC=5","AP=2","coplanar(A,B,C,P)"]),s=solve(q,600);valid(q,s);
    expect(s.branches[0].loci.find(l=>l.point==="P")?.kind).toBe("circle");
  });
  it("evaluates skew line angles and all line/plane relation combinations",()=>{
    const names=["A","B","C","D","E","F","G","H"],p={A:[0,0,0],B:[1,0,0],C:[0,1,0],D:[1,1,1],E:[0,0,1],F:[1,0,1],G:[0,1,1],H:[0,0,2]};
    for(const source of ["angle(AC,BD)=45","AB // EF","AB // EFG","ABC // EFG","AE ⟂ ABC","AB ⟂ AC","ABC ⟂ AEH"]){
      // The final plane must be nondegenerate: AEH is intentionally invalid.
      const q={points:names,segments:[],conditions:[parseCondition(source,names)]} as ConstraintProblem;
      expect(evaluator(q).verify(flatten(names,p as never)).valid).toBe(source!=="ABC ⟂ AEH");
    }
    const ratio=problem("A B C",["AB/BC=2","BC=3"]);valid(ratio,solve(ratio));
  });
  it("treats exact right/zero angles with regular equations and keeps the correct degrees of freedom",()=>{
    const p=problem("A B C",["AB=3","AC=4","angle(AB,AC)=90"]),r=solve(p,700);valid(p,r);
    expect(r.branches[0].dof).toBe(0);expect(r.branches[0].reference).toHaveLength(3);
    const q=problem("A B C D",["AB=2","AC=2","BC=2","AD=2","BD=2","dihedral(AB,C,D)=180"]),s=solve(q,700);valid(q,s);
    expect(s.branches[0].dof).toBe(0);
  });
  it("moves jointly constrained followers instead of moving points independently",()=>{
    const p=problem("A B C P Q",["AB=3","AC=4","BC=5","AP=2","PQ=1"]),r=solve(p,500);valid(p,r);
    const b=r.branches[0],q=b.positions.Q,length=norm(q),target=q.map(n=>-2*n/length) as [number,number,number];
    const moved=solveConstraints({id:2,problem:p,previous:r,budget:500,move:{point:"P",target,branch:0}});valid(p,moved);
    expect(norm(sub(moved.branches[0].positions.P,target))).toBeLessThan(1e-4);
    expect(norm(sub(moved.branches[0].positions.Q,q))).toBeGreaterThan(.01);
    for(const n of b.reference)expect(moved.branches[0].positions[n]).toEqual(b.positions[n]);
  });
  it("never hides a short-length violation behind a large drawing scale",()=>{
    const p=problem("A B C",["AB=10000","AC=0.01"]),e=evaluator(p);
    expect(e.verify(flatten(p.points,{A:[0,0,0],B:[10000,0,0],C:[0,.01,0]})).valid).toBe(true);
    expect(e.verify(flatten(p.points,{A:[0,0,0],B:[10000,0,0],C:[0,.02,0]})).valid).toBe(false);
  });
});
