import {it,expect} from 'vitest';
import {newDrawing,type DrawingPoint} from '../types';
import {applyDefinition} from '../model';
import {planarContext} from './planarModel';
import {setPlanarRole} from './inputs';
import {addLessonInput} from './planarLesson';
import {planarEvaluator} from './planar';
import {solveConstraints} from './solver';
import {symbolicPlanarEquations} from './planarSymbolic';
import {locusPaths} from './loci';
import {solutionSetObject,validateSolutionSet} from './document';
import {normalizeRationalExpression,normalizeRationalRelations,solveExactSystem} from './exactSystem';
import type {ConstraintProblem} from './types';
function scene(condition:string,actual=false){
 let doc=newDrawing();for(const s of actual?['A=(-3.37576754,0.789692982)','B=(-261/32,-77/48)','C=(-5.45274123,-5.97061404)','P=(1,0)','k=1.91','l=Line(B,C)','l1=Perpendicular(l,P)','D=Intersect(l,l1)','s=Segment(P,A)','s1=Segment(P,D)']:['A=(2,0)','B=(1/2,-2)','C=(1/2,2)','P=(1,0)','k=2','l=Line(B,C)','l1=Perpendicular(l,P)','D=Intersect(l,l1)','s=Segment(P,A)','s1=Segment(P,D)'])doc=applyDefinition(doc,s);
 const p=doc.objects.find(o=>o.symbol==='P')!,a=addLessonInput(setPlanarRole(setPlanarRole(planarContext(doc,true),p.id,'x','unknown'),p.id,'y','unknown'),condition);
 const problem:ConstraintProblem={mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context};return {problem,e:planarEvaluator(problem)};
}
it.each(['pointLineDistance(P,B C,PA/k)','PA=k*PD'])('eliminates the dependent foot before solving %s',condition=>{
 const {problem,e}=scene(condition),s=symbolicPlanarEquations(problem,e.variables);
 expect(s.complete,s.unsupported.join(';')).toBe(true);expect(s.definitions.complete,s.definitions.unsupported.join(';')).toBe(true);expect(s.definitions.eliminated).toContain('D');expect(s.coordinates.D[0]).not.toMatch(/q_/);expect(s.coordinates.D[1]).toContain('q_1');
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.precision).toBe('construction');expect(r.complete).toBe(true);expect(r.branches).toHaveLength(2);expect(r.branches.every(b=>b.dof===1)).toBe(true);expect(r.modelSummary?.independent).toEqual(['x(P)','y(P)']);
 for(const point of locusPaths(r.branches[0].loci[0]).flat())expect(e.errors(e.variables.map(u=>point[u.field==='x'?0:1]))).toEqual([]);
 validateSolutionSet(solutionSetObject(problem,r));
});
it('handles the full current rotated scene without freezing or adding any dependent unknown',()=>{
 const {problem,e}=scene('pointLineDistance(P,B C, PA/k)',true),r=solveConstraints({id:1,problem,budget:2000});expect(e.variables).toHaveLength(2);expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(2);expect(r.modelSummary?.eliminated).toContain('D');
 for(const b of r.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
});
it('solves a quartic after substituting the same dependent foot into the remaining equation',()=>{
 const {problem}=scene('(x(P)-1)*(x(P)+2)*(x(P)-3)*(x(P)+4)=0\ny(P)=y(D)+x(D)+x(P)-2');
 // D=(1/2,y(P)); the second equation fixes x(P)=3/2 and is inconsistent.
 const bad=solveConstraints({id:1,problem,budget:2000});expect(bad.branches).toHaveLength(0);
 problem.planar!.equations=problem.planar!.equations.filter(q=>!q.source.startsWith('y(P)='));problem.planar!.equations.push({id:'height',enabled:true,source:'y(P)=x(D)+x(P)'});
 const r=solveConstraints({id:2,problem,budget:2000});expect(r.precision).toBe('algebraic');expect(r.complete).toBe(true);expect(r.branches).toHaveLength(4);expect(r.branches.map(b=>b.positions.P[0]).sort((a,b)=>a-b)).toEqual([-4,-2,1,3]);
 const e=planarEvaluator(problem);for(const b of r.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);validateSolutionSet(solutionSetObject(problem,r));
});
it('retains a canceled denominator domain in the shared normal form',()=>{
 const s=normalizeRationalExpression('(u^2-1)/(u-1)',['u'])!;expect(s.source.length).toBeLessThan(30);expect(s.guards.join(';')).toContain('u');
 const rows=normalizeRationalRelations([`${s.source}=2`,...s.guards],['u']),r=solveExactSystem(rows,['u']);expect(r.kind).toBe('finite');expect(r.candidates).toHaveLength(0);
 expect(normalizeRationalRelations(['0/(u-1)+u=1'],['u']).join(';')).toContain('!=');
});
it('does not promote a conic to an unrestricted trajectory when a dependent intersection has a pole',()=>{
 let d=newDrawing();for(const s of ['P=(1,0)','l: y=0','m: y=x(P)*x-1','D=Intersect(l,m)'])d=applyDefinition(d,s);
 const p=d.objects.find(o=>o.symbol==='P')!,a=addLessonInput(setPlanarRole(setPlanarRole(planarContext(d),p.id,'x','unknown'),p.id,'y','unknown'),'x(P)^2+y(P)^2=1'),problem:ConstraintProblem={mode:'coordinate',points:a.points,segments:[],conditions:a.conditions,planar:a.context},s=symbolicPlanarEquations(problem,planarEvaluator(problem).variables);
 expect(s.definitions.complete).toBe(true);expect(s.sources.some(s=>s.includes('!=')&&s.includes('q_0'))).toBe(true);
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.complete).toBe(false);expect(r.branches.every(b=>b.loci.every(l=>!l.complete))).toBe(true);
 problem.planar!.equations.push({id:'pole',enabled:true,source:'x(P)=0'});expect(solveConstraints({id:2,problem,budget:2000}).branches).toHaveLength(0);
});
it('retains the source coordinate map when a midpoint is used in an independent quartic',()=>{
 const {problem}=scene('(x(P)-1)*(x(P)+2)*(x(P)-3)*(x(P)+4)=0\ny(P)=0');const p=problem.planar!.document.objects.find(o=>o.symbol==='P') as DrawingPoint;
 problem.planar!.document=applyDefinition(problem.planar!.document,'M=Midpoint(P,A)');problem.points.push('M');expect(p.construction.type).toBe('free');
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.branches).toHaveLength(4);expect(r.modelSummary?.eliminated).toContain('M');expect(r.branches.every(b=>b.dof===0)).toBe(true);
});

it('keeps exact coefficient digits when presenting the normalized model',async()=>{
 const {mathPreview}=await import('../mathPreview'),n='123456789012345678901234567890123456789';
 expect(mathPreview(`${n}/7`)).toContain(n);expect(mathPreview('1e-20/3')).toContain('10^{-20}');
});

it('preserves domains of unused dependent scalar outputs without freezing their values',()=>{
 const {problem}=scene('pointLineDistance(P,B C,PA/k)');
 problem.planar!.document=applyDefinition(problem.planar!.document,'n=1/x(P)');
 const s=symbolicPlanarEquations(problem,planarEvaluator(problem).variables);expect(s.definitions.complete,s.definitions.unsupported.join(';')).toBe(true);expect(s.sources.some(r=>r.includes('q_0')&&r.includes('!='))).toBe(true);
 const {problem:other}=scene('pointLineDistance(P,B C,PA/k)');other.planar!.document=applyDefinition(other.planar!.document,'n=Length(s1)');
 const normal=symbolicPlanarEquations(other,planarEvaluator(other).variables);expect(normal.definitions.complete,normal.definitions.unsupported.join(';')).toBe(true);const r=solveConstraints({id:1,problem:other});expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(2);
});

it('substitutes scalar parameters uniformly into dot products before quartic elimination',()=>{
 const {problem}=scene('(x(P)-1)*(x(P)+2)*(x(P)-3)*(x(P)+4)=0\ndot(PA,BC)=k');
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.precision).toBe('algebraic');expect(r.branches).toHaveLength(4);const e=planarEvaluator(problem);for(const b of r.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
});

it('rechecks legacy algebraic evidence mathematically after normal form changes',async()=>{
 const {validateExactCertificate}=await import('./exactSystem'),old=['((u)^2)=2','u>0'],r=solveExactSystem(old,['u']),c=r.candidates[0],current=normalizeRationalRelations(old,['u']);
 expect(current).not.toEqual(old);expect(()=>validateExactCertificate(c.certificate,c.values,current,['u'])).not.toThrow();
 expect(()=>validateExactCertificate(c.certificate,c.values,['u^2=3'],['u'])).toThrow();
});
