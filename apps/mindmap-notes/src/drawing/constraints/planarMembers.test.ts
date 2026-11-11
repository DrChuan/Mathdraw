import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applyDefinition} from '../model';
import type {DrawingDocument,DrawingPoint,DrawingSolutionSet} from '../types';
import {constraintBinding,installSolutionSet,validateSolutionSet} from './document';
import {expandedCoordinateSet} from './planarMembers';
import {planarContext,objectSymbol} from './planarModel';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {addLessonInput} from './planarLesson';
import {newDrawing} from '../types';
const sample=()=>JSON.parse(readFileSync(new URL('./fixtures/director-contact-points.json',import.meta.url),'utf8')) as DrawingDocument;
it('binds an external derived intersection through its original sources and commits it only after a valid move',()=>{
 let doc=sample(),set=doc.objects.find(o=>o.kind==='solutionSet') as DrawingSolutionSet;
 const result=solveConstraints({id:1,problem:set.problem,budget:1000});doc=installSolutionSet(doc,{...set,result,activeBranch:0});
 // Remove the old intersection from the condition system, then create it on
 // the main canvas, exactly as a later construction would be made.
 set=doc.objects.find(o=>o.kind==='solutionSet') as DrawingSolutionSet;
 const id=doc.objects.find(o=>objectSymbol(o)==='C')!.id;
 set=structuredClone(set);delete set.driver;set.problem.points=set.problem.points.filter(n=>n!=='C');set.problem.planar!.document.objects=set.problem.planar!.document.objects.filter(o=>o.id!==id);set.result.branches.forEach(b=>{delete b.positions.C;b.loci=[];});
 doc={...doc,objects:doc.objects.filter(o=>o.id!==id&&o.kind!=='spatialLocus').map(o=>o.id===set.id?set:o)};
 doc=applyDefinition(doc,'D=Intersect(m,n,1)');const point=doc.objects.find(o=>objectSymbol(o)==='D') as DrawingPoint,before=JSON.stringify(doc);
 const binding=constraintBinding(doc,point)!;expect(binding.movable).toBe(true);expect(binding.point).toBe('D');expect(point.constraintSet).toBeUndefined();expect(JSON.stringify(doc)).toBe(before);
 const expanded=expandedCoordinateSet(doc,set);expect(expanded.problem.planar!.document.objects.find(o=>o.id===point.id)).toMatchObject({construction:point.construction});expect(expanded.problem.points).toContain('D');
 const r=solveConstraints({id:2,problem:expanded.problem,previous:expanded.result,budget:350,move:{point:'D',target:[0,Math.sqrt(13),0],branch:0}});
 expect(r.precision).toBe('construction');expect(r.branches[0].positions.D[1]).toBeCloseTo(Math.sqrt(13),6);
 const next=installSolutionSet(doc,{...expanded,result:r});expect(next.objects.filter(o=>o.id===point.id)).toHaveLength(1);expect(next.objects.find(o=>o.id===point.id)).toMatchObject({construction:point.construction,constraintSet:set.id});
 validateSolutionSet(next.objects.find(o=>o.id===set.id) as DrawingSolutionSet);
 expect(planarContext(next,true).document.objects.filter(o=>o.id===point.id)).toHaveLength(1);
});
it('creates single line intersections and selected conic branches without an unwanted second point',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'l:y=0\nm:x=1\nc:x^2+y^2=4\nP=Intersect(l,m,1)\nQ=Intersect(l,c,2)'),p={mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context},e=planarEvaluator(p);
 expect(e.model(e.initial).positions.P).toEqual([1,0,0]);expect(e.model(e.initial).positions.Q[0]).toBeCloseTo(2,9);expect(a.context.document.objects.filter(o=>o.kind==='point').map(objectSymbol)).toEqual(['O','P','Q']);
 const reopened=structuredClone(a.context);expect(reopened.document.objects.find(o=>objectSymbol(o)==='Q')).toMatchObject({construction:{type:'intersection',branch:1}});
});
it('allows a fourth curve-curve crossing to remain an actual dependent construction',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'c:x^2/4+y^2=1\nd:x^2+y^2/4=1\nP=Intersect(c,d,4)'),p={mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context},e=planarEvaluator(p);
 expect(e.errors(e.initial)).toEqual([]);expect(e.model(e.initial).positions.P[0]).toBeGreaterThan(0);expect(e.model(e.initial).positions.P[1]).toBeGreaterThan(0);
});

it('expands a line-conic intersection from its actual source when it enters another equation',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'h=?\nl:y=0\nc:(x-h)^2+y^2=4\nP=Intersect(l,c,2)\nx(P)=5'),p={mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context},e=planarEvaluator(p),r=solveConstraints({id:1,problem:p,budget:1000});
 expect(r.branches.length).toBeGreaterThan(0);expect(r.precision).not.toBe('approximate');expect(r.branches[0].positions.P[0]).toBeCloseTo(5,8);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
});
it('creates a native tangent on the curve and both branches from an outside point',()=>{
 const a=addLessonInput(planarContext(newDrawing()),'c:x^2/9+y^2/4=1\nA=(3,0)\nP=(5,0)\nl=Tangent(c,A,1)\nm=Tangent(c,P,1)\nn=Tangent(c,P,2)'),p={mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context},e=planarEvaluator(p);
 expect(e.errors(e.initial)).toEqual([]);expect(a.context.unknowns).toHaveLength(0);expect(a.context.document.objects.filter(o=>o.kind==='curve'&&o.derived?.type==='tangent')).toHaveLength(3);
});
it('inverse-drags a later midpoint through the analytic family without replacing its constructor',()=>{
 let doc=sample(),set=doc.objects.find(o=>o.kind==='solutionSet') as DrawingSolutionSet;
 const result=solveConstraints({id:1,problem:set.problem,budget:1000});doc=installSolutionSet(doc,{...set,result,activeBranch:0});doc=applyDefinition(doc,'D=Midpoint(O,C)');
 const point=doc.objects.find(o=>objectSymbol(o)==='D') as DrawingPoint,binding=constraintBinding(doc,point)!;
 expect(binding.movable).toBe(true);expect(binding.set.problem.planar!.unknowns).toHaveLength(set.problem.planar!.unknowns.length);
 const r=solveConstraints({id:2,problem:binding.set.problem,previous:binding.set.result,budget:350,move:{point:'D',target:[0,Math.sqrt(13)/2,0],branch:0}}),e=planarEvaluator(binding.set.problem);
 expect(r.precision).toBe('construction');expect(r.branches[0].positions.D[1]).toBeCloseTo(Math.sqrt(13)/2,4);expect(e.errors(e.encode(r.branches[0].positions,r.branches[0].values))).toEqual([]);
 const next=installSolutionSet(doc,{...binding.set,result:r});expect(next.objects.find(o=>o.id===point.id)).toMatchObject({construction:point.construction});
});
