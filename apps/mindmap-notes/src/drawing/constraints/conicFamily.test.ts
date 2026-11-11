import {nonnegativeExpression} from './metricSymbolic';
import {it,expect} from 'vitest';
import {newDrawing} from '../types';
import {planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {planarConicFamily} from './conicFamily';
import {locusPaths,locusPoint,nearestLocus} from './loci';
import {installSolutionSet,solutionSetObject,validateSolutionSet} from './document';
import {resolveGeometry} from '../geometry';
function scene(k='1/2',extra=''){
 const a=addLessonInput(planarContext(newDrawing()),`P=(?,?)\nF=(2,0)\nl: x=1/2\npointLineDistance(P,l,${k}*PF)`+(extra?'\n'+extra:''));
 const problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context};return {problem,e:planarEvaluator(problem)};
}
it('constructs the focus/directrix hyperbola as two connected components, not numerical samples',()=>{
 const {problem,e}=scene(),s=symbolicPlanarEquations(problem,e.variables);expect(s.unsupported).toEqual([]);
 const plan=planarConicFamily(problem,e.variables);expect(plan).toBeDefined();
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.precision).toBe('construction');expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
 expect(r.branches.every(b=>b.dof===1&&b.loci[0].kind==='conic'&&b.loci[0].complete)).toBe(true);
 expect(r.branches.map(b=>Math.sign(b.positions.P[0])).sort()).toEqual([-1,1]);
 for(const b of r.branches)for(const p of locusPaths(b.loci[0]).flat()){expect(p[0]*p[0]-p[1]*p[1]/3).toBeCloseTo(1,7);expect(e.errors(e.variables.map(u=>p[u.field==='x'?0:1]))).toEqual([]);}
 const set=solutionSetObject(problem,r);validateSolutionSet(set);const doc=installSolutionSet(newDrawing(),set);expect(doc.objects.some(o=>o.kind==='spatialLocus')).toBe(true);expect(resolveGeometry(doc).errors.size).toBe(0);
 const left=r.branches.findIndex(b=>b.positions.P[0]<0),moved=solveConstraints({id:2,problem,previous:r,move:{point:'P',target:[-3,2,0],branch:left}});
 expect(moved.precision).toBe('construction');expect(moved.branches[left].positions.P[0]).toBeLessThan(0);expect(e.errors(e.encode(moved.branches[left].positions,moved.branches[left].values))).toEqual([]);
});
it.each([['2',1],['1',1]])('also constructs ellipse/parabola from the same distance rule: %s',(k,count)=>{
 const {problem,e}=scene(k),r=solveConstraints({id:1,problem});expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(count);
 for(const b of r.branches){expect(b.loci[0].kind).toBe('conic');const p=locusPoint(b.loci[0],.3);expect(e.errors(e.variables.map(u=>p[u.field==='x'?0:1]))).toEqual([]);expect(Math.hypot(...nearestLocus(b.loci[0],p).map((n,i)=>n-p[i]))).toBeLessThan(1e-6);}
});
it('does not draw an unrestricted conic when an additional inequality cuts its domain',()=>{
 const {problem,e}=scene('1/2','x(P)>0');expect(planarConicFamily(problem,e.variables)).toBeUndefined();
});
it('does not square away a negative distance or an unproven radical domain',()=>{
 const {problem,e}=scene('-1/2');expect(planarConicFamily(problem,e.variables)).toBeUndefined();
});

it('supports a rotated rational directrix and the original LaTeX distance syntax',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'P=(?,?)\nF=(2,2)\nl: x+y=1\npointLineDistance(P,l,1/2\\cdot PF)'),problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context};
 const r=solveConstraints({id:1,problem});expect(r.precision).toBe('construction');expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);
 const e=planarEvaluator(problem);for(const b of r.branches)for(const p of locusPaths(b.loci[0]).flat())expect(e.errors(e.variables.map(u=>p[u.field==='x'?0:1]))).toEqual([]);
});
it('does not ignore an additional equation that isolates points on the conic',()=>{
 const {problem}=scene('1/2','x(P)=2'),r=solveConstraints({id:1,problem});expect(r.branches).toHaveLength(2);expect(r.branches.every(b=>b.dof===0&&b.loci.length===0)).toBe(true);
 expect(nonnegativeExpression('sqrt(q_0)',['q_0'])).toBe(false);expect(nonnegativeExpression('(1/q_0)^2',['q_0'])).toBe(false);
});
