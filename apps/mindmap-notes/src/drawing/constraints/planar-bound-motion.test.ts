import {it,expect} from 'vitest';
import {newDrawing} from '../types';
import {addLessonInput} from './planarLesson';
import {planarContext} from './planarModel';
import {planarEvaluator} from './planar';
import {solveConstraints} from './solver';
import type {ConstraintProblem} from './types';
it('keeps the inward motion of perpendicular ellipse tangents at an angular bound',()=>{
 const t=5,m=t-3*Math.PI/2,n=[-Math.sin(t),Math.cos(t)],v=[-Math.sin(m),Math.cos(m)],h=Math.sqrt(9*n[0]**2+4*n[1]**2),k=Math.sqrt(9*v[0]**2+4*v[1]**2),p=[h*n[0]+k*v[0],h*n[1]+k*v[1]];
 const a=addLessonInput(planarContext(newDrawing()),'C: x^2/9+y^2/4=1\nP=(?,?)\nl=过点直线(P)\nm=过点直线(P)\ntangent(l,C)\ntangent(m,C)\nperpendicular(l,m)');
 a.context.unknowns.forEach((u,i)=>{u.initial=[p[0],p[1],t,m][i];if(i===2){u.min=-5;u.max=5;}});
 const problem:ConstraintProblem={mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem,budget:500});expect(r.branches.length).toBeGreaterThan(0);expect(r.branches[0].motionDof).toBe(1);
 const moved=solveConstraints({id:2,problem,previous:r,budget:1000,parameter:{variable:a.context.unknowns[2].id,target:4.98,branch:0}}),b=moved.branches[0];expect(b.motionDof).toBe(1);expect(Math.hypot(b.positions.P[0]-r.branches[0].positions.P[0],b.positions.P[1]-r.branches[0].positions.P[1])).toBeGreaterThan(.001);expect(planarEvaluator(problem).errors(planarEvaluator(problem).encode(b.positions,b.values))).toEqual([]);
},5000);
