import {describe,it,expect} from "vitest";
import katex from "katex";
import {parseCondition,pointNames} from "./input";
import {conditionStatement} from "./statement";
import {evaluator,flatten,contradictions} from "./compile";
import {solveConstraints} from "./solver";
import type {ConstraintProblem} from "./types";
import {newDrawing,type DrawingPolygon} from "../types";
import {applyDefinition,normalizeDrawing,definition} from "../model";
import {resolveGeometry,validateDrawing} from "../geometry";
import {visibleInObjectList} from "../polyhedra";

const problem=(names:string,sources:string[]):ConstraintProblem=>{const points=pointNames(names);return {points,segments:[],conditions:sources.map(s=>parseCondition(s,points))};};
const add=(...sources:string[])=>{let d=newDrawing();d.dimension="3d";for(const s of sources)d=applyDefinition(d,s);return d;};
describe("readable conditions, division and folding",()=>{
 it("constructs a non-square rectangle analytically",()=>{
   const p=problem("A B C D",["rectangle(A,B,C,D)","AB=3","AD=2"]),r=solveConstraints({id:1,problem:p,budget:1000});
   expect(r.status).toBe("solved");expect(r.method).toBe("construction");expect(r.complete).toBe(true);expect(evaluator(p).verify(flatten(p.points,r.branches[0].positions)).valid).toBe(true);
 });
 it("defaults division to midpoint and constructs an arbitrary internal ratio",()=>{
   expect(parseCondition("division(M,AB)",["A","B","M"]).value).toBe(1);
   expect(parseCondition("midpoint(M,A,B)",["A","B","M"]).value).toBe(1);
   const p=problem("A B C M",["AB=3","AC=4","BC=5","division(M,AB,1/2)"]),r=solveConstraints({id:2,problem:p,budget:1000});
   expect(r.method).toBe("construction");expect(r.status).toBe("solved");const {A,B,M}=r.branches[0].positions;
   expect(Math.hypot(...M.map((v,i)=>v-A[i]))/Math.hypot(...B.map((v,i)=>v-M[i]))).toBeCloseTo(.5,9);
 });
 it("accepts radians and exact trigonometric values, retaining both sine branches",()=>{
   const names=["A","B","C"];
   expect(parseCondition("vertexAngle(A,B,C,pi/3)",names).value).toBeCloseTo(60,10);
   expect(parseCondition("vertexAngle(A,B,C,rad(1/2))",names).value).toBeCloseTo(90/Math.PI,10);
   expect(parseCondition("cos(vertexAngle(A,B,C))=1/2",names).value).toBeCloseTo(60,10);
   expect(parseCondition("tan(vertexAngle(A,B,C))=-sqrt(3)",names).value).toBeCloseTo(120,10);
   expect(parseCondition("tan(vertexAngle(A,B,C))=0",names).alternateValue).toBe(180);
   const p=problem("A B C",["AB=2","BC=3","sin(vertexAngle(A,B,C))=1/2"]),r=solveConstraints({id:3,problem:p,budget:1000});
   expect(r.status).toBe("solved");expect(r.complete).toBe(true);expect(r.branches.length).toBe(2);
   for(const b of r.branches)expect(evaluator(p).verify(flatten(p.points,b.positions)).valid).toBe(true);
   expect(()=>parseCondition("cos(lineAngle(AB,BC))=-1/2",names)).toThrow();
 });
 it("presents geometry and angles as natural-language statements with valid formulas",()=>{
   const p=problem("P A B C D M",["pyramid(P,A,B,C,D)","perpendicular(AB,CD)","dihedral(BC,A,D,pi/3)","division(M,AB,1)","cos(vertexAngle(A,B,C))=1/2"]);
   const strings=p.conditions.map(c=>conditionStatement(c).map(part=>"text" in part?part.text:part.math).join(""));
   expect(strings[0]).toContain("四棱锥 P-ABCD");expect(strings[1]).toContain("\\perp");expect(strings[2]).toContain("二面角 A-BC-D");expect(strings[2]).toContain("\\pi");expect(strings[3]).toContain("中点");
   for(const c of p.conditions)for(const part of conditionStatement(c))if("math" in part)expect(()=>katex.renderToString(part.math,{throwOnError:true})).not.toThrow();
 });
 it("reports the supplied pyramid's impossible 18.43-degree line-plane angle before searching",()=>{
   const p=problem("P A B C D M",["pyramid(P,A,B,C,D)","parallelogram(A,B,C,D)","perpendicular(AB,AD)","PA=1","AD=1","AB=\\sqrt2","onSegment(M,AB)","equal(PM,MB)","perpendicular(PA,ABC)","linePlaneAngle(AP,AMC,18.43)"]);
   expect(contradictions(p).join(" ")).toContain("必须为 90°");expect(solveConstraints({id:4,problem:p,budget:1000}).status).toBe("contradiction");
   p.conditions.pop();expect(contradictions(p)).toEqual([]);
   p.conditions.push(parseCondition("tan(linePlaneAngle(AP,PMD))=1/3",p.points));
   const corrected=solveConstraints({id:5,problem:p,budget:1000});expect(corrected.status).toBe("solved");expect(corrected.method).toBe("construction");
 });
 it("folds a polygon around its own edge with a live degree slider and hidden source",()=>{
   const d=add("A=(0,0,0)","B=(2,0,0)","C=(2,1,0)","D=(0,1,0)","p=Polygon(A,B,C,D)");
   const old=d.objects.find(o=>o.symbol==="p")!,next=applyDefinition(d,"Fold(p,p.edge(1))"),fold=next.objects.find(o=>o.kind==="polygon"&&o.fold) as DrawingPolygon;
   expect(visibleInObjectList(next.objects.find(o=>o.id===old.id)!)).toBe(false);expect(next.objects.find(o=>o.id===old.id)!.hidden).toBe(true);
   expect(resolveGeometry(next).errors.size).toBe(0);const g=resolveGeometry(next),v=g.points.get(fold.points[2])!.p;expect(v[0]).toBeCloseTo(2);expect(v[1]).toBeCloseTo(0);expect(v[2]).toBeCloseTo(1);
   const angle=next.objects.find(o=>o.id===fold.fold!.angle)!;const moved=applyDefinition(next,`${angle.symbol}=-90`,angle.id);expect(resolveGeometry(moved).points.get(fold.points[2])!.p[2]).toBeCloseTo(-1);
   expect(()=>validateDrawing(normalizeDrawing(JSON.parse(JSON.stringify(moved))))).not.toThrow();expect(definition(moved,fold)).toContain("Fold(");
 });
 it("opens a grouped polyhedron's folded face without losing its other faces",()=>{
   const d=add("A=(0,0,0)","B=(2,0,0)","C=(0,2,0)","D=(0,0,2)","a=Polygon(A,B,C)","b=Polygon(A,D,B)","c=Polygon(B,D,C)","f=Polygon(C,D,A)");
   expect(d.objects.some(o=>o.kind==="solid"&&o.construction?.type==="faces")).toBe(true);
   const next=applyDefinition(d,"Fold(a,a.edge(1))"),g=resolveGeometry(next);
   expect(g.errors.size).toBe(0);expect(next.objects.filter(o=>(o.kind==="polygon"||o.kind==="triangle")&&visibleInObjectList(o))).toHaveLength(4);
 });
});
