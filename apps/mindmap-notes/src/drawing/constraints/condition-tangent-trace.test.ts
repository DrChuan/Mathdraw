import {it,expect} from 'vitest';
import {newDrawing} from '../types';
import {addLessonInput} from './planarLesson';
import {planarContext} from './planarModel';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {solutionSetObject,installSolutionSet,validateSolutionSet} from './document';
import {resolveGeometry} from '../geometry';
import type {ConstraintProblem} from './types';
export const mongeConditions='C: x^2/9+y^2/4=1\nP=(?,?)\nl=过点直线(P)\nm=过点直线(P)\ntangent(l,C)\ntangent(m,C)\nperpendicular(l,m)';
it.each([mongeConditions,mongeConditions.replace('C: x^2/9+y^2/4=1','椭圆 C x\nC_a=3\nC_b=2')])('constructs and traces P solely from incidence, perpendicularity and tangency conditions: %s',source=>{
 const a=addLessonInput(planarContext(newDrawing()),source),problem:ConstraintProblem={mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context};
 const r=solveConstraints({id:1,problem,budget:3000});expect(r.branches.length).toBeGreaterThan(0);const b=r.branches[0],e=planarEvaluator(problem);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);expect(b.dof).toBe(1);expect(b.positions.P[0]**2+b.positions.P[1]**2).toBeCloseTo(13,5);
 const traced=solveConstraints({id:2,problem,previous:r,budget:7000,trace:{point:'P',branch:0}}),locus=traced.branches[0].loci.find(l=>l.point==='P')!;expect(locus.kind).toBe('sampled');const samples=locus.paths!.flat();expect(samples.length).toBeGreaterThan(100);const bins=new Set<number>();for(const [x,y]of samples){expect(x*x+y*y).toBeCloseTo(13,3);bins.add(Math.floor((Math.atan2(y,x)+Math.PI)*24/(2*Math.PI))%24);}expect(bins.size).toBeGreaterThanOrEqual(23);
 const set=solutionSetObject(problem,traced);validateSolutionSet(set);const doc=installSolutionSet(newDrawing(),set);expect(doc.objects.some(o=>o.kind==='spatialLocus'&&o.point==='P')).toBe(true);expect(resolveGeometry(doc).errors.size).toBe(0);
},15000);
