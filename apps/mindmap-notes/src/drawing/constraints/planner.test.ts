import { describe,it,expect } from "vitest";
import { parseCondition,pointNames } from "./input";
import { evaluator,flatten } from "./compile";
import { solveConstraints } from "./solver";
import { planConstructions } from "./planner";
import { intersectLoci } from "./intersections";
import { distanceKey,metricNetworks } from "./metric";
import { norm,sub } from "./math";
import { analyticLoci } from "./loci";
import { driverChoices,referenceChoices } from "./reference";
import { rigidMotion } from "./rigidMotion";
import type { ConstraintProblem } from "./types";

const problem=(names:string,sources:string[]):ConstraintProblem=>{
  const points=pointNames(names);return {points,segments:[],conditions:sources.map(s=>parseCondition(s,points))};
};
const solve=(p:ConstraintProblem)=>{
  const result=solveConstraints({id:1,problem:p,budget:1000,seed:17});
  expect(result.status,result.diagnostics.join("\n")).toBe("solved");expect(result.method).toBe("construction");
  expect(result.constructionSteps?.length).toBeGreaterThan(0);
  for(const b of result.branches)expect(evaluator(p).verify(flatten(p.points,b.positions)).valid).toBe(true);
  return result;
};
const triangle=["AB=3","AC=4","BC=5"];

describe("construction-first planning",()=>{
  it("allows a former reference member to drive after an explicit frame change",()=>{
    for(const [names,conditions,driver,anchor] of [
      ["A B C D E",["onSegment(E,CD)","midpoint(D,AB)","AE=6","perpendicular(AE,BC)"],"E","A"],
      ["K L M Q",["KL=3","KM=4","LM=5","KQ=2"],"K","L"],
    ] as const) {
      const p=problem(names,[...conditions]),initial=solve(p),branch=initial.branches[0];
      expect(driverChoices(branch,p.points)).toContain(driver);
      expect(referenceChoices(branch)).toContainEqual([anchor]);
      const switched=solveConstraints({id:4,problem:p,previous:initial,budget:800,reference:{branch:0,points:[anchor]}}),b=switched.branches[0];
      expect(b.reference).toEqual([anchor]);expect(b.dof).toBeGreaterThan(0);
      const o=b.positions[anchor],q=b.positions[driver],target=[o[0]-(q[1]-o[1]),o[1]+q[0]-o[0],q[2]] as [number,number,number];
      const moved=solveConstraints({id:5,problem:p,previous:switched,budget:400,move:{point:driver,target,branch:0}});
      expect(evaluator(p).verify(flatten(p.points,moved.branches[0].positions)).valid).toBe(true);
      expect(norm(sub(moved.branches[0].positions[driver],target))).toBeLessThan(1e-7);
      expect(moved.branches[0].positions[anchor]).toEqual(o);expect(moved.method).toBe("construction");
    }
    const rigid=solve(problem("A B C",["AB=3","AC=4","BC=5"]));
    expect(driverChoices(rigid.branches[0],["A","B","C"])).toEqual([]);
  });
  it("uses generic rigid motions without moving fixed anchors or stretching geometry",()=>{
    const p={A:[2,3,4],B:[2,3,8],P:[4,3,6],Q:[2,5,6]} as Record<string,[number,number,number]>;
    const aroundAxis=rigidMotion(p,["A","B"],"P",[2,5,6],1)!;
    expect(aroundAxis.A).toEqual(p.A);expect(aroundAxis.B).toEqual(p.B);
    for(const a of Object.keys(p))for(const b of Object.keys(p))expect(norm(sub(aroundAxis[a],aroundAxis[b]))).toBeCloseTo(norm(sub(p[a],p[b])),10);
    expect(rigidMotion(p,["A","B","Q"],"P",[2,5,6],1)).toBeUndefined();
    expect(rigidMotion(p,["A"],"P",[100,3,4],1)).toBeUndefined();
    const opposite=rigidMotion(p,["A"],"P",[0,3,2],1)!;
    expect(norm(sub(opposite.P,[0,3,2]))).toBeLessThan(1e-8);
  });
  it("accepts user-selected fixed subsets and preserves every condition during deformation",()=>{
    for(const [names,sources,anchors,driver] of [
      ["A B C D E",["onSegment(E,CD)","midpoint(D,AB)","AE=6","perpendicular(AE,BC)"],["C","D"],"E"],
      ["U V W M T",["onSegment(T,WM)","division(M,UV,2)","UT=5","perpendicular(TU,VW)"],["W","M"],"T"],
    ] as const) {
      const p=problem(names,[...sources]),initial=solve(p);
      const framed=solveConstraints({id:6,problem:p,previous:initial,budget:800,reference:{branch:0,points:[...anchors]}}),b=framed.branches[0];
      expect(b.reference).toEqual(anchors);expect(b.dof).toBeGreaterThan(0);
      const [a,c]=anchors.map(n=>b.positions[n]),target=a.map((v,i)=>v+.6*(c[i]-v)) as [number,number,number];
      const moved=solveConstraints({id:7,problem:p,previous:framed,budget:1000,move:{point:driver,target,branch:0}}).branches[0];
      for(const n of anchors)expect(moved.positions[n]).toEqual(b.positions[n]);
      expect(norm(sub(moved.positions[driver],target))).toBeLessThan(1e-6);
      expect(evaluator(p).verify(flatten(p.points,moved.positions)).valid).toBe(true);
      const locked=solveConstraints({id:8,problem:p,previous:framed,budget:300,reference:{branch:0,points:[...p.points]}});
      expect(locked.branches[0].dof).toBe(0);expect(driverChoices(locked.branches[0],p.points)).toEqual([]);
      const unlocked=solveConstraints({id:9,problem:p,previous:locked,budget:300,reference:{branch:0,points:[anchors[0]]}});
      expect(unlocked.branches[0].dof).toBeGreaterThan(0);
      for(const points of [[],[anchors[0],anchors[0]],["missing"]])expect(()=>solveConstraints({id:10,problem:p,previous:initial,reference:{branch:0,points}})).toThrow(/固定点/);
    }
  });
  it("constructs a segment-incidence/division/perpendicular loop and preserves its free family",()=>{
    const p=problem("A B C D E",["onSegment(E,CD)","midpoint(D,AB)","AE=6","perpendicular(AE,BC)"]),r=solve(p);
    expect(r.complete).toBe(false);expect(r.branches[0].dof).toBeGreaterThan(0);expect(r.branches[0].reference).toEqual(["A","E"]);
    for(const point of ["A","E"])expect(()=>solveConstraints({id:2,problem:p,previous:r,budget:300,move:{point,target:[1,2,0],branch:0}})).toThrow(/参照/);
    for(const [point,target] of [["B",[8,4,0]],["D",[4,2,0]]] as const) {
      const moved=solveConstraints({id:3,problem:p,previous:r,budget:400,move:{point,target:[...target],branch:0}});
      expect(evaluator(p).verify(flatten(p.points,moved.branches[0].positions)).valid).toBe(true);
      expect(moved.method).toBe("construction");
      expect(norm(sub(moved.branches[0].positions[point],[...target]))).toBeLessThan(1e-8);
    }
    // The rule recognizes incidence relations and ratios, not the point names
    // or a single hard-coded midpoint configuration.
    const renamed=problem("U V W M T",["division(M,UV,2)","onSegment(T,WM)","UT=5","perpendicular(VW,TU)"]);
    solve(renamed);
  });
  it("constructs SSS/SAS without numerical search and propagates equalities and ratios",()=>{
    for(const sources of [triangle,["AB=2","BC=2","vertexAngle(A,B,C,120)"],["AB=3","AC/AB=2","vertexAngle(B,A,C,90)"]]) {
      const p=problem("A B C",sources),r=solve(p);expect(r.complete).toBe(true);expect(r.branches).toHaveLength(1);expect(r.branches[0].dof).toBe(0);
    }
  });
  it("preserves both angle signs when deriving a distance from unoriented lines",()=>{
    const p=problem("A B C",["AB=3","BC=2","lineAngle(AB,BC,60)"]),r=solve(p);
    expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
    const distances=r.branches.map(b=>norm(sub(b.positions.C,b.positions.A))).sort((a,b)=>a-b);
    expect(distances[0]).toBeCloseTo(Math.sqrt(7),12);expect(distances[1]).toBeCloseTo(Math.sqrt(19),12);
  });
  it("handles a vertex shared by both relation objects before that vertex is known",()=>{
    for(const relation of ["lineAngle(AB,BC,90)","perpendicular(AB,BC)"]) {
      const p=problem("A C B",["AC=2","AB=sqrt(2)","BC=sqrt(2)",relation]),r=solve(p);
      expect(r.complete).toBe(true);expect(r.branches[0].dof).toBe(0);
    }
    const parallel=solve(problem("A C B",["AC=2","AB=1","BC=1","parallel(AB,BC)"]));
    expect(parallel.complete).toBe(true);
    // The unknown P occurs in both the line AP and the plane PBC. A plane
    // containing P is not a known reference plane while P is being placed.
    for(const relation of ["linePlaneAngle(A P,P B C,90)","perpendicular(A P,P B C)"]) {
      const p=problem("A B C P",[...triangle,"AP=1","BP=sqrt(8)","CP=sqrt(15)",relation]),r=solve(p);
      expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
    }
  });
  it("extracts shared-vertex loci without reading the moving vertex as a fixed reference",()=>{
    const positions={A:[-1,0,0],B:[0,1,0],C:[1,0,0]} as const;
    const p=problem("A B C",["perpendicular(AB,BC)"]);
    const loci=analyticLoci(p,structuredClone(positions) as never,["A","C"],1);
    expect(loci).toHaveLength(1);expect(loci[0].kind).toBe("sphere");expect(loci[0].radius).toBe(1);expect(loci[0].origin).toEqual([0,0,0]);
    const q=problem("A B C P",["perpendicular(A P,P B C)"]);
    expect(()=>analyticLoci(q,{A:[0,0,0],B:[3,0,0],C:[0,4,0],P:[1/3,1/4,Math.sqrt(119)/12]},["A","B","C"],1)).not.toThrow();
  });
  it("uses sphere/plane and sphere/line intersections and retains actual free loci",()=>{
    const p=problem("A B C P",[...triangle,"AP=2","coplanar(A,B,C,P)"]),r=solve(p);
    expect(r.complete).toBe(false);expect(r.branches[0].dof).toBe(1);expect(r.branches[0].loci.find(l=>l.point==="P")?.kind).toBe("circle");
    const q=problem("A B C P",[...triangle,"AP=2","perpendicular(A P,A B C)"]),s=solve(q);
    expect(s.complete).toBe(true);expect(s.branches).toHaveLength(2);expect(s.branches.every(b=>b.dof===0)).toBe(true);
  });
  it("constructs collinear divisions and obeys segment bounds",()=>{
    const p=problem("A B P",["AB=2","AP=0.5","onSegment(P,A,B)"]),r=solve(p);
    expect(r.complete).toBe(true);expect(r.branches).toHaveLength(1);
    expect(norm(sub(r.branches[0].positions.B,r.branches[0].positions.P))).toBeCloseTo(1.5,12);
  });
  it("constructs regular polygons and regular pyramid vertices from sphere intersections",()=>{
    const r=solve(problem("A B C D E",["regularPolygon(A,B,C,D,E)","AB=2"]));expect(r.complete).toBe(true);
    const p=problem("P A B C D",["pyramid(P,A,B,C,D)","regularPolygon(A,B,C,D)","AB=2","PA=3","PA=PB","PB=PC","PC=PD"]),s=solve(p);
    expect(s.complete).toBe(true);expect(s.branches).toHaveLength(2);
  });
  it("eliminates frustum offsets before intersecting lateral-length spheres",()=>{
    const p=problem("A B C D E F G H",["frustum(A,B,C,D,E,F,G,H)","regularPolygon(A,B,C,D)",
      "AB=4","EF=2","AE=3","AE=BF","BF=CG","CG=DH"]),r=solve(p);
    expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);expect(r.branches.every(b=>b.dof===0)).toBe(true);
  });
  it("uses perpendicular-bisector planes for equal distances to a moving vertex",()=>{
    const p=problem("A B C P",[...triangle,"PA=PB","PB=PC"]),r=solve(p);
    expect(r.complete).toBe(false);expect(r.branches[0].dof).toBe(1);
    for(const b of r.branches) {
      const pa=norm(sub(b.positions.P,b.positions.A));
      expect(norm(sub(b.positions.P,b.positions.B))).toBeCloseTo(pa,12);
      expect(norm(sub(b.positions.P,b.positions.C))).toBeCloseTo(pa,12);
    }
  });
  it("constructs parallelograms and cubes by affine propagation",()=>{
    expect(solve(problem("A B C D",["parallelogram(A,B,C,D)","AB=3","AD=2","vertexAngle(B,A,D,60)"])).complete).toBe(true);
    const cube=solve(problem("A B C D E F G H",["cube(A,B,C,D,E,F,G,H)","AB=3"]));
    expect(cube.complete).toBe(true);expect(cube.branches).toHaveLength(2);
  });
  it("intersects dihedral half-planes with distance loci",()=>{
    const p=problem("A B C D",[...triangle,"AD=2","BD=sqrt(13)","dihedral(AB,C,D,120)"]),r=solve(p);
    expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
  });
  it("does not invent uniqueness for a free-size square or continuous sphere",()=>{
    expect(solve(problem("A B C D",["square(A,B,C,D)"])).complete).toBe(false);
    const r=solve(problem("A B C P",[...triangle,"AP=2"]));expect(r.complete).toBe(false);expect(r.branches[0].dof).toBe(2);
  });
  it("keeps unsupported coupled relations for the fallback and preserves cancellation budget",()=>{
    const p=problem("A B C D",["lineAngle(AB,CD,30)"]),plan=planConstructions(p,Date.now()+100);
    expect(plan.solutions).toEqual([]);expect(plan.finite).toBe(false);
    const expired=planConstructions(p,0);expect(expired.finite).toBe(false);expect(expired.solutions).toEqual([]);
  });
  it("propagates prism side lengths before attempting coordinate placement",()=>{
    const p=problem("A B C D E F",["prism(A,B,C,D,E,F)","AB=3","DE=3","AD=2"]);
    for(const metric of metricNetworks(p).networks)expect(metric.get(distanceKey("B","E"))).toBe(2);
  });
  it("continues exploring incomplete constructed families rather than repeating the same samples",()=>{
    const p=problem("A B C P",[...triangle,"AP=2"]),first=solve(p);
    const next=solveConstraints({id:2,problem:p,previous:first,budget:300,seed:27});
    expect(next.status).toBe("solved");expect(next.method).toBe("hybrid");expect(next.attempts).toBeGreaterThan(first.attempts);
    expect(next.complete).toBe(false);
    for(const b of next.branches)expect(evaluator(p).verify(flatten(p.points,b.positions)).valid).toBe(true);
  });
  it("constructs dependent followers on drag, choosing their nearest locus positions",()=>{
    const p=problem("A B C P Q",[...triangle,"AP=2","PQ=1"]),first=solve(p),b=first.branches[0];
    const target=[0,0,2] as [number,number,number],previousQ=b.positions.Q;
    const moved=solveConstraints({id:2,problem:p,previous:first,budget:300,move:{point:"P",target,branch:0}});
    const q=moved.branches[0].positions.Q,delta=sub(previousQ,target),length=norm(delta);
    expect(norm(sub(moved.branches[0].positions.P,target))).toBeLessThan(1e-10);
    if(length>1e-12)for(let i=0;i<3;i++)expect(q[i]).toBeCloseTo(target[i]+delta[i]/length,10);
    expect(evaluator(p).verify(flatten(p.points,moved.branches[0].positions)).valid).toBe(true);
    for(const name of b.reference)expect(moved.branches[0].positions[name]).toEqual(b.positions[name]);
  });
});

describe("analytic locus intersections",()=>{
  it("intersects three spheres in two points and rejects inconsistent affine equations",()=>{
    const r=intersectLoci([],[{center:[0,0,0],radius:Math.sqrt(3)},{center:[2,0,0],radius:Math.sqrt(3)},{center:[0,2,0],radius:Math.sqrt(3)}],1);
    expect(r.dimension).toBe(0);expect(r.points).toHaveLength(2);
    for(const p of r.points){expect(p[0]).toBeCloseTo(1,12);expect(p[1]).toBeCloseTo(1,12);expect(Math.abs(p[2])).toBeCloseTo(1,12);}
    expect(intersectLoci([{n:[1,0,0],d:1},{n:[2,0,0],d:4}],[],1).points).toHaveLength(0);
  });
  it("retains circles/spheres and handles tangency without imaginary points",()=>{
    expect(intersectLoci([{n:[0,0,1],d:0}],[{center:[0,0,0],radius:2}],1).dimension).toBe(1);
    expect(intersectLoci([],[{center:[0,0,0],radius:2}],1).dimension).toBe(2);
    const tangent=intersectLoci([{n:[0,0,1],d:2}],[{center:[0,0,0],radius:2}],1);
    expect(tangent.dimension).toBe(0);expect(tangent.points).toEqual([[0,0,2]]);
    expect(intersectLoci([{n:[0,0,1],d:3}],[{center:[0,0,0],radius:2}],1).points).toEqual([]);
  });
});
