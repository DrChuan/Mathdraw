import {describe,it,expect} from 'vitest';
import {newDrawing,type DrawingDocument,type DrawingPoint} from '../types';
import {applyDefinition,normalizeDrawing} from '../model';
import {objectSymbol,planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {pointCreationSource} from './pointCreation';
import {validatePlanarEquationSyntax} from './planarSyntax';
import {equationEnvironment} from './planarExpressions';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {coordinateDriverChoices,setPlanarPointInput,updatePlanarInput,isPlanarInput} from './inputs';
import {solutionSetObject,installSolutionSet,constraintBinding} from './document';
import type {ConstraintProblem} from './types';
const setup=(source:string)=>{const a=addLessonInput(planarContext(newDrawing()),source);return {mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context};};
const find=(d:DrawingDocument,n:string)=>d.objects.find(o=>objectSymbol(o)===n)!;
describe('slope expressions share numeric and exact reference handling',()=>{
 it.each(['k(AB)','k(A B)','k(l)','slope(l)'])('solves %s exactly without freezing the line',(expression)=>{
  const p=setup(`A=(0,0)\nB=(2,?)\nl=Line(A,B)\n${expression}=1/2`),e=planarEvaluator(p),compiled=symbolicPlanarEquations(p,e.variables);
  expect(compiled.complete,compiled.unsupported.join(';')).toBe(true);
  const r=solveConstraints({id:1,problem:p,budget:1000});expect(r.branches.length).toBeGreaterThan(0);expect(r.precision).not.toBe('approximate');
  for(const b of r.branches){expect(b.positions.B[1]).toBeCloseTo(1,9);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);}
 });
 it('combines a parameterized equation line and point-pair slopes without confusing scalar k',()=>{
  const p=setup('k=?\nA=(0,0)\nB=(2,1)\nl:y=k*x+1\nk(l)+k(AB)=5/2');
  const r=solveConstraints({id:1,problem:p,budget:1000});expect(r.branches.length).toBeGreaterThan(0);
  const o=find(p.planar.document,'k');expect(r.branches[0].values![o.id+'.value']).toBeCloseTo(2,9);
 });
 it('rejects vertical, degenerate and nonlinear references rather than returning infinite slopes',()=>{
  const p=setup('A=(0,0)\nB=(0,1)\nl:x=2\nc:x^2+y^2=1'),env=equationEnvironment(p.planar.document);
  expect(()=>env.numeric('k(AB)')).toThrow('斜率不存在');expect(()=>env.numeric('k(l)')).toThrow('斜率不存在');expect(()=>env.numeric('k(c)')).toThrow('不是直线');
  expect(()=>validatePlanarEquationSyntax('k(l,2)=0',p.planar.document,p.points)).toThrow('参数数量');
 });
 it('uses horizontal slope zero, and enforces the nonvertical guard after clearing denominators',()=>{
  const p=setup('A=(0,0)\nB=(?,1)\nk(AB)=0'),r=solveConstraints({id:1,problem:p,budget:100});expect(r.branches).toHaveLength(0);
  expect(equationEnvironment(setup('l:y=3').planar.document).numeric('k(l)')).toBe(0);
 });
 it('keeps a variable denominator guard and rejects a coincident endpoint as an extraneous root',()=>{
  const p=setup('A=(0,0)\nB=(?,?)\nk(AB)=2\nx(B)=0'),e=planarEvaluator(p),symbolic=symbolicPlanarEquations(p,e.variables);
  expect(symbolic.complete).toBe(true);expect(symbolic.sources.some(s=>s.includes('!=')||s.includes('>'))).toBe(true);
  expect(solveConstraints({id:1,problem:p,budget:150}).branches).toHaveLength(0);
 });
});
describe('point creation and existing canvas point drivers',()=>{
 it.each(['c','l','s'])('creates a point with an explicit incidence on %s',path=>{
  const base=setup('A=(0,0)\nB=(4,0)\nc:x^2/4+y^2/3=1\nl:y=2\ns=Segment(A,B)'),before=JSON.stringify(base.planar);
  const source=pointCreationSource(base.planar.document,'P','','',path);expect(source).toBe(`P=(?,?)\nonCurve(P,${path})`);
  const next=addLessonInput(base.planar,source,base.points);expect(next.context.unknowns).toHaveLength(2);expect(next.context.equations.at(-1)?.source).toBe(`onCurve(P,${path})`);expect(JSON.stringify(base.planar)).toBe(before);
  const p:ConstraintProblem={...base,points:next.points,conditions:next.conditions,planar:next.context},r=solveConstraints({id:1,problem:p,budget:1000});expect(r.branches.length).toBeGreaterThan(0);
  for(const b of r.branches){const e=planarEvaluator(p);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);}
 });
 it('jointly solves an ellipse point and preserves explicit coordinate restrictions',()=>{
  const base=setup('c:x^2/4+y^2/3=1'),a=addLessonInput(base.planar,pointCreationSource(base.planar.document,'P','1','','c'));
  const p:ConstraintProblem={...base,points:a.points,conditions:a.conditions,planar:a.context},r=solveConstraints({id:1,problem:p,budget:1000});expect(r.branches).toHaveLength(2);for(const b of r.branches){expect(b.positions.P[0]).toBe(1);expect(Math.abs(b.positions.P[1])).toBeCloseTo(1.5,9);}
  expect(()=>pointCreationSource(base.planar.document,'Q','','','missing')).toThrow('曲线或直线');
 });
 it('offers an imported sliding point as an input driver without counting it as an internal DOF',()=>{
  let d=newDrawing();for(const s of ['A=(0,0)','B=(4,0)','s=Segment(A,B)','D=On(s,0.5)'])d=applyDefinition(d,s);
  const context=planarContext(d,true),p:ConstraintProblem={mode:'coordinate',points:context.document.objects.filter(o=>o.kind==='point').map(objectSymbol),segments:[],conditions:[],planar:context},r=solveConstraints({id:1,problem:p,budget:500});
  expect(r.branches[0].dof).toBe(0);expect(coordinateDriverChoices(p,r.branches[0])).toContain('D');expect(coordinateDriverChoices(p,r.branches[0])).toContain('A');expect(coordinateDriverChoices(p,r.branches[0])).not.toContain('O');
  const next=updatePlanarInput(p,find(d,'D').id,{target:[3,9,0]}),n=solveConstraints({id:2,problem:next,budget:500});expect(n.branches[0].positions.D).toEqual([3,0,0]);
  const installed=installSolutionSet(d,{...solutionSetObject(next,n),driver:'D'}),point=find(installed,'D') as DrawingPoint;expect(point.id).toBe(find(d,'D').id);expect(point.construction.type).toBe('onPath');expect(constraintBinding(installed,point)?.input).toBe(true);
  const reopened=planarContext(normalizeDrawing(JSON.parse(JSON.stringify(installed))),true);expect(isPlanarInput(reopened,point.id)).toBe(true);
 });
 it('makes a legacy fixed point adjustable only after explicit selection, and protects dependent points',()=>{
  const p=setup('A=(1,2)\nB=(3,4)\nM=Midpoint(A,B)'),id=find(p.planar.document,'A').id,r=solveConstraints({id:1,problem:p,budget:500});expect(coordinateDriverChoices(p,r.branches[0])).not.toContain('A');
  const next={...p,planar:setPlanarPointInput(p.planar,id)},n=solveConstraints({id:2,problem:next,budget:500});expect(coordinateDriverChoices(next,n.branches[0])).toContain('A');expect(next.planar.unknowns).toHaveLength(0);expect(p.planar.inputs).toEqual([]);
  expect(()=>setPlanarPointInput(p.planar,find(p.planar.document,'M').id)).toThrow('来源');
 });
});
