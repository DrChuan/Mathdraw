import { describe, expect, it } from "vitest";
import { newDrawing, type DrawingDocument, type DrawingPoint } from "./types";
import { applyDefinition } from "./model";
import { resolveGeometry, resolveLocusGeometry, validateDrawing } from "./geometry";
import { dependsOn, exactLocus, locusDocument, locusDriver, sampleLocus } from "./locus";
import { evaluate, parseExpression } from "./expression";
import { sampleCurve } from "./curves";
import { createLocusDrag } from "./locusDrag";
import { project } from "./geometry";
import { readFileSync } from "node:fs";
import { normalizeDrawing } from "./model";
const add=(...sources:string[])=>sources.reduce((d,s)=>applyDefinition(d,s),newDrawing());
const id=(d:DrawingDocument,s:string)=>d.objects.find(o=>o.symbol===s)!.id;
const trace=(d:DrawingDocument)=>[...resolveGeometry(d).curves.values()].find(c=>c.derived?.type==="locus")!;

describe("locus dependency closure and upstream drivers",()=>{
  it("traces a derived selected point through its path ancestor",()=>{
    const d=add('c:x^2+y^2=4','P=On(c,(2,0))','A=(0,0)','M=Midpoint(A,P)','Q=(x(M)+1,y(M)^2)','Locus(M,Q)');
    expect(trace(d).derived).toMatchObject({driver:id(d,'P'),follower:id(d,'Q')});
    validateDrawing(d);
    expect(sampleCurve(trace(d)).paths.flat().length).toBeGreaterThan(30);
  });
  it("recognizes siblings sharing an upstream path point",()=>{
    const d=add('c:y=x^2','P=On(c,(1,1))','M=(x(P)+1,y(P))','Q=(x(P),y(P)+2)','Locus(M,Q)');
    expect(trace(d).derived).toMatchObject({driver:id(d,'P')});
  });
  it("rejects unrelated points even when their positions coincide",()=>{
    const d=add('c:y=x','P=On(c,(1,1))','Q=(1,1)');
    expect(()=>applyDefinition(d,'Locus(P,Q)')).toThrow(/没有可计算/);
  });
  it("allows a currently undefined follower to trace valid poses",()=>{
    let d=add('c:y=x^2','P=On(c,(1,1))','Q=(1/x(P),y(P))');
    const p=d.objects.find(o=>o.id===id(d,'P')) as DrawingPoint;
    d={...d,objects:d.objects.map(o=>o.id===p.id?{...p,construction:{type:'onPath' as const,path:id(d,'c'),parameter:0}}:o)};
    expect(resolveGeometry(d).points.has(id(d,'Q'))).toBe(false);
    d=applyDefinition(d,'Locus(P,Q,-2,2)');
    expect(sampleCurve(trace(d)).paths.flat().length).toBeGreaterThan(30);
  });
  it("keeps reverse dragging connected to the inferred path driver",()=>{
    const d=add('c:y=x^2','P=On(c,(1,1))','M=(x(P)+1,y(P))','Q=(x(M)+1,y(M))','Locus(M,Q,-2,2)');
    const drag=createLocusDrag(d,trace(d),[800,600]);
    const q=project([3.5,2.25,0],d);
    const result=drag.move([(q[0]-d.view.center[0])*d.view.scale+400,(q[1]-d.view.center[1])*d.view.scale+300]);
    expect(result.document).toBeTruthy();
    const actual=resolveGeometry(result.document!).points.get(id(d,'Q'))!.p;
    expect(actual[0]).toBeCloseTo(3.5,4);expect(actual[1]).toBeCloseTo(2.25,4);
  });
  it("reports ambiguous independent path parameters",()=>{
    const d=add('c:y=x','P=On(c,(1,1))','R=On(c,(2,2))','M=Midpoint(P,R)','Q=(x(M),y(M)+1)');
    expect(()=>locusDriver(d,id(d,'M'),id(d,'Q'))).toThrow(/多个独立动点/);
    expect(()=>applyDefinition(d,'Locus(P,Q)')).not.toThrow();
  });
  it("walks generated polygon edge references and keeps their defining points",()=>{
    let d=add('c:y=x^2','P=On(c,(1,1))','A=(0,0)','B=(2,0)','T=Triangle(A,P,B)');
    const q:DrawingPoint={...d.objects.find(o=>o.id===id(d,'A')) as DrawingPoint,id:'edge-point',symbol:'Q',construction:{type:'onPath',path:`${id(d,'T')}:e:0`,parameter:.5}};
    d={...d,objects:[...d.objects,q]};
    expect(dependsOn(d,q.id,id(d,'P'))).toBe(true);
    const base=locusDocument(d,id(d,'P'),q.id);
    expect(base.objects.some(o=>o.id===id(d,'T'))).toBe(true);
    expect(sampleLocus(base,id(d,'P'),q.id,'xy',-2,2,2000).flat().length).toBeGreaterThan(30);
  });
  for(const command of ['Locus(A,B)','Locus(A,C)','Locus(B,C)'])it(`traces the saved parabola/tangent construction: ${command}`,()=>{
    const input=normalizeDrawing(JSON.parse(readFileSync(new URL('../../../数学绘图/轨迹.mathdraw.json',import.meta.url),'utf8')));
    const d=applyDefinition(input,command);validateDrawing(d);
    expect(sampleCurve(trace(d),[-20,20,-20,20]).paths.flat().length).toBeGreaterThan(30);
  });
});

describe("exact multilevel coordinate and numeric composition",()=>{
  for(const source of ['Q=On(l,0.25)','Q=(n,y(P)+n)'])it(source,()=>{
    const d=add('c:y=x^2','P=On(c,(1,1))','A=(0,0)','l=Line(A,P)','k=x(P)+1','n=k^2',source);
    const xy=exactLocus(d,id(d,'P'),id(d,'Q'),'xy');expect(xy).not.toBeNull();
    for(const t of [-1.5,.4,2]) {
      const p=d.objects.find(o=>o.id===id(d,'P')) as DrawingPoint;
      if(p.construction.type!=='onPath')throw Error();
      const changed={...d,objects:d.objects.map(o=>o.id===p.id?{...p,construction:{...p.construction,parameter:t}}:o)};
      const actual=resolveGeometry(changed).points.get(id(d,'Q'))!.p;
      xy!.forEach((s,i)=>expect(evaluate(parseExpression(s,['t']),{t})).toBeCloseTo(actual[i],6));
    }
  });
  it("uses numeric fallback for normalized relation lines",()=>{
    const d=add('c:y=x^2','P=On(c,(1,1))','A=(0,0)','B=(1,0)','l=Line(A,P)','h=Parallel(l,B)','Q=On(h,2)','Locus(P,Q,-2,2)');
    const c=trace(d);expect(c.locusInput).toBeTruthy();
    const paths=sampleCurve(c,[-10,10,-10,10],180,2000).paths;
    expect(paths.flat().length).toBeGreaterThan(30);
    for(const [x,y] of paths.flat())expect(Math.hypot(x-1,y)).toBeCloseTo(2,5);
  });
  it("matches display geometry in the lightweight evaluator",()=>{
    const d=add('c:x^2+y^2=4','P=On(c,(2,0))','A=(0,0)','B=(1,0)','l=Line(A,P)','Q=Reflect(B,l)');
    const full=resolveGeometry(d),light=resolveLocusGeometry(d);
    for(const [id,p] of full.points)expect(light.points.get(id)?.p).toEqual(p.p);
    expect([...light.errors]).toEqual([...full.errors]);
    expect(light.connected.size).toBe(0);
  });
  it("retains segment bounds instead of tracing its infinite supporting line",()=>{
    const d=add('c:y=x','P=On(c,(3,3))','A=(0,0)','s=Segment(A,P)','l:x=2','Q=Intersect(s,l)','Locus(P,Q,-4,4)');
    expect(trace(d).locusInput).toBeTruthy();
    const paths=sampleLocus(d,id(d,'P'),id(d,'Q'),'xy',-4,4,2000);
    expect(paths.flat().length).toBeGreaterThan(20);
    expect(paths.flat().length).toBeLessThan(70);
    for(const [x,y] of paths.flat()){expect(x).toBeCloseTo(2);expect(y).toBeCloseTo(2);}
  });
});
