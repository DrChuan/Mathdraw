import {it,expect,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {newDrawing,type DrawingDocument, type DrawingSolutionSet} from '../types';
import {planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {validateSolutionSet,solutionSetObject} from './document';
const sample=(file:string)=>{const d=JSON.parse(readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8')) as DrawingDocument;return {doc:d,set:d.objects.find(o=>o.kind==='solutionSet') as DrawingSolutionSet};};
describe('dual conic elimination and source-preserving reconstruction',()=>{
 it.each(['director-through-point.json','director-contact-points.json','director-latex-perpendicular.json'])('solves and drags %s analytically',file=>{
  const {set}=sample(file),problem=set.problem,e=planarEvaluator(problem),r=solveConstraints({id:1,problem,budget:1000});
  expect(r.precision,JSON.stringify(r.modelSummary)).toBe('construction');expect(r.branches).toHaveLength(1);
  const b=r.branches[0],name=file.includes('through')?'P':'C',l=b.loci.find(l=>l.point===name)!;expect(l?.kind).toBe('conic');expect(b.dof).toBe(1);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
  const radius=Math.hypot(...b.positions[name]);
  for(const angle of [0,Math.PI/2,2.4,Math.PI,4.2,5.9]){
   const moved=solveConstraints({id:2,problem,previous:r,budget:350,move:{point:name,branch:0,target:[radius*Math.cos(angle),radius*Math.sin(angle),0]}}),v=moved.branches[0];
   expect(moved.precision).toBe('construction');expect(Math.hypot(v.positions[name][0]-radius*Math.cos(angle),v.positions[name][1]-radius*Math.sin(angle))).toBeLessThan(1e-6);expect(e.errors(e.encode(v.positions,v.values))).toEqual([]);
  }
  if(file.includes('contact')){
   const moved=solveConstraints({id:3,problem,previous:r,budget:350,move:{point:'A',branch:0,target:[0,2,0]}});
   expect(moved.precision).toBe('construction');expect(moved.branches[0].positions.A[1]).toBeCloseTo(2,6);expect(e.errors(e.encode(moved.branches[0].positions,moved.branches[0].values))).toEqual([]);
  }
  validateSolutionSet(solutionSetObject(problem,r));
 });
 it('upgrades old sample branches and boundary mobility without moving saved positions during inspection',()=>{
  const {set}=sample('director-through-point.json'),before=JSON.stringify(set.result.branches.map(b=>b.positions));
  const refreshed=solveConstraints({id:1,problem:set.problem,previous:set.result,budget:1000,refreshMobility:true});
  expect(JSON.stringify(refreshed.branches.map(b=>b.positions))).toBe(before);expect(refreshed.branches.every(b=>b.motionDof===1)).toBe(true);
  const moved=solveConstraints({id:2,problem:set.problem,previous:set.result,budget:350,move:{point:'P',branch:3,target:[0,Math.hypot(...set.result.branches[3].positions.P),0]}});
  expect(moved.branches).toHaveLength(1);expect(moved.precision).toBe('construction');expect(moved.branches[0].positions.P[0]).toBeCloseTo(0,6);
 });
 it('handles translation, rotation and equation scaling through the same dual quadratic identity',()=>{
  const source='c:-7*((x+y-2)^2/18+(x-y-4)^2/8-1)=0\nP=(?,?)\nl=过点直线(P)\nm=过点直线(P)\ntangent(l,c)\ntangent(m,c)\nperpendicular(l,m)',a=addLessonInput(planarContext(newDrawing()),source),problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem,budget:1000}),e=planarEvaluator(problem);
  expect(r.precision).toBe('construction');expect(r.branches[0].dof).toBe(1);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
 });
 it('uses native through-point tangent definitions in the same elimination plan',()=>{
  const a=addLessonInput(planarContext(newDrawing()),'c:x^2/9+y^2/4=1\nP=(?,?)\nl=Tangent(c,P,1)\nm=Tangent(c,P,2)\nperpendicular(l,m)'),problem={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem,budget:1000}),e=planarEvaluator(problem);
  expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(1);expect(r.branches[0].loci[0].kind).toBe('conic');expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
  const moved=solveConstraints({id:2,problem,previous:r,budget:350,move:{point:'P',branch:0,target:[0,Math.sqrt(13),0]}});expect(moved.precision).toBe('construction');expect(moved.branches[0].positions.P[1]).toBeCloseTo(Math.sqrt(13),6);
 });
 it('preserves explicit fixed references while reconstructing the tangent family',()=>{
  const {set}=sample('director-through-point.json'),r=solveConstraints({id:1,problem:set.problem,budget:1000}),fixed=solveConstraints({id:2,problem:set.problem,previous:r,budget:1000,reference:{points:['O','P'],branch:0}});
  expect(fixed.branches[0].motionDof).toBe(0);
  expect(()=>solveConstraints({id:3,problem:set.problem,previous:fixed,budget:350,move:{point:'P',branch:0,target:[0,5,0]}})).toThrow();
 });
 it('does not discard an extra restriction on the moving intersection',()=>{
  const {set}=sample('director-through-point.json'),p=structuredClone(set.problem);p.planar!.equations.push({id:'limit',source:'x(P)=0',enabled:true});
  const r=solveConstraints({id:1,problem:p,budget:1000});expect(r.branches.every(b=>b.loci.every(l=>l.point!=='P'||l.kind!=='conic'||!l.complete))).toBe(true);
 });
});
