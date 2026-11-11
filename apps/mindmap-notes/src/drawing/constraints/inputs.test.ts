import {it,expect} from 'vitest';
import {newDrawing,type DrawingDocument,type DrawingPoint} from '../types';
import {applyDefinition,normalizeDrawing} from '../model';
import {resolveGeometry} from '../geometry';
import {planarContext,objectSymbol} from './planarModel';
import {addLessonInput} from './planarLesson';
import {setPlanarRole,isPlanarInput,planarRole,updatePlanarInput,validatePlanarInputs} from './inputs';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {solutionSetObject,installSolutionSet,validateSolutionSet,constraintBinding} from './document';
import type {ConstraintProblem} from './types';
const find=(d:DrawingDocument,n:string)=>d.objects.find(o=>objectSymbol(o)===n)!;
function scene(){
 let d=newDrawing();for(const s of ['A=(2,0)','B=(1/2,-2)','C=(1/2,2)','l=Line(B,C)','k=1.4'])d=applyDefinition(d,s);
 const a=addLessonInput(planarContext(d,true),'P=(?,?)\npointLineDistance(P,B C,k*PA)');
 const problem:ConstraintProblem={mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context};
 return {d,problem,result:solveConstraints({id:1,problem})};
}
it('imports independent canvas inputs without adding them to solver DOF',()=>{
 const {d,problem,result}=scene();expect(problem.planar!.unknowns).toHaveLength(2);expect(isPlanarInput(problem.planar,find(d,'k').id,'value')).toBe(true);expect(result.branches).toHaveLength(1);expect(result.branches[0].dof).toBe(1);
 const set=solutionSetObject(problem,result),doc=installSolutionSet(d,set),binding=constraintBinding(doc,find(doc,'A') as DrawingPoint);expect(binding?.input).toBe(true);expect(binding?.movable).toBe(true);expect(binding?.reference).toBe(true);
});
it('re-solves k and regenerates the locus while retaining source IDs and definitions',()=>{
 const {d,problem,result}=scene(),before=JSON.stringify(problem),next=updatePlanarInput(problem,find(d,'k').id,{field:'value',value:.5}),solved=solveConstraints({id:2,problem:next,previous:result,seeds:[result.branches[0].positions],seedValues:[result.branches[0].values!]});
 expect(JSON.stringify(problem)).toBe(before);expect(next.planar!.unknowns).toHaveLength(2);expect(solved.precision).toBe('construction');expect(solved.branches).toHaveLength(2);expect(solved.branches.every(b=>b.dof===1)).toBe(true);
 for(const b of solved.branches){const e=planarEvaluator(next);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);}
 const set=solutionSetObject(next,solved);validateSolutionSet(set);const installed=installSolutionSet(d,set);expect(find(installed,'k').id).toBe(find(d,'k').id);
 const reopened=planarContext(normalizeDrawing(JSON.parse(JSON.stringify(installed))),true);expect(isPlanarInput(reopened,find(d,'k').id,'value')).toBe(true);expect(resolveGeometry(installed).errors.size).toBe(0);
});
it('moving a known focus or an endpoint is an input update, not a violation of fixed references',()=>{
 const {d,problem,result}=scene(),next=updatePlanarInput(problem,find(d,'A').id,{target:[3,1,0]}),r=solveConstraints({id:2,problem:next,previous:result,seeds:[result.branches[0].positions]});
 expect(r.branches[0].positions.A).toEqual([3,1,0]);expect(r.precision).toBe('construction');expect(r.branches[0].dof).toBe(1);
 const e=planarEvaluator(next);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
});
it('keeps fixed values and internal unknowns distinct from adjustable inputs',()=>{
 const {d,problem}=scene(),id=find(d,'k').id;
 const fixed=setPlanarRole(problem.planar!,id,'value','fixed');expect(planarRole(fixed,id,'value')).toBe('fixed');expect(()=>updatePlanarInput({...problem,planar:fixed},id,{field:'value',value:2})).toThrow(/不是可变输入/);
 const unknown=setPlanarRole(fixed,id,'value','unknown');expect(isPlanarInput(unknown,id)).toBe(false);expect(unknown.unknowns.some(u=>u.object===id)).toBe(true);
 const input=setPlanarRole(unknown,id,'value','input',3);expect((input.document.objects.find(o=>o.id===id) as {value:number}).value).toBe(3);expect(input.unknowns.some(u=>u.object===id)).toBe(false);expect(planarRole(input,id,'value')).toBe('input');validatePlanarInputs(input);
});
it('does not silently reinterpret old fixed definitions as inputs',()=>{
 const {problem}=scene();delete problem.planar!.inputs;const set=solutionSetObject(problem,solveConstraints({id:1,problem})),doc=installSolutionSet(newDrawing(),set);expect(planarContext(doc,true).inputs).toEqual([]);
});
it('allows input changes with a zero-DOF solution and rejects invalid values without changing the old scene',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'k=2\nP=(?,?)\nx(P)=k\ny(P)=0');a.context.inputs=[{object:find(a.context.document,'k').id,fields:['value']}];
 const p:ConstraintProblem={mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem:p});expect(r.branches[0].dof).toBe(0);
 const next=updatePlanarInput(p,find(a.context.document,'k').id,{field:'value',value:3}),n=solveConstraints({id:2,problem:next});expect(n.branches[0].positions.P[0]).toBeCloseTo(3);expect(n.branches[0].dof).toBe(0);
 a.context.equations.push({id:'fixed',enabled:true,source:'k=2'});const snapshot=JSON.stringify(p),invalid=updatePlanarInput(p,find(a.context.document,'k').id,{field:'value',value:3}),bad=solveConstraints({id:3,problem:invalid,budget:100});expect(bad.branches).toHaveLength(0);expect(JSON.stringify(p)).toBe(snapshot);
});
it('preserves the path definition of an imported sliding point',()=>{
 let d=newDrawing();for(const s of ['A=(0,0)','B=(4,0)','s=Segment(A,B)','D=On(s,0.5)'])d=applyDefinition(d,s);
 const context=planarContext(d,true),p:ConstraintProblem={mode:'coordinate',points:context.document.objects.filter(o=>o.kind==='point').map(objectSymbol),conditions:[],segments:[],planar:context};
 const next=updatePlanarInput(p,find(d,'D').id,{target:[2,3,0]}),point=find(next.planar!.document,'D') as DrawingPoint;expect(point.construction.type).toBe('onPath');expect(resolveGeometry(next.planar!.document).points.get(point.id)!.p).toEqual([2,0,0]);
});
it('rejects role declarations for derived outputs, duplicate fields and unknown/input overlap',()=>{
 const {problem,d}=scene(),c=problem.planar!,bad=structuredClone(c);bad.inputs!.push({object:find(d,'l').id,fields:['x']});expect(()=>validatePlanarInputs(bad)).toThrow();
 const overlap=structuredClone(c);overlap.inputs!.push({object:find(c.document,'P').id,fields:['x']});expect(()=>validatePlanarInputs(overlap)).toThrow();
});
