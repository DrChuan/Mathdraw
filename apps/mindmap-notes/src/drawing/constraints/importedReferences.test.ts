import {it,expect} from 'vitest';
import {newDrawing} from '../types';
import {applyDefinition,normalizeDrawing} from '../model';
import {planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {locusPaths} from './loci';
import {equationEnvironment} from './planarExpressions';
import {resolveGeometry} from '../geometry';
import {solutionSetObject,installSolutionSet,validateSolutionSet} from './document';
import {knownConicFeature} from './knownConicFeatures';
import {conicFoci,conicFeatureEquation,conicCoefficients,conicVertices} from '../conics';
import {evaluate,parseExpression} from '../expression';
function imported(reference:string){
 let d=newDrawing();for(const source of ['A=(127/96,65/48)','B=(-205/32,-4/3)','C=(127/96,233/48)','l=Line(B,C)','k=1.4'])d=applyDefinition(d,source);
 const a=addLessonInput(planarContext(normalizeDrawing(JSON.parse(JSON.stringify(d)))),`P=(?,?)\npointLineDistance(P,${reference},k\\cdot PA)`);
 return {original:d,problem:{mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context}};
}
it.each(['B C','BC','Line(B,C)','l'])('uses the same exact imported line for %s',reference=>{
 const {original,problem}=imported(reference),e=planarEvaluator(problem),s=symbolicPlanarEquations(problem,e.variables);expect(s.unsupported).toEqual([]);
 const r=solveConstraints({id:1,problem,budget:2000});expect(r.precision).toBe('construction');expect(r.complete).toBe(true);expect(r.branches).toHaveLength(1);expect(r.branches[0].dof).toBe(1);
 for(const p of locusPaths(r.branches[0].loci[0]).flat())expect(e.errors(e.variables.map(u=>p[u.field==='x'?0:1]))).toEqual([]);
 expect(problem.planar.document.objects.filter(o=>original.objects.some(p=>p.id===o.id))).toEqual(original.objects);
});
it.each(['0.5','1','2'])('is identical for objects created on canvas or inside the tool (k=%s)',k=>{
 const definitions=`A=(2,0)\nB=(1/2,-2)\nC=(1/2,2)\nl=Line(B,C)\nk=${k}`;
 let d=newDrawing();for(const s of definitions.split('\n'))d=applyDefinition(d,s);
 const condition='P=(?,?)\npointLineDistance(P,B C,k*PA)';
 const outside=addLessonInput(planarContext(d),condition),inside=addLessonInput(planarContext(newDrawing()),definitions+'\n'+condition);
 const results=[outside,inside].map(a=>solveConstraints({id:1,problem:{mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context}}));
 expect(results.every(r=>r.precision==='construction'&&r.complete)).toBe(true);
 expect(results[0].branches.map(b=>b.loci[0].conic?.equation)).toEqual(results[1].branches.map(b=>b.loci[0].conic?.equation));
});
it('recomputes from changed canvas parameters instead of retaining a copied distance',()=>{
 const {original}=imported('l'),one=(d:typeof original)=>{const a=addLessonInput(planarContext(d),'P=(?,?)\npointLineDistance(P,B C,k*PA)');return solveConstraints({id:1,problem:{mode:'coordinate',points:a.points,conditions:a.conditions,segments:[],planar:a.context}});};
 const previous=one(original),parameter=original.objects.find(o=>o.symbol==='k')!,changed=applyDefinition(original,'k=0.5',parameter.id),next=one(changed);
 expect(previous.branches).toHaveLength(1);expect(next.branches).toHaveLength(2);expect(next.precision).toBe('construction');expect(changed.objects.find(o=>o.symbol==='k')!.id).toBe(parameter.id);
});
it('preserves source IDs, dependencies, styles and original canvas through solve, install and reopen',()=>{
 const {original,problem}=imported('B C'),snapshot=JSON.stringify(original),r=solveConstraints({id:1,problem}),set=solutionSetObject(problem,r);
 validateSolutionSet(set);const installed=installSolutionSet(original,set),reopened=normalizeDrawing(JSON.parse(JSON.stringify(installed)));
 expect(JSON.stringify(original)).toBe(snapshot);expect(resolveGeometry(reopened).errors.size).toBe(0);
 for(const o of original.objects){const actual=reopened.objects.find(p=>p.id===o.id)!;expect(actual.kind).toBe(o.kind);expect(actual.style).toEqual(o.style);if(o.kind==='line'&&actual.kind==='line')expect(actual.points).toEqual(o.points);}
 const importedAgain=planarContext(reopened),next={...problem,planar:importedAgain},again=solveConstraints({id:2,problem:next});expect(again.precision).toBe('construction');expect(again.branches).toHaveLength(1);
});
it.each(['l','B C','BC','Line(B,C)'])('shares incidence reference parsing for %s',ref=>{
 const {problem}=imported(ref),doc=structuredClone(problem.planar.document),p=doc.objects.find(o=>o.kind==='point'&&o.symbol==='P')!;
 problem.planar.equations=[{id:'incidence',enabled:true,source:`onLine(P,${ref})`}];const e=planarEvaluator(problem);expect(symbolicPlanarEquations(problem,e.variables).unsupported).toEqual([]);
 if(p.kind==='point')p.construction={type:'free',position:[127/96,233/48,0]};
 const env=equationEnvironment(doc);expect(Math.max(...env.residual(`onLine(P,${ref})`).map(Math.abs))).toBeLessThan(1e-8);
 if(p.kind==='point')p.construction={type:'free',position:[100,100,0]};
 expect(Math.max(...equationEnvironment(structuredClone(doc)).residual(`onLine(P,${ref})`).map(Math.abs))).toBeGreaterThan(1);
});
it.each(['x^2/9-y^2/16=1','(x-3)^2/25+(y+2)^2/9=1','y^2-6*y+9=8*x-16'])('retains imported focus and directrix constructors: %s',source=>{
 let d=newDrawing();for(const s of [`Q: ${source}`,'A=Focus(Q,1)','l=Directrix(Q,1)','k=1'])d=applyDefinition(d,s);
 const a=addLessonInput(planarContext(d),'P=(?,?)\npointLineDistance(P,l,k*PA)'),problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},e=planarEvaluator(problem),s=symbolicPlanarEquations(problem,e.variables);
 expect(s.unsupported).toEqual([]);const r=solveConstraints({id:1,problem});expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(1);
 for(const point of locusPaths(r.branches[0].loci[0]).flat())expect(e.errors(e.variables.map(u=>point[u.field==='x'?0:1]))).toEqual([]);
});
it.each(['Parallel(l,D)','Perpendicular(l,D)','PerpendicularBisector(B,C)'])('preserves an imported line construction %s',definition=>{
 let d=newDrawing();for(const s of ['A=(3,4)','B=(0,0)','C=(2,1)','D=(2,3)','l=Line(B,C)',`m=${definition}`])d=applyDefinition(d,s);
 const a=addLessonInput(planarContext(d),'P=(?,?)\npointLineDistance(P,m,PA/2)'),problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem}),e=planarEvaluator(problem);
 expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(2);
 for(const b of r.branches)for(const point of locusPaths(b.loci[0]).flat())expect(e.errors(e.variables.map(u=>point[u.field==='x'?0:1]))).toEqual([]);
});
it.each(['x^2/25+y^2/9=1','y^2/25+x^2/9=1','x^2/9-y^2/16=1','y^2/9-x^2/16=1','(x-3)^2/25+(y+2)^2/9=1','y^2-6*y+9=8*x-16','x^2+4*x+4=-8*y+24'])('agrees with canvas feature identity and ordering for %s',source=>{
 for(const feature of ['focus','vertex','directrix','asymptote'] as const)for(const i of [0,1]){
  const f=knownConicFeature(source,feature,i);if(!f)continue;
  if(f.point){const actual=(feature==='focus'?conicFoci(source):conicVertices(source))?.[i];expect(actual).toBeDefined();f.point.forEach((s,k)=>expect(evaluate(parseExpression(s))).toBeCloseTo(actual![k],8));}
  if(f.line){const expected=conicCoefficients(conicFeatureEquation(source,feature as 'directrix'|'asymptote',i))!,actual=conicCoefficients(f.line)!;expect(Math.min(...[1,-1].map(sign=>Math.max(...actual.map((v,k)=>Math.abs(v-sign*expected[k])))))).toBeLessThan(1e-7);}
 }
});
