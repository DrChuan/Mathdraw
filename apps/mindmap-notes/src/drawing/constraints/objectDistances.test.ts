import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {parseCondition,validateProblem} from './input';
import {evaluator,flatten} from './compile';
import {formConditionSource} from './form';
import {addLessonInput} from './planarLesson';
import {planarContext} from './planarModel';
import {solveConstraints} from './solver';
import {equationEnvironment} from './planarExpressions';
import type {ConstraintProblem,Positions} from './types';
const names=['P','A','B','C'];
function check(source:string,p:Positions){const condition=parseCondition(source,names),problem:ConstraintProblem={points:names,segments:[],conditions:[condition]};validateProblem(problem);return evaluator(problem).verify(flatten(names,p));}
const base:Positions={P:[4,3,0],A:[0,0,0],B:[1,0,0],C:[0,1,0]};
describe('distances to infinite lines and planes',()=>{
 it('measures the perpendicular distance even when the foot is outside the defining segment',()=>{expect(check('pointLineDistance(P,AB)=3',base).errors.every(e=>e.error<1e-7&&!e.degenerate)).toBe(true);expect(check('pointLineDistance(P,AB)=5',base).errors.some(e=>e.error>.1)).toBe(true);});
 it('measures a spatial point-line distance',()=>{expect(check('pointLineDistance(P,AB)=5',{...base,P:[4,3,4]}).errors.every(e=>e.error<1e-7&&!e.degenerate)).toBe(true);});
 it.each([3,-3,0])('uses unsigned plane distance at height %s',z=>{const r=check(`pointPlaneDistance(P,ABC)=${Math.abs(z)}`,{...base,P:[4,7,z]});expect(r.errors.every(e=>e.error<1e-7&&!e.degenerate)).toBe(true);});
 it('rejects degenerate line and plane definitions even at zero distance',()=>{expect(check('pointLineDistance(P,AB)=0',{...base,B:[0,0,0]}).errors.some(e=>e.degenerate)).toBe(true);expect(check('pointPlaneDistance(P,ABC)=0',{...base,C:[2,0,0]}).errors.some(e=>e.degenerate)).toBe(true);});
 it('validates nonnegative distance and formats both form inputs',()=>{for(const k of ['pointLineDistance','pointPlaneDistance'] as const){expect(()=>parseCondition(`${k}(P,${k==='pointLineDistance'?'AB':'ABC'})=-1`,names)).toThrow();const s=formConditionSource(k,['P',k==='pointLineDistance'?'AB':'ABC'],names,'2','degrees','both');expect(parseCondition(s,names).value).toBe(2);}});
 it('supports named equation lines and solves an unknown point coordinate',()=>{const a=addLessonInput(planarContext(newDrawing()),'直线 l: y=0\nP=(4,?)\npointLineDistance(P,l,3)');const problem:ConstraintProblem={mode:'coordinate',points:a.points,segments:[],conditions:a.conditions,planar:a.context};const r=solveConstraints({id:1,problem,budget:2000});expect(r.branches.length).toBeGreaterThan(0);for(const b of r.branches){expect(Math.abs(b.positions.P[1])).toBeCloseTo(3,5);expect(b.positions.P[0]).toBeCloseTo(4,8);}const env=equationEnvironment(a.context.document);expect(()=>env.residual('pointLineDistance(P,l,-1)')).toThrow();});
 it.each(['pointLineDistance(P,AB)=2','pointPlaneDistance(P,ABC)=2'])('solves a spatial construction with %s',source=>{const problem:ConstraintProblem={mode:'spatial',points:names,segments:[],conditions:['AB=3','AC=4','BC=5',source].map(s=>parseCondition(s,names))};const r=solveConstraints({id:1,problem,budget:2000});expect(r.branches.length).toBeGreaterThan(0);for(const b of r.branches)expect(evaluator(problem).verify(flatten(names,b.positions)).errors.every(e=>e.error<3e-6&&!e.degenerate)).toBe(true);},5000);
 it('does not allow plane distance in a planar problem',()=>{const a=addLessonInput(planarContext(newDrawing()),'P=(0,1)\nA=(0,0)\nB=(1,0)\nC=(0,2)\npointPlaneDistance(P,ABC)=2');expect(()=>validateProblem({mode:'coordinate',points:a.points,segments:[],conditions:a.conditions,planar:a.context})).toThrow(/空间条件/);});
});
