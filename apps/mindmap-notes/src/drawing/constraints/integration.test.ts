import { describe,it,expect } from "vitest";
import { newDrawing, defaultStyle, type DrawingDocument, type DrawingSolutionSet, type Vec3 } from "../types";
import { applyDefinition, normalizeDrawing, solidObject, sourceIds } from "../model";
import { affectedObjects, frameFromDirections, planeFromPoints, project, resolveGeometry, rotate, validateDrawing } from "../geometry";
import { exportSvg, sceneFor } from "../scene";
import { hitTest, screenPoint } from "../interaction";
import { parseCondition } from "./input";
import { solveConstraints } from "./solver";
import { installSolutionSet, solutionSetObject, selectedBranch, placeOnPlane, constraintLocusPoints, mirrorSolutionSet } from "./document";
import { applyCoordinateFrame } from "./rebase";
import { local, add, cross } from "./math";
import type { ConstraintProblem } from "./types";

const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],5));
const make=(points:string[],conditions:string[],segments:[string,string][]=[]):DrawingSolutionSet=>{
  const problem:ConstraintProblem={points,segments,conditions:conditions.map(s=>parseCondition(s,points))};
  const result=solveConstraints({id:1,problem,budget:400,seed:17});return solutionSetObject(problem,result);
};
const withFrame=(d:DrawingDocument)=>{
  const origin:Vec3=[1.2,-2.3,.7],x=rotate([1,0,0],[27,36,11]),y=rotate([0,1,0],[27,36,11]);
  d.coordinateFrame=frameFromDirections(origin,add(origin,x),add(origin,y),planeFromPoints(origin,add(origin,x),add(origin,y),"test"));return d;
};
describe("constraint document integration",()=>{
  it("reverses xOy winding while preserving height, references and save/reopen",()=>{
    const set=make(["A","B","C","D"],["AB=2","AC=2","AD=2","BC=2","BD=2","CD=2"]);
    let doc=normalizeDrawing(installSolutionSet(newDrawing(),set));doc=applyDefinition(doc,"M=Midpoint(C,D)");
    const before=resolveGeometry(doc),mirrored=normalizeDrawing(JSON.parse(JSON.stringify(installSolutionSet(doc,mirrorSolutionSet(set))))),after=resolveGeometry(mirrored);
    expect(mirrored.objects.map(o=>o.id).sort()).toEqual(doc.objects.map(o=>o.id).sort());
    for(const [id,p] of before.points)if(p.object?.kind==="point"&&p.object.construction.type!=="origin"&&after.points.has(id))near(after.points.get(id)!.p,[p.p[0],-p.p[1],p.p[2]]);
    const twice=resolveGeometry(installSolutionSet(mirrored,mirrorSolutionSet(mirrorSolutionSet(set))));
    for(const [id,p] of before.points)if(twice.points.has(id))near(twice.points.get(id)!.p,p.p);
    expect(after.errors.size).toBe(0);
  });

  it("reopens the reported quadrilateral prism as ordinary points, edges and a selectable closed body",()=>{
    const names=["A","B","C","D","A_1","B_1","C_1","D_1"],edges:[string,string][]=[];
    for(let i=0;i<4;i++)edges.push([names[i],names[(i+1)%4]],[names[i+4],names[(i+1)%4+4]],[names[i],names[i+4]]);
    const set=make(names,["prism(A,B,C,D,A_1,B_1,C_1,D_1)","perpendicular(A A_1,A B C)",
      "AD=\\sqrt{3}","AB=3","AA_1=3","BC=2","CD=2","lineAngle(AB,BC,60)"],edges);
    const doc=normalizeDrawing(JSON.parse(JSON.stringify(installSolutionSet(newDrawing(),set)))),geometry=resolveGeometry(doc);
    expect(set.result.method).toBe("construction");expect(set.result.complete).toBe(true);
    expect(doc.objects.filter(o=>o.kind==="segment")).toHaveLength(12);
    expect(doc.objects.filter(o=>o.kind==="point"&&o.constraintSet===set.id&&o.construction.type==="free")).toHaveLength(8);
    expect(doc.objects.filter(o=>o.kind==="spatialLocus")).toHaveLength(0);
    const body=doc.objects.find(o=>o.kind==="solid"&&o.construction?.type==="faces")!;
    expect(doc.objects.filter(o=>o.body===body.id)).toHaveLength(6);
    expect(geometry.meshes.find(m=>m.id===body.id)?.faces).toHaveLength(12);
    expect(geometry.errors.size).toBe(0);
  });
  it("persists linked points, only declared segments, and a 3d sphere locus",()=>{
    const set=make(["A","B","C","P"],["AB=3","AC=4","BC=5","AP=2"],[["A","B"]]);
    const doc=normalizeDrawing(installSolutionSet(newDrawing(),set)),reopened=normalizeDrawing(JSON.parse(JSON.stringify(doc)));
    expect(doc.schemaVersion).toBe(3);expect(doc.objects.filter(o=>o.kind==="segment")).toHaveLength(1);
    expect(doc.objects.filter(o=>o.kind==="spatialLocus")).toHaveLength(1);
    expect(doc.objects.filter(o=>o.kind==="point"&&o.construction.type==="constraint")).toHaveLength(1);
    expect(doc.objects.filter(o=>o.kind==="point"&&o.construction.type==="free"&&o.constraintSet===set.id)).toHaveLength(3);
    for(const p of resolveGeometry(doc).points.values())if(p.object)near(p.p,resolveGeometry(reopened).points.get(p.id)!.p);
    const group=doc.objects.find(o=>o.kind==="solutionSet")!;
    expect(affectedObjects(doc,group.id).size).toBe(7); // group, 4 points, segment, locus
    expect(sourceIds(doc,group.id)).toHaveLength(0); // no cyclic dependencies through group children
    expect(exportSvg(sceneFor(doc,[]),doc,[1000,700])).toContain('stroke-dasharray="5 4"');
    const bounds=constraintLocusPoints(doc);
    expect(bounds.length).toBeGreaterThan(300);
    expect(Math.max(...bounds.map(p=>p[2]))).toBeCloseTo(2,5);
    expect(Math.min(...bounds.map(p=>p[2]))).toBeCloseTo(-2,5);
  });
  it("updates whole configurations while downstream midpoint remains linked",()=>{
    const set=make(["A","B","C","D"],["AB=2","AC=2","AD=2","BC=2","BD=2","CD=2"]);
    expect(set.result.branches.length).toBe(2);
    let doc=normalizeDrawing(installSolutionSet(newDrawing(),set));doc=applyDefinition(doc,"M=Midpoint(C,D)");
    const before=resolveGeometry(doc),mid=doc.objects.find(o=>o.symbol==="M")!;
    const next=installSolutionSet(doc,{...set,activeBranch:1}),after=resolveGeometry(next);
    expect(before.points.get(mid.id)!.p[2]*after.points.get(mid.id)!.p[2]).toBeLessThan(0);
    expect(mid.kind==="point"&&mid.construction.type).toBe("division");
  });
  it("template faces occlude axes and remain selectable without duplicate vertex hits",()=>{
    const set=make(["A","B","C","D","E","F","G","H"],["cube(A,B,C,D,E,F,G,H)","AB=3"],[["A","B"]]);
    const doc=normalizeDrawing(installSolutionSet(newDrawing(),set)),r=resolveGeometry(doc);
    const body=doc.objects.find(o=>o.kind==="solid"&&o.construction?.type==="faces")!;
    expect(r.meshes.find(m=>m.id===body.id)!.faces).toHaveLength(12);expect(r.edges.filter(e=>e.owner===set.id)).toHaveLength(0);
    const b=doc.objects.find(o=>o.kind==="point"&&o.name==="B")!;
    const hits=hitTest(doc,[],[1000,700],screenPoint(doc,[1000,700],r.points.get(b.id)!.p),true);
    expect(hits.filter(h=>h.kind==="point")).toHaveLength(1);
    expect(sceneFor(doc,[]).paths.some(p=>p.id.startsWith("@axis:")&&p.dashed)).toBe(true);
  });
  it("validates saved snapshots and references instead of trusting corrupt results",()=>{
    const set=make(["A","B","C"],["AB=3","AC=4","BC=5"]),doc=installSolutionSet(newDrawing(),set);
    const bad=structuredClone(doc),root=bad.objects.find(o=>o.kind==="solutionSet") as DrawingSolutionSet;
    selectedBranch(root).positions.B=[100,0,0];expect(()=>validateDrawing(bad)).toThrow(/不满足/);
    const moving=make(["A","B","C","P"],["AB=3","AC=4","BC=5","AP=2"]);
    const bad2=installSolutionSet(newDrawing(),moving),point=bad2.objects.find(o=>o.kind==="point"&&o.construction.type==="constraint");
    if(point?.kind==="point"&&point.construction.type==="constraint")point.construction.set="missing";
    expect(()=>validateDrawing(bad2)).toThrow();
  });
  it("places any selected noncollinear face on xOy, rejects a degenerate choice",()=>{
    const set=make(["A","B","C","D"],["AB=2","AC=2","AD=2","BC=2","BD=2","CD=2"]);
    const placed=placeOnPlane(set,["B","C","D"]),doc=installSolutionSet(newDrawing(),placed),r=resolveGeometry(doc);
    const face=doc.objects.filter(o=>o.kind==="point"&&o.constraintSet===set.id&&["B","C","D"].includes(o.name));
    expect(face).toHaveLength(3);for(const point of face)expect(r.points.get(point.id)!.p[2]).toBeCloseTo(0);
    expect(()=>placeOnPlane(set,["A","A","C"])).toThrow();
  });
  it("edits declarations while retaining IDs and protects external references",()=>{
    const set=make(["A","B","C"],["AB=3","AC=4","BC=5"],[["A","B"],["A","C"]]);
    let doc=normalizeDrawing(installSolutionSet(newDrawing(),set));
    const aid=doc.objects.find(o=>o.kind==="point"&&o.name==="A")!.id,edge=doc.objects.find(o=>o.kind==="segment"&&o.name==="AB")!;
    const added=make(["A","B","C","P"],["AB=3","AC=4","BC=5","AP=2"],[["A","B"],["A","C"],["A","P"]]);added.id=set.id;
    doc=normalizeDrawing(installSolutionSet(doc,added));
    expect(doc.objects.find(o=>o.kind==="point"&&o.name==="A")!.id).toBe(aid);expect(doc.objects.some(o=>o.id===edge.id)).toBe(true);
    doc=applyDefinition(doc,"M=Midpoint(A,C)");
    const reduced=make(["A","B"],["AB=3"],[["A","B"]]);reduced.id=set.id;
    expect(()=>installSolutionSet(doc,reduced)).toThrow(/外部对象/);
    // Fixed reference points intentionally remain editable ordinary points.
    const edited=applyDefinition(doc,"(0,0,0)",aid),a=edited.objects.find(o=>o.id===aid);
    expect(a?.kind==="point"&&a.construction.type).toBe("free");
  });
});
describe("whole drawing coordinate rebase",()=>{
  it("keeps projections, numeric associations, derived points and coordinate queries",()=>{
    let doc=newDrawing();doc.dimension="3d";doc.view.mode="space";
    for(const s of ["m=2","A=(1,2,3)","B=(m,1,4)","M=Midpoint(A,B)"])doc=applyDefinition(doc,s);
    withFrame(doc);
    for(const s of ["C=(x(A)+1,y(A),z(A))","k=x(B)"])doc=applyDefinition(doc,s);
    const before=resolveGeometry(doc),afterDoc=applyCoordinateFrame(doc),after=resolveGeometry(afterDoc),f=doc.coordinateFrame!;
    expect(afterDoc.coordinateFrame).toBeUndefined();expect(afterDoc.view.camera).toBeDefined();
    const pose={...f,z:cross(f.x,f.y)};
    for(const o of doc.objects)if(o.kind==="point") {
      near(after.points.get(o.id)!.p,local(before.points.get(o.id)!.p,pose));
      near(project(before.points.get(o.id)!.p,doc),project(after.points.get(o.id)!.p,afterDoc));
    }
    const k=doc.objects.find(o=>o.symbol==="k")!;expect(after.numbers.get(k.id)).toBeCloseTo(before.numbers.get(k.id)!,6);
    const movedBefore=applyDefinition(doc,"m=3",doc.objects.find(o=>o.symbol==="m")!.id);
    const movedAfter=applyDefinition(afterDoc,"m=3",afterDoc.objects.find(o=>o.symbol==="m")!.id);
    const b=doc.objects.find(o=>o.symbol==="B")!;
    near(resolveGeometry(movedAfter).points.get(b.id)!.p,local(resolveGeometry(movedBefore).points.get(b.id)!.p,pose));
    expect(normalizeDrawing(JSON.parse(JSON.stringify(afterDoc))).view.camera).toEqual(afterDoc.view.camera);
  });
  it("preserves body vertices, work planes, annotations and the constraint group",()=>{
    const set=make(["A","B","C","P"],["AB=3","AC=4","BC=5","AP=2"]);
    let doc=normalizeDrawing(installSolutionSet(newDrawing(),set));
    const solid=solidObject("cube");solid.rotation=[23,11,45];solid.origin=[2,3,4];doc.objects.push(solid);
    doc.objects.push({id:crypto.randomUUID(),name:"note",kind:"label",position:[3,2,1],text:"label",style:defaultStyle()});
    doc=normalizeDrawing(withFrame(doc));doc.view.angle=38;
    const r=resolveGeometry(doc),next=applyCoordinateFrame(doc),s=resolveGeometry(next);
    for(const mesh of r.meshes)mesh.vertices.forEach((p,i)=>near(project(p,doc),project(s.meshes.find(m=>m.id===mesh.id)!.vertices[i],next)));
    const scene=sceneFor(doc,[]),after=sceneFor(next,[]);
    for(const path of scene.paths.filter(p=>!p.id.startsWith("@axis:"))) {
      const same=after.paths.filter(p=>p.id===path.id);
      expect(same.some(p=>p.points.length===path.points.length&&p.points.every((q,i)=>Math.hypot(q[0]-path.points[i][0],q[1]-path.points[i][1])<.1))).toBe(true);
    }
    expect(validateDrawing(next)).toBe(next);
  });
  it("keeps editable body parameters and orientation after rebasing",()=>{
    let d=newDrawing();d.dimension="3d";d.view.mode="space";
    d=applyDefinition(d,"m=2");d=applyDefinition(d,"s=Cube(m)");withFrame(d);
    const converted=applyCoordinateFrame(d),s=converted.objects.find(o=>o.symbol==="s")!;
    // Editing its displayed definition must retain its new body basis.
    const source=s.parameters?.source;expect(source).toBeTruthy();
    const edited=applyDefinition(converted,source!,s.id);
    const old=resolveGeometry(converted).meshes.find(m=>m.id===s.id)!,next=resolveGeometry(edited).meshes.find(m=>m.id===s.id)!;
    old.vertices.forEach((p,i)=>near(p,next.vertices[i]));
    const m=converted.objects.find(o=>o.symbol==="m")!,grown=applyDefinition(converted,"m=3",m.id);
    expect(resolveGeometry(grown).meshes.find(m=>m.id===s.id)?.vertices).not.toEqual(old.vertices);
  });
});
