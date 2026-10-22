import { describe, it, expect } from "vitest";
import { newDrawing, type DrawingDocument, type DrawingCurve } from "./types";
import { applyDefinition } from "./model";
import { resolveGeometry } from "./geometry";
import { sampleCurve } from "./curves";
const add=(...sources:string[])=>sources.reduce((d,s)=>applyDefinition(d,s),newDrawing());
const by=(d:DrawingDocument,s:string)=>d.objects.find(o=>o.symbol===s)!;
describe("reported coordinate and locus regressions",()=>{
 it("references both coordinates of D",()=>{const d=add('D=(2,3)','G=(x(D),y(D))');expect(resolveGeometry(d).points.get(by(d,'G').id)?.p).toEqual([2,3,0]);});
 for(const follower of ['Q=Reflect(D,l)','Q=(x(D)+1,y(D))']) it(`traces ${follower} on an ellipse`,()=>{
  const d=add('c:x^2/4+y^2=1','D=On(c,(2,0))','A=(0,0)','B=(1,1)','l=Line(A,B)',follower,'Locus(D,Q)');
  const c=[...resolveGeometry(d).curves.values()].find(c=>c.derived?.type==='locus') as DrawingCurve;
  expect(sampleCurve(c,[-5,5,-5,5],60,2000).paths.flat().length).toBeGreaterThan(20);
 });
});

import { definition } from "./model";
import { annotationLayout } from "./annotation";
import { exportSvg, sceneFor } from "./scene";
import { initialTool, wantsPoint, toolTarget } from "./interaction";
import { pointAt } from "./parametric";
import { evaluate, parseExpression } from "./expression";
import { conicPath } from "./conics";
import { intersectionObjects, normalizeDrawing } from "./model";
import { canSelectPoint } from "./interaction";
import { mergeColors } from "./colors";
import { cartesianLocus } from "./locus";
import { locusFormula } from "./mathPreview";
import { equation } from "./expression";
import katex from "katex";
describe("intersection labels, mixed picking and palettes",()=>{
 it("gives every intersection a unique matching label, including previews and named commands",()=>{
  const d=add('c:x^2+y^2=4','l:y=0');
  const ps=intersectionObjects(d,by(d,'c').id,by(d,'l').id);
  expect(ps).toHaveLength(2);expect(new Set(ps.map(p=>p.name)).size).toBe(2);
  expect(ps.every(p=>p.name===p.symbol)).toBe(true);
  const next=applyDefinition(d,'P=Intersect(c,l)'),points=next.objects.filter(o=>o.kind==='point'&&o.construction.type==='intersection');
  expect(new Set(points.map(p=>p.name)).size).toBe(2);expect(points.every(p=>p.name===p.symbol)).toBe(true);
  const legacy={...next,objects:next.objects.map(o=>points.some(p=>p.id===o.id)?{...o,name:'I'}:o)};
  const repaired=normalizeDrawing(legacy).objects.filter(o=>points.some(p=>p.id===o.id));
  expect(new Set(repaired.map(o=>o.name)).size).toBe(2);
 });
 it("allows existing point highlights during reflection without a new-point preview",()=>{
  const s={...initialTool('reflect'),references:['axis']};
  expect(canSelectPoint(s)).toBe(true);expect(wantsPoint(s)).toBe(false);
  expect(canSelectPoint({...s,references:[]})).toBe(false);
  for(const tool of ['parallel','perpendicular','length','midpoint'] as const)expect(canSelectPoint(initialTool(tool))).toBe(true);
  expect(canSelectPoint(initialTool('tangent'))).toBe(false);
 });
 it("deduplicates custom and used colors and rejects corrupt preferences",()=>{
  expect(mergeColors(['#AABBCC','#161b22'],['#aabbcc','bad','#123456'])).toEqual(['#aabbcc','#161b22','#123456']);
 });
});
describe("exact Cartesian locus presentation",()=>{
 const fixtures:[string,string][]=[['2*cos(t)','sin(t)'],['1+cos(t)-2*sin(t)','3+cos(t)+2*sin(t)'],['(exp(t)+exp(-t))/2','(exp(t)-exp(-t))/2'],['t+t^2','t-t^2'],['t','t^4'],['2*cos(t)','1'],['cos(t)','2*cos(t)+3'],['-3*sin(t)','2-(-3*sin(t))^2']];
 for(const xy of fixtures)it(`eliminates parameters from ${xy.join(',')}`,()=>{
  const source=cartesianLocus(xy);expect(source).toBeTruthy();
  const parsed=equation(source!);
  for(const t of [-1,-.3,0,.8,1.5]){
   const [x,y]=xy.map(s=>evaluate(parseExpression(s,['t']),{t})),v=evaluate(parsed.ast,{x,y});
   expect(parsed.type==='y'?v-y:parsed.type==='x'?v-x:v).toBeCloseTo(0,7);
  }
  const tex=locusFormula({resolvedDefinition:source,parametric:{x:xy[0],y:xy[1]}});
  expect(tex).not.toContain('(t)');expect(()=>katex.renderToString(tex,{throwOnError:true})).not.toThrow();
 });
 it("does not fit a spurious implicit equation to unsupported curves",()=>{
  expect(cartesianLocus(['cos(t)','sin(2*t)'])).toBeUndefined();
  const tex=locusFormula({resolvedDefinition:'x(t)=cos(t), y(t)=sin(2*t)',parametric:{x:'cos(t)',y:'sin(2*t)'}});
  expect(tex).toContain('\\begin{cases}');expect(tex).toContain('\\operatorname{sin}');
  expect(()=>katex.renderToString(tex,{throwOnError:true})).not.toThrow();
 });
 it("gets a Cartesian equation for reflection about an equation-defined axis",()=>{
  const d=add('c:x^2/4+y^2=1','D=On(c,(2,0))','l:y=x+1','Q=Reflect(D,l)','Locus(D,Q)');
  const locus=[...resolveGeometry(d).curves.values()].find(c=>c.derived?.type==='locus')!;
  expect(locus.resolvedDefinition).toBeTruthy();expect(locus.resolvedDefinition).not.toContain('(t)=');
  const f=equation(locus.resolvedDefinition!);
  for(const t of [0,.5,2,4]){const [x,y]=pointAt(locus,t);expect(evaluate(f.ast,{x,y})).toBeCloseTo(0,6);}
 });
});
describe("annotation input and output",()=>{
 for(const s of ['Text("a=b",(0,0))','Text(“formula”,(0,0))',String.raw`Text("$\frac{a}{b}+\theta$",(0,0))`]) it(`accepts ${s}`,()=>{
  const d=add(s),o=d.objects.find(o=>o.kind==='label')!;expect(o.kind).toBe('label');
  if(o.kind!=='label')throw Error();expect(o.text).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);expect(d.objects.filter(o=>o.kind==='number')).toHaveLength(0);
  const again=applyDefinition(d,definition(d,o),o.id);expect(again.objects.find(p=>p.id===o.id)).toMatchObject({text:o.text});
 });
 it("lays out fractions, scripts, radicals and Greek with Times glyphs",()=>{
  const tex=String.raw`Value: $\frac{a_1^2}{b}+\sqrt{3}+\theta$`,layout=annotationLayout(tex,20);
  expect(layout.lines.length).toBeGreaterThan(1);expect(layout.glyphs.some(g=>g.text==='θ')).toBe(true);
  expect(layout.glyphs.some(g=>g.text==='2'&&g.size<20&&g.y<0)).toBe(true);
  const d=add(`Text(${JSON.stringify(tex)},(0,0))`),svg=exportSvg(sceneFor(d,[],[800,600]),d,[800,600]);
  expect(svg).toContain('Times New Roman');expect(svg).not.toContain('foreignObject');expect(svg).not.toContain('\\frac');expect(svg).toContain('θ');
 });
 it("preserves a matrix's double slash in a definition round trip",()=>{
  const text=String.raw`$\begin{pmatrix}a&b\\c&d\end{pmatrix}$`,d=add(`Text(${JSON.stringify(text)},(0,0))`),o=d.objects.find(o=>o.kind==='label')!;
  if(o.kind!=='label')throw Error();expect(o.text).toBe(text);expect(annotationLayout(o.text,20).glyphs.map(g=>g.text).join('')).not.toContain('begin');
 });
});
describe("coordinate normalization and dependency changes",()=>{
 for(const source of ['G=(x(D),y(D))','G=(x ( D ), y ( D ))',String.raw`G=(\operatorname{x}\left(D\right),\mathrm{y}(D))`,'G=（x(D)，y(D)）']) it(source,()=>{
  let d=add('D=(2,3)',source);const id=by(d,'D').id;d=applyDefinition(d,'D=(4,-2)',id);expect(resolveGeometry(d).points.get(by(d,'G').id)?.p).toEqual([4,-2,0]);
 });
 for(const source of ['Q=Reflect(D,l)','Q=(x(D)+1,y(D))','Q=(x(D),y(D))']) it(`traces coordinate and reflected followers with an equation axis: ${source}`,()=>{
  const d=add('c:x^2/4+y^2=1','D=On(c,(2,0))','l:y=x+1',source,'Locus(D,Q)');
  const locus=[...resolveGeometry(d).curves.values()].find(c=>c.derived?.type==='locus')!;
  const result=sampleCurve(locus,[-6,6,-6,6],90,2500);expect(result.paths.flat().length).toBeGreaterThan(40);
  if(locus.parametric) {const p=pointAt(locus,0);expect(p.every(Number.isFinite)).toBe(true);}
 });
 for(const [equation,seed] of [['x^2/4+y^2=1',[2,0]],['y^2=2*x',[2,2]],['x^2-y^2=1',[-1,0]]] as const) it(`parametrizes ${equation} without changing branch`,()=>{
  const d=add(`c:${equation}`),c=resolveGeometry(d).curves.get(by(d,'c').id)!,p=conicPath(c,[...seed]);expect(p).not.toBeNull();
  const residual=parseExpression(equation.replace('=','-(')+')');
  for(const t of [p!.tMin,(p!.tMin+p!.tMax)/2,p!.tMax]){const x=evaluate(parseExpression(p!.x,['t']),{t}),y=evaluate(parseExpression(p!.y,['t']),{t});expect(evaluate(residual,{x,y})).toBeCloseTo(0,5);if(equation.includes('x^2-y'))expect(x).toBeLessThan(0);}
 });
});
describe("current tool requirements",()=>{
 it("does not draw a point prompt until a tangent curve has been selected",()=>{const s=initialTool('tangent');expect(wantsPoint(s)).toBe(false);expect(toolTarget(s)).toBe('曲线');s.references=['c'];expect(wantsPoint(s)).toBe(true);expect(toolTarget(s)).toContain('点');});
 for(const tool of ['reflect','intersect','area','perimeter','planeFace'] as const) it(`does not suggest a new point for ${tool}`,()=>expect(wantsPoint(initialTool(tool))).toBe(false));
});
