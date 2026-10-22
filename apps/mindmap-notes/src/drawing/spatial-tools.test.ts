import { describe,it,expect } from "vitest";
import katex from "katex";
import {newDrawing,type DrawingDocument,type DrawingSegment} from "./types";
import {applyDefinition,normalizeDrawing} from "./model";
import {resolveGeometry,validateDrawing} from "./geometry";
import {mathPreview} from "./mathPreview";
import {framePointSnap,screenPoint,hitTest} from "./interaction";
import {applyCoordinateFrame} from "./constraints/rebase";
import {vectorCoordinates} from "./vectorCoordinates";

const start=()=>{const d=newDrawing();d.dimension="3d";d.view.mode="space";return d;};
const add=(doc:DrawingDocument,...sources:string[])=>sources.reduce((d,s)=>applyDefinition(d,s),doc);
const id=(d:DrawingDocument,s:string)=>d.objects.find(o=>o.symbol===s)!.id;
const vector=(d:DrawingDocument,s:string)=>d.objects.find(o=>o.symbol===s) as DrawingSegment;
const section=(d:DrawingDocument)=>{const g=resolveGeometry(d),o=d.objects.find(o=>o.kind==="polygon"&&o.section)!;return {g,o,mesh:g.meshes.find(m=>m.id===o.id)!};};

describe("spatial tools and reported presentation issues",()=>{
  it("renders concatenated subscripted endpoint symbols without double subscripts",()=>{
    for(const source of ["D_1A_1 = Segment(D_1,A_1)","A_123B_456C_78 = Triangle(A_123,B_456,C_78)","a_123_456=1"]) {
      const latex=mathPreview(source).replace(/(?<![\\A-Za-z])([A-Za-z]+[0-9]*)(?=\()/g,"\\operatorname{$1}");
      expect(()=>katex.renderToString(latex,{throwOnError:true})).not.toThrow();
    }
    expect(mathPreview("D_1A_1")).toBe("D_{1}A_{1}");
  });
  it("reuses line endpoints for coordinate-frame picks, including spatial lines outside z=0",()=>{
    const d=add(start(),"A=(0,0,2)","B=(4,0,2)","s=Segment(A,B)"),q=screenPoint(d,[1000,700],[2,0,2]);
    const snap=framePointSnap(d,[],[1000,700],q,[id(d,"A")]);
    expect(snap.existing).toBe(id(d,"B"));expect(snap.construction).toBeUndefined();
  });
  it("removes the original O after choosing another origin and preserves references privately",()=>{
    let d=add(start(),"A=(2,3,1)","B=(4,3,1)","s=Segment(O,B)");
    const oldO=id(d,"O"),origin=id(d,"A");
    d.coordinateOriginId=origin;d.coordinateFrame={origin:[2,3,1],x:[1,0,0],y:[0,1,0],zSign:1};
    const converted=applyCoordinateFrame(d),o=converted.objects.find(o=>o.id===oldO)!;
    expect(o.hidden).toBe(true);expect(o.auxiliary).toBe(true);
    expect(resolveGeometry(converted).points.get(oldO)!.p).toEqual([-2,-3,-1]);
    expect(resolveGeometry(converted).points.get(origin)!.p).toEqual([0,0,0]);
    expect(converted.objects.some(o=>o.kind==="point"&&o.construction.type==="origin")).toBe(false);
    expect(normalizeDrawing(JSON.parse(JSON.stringify(converted))).objects.some(o=>o.kind==="point"&&o.construction.type==="origin")).toBe(false);
    const independent=add(start(),"A=(2,3,1)");independent.coordinateOriginId=id(independent,"A");independent.coordinateFrame=d.coordinateFrame;
    expect(applyCoordinateFrame(independent).objects.some(o=>o.symbol==="O")).toBe(false);
    const convertedIndependent=applyCoordinateFrame(independent);
    expect(()=>normalizeDrawing({...convertedIndependent,objects:convertedIndependent.objects.filter(o=>o.id!==independent.coordinateOriginId)})).not.toThrow();
  });
  it("displays vector components and simplifies fixed normal ratios",()=>{
    const d=add(start(),"A=(0,0,0)","B=(sqrt(3)/2,-1/2,0)","C=(2,0,-1)","n=Normal(A,B,C)","vec=Vector(A,C)");
    const normal=vectorCoordinates(d,vector(d,"n"))!;
    expect(normal.value[0]).toBeCloseTo(1,10);expect(normal.value[1]).toBeCloseTo(Math.sqrt(3),10);expect(normal.value[2]).toBeCloseTo(2,10);
    expect(normal.source).not.toContain("/");expect(vectorCoordinates(d,vector(d,"vec"))!.value).toEqual([2,0,-1]);
  });
  it("retains variables in normal components and updates after changing a slider",()=>{
    const d=add(start(),"m=2","A=(0,0,0)","B=(1,0,m)","C=(0,1,0)","n=Normal(A,B,C)"),n=vector(d,"n");
    expect(vectorCoordinates(d,n)!.source).toContain("m");expect(vectorCoordinates(d,n)!.value).toEqual([-2,0,1]);
    const next=applyDefinition(d,"m=3",id(d,"m"));expect(vectorCoordinates(next,n)!.value).toEqual([-3,0,1]);
    expect(vectorCoordinates(normalizeDrawing(JSON.parse(JSON.stringify(next))),n)!.source).toContain("m");
    const sectionDoc=add(d,"S=Cube(4)","p=Section(S,A,B,C)","nn=Normal(p)");
    const result=vectorCoordinates(sectionDoc,vector(sectionDoc,"nn"))!;
    expect(result.source).toContain("m");expect(result.value).toEqual([-2,0,1]);
  });
  it("creates the same cube section from three points, two lines or a line and a point",()=>{
    const base=add(start(),"S=Cube(4)","A=(0,0,2)","B=(1,0,2)","C=(0,1,2)","l=Line(A,B)","r=Line(A,C)");
    for(const source of ["Section(S,A,B,C)","Section(S,l,r)","Section(S,l,C)","Section(S,C,l)"]) {
      const d=applyDefinition(base,source),{g,mesh,o}=section(d);
      expect(g.errors.size).toBe(0);expect(mesh.loops).toHaveLength(1);expect(mesh.vertices).toHaveLength(4);
      mesh.vertices.forEach(p=>expect(p[2]).toBeCloseTo(2,10));
      const polygon=g.objects.get(o.id);expect(polygon?.kind==="polygon"&&polygon.points.length).toBe(4);
      expect(validateDrawing(normalizeDrawing(JSON.parse(JSON.stringify(d))))).toBeDefined();
      const q=screenPoint(d,[1000,700],[0,0,2]);expect(hitTest(d,[],[1000,700],q,true).some(h=>h.kind==="face"&&h.owner===o.id)).toBe(true);
      const measured=applyDefinition(d,`Area(${o.symbol})`);expect([...resolveGeometry(measured).objects.values()].some(o=>o.kind==="label"&&o.text==="S = 16")).toBe(true);
    }
  });
  it("retains section IDs while a controlling parameter changes or temporarily removes the section",()=>{
    const d=add(start(),"m=2","S=Cube(4)","A=(0,0,m)","B=(1,0,m)","C=(0,1,m)","p=Section(S,A,B,C)","n=Normal(p)"),p=id(d,"p");
    const outside=applyDefinition(d,"m=6",id(d,"m"));expect(resolveGeometry(outside).errors.has(p)).toBe(true);
    const restored=applyDefinition(outside,"m=1",id(d,"m"));expect(section(restored).mesh.vertices.every(p=>Math.abs(p[2]-1)<1e-10)).toBe(true);
    expect(id(restored,"p")).toBe(p);expect(resolveGeometry(restored).errors.size).toBe(0);
  });
  it("keeps multiple disconnected components when slicing a concave prism",()=>{
    let d=start();const coords=[[-3,-3],[3,-3],[3,3],[1,3],[1,-1],[-1,-1],[-1,3],[-3,3]];
    coords.forEach((p,i)=>d=applyDefinition(d,`P_${i}=(${p[0]},${p[1]},0)`));
    d=add(d,`b=Polygon(${coords.map((_,i)=>`P_${i}`).join(",")})`,"S=Prism(b,(0,0,3))","A=(-3,1,0)","B=(3,1,0)","C=(0,1,3)","p=Section(S,A,B,C)");
    const {g,mesh}=section(d);expect(g.errors.size).toBe(0);expect(mesh.loops).toHaveLength(2);expect(mesh.edges).toHaveLength(8);
  });
  it("rejects skew lines and collinear plane points without changing the source document",()=>{
    const d=add(start(),"S=Cube(4)","A=(0,0,1)","B=(1,0,1)","C=(0,1,2)","D=(0,2,2)","l=Line(A,B)","r=Line(C,D)"),before=JSON.stringify(d);
    expect(()=>applyDefinition(d,"Section(S,l,r)")).toThrow(/异面/);
    expect(()=>applyDefinition(d,"Section(S,l,A)")).toThrow(/直线/);
    expect(JSON.stringify(d)).toBe(before);
  });
});
