import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {planarContext,objectSymbol} from './planarModel';
import {addLessonInput} from './planarLesson';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {standardConicPoint} from './conicPointSymbolic';
import {solutionSetObject,validateSolutionSet} from './document';
function scene(extra=''){
 const added=addLessonInput(planarContext(newDrawing()),'椭圆 C x 参数 a,b,c,e\nA=Vertex(C,4)\nE=(0,-3/5)\nl=过点直线(E)\nM,N=Intersect(C,l)\nk=DiameterCircle(M,N)\ne=sqrt(3)/2\ny(A)=1'+(extra?'\n'+extra:''));
 const problem={mode:'coordinate' as const,points:added.points,segments:[],conditions:added.conditions,planar:added.context};
 return {problem,evaluator:planarEvaluator(problem)};
}
describe('finite parameter blocks with a forward construction',()=>{
 it('solves conic size before constructing free secants, intersections and diameter circles',()=>{
  const {problem,evaluator:e}=scene(),s=symbolicPlanarEquations(problem,e.variables);
  expect(s.unsupported).toHaveLength(1);expect(s.unsupported[0]).toContain('>0');
  const r=solveConstraints({id:1,problem,budget:2000});expect(r.status).toBe('solved');expect(r.precision).toBe('construction');expect(r.attempts).toBeLessThan(5);
  const b=r.branches[0],a=problem.planar.document.objects.find(o=>objectSymbol(o)==='a')!,small=problem.planar.document.objects.find(o=>objectSymbol(o)==='b')!;
  expect(b.values?.[`${a.id}.value`]).toBeCloseTo(2,7);expect(b.values?.[`${small.id}.value`]).toBeCloseTo(1,7);expect(b.dof).toBe(1);expect(b.constructionParameters).toHaveLength(1);expect(r.complete).toBe(false);
  expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
  const set=solutionSetObject(problem,r);validateSolutionSet(set);
  const moved=solveConstraints({id:2,problem,previous:r,parameter:{branch:0,variable:b.constructionParameters![0],target:Math.PI/2},budget:1000});
  expect(moved.precision).toBe('construction');expect(e.errors(e.encode(moved.branches[0].positions,moved.branches[0].values))).toEqual([]);
 });
 it('does not silently discard an equality that constrains the free line direction',()=>{
  const {problem}=scene('l_t=0.3'),r=solveConstraints({id:1,problem,budget:2000});
  expect(r.status).toBe('solved');expect(r.branches.every(b=>!b.constructionParameters?.length)).toBe(true);
 });
 it('keeps inequality domains and rejects an invalid constructive parameter update',()=>{
  const {problem}=scene('l_t<0'),r=solveConstraints({id:1,problem,budget:2000});expect(r.precision).toBe('construction');
  expect(()=>solveConstraints({id:2,problem,previous:r,parameter:{branch:0,variable:r.branches[0].constructionParameters![0],target:.2}})).toThrow(/不满足/);
 });
 it('handles renamed parameters and a vertical major axis without sample constants',()=>{
  const added=addLessonInput(planarContext(newDrawing()),'椭圆 Q y 参数 a_2,b_2,c_2,e_2\nH=Vertex(Q,4)\nS=(1/5,0)\ng=过点直线(S)\nJ,K=Intersect(Q,g)\nd=DiameterCircle(J,K)\ne_2=4/5\nx(H)=3');
  const problem={mode:'coordinate' as const,points:added.points,segments:[],conditions:added.conditions,planar:added.context},r=solveConstraints({id:1,problem,budget:2000});
  expect(r.precision).toBe('construction');expect(r.branches[0].dof).toBe(1);
  const values=r.branches[0].values!,parameter=(n:string)=>values[`${added.context.document.objects.find(o=>objectSymbol(o)===n)!.id}.value`];
  expect(parameter('a_2')).toBeCloseTo(5,7);expect(parameter('b_2')).toBeCloseTo(3,7);
 });
 it('uses feature branch guards rather than the starting ellipse aspect ratio',()=>{
  expect(standardConicPoint('y^2/a_2^2+x^2/b_2^2=1','vertex',3,['a_2>b_2','a_2>0','b_2>0'])).toEqual(['(b_2)','0']);
  expect(standardConicPoint('x^2/a^2+y^2/b^2=1','vertex',3,[])).toBeUndefined();
  expect(standardConicPoint('x^2/a^2-y^2/b^2=1','focus',0,['a>0','b>0'])).toEqual(['-(sqrt(a^2+b^2))','0']);
 });
});
