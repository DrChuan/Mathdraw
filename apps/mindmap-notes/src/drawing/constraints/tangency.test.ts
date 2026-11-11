import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {addLessonInput} from './planarLesson';
import {planarContext} from './planarModel';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {solveConstraints} from './solver';
import {unknownCircleSource,tangencySources} from './circleCreation';
import {objectSymbol,addPlanarDefinition} from './planarModel';
import {readFileSync} from 'node:fs';
import {decodeConfiguration} from './configuration';
import {parsePlanarInput,equationEnvironment} from './planarExpressions';
const setup=(s:string)=>{const a=addLessonInput(planarContext(newDrawing()),s);return {mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context};};
describe('tangency uses the same unfrozen conic and line definitions',()=>{
 it.each([
  ['c:x^2+y^2=4','l:x=2'],
  ['c:x^2/4+y^2=1','l:x=2'],
  ['c:x^2-y^2=1','l:x=1'],
  ['c:y^2=4*x','l:x=0'],
  ['c:(x+y)^2/4+(x-y)^2=1','l:x+y=2'],
  ['c:-7*((x-3)^2+(y+2)^2-4)=0','l:y=0']
 ])('compiles and verifies %s with %s',(c,l)=>{
  const p=setup(`${c}\n${l}\ntangent(l,c)`),e=planarEvaluator(p),s=symbolicPlanarEquations(p,e.variables);
  expect(s.complete,s.unsupported.join(';')).toBe(true);expect(e.errors(e.initial)).toEqual([]);
 });
 it('solves a translating circle tangent to three lines without slope singularities',()=>{
  const p=setup('C=(?,?)\nr=?\nc:(x-x(C))^2+(y-y(C))^2=r^2\nr>0\nl:x=0\nm:y=0\nn:x+y=2\ntangent(l,c)\ntangent(m,c)\ntangent(n,c)'),e=planarEvaluator(p),s=symbolicPlanarEquations(p,e.variables);
  expect(s.complete,s.unsupported.join(';')).toBe(true);
  const result=solveConstraints({id:1,problem:p,budget:2000});
  expect(result.branches.length).toBeGreaterThan(0);
  for(const b of result.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
 });
 it('solves an unknown radius exactly and excludes the zero-radius root',()=>{
  const p=setup('r=?\nc:x^2+y^2=r^2\nr>0\nl:x=2\ntangent(l,c)'),e=planarEvaluator(p),r=solveConstraints({id:1,problem:p,budget:1000});
  expect(r.precision).not.toBe('approximate');expect(r.branches).toHaveLength(1);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
 });
 it('rejects asymptotes, line components, and zero-radius circles',()=>{
  for(const source of ['c:x^2-y^2=1\nl:y=x','c:x*y=0\nl:x=0','c:x^2+y^2=0\nl:x=0']){
   const p=setup(`${source}\ntangent(l,c)`),e=planarEvaluator(p),s=symbolicPlanarEquations(p,e.variables);
   expect(s.complete).toBe(true);expect(e.errors(e.initial).length).toBeGreaterThan(0);
  }
 });
});
describe('circle creation keeps unknown coefficients distinct from constants',()=>{
 it('reproduces the saved configuration without silently changing its constants',()=>{
  const saved=decodeConfiguration(readFileSync(new URL('./fixtures/ellipse-three-tangents.json',import.meta.url),'utf8'));
  const points=saved.points.split(' '),planar=saved.planar!,before=JSON.stringify(saved),parsed=parsePlanarInput(saved.conditions[0].source,points);
  const p={mode:'coordinate' as const,points,conditions:parsed.conditions,segments:[],planar},e=planarEvaluator(p),env=equationEnvironment(e.model(e.initial).doc);
  expect(planar.unknowns).toHaveLength(4);
  expect(env.numeric('D')).toBe(1);expect(env.numeric('F')).toBe(1);
  const residual=env.residual('tangent(F_1 F_2,c1)')[0];expect(Math.abs(residual)).toBeGreaterThan(.1);
  for(const n of [1,2,3]){const v=[...e.initial];v[0]=2*n;v[1]=n;const other=equationEnvironment(e.model(v).doc);expect(other.residual('tangent(F_1 F_2,c1)')[0]).toBeCloseTo(residual,10);}
  expect(JSON.stringify(saved)).toBe(before);
 });
 it('does not accept a tiny circle merely because the squared discriminant is small',()=>{
  const p=setup('c:(x-7)^2+(y-0.00027)^2=0.00021^2\nl:y=0\ntangent(l,c)'),e=planarEvaluator(p);
  expect(e.errors(e.initial).some(e=>e.source==='tangent(l,c)')).toBe(true);
 });
 it('does not silently accept undeclared uppercase E as Euler constant',()=>{
  expect(()=>addPlanarDefinition(planarContext(newDrawing()),'c:x^2+y^2+Dx+Ey+F=0')).toThrow('大写 E');
  const p=setup('E_1=?\nc:x^2+y^2+D*x+E_1*y+F=0');
  expect(p.planar.unknowns.map(u=>objectSymbol(p.planar.document.objects.find(o=>o.id===u.object)!)).sort()).toEqual(['D','E_1','F']);
 });
 it('creates exactly the requested unknown circle and tangencies in one transaction',()=>{
  const base=setup('l:x=0\nm:y=0\nn:x+y=2'),before=JSON.stringify(base),source=unknownCircleSource(base.planar.document,'c','','','',['l','m','n','l']),p=setup(`l:x=0\nm:y=0\nn:x+y=2\n${source}`);
  expect(p.planar.unknowns).toHaveLength(3);expect(p.planar.equations.filter(q=>q.source.startsWith('tangent'))).toHaveLength(3);expect(JSON.stringify(base)).toBe(before);
  expect(tangencySources('l， m,l, A B','c')).toEqual(['tangent(l,c)','tangent(m,c)','tangent(A B,c)']);
 });
 it.each(['','1'])('solves the ellipse and tangent circle together with radius %s',(radius)=>{
  const source='椭圆 c x 参数 a,b,c_1,e\nF_1=Focus(c,1)\nF_2=Focus(c,2)\nP=(?,?)\nonCurve(P,c)\nPF_1=3PF_2\nl1=Line(P,F_1)\nL2=Line(P,F_2)',base=setup(source),circle=unknownCircleSource(base.planar.document,'c1','','',radius,['l1','L2','F_1 F_2']),p=setup(`${source}\n${circle}`),e=planarEvaluator(p);
  const result=solveConstraints({id:1,problem:p,budget:2000});
  expect(result.branches.length,JSON.stringify(result.diagnostics)).toBeGreaterThan(0);
  expect(result.branches.some(b=>Math.abs(b.positions.P[1])>1e-5)).toBe(true);
  for(const b of result.branches){expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);if(Math.abs(b.positions.P[1])>1e-5)expect(b.dof).toBe(radius?1:2);}
 },10000);
});
