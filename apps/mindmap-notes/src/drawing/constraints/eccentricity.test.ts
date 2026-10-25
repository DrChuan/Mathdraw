import {eccentricityEquations} from './conicAlgebra';
import {solveExactSystem} from './exactSystem';
import {symbolicPlanarEquations} from './planarSymbolic';
import {independentParameterBranches} from './parameterBlocks';
import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {addLessonInput} from './planarLesson';
import {planarContext} from './planarModel';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
const problem=(fixed=false,angle=false)=>{const lesson=addLessonInput(planarContext(newDrawing()),[...(fixed?['c: x^2/4+y^2/2=1']:['a=?','b=?','c: x^2/a^2+y^2/b^2=1','a>b','b>0','e(c)=sqrt(2)/2','2*a=4']),...(angle?['T=(0,-2)','l=过点直线(T)']:['k=?','l: y=k*x-2']),'onCurve(A,c)','onLine(A,l)','onCurve(B,c)','onLine(B,l)','area(Triangle(O,A,B))=sqrt(2)'].join('\n'),['O','A','B']);return {mode:'coordinate' as const,points:lesson.points,segments:[],conditions:lesson.conditions,planar:lesson.context};};
describe('eccentricity and jointly unknown conic parameters',()=>{
 it.each([
  ['x^2/4+y^2/2=1','sqrt(2)/2'],
  ['-3*(x-2)^2/4-3*(y+5)^2/2=-3','sqrt(2)/2'],
  ['(x+y)^2/8+(x-y)^2/4=1','sqrt(2)/2'],
  ['x^2/9-y^2/4=1','sqrt(13)/3'],
  ['y^2/4-x^2/9=1','sqrt(13)/2'],
  ['x^2-y^2=1','sqrt(2)'],
  ['(y-3)^2=8*(x-2)','1'],
  ['x^2+y^2=4','0'],
 ])('preserves conic type, rotation and equation scale: %s',(source,value)=>{
  const result=solveExactSystem(eccentricityEquations(source,value,[]),[],{deadline:Date.now()+1000});expect(result.candidates.length,result.reason).toBeGreaterThan(0);
 });
 it.each(['x^2+y^2=-1','x^2-y^2=0','x^2=1','x+y=0'])('rejects imaginary or degenerate curve: %s',source=>{expect(solveExactSystem(eccentricityEquations(source,'0',[]),[],{deadline:Date.now()+1000}).candidates).toHaveLength(0);});
 it('solves ellipse parameters independently from the chord without freezing a family',()=>{
  const p=problem(),e=planarEvaluator(p),symbolic=symbolicPlanarEquations(p,e.variables),indices=e.variables.flatMap((u,i)=>p.planar.document.objects.some(o=>o.id===u.object&&o.kind==='number')?[i]:[]);
  expect(symbolic.complete,symbolic.unsupported.join('；')).toBe(true);
  const result=independentParameterBranches(symbolic.sources,symbolic.tokens,indices,e.initial,Date.now()+1000);expect(result.solved).toBe(1);expect(result.branches).toHaveLength(1);
  const a=e.variables.findIndex(u=>p.planar.document.objects.some(o=>o.id===u.object&&o.symbol==='a')),b=e.variables.findIndex(u=>p.planar.document.objects.some(o=>o.id===u.object&&o.symbol==='b'));
  expect(result.branches[0].get(a)).toBeCloseTo(2,10);expect(result.branches[0].get(b)).toBeCloseTo(Math.sqrt(2),10);
  expect(independentParameterBranches(['x>0'],['x'],[0],[1],Date.now()+100).branches).toEqual([]);
 });
 it('also solves a line parameterized by direction angle through the given point',()=>{const p=problem(false,true),r=solveConstraints({id:1,problem:p,budget:2000});expect(r.branches.length,r.diagnostics.join('\n')).toBeGreaterThan(0);const e=planarEvaluator(p);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);},8000);
 it('rejects the dual hyperbola eccentricity branch',()=>{expect(solveExactSystem(eccentricityEquations('x^2/9-y^2/4=1','sqrt(13)/2',[]),[],{deadline:Date.now()+1000}).candidates).toHaveLength(0);});
 it.each([false,true])('solves the area chord with fixed ellipse = %s',fixed=>{const p=problem(fixed),r=solveConstraints({id:1,problem:p,budget:2000});expect(r.branches.length,JSON.stringify({diagnostics:r.diagnostics,exact:r.exactAnalysis})).toBeGreaterThan(0);const e=planarEvaluator(p);for(const branch of r.branches){expect(e.errors(e.encode(branch.positions,branch.values))).toEqual([]);if(!fixed){const value=(name:string)=>{const o=p.planar.document.objects.find(o=>o.symbol===name)!;return branch.values![o.id+'.value'];};expect(value('a')).toBeCloseTo(2,6);expect(value('b')).toBeCloseTo(Math.sqrt(2),6);}}},12000);
});
