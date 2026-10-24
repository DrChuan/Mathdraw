import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {applyDefinition,normalizeDrawing} from '../model';
import {resolveGeometry,validateDrawing} from '../geometry';
import {parseCondition} from './input';
import {solveConstraints} from './solver';
import {contextPoints,planarContext,unknownValue,objectSymbol,renamePlanarSource} from './planarModel';
import {solutionSetObject,installSolutionSet,validateSolutionSet} from './document';
import {planarEvaluator} from './planar';
import {algebraicRoots} from './algebraic';
import {parsePlanarInput,equationEnvironment} from './planarExpressions';
import {decodeConfiguration} from './configuration';
import type{ConstraintProblem}from './types';
function setup(definitions:string[],equations:string[],unknowns:[string,string,number?,number?][]=[]){let d=newDrawing();for(const s of definitions)d=applyDefinition(d,s);const context=planarContext(d);context.equations=equations.map(source=>({source,enabled:true,id:crypto.randomUUID()}));context.unknowns=unknowns.map(([name,field,min,max])=>{const o=d.objects.find(o=>objectSymbol(o)===name)!;return{id:`${o.id}.${field}`,object:o.id,field,initial:unknownValue(d,o,field),min,max};});const problem:ConstraintProblem={mode:'coordinate',points:contextPoints(context),segments:[],conditions:[],planar:context};return {d,context,problem};}
function solve(p:ConstraintProblem){const r=solveConstraints({id:1,problem:p,budget:1000,seed:17});expect(r.status,r.diagnostics.join(';')).toBe('solved');for(const b of r.branches){const e=planarEvaluator(p);expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);}return r;}
describe('planar conditional geometry',()=>{
 it('counts intrinsic shape separately from rotations and never leaves the plane',()=>{const points=['A','B','C','D','E'],p:ConstraintProblem={mode:'plane',points,segments:[['A','B'],['C','D']],conditions:['onSegment(E,CD)','midpoint(D,AB)','AE=6','perpendicular(AE,BC)'].map(s=>parseCondition(s,points))},r=solve(p);expect(r.branches[0].dof).toBe(2);expect(r.branches[0].motionDof).toBe(3);expect(Object.values(r.branches[0].positions).every(p=>p[2]===0)).toBe(true);const framed=solveConstraints({id:2,problem:p,previous:r,reference:{branch:0,points:['C','D']}});expect(framed.branches[0].dof).toBe(2);const b=framed.branches[0],target=b.positions.C.map((v,i)=>v+.6*(b.positions.D[i]-v)) as [number,number,number];const moved=solveConstraints({id:3,problem:p,previous:framed,move:{branch:0,point:'E',target}});expect(moved.branches[0].positions.E[2]).toBe(0);expect(planarEvaluator(p).errors(planarEvaluator(p).encode(moved.branches[0].positions,moved.branches[0].values))).toEqual([]);});
 it('retains both planar SSS windings and reports zero intrinsic freedom',()=>{const points=['A','B','C'],p:ConstraintProblem={mode:'plane',points,segments:[],conditions:['AB=3','AC=4','BC=5'].map(s=>parseCondition(s,points))},r=solve(p);expect(r.branches).toHaveLength(2);expect(r.complete).toBe(true);expect(r.branches.every(b=>b.dof===0&&b.motionDof===0)).toBe(true);expect(r.branches[0].positions.C[1]*r.branches[1].positions.C[1]).toBeLessThan(0);});
 it('preserves object IDs, styles, hidden state, midpoint dependencies and absolute coordinates on reopen',()=>{const {d,problem}=setup(['A=(1,2)','B=(5,2)','M=Midpoint(A,B)','s=Segment(A,B)','m=2','c: x^2+y^2=25'],['x(M)=3','y(M)=2']);d.objects.find(o=>o.symbol==='s')!.hidden=true;const r=solve(problem),set=solutionSetObject(problem,r),next=normalizeDrawing(installSolutionSet(d,set));expect(next.dimension).toBe('2d');for(const o of d.objects){const saved=next.objects.find(k=>k.id===o.id)!;expect(saved).toBeTruthy();expect(saved.style).toEqual(o.style);expect(saved.hidden).toBe(o.hidden);}expect(next.objects.filter(o=>o.symbol==='M')).toHaveLength(1);const m=next.objects.find(o=>o.symbol==='M')!;expect(m.kind==='point'&&m.construction.type).toBe('division');expect(resolveGeometry(next).points.get(m.id)?.p).toEqual([3,2,0]);const reopened=normalizeDrawing(JSON.parse(JSON.stringify(next)));expect(reopened.schemaVersion).toBe(4);expect(resolveGeometry(reopened).errors.size).toBe(0);expect(d.objects.some(o=>o.kind==='solutionSet')).toBe(false);});
 it('isolates rational and non-radical algebraic roots and excludes poles and range violations',()=>{expect(algebraicRoots('m^2=2','m')).toHaveLength(2);const quintic=algebraicRoots('m^5-m-1=0','m')!;expect(quintic).toHaveLength(1);expect(quintic[0].polynomial).toEqual(['-1','-1','0','0','0','1']);expect(quintic[0].expression).toBeUndefined();const {problem}=setup(['m=1'],['m^2=2','m>0'],[['m','value']]),r=solve(problem);expect(r.branches).toHaveLength(1);expect(r.precision).toBe('algebraic');const poles=setup(['m=1'],['(m^2-1)/(m-1)=2'],[['m','value']]);expect(solveConstraints({id:1,problem:poles.problem}).branches).toHaveLength(0);});
 it('finds all conic intersections outside viewport bounds, including four crossings and vertical tangency',()=>{for(const [defs,n] of [[['c: x^2/9+y^2/4=1','d: x^2/4+y^2/9=1'],4],[['c: (x-100)^2+y^2=1','d: x=101'],1],[['c: y=x^2','d: y=4'],2],[['c: x^2-y^2=1','d: x=2'],2]] as const){const {problem}=setup([...defs],['intersection(P,c,d)']);problem.points.push('P');const r=solve(problem);expect(r.branches).toHaveLength(n);expect(r.method).toBe('construction');}});
 it('keeps imported definitions as hard constraints and errors on unsupported or invalid expressions',()=>{const {problem}=setup(['A=(1,2)'],['x(A)=7']);const r=solveConstraints({id:1,problem,budget:100});expect(r.branches).toHaveLength(0);expect(r.status).not.toBe('contradiction');const env=equationEnvironment(setup(['A=(1,2)'],[]).d);expect(()=>env.residual('x(unknown)=2')).toThrow(/找不到/);expect(env.residual('x(A)/2=1/2')).toEqual([0]);});
 it('requires explicit numerical parameter bounds and validates every saved solution',()=>{const {problem}=setup(['m=1'],['sin(m)=0.5'],[['m','value']]);expect(()=>solveConstraints({id:1,problem,budget:100})).toThrow(/上下界/);problem.planar!.unknowns[0].min=0;problem.planar!.unknowns[0].max=1;const r=solve(problem);expect(r.precision).toBe('approximate');validateSolutionSet(solutionSetObject(problem,r));const bad=structuredClone(r);bad.branches[0].values![problem.planar!.unknowns[0].id]=10;expect(()=>validateSolutionSet(solutionSetObject(problem,bad))).toThrow();});
 it('supports planar circle declarations without three plane-defining points',()=>{const p:ConstraintProblem={mode:'plane',points:['O','P'],segments:[],conditions:[],curves:[{id:'c',name:'c',type:'circle',method:'centerRadius',points:['O'],value:2,valueSource:'2'}]};p.conditions=[parseCondition('onCurve(P,c)',p.points,undefined,p.curves)];const r=solve(p);expect(Object.values(r.branches[0].positions).every(p=>p[2]===0)).toBe(true);});
 it('round trips v2 self-contained configurations and retains v1 spatial interpretation',()=>{const {context}=setup(['A=(1,2)'],[]),placement={planeNames:[],side:1 as const,orientationPoint:'',keepPlacement:true,mirrored:false};expect(decodeConfiguration(JSON.stringify({format:'mathdraw-conditions',version:2,mode:'coordinate',points:'O A',segments:'',conditions:[],planar:context,placement})).mode).toBe('coordinate');expect(decodeConfiguration(JSON.stringify({format:'mathdraw-conditions',version:1,points:'A',segments:'',conditions:[],placement})).mode).toBeUndefined();expect(()=>validateDrawing({...newDrawing(),schemaVersion:5})).toThrow();expect(parsePlanarInput('x(A)=y(A)=2',['A']).equations).toHaveLength(2);});
 it('eliminates unknown ellipse semi-axes from point incidence, without numerical parameter bounds',()=>{const {problem}=setup(['a=4','b=2','A=(3,0)','B=(0,2)','c: x^2/a^2+y^2/b^2=1'],['onCurve(A,c)','onCurve(B,c)','a>0','b>0'],[['a','value'],['b','value']]);const r=solve(problem);expect(r.branches).toHaveLength(1);expect(r.precision).toBe('algebraic');const values=Object.values(r.branches[0].values!);expect(values[0]).toBeCloseTo(3,7);expect(values[1]).toBeCloseTo(2,7);});
 it('solves unknown parabola parameters and independent point coordinates by source algebra',()=>{for(const [defs,eq,unknowns,expected]of [[['p=1','A=(2,4)','c: y^2=2*p*x'],['onCurve(A,c)'],[['p','value']],4],[['A=(0,2)'],['x(A)^2=3','x(A)>0'],[['A','x']],Math.sqrt(3)]] as [string[],string[],[string,string][],number][]){const {problem}=setup(defs,eq,unknowns),r=solve(problem);expect(Object.values(r.branches[0].values!)[0]).toBeCloseTo(expected,7);expect(r.precision).toBe('algebraic');}});
 it('absorbs previous planar sets into a single source graph instead of nesting a frozen copy',()=>{const {d,problem}=setup(['m=1','A=(m,2)'],['m^2=4','m>0'],[['m','value']]),r=solve(problem),set=solutionSetObject(problem,r),first=installSolutionSet(d,set),context=planarContext(first);expect(context.document.objects.some(o=>o.kind==='solutionSet')).toBe(false);expect(context.absorbedSets).toContain(set.id);const p:ConstraintProblem={mode:'coordinate',points:contextPoints(context),segments:[],conditions:context.inheritedConditions??[],planar:context};const second=installSolutionSet(first,solutionSetObject(p,solve(p)));expect(second.objects.filter(o=>o.kind==='solutionSet')).toHaveLength(1);for(const o of d.objects)expect(second.objects.filter(p=>p.id===o.id)).toHaveLength(1);});
 it('moves an independent parameter through the solver and updates dependent points and curves',()=>{const {d,problem}=setup(['m=1','n=2','D=(m,n)','c: y=m*x'],['n=2*m'],[['m','value',-5,5],['n','value',-10,10]]),r=solve(problem),variable=problem.planar!.unknowns[0],moved=solveConstraints({id:2,problem,previous:r,budget:800,parameter:{variable:variable.id,target:2,branch:0}}),b=moved.branches[0];expect(b.values![variable.id]).toBeCloseTo(2,5);const next=installSolutionSet(d,solutionSetObject(problem,moved)),g=resolveGeometry(next);expect(g.points.get(d.objects.find(o=>o.symbol==='D')!.id)!.p[1]).toBeCloseTo(4,5);expect(g.curves.get(d.objects.find(o=>o.symbol==='c')!.id)!.equation).toContain('2');});
 it('accepts named lines and vectors without confusing scalar and vector expressions',()=>{const {d}=setup(['A=(0,0)','B=(3,0)','C=(0,2)','s=Segment(A,B)','w=Vector(A,C)','m=2'],[]),e=equationEnvironment(d);expect(e.residual('perpendicular(s,w)')).toEqual([0]);expect(e.residual('AB=3')).toEqual([0]);expect(e.residual('vectorRelation(vec(AC)=m*vec(AC)/2)')).toEqual([0,0]);expect(renamePlanarSource('AB=CD','A','X',['A','B','C','D'])).toBe('X B=CD');expect(renamePlanarSource('x(A)=a(c)','A','X',['A'])).toBe('x(X)=a(c)');});
 it('isolates IDs and symbols between independent coordinate-free constructions, then absorbs both safely',()=>{const points=['A','B','C'],p:ConstraintProblem={mode:'plane',points,segments:[['A','B'],['B','C'],['C','A']],conditions:['AB=3','AC=4','BC=5'].map(s=>parseCondition(s,points))},r=solve(p),first=solutionSetObject(p,r),second=solutionSetObject(p,r),d=normalizeDrawing(installSolutionSet(installSolutionSet(newDrawing(),first),second));expect(d.objects.filter(o=>o.kind==='point'&&o.constraintSet)).toHaveLength(6);expect(new Set(d.objects.map(o=>o.id)).size).toBe(d.objects.length);const c=planarContext(d),problem:ConstraintProblem={mode:'coordinate',points:contextPoints(c),segments:[],conditions:c.inheritedConditions!,curves:c.inheritedCurves,planar:c};expect(c.inheritedConditions).toHaveLength(6);expect(solve(problem).branches).toHaveLength(1);});
 it('does not reinterpret focal-distance sums as vectors and preserves coordinate function precedence',()=>{const {d}=setup(['A=(0,0)','B=(3,0)','C=(0,4)'],[]);expect(parsePlanarInput('AB+AC=7',['A','B','C']).conditions.map(c=>c.kind)).toEqual(['scalarEquation']);expect(equationEnvironment(d).residual('AB+AC=7')).toEqual([0]);expect(parsePlanarInput('x(A)=2',['x','A']).conditions).toHaveLength(0);});
 it('honors explicit curve limits and strict inequalities without treating the viewport as a domain',()=>{const {problem,context}=setup(['c: x^2+y^2=4','d: y=0'],['intersection(P,c,d)']);problem.points.push('P');const c=context.document.objects.find(o=>o.symbol==='c');if(c?.kind==='curve')c.limits={xMin:0};const r=solve(problem);expect(r.branches).toHaveLength(1);expect(r.branches[0].positions.P[0]).toBeCloseTo(2,8);const strict=setup(['m=0'],['m^2=0','m>0'],[['m','value']]);expect(solveConstraints({id:1,problem:strict.problem}).branches).toHaveLength(0);});
 it('refuses to project imported off-plane points or silently erase a known z coordinate',()=>{const {problem,context}=setup(['A=(1,2)'],[]);const a=context.document.objects.find(o=>o.symbol==='A');if(a?.kind==='point'&&a.construction.type==='free')a.construction.position[2]=3;expect(solveConstraints({id:1,problem,budget:50}).branches).toHaveLength(0);context.unknowns=[{id:a!.id+'.x',object:a!.id,field:'x',initial:1,min:-2,max:2}];expect(solveConstraints({id:1,problem,budget:50}).branches).toHaveLength(0);});
 it('rebinds references to absorbed virtual vertices and keeps a hidden source group hidden',()=>{const {d,problem}=setup(['B=(3,4)'],[]),set=solutionSetObject(problem,solve(problem));set.hidden=true;const doc=installSolutionSet(d,set),b=d.objects.find(o=>o.kind==='point'&&o.symbol==='B')!;if(b.kind!=='point')throw Error();const alias={...b,id:crypto.randomUUID(),name:'Q',symbol:'Q',construction:{type:'alias' as const,point:`${set.id}:v:1`}};doc.objects.push(alias);const context=planarContext(doc),q=context.document.objects.find(o=>o.id===alias.id);expect(q?.kind==='point'&&q.construction.type==='alias'&&q.construction.point).toBe(b.id);expect(context.document.objects.find(o=>o.id===b.id)?.hidden).toBe(true);expect(resolveGeometry(context.document).errors.size).toBe(0);});
 it('retains presentation locks and slider settings during a constrained update',()=>{const {d,problem}=setup(['m=1','D=(m,2)'],[],[['m','value',-5,5]]),r=solve(problem),set=solutionSetObject(problem,r),doc=installSolutionSet(d,set),m=doc.objects.find(o=>o.symbol==='m'),point=doc.objects.find(o=>o.symbol==='D');if(m?.kind!=='number'||!point)throw Error();m.slider.min=-20;point.locked=true;point.name='Label';const next=installSolutionSet(doc,{...set,result:r});expect(next.objects.find(o=>o.id===point.id)?.locked).toBe(true);expect(next.objects.find(o=>o.id===point.id)?.name).toBe('Label');const n=next.objects.find(o=>o.id===m.id);expect(n?.kind==='number'&&n.slider.min).toBe(-20);});
});


describe('planar solver result integrity',()=>{
 it('retains isolated algebraic roots when changing only the reference',()=>{
  const {problem}=setup(['m=1','A=(0,0)'],['m^2=2'],[['m','value']]),previous=solve(problem),before=structuredClone(previous);
  const next=solveConstraints({id:2,problem,previous,reference:{branch:0,points:['A']}});
  expect(next.branches[0].exactValues).toEqual(before.branches[0].exactValues);
  expect(next.precision).toBe('algebraic');expect(next.complete).toBe(previous.complete);expect(previous).toEqual(before);
 });
 it('does not merge distinct algebraic roots within drawing tolerance',()=>{
  const {problem}=setup(['m=0'],['m*(m-0.0000005)=0'],[['m','value']]),r=solve(problem);
  expect(r.branches).toHaveLength(2);
  const roots=r.branches.map(b=>Object.values(b.exactValues!)[0]);
  expect(roots[0].interval[1]).toBeLessThanOrEqual(roots[1].interval[0]);expect(roots[0].approximate).toBe(0);expect(roots[1].interval[0]).toBeLessThanOrEqual(0.0000005);expect(roots[1].interval[1]).toBeGreaterThanOrEqual(0.0000005);
 });
 it('replaces the certificate and invalidates enumeration after algebraic parameter updates',()=>{
  const {problem}=setup(['m=1'],['m^2=4'],[['m','value']]),previous=solve(problem);expect(previous.complete).toBe(true);
  const variable=problem.planar!.unknowns[0].id,next=solveConstraints({id:2,problem,previous,parameter:{branch:0,variable,target:2}});
  expect(next.complete).toBe(false);expect(next.precision).toBe('algebraic');expect(next.branches[0].exactValues![variable].approximate).toBe(2);validateSolutionSet(solutionSetObject(problem,next));
  expect(previous.branches[0].exactValues).toBeDefined();expect(previous.complete).toBe(true);
 });
 it('does not preserve an enumeration claim after numerical point motion',()=>{
  const {problem}=setup(['A=(0,0)'],[],[['A','x',-5,5]]),previous=solve(problem);previous.complete=true;
  const next=solveConstraints({id:2,problem,previous,move:{branch:0,point:'A',target:[2,0,0]}});
  expect(next.branches[0].positions.A[0]).toBeCloseTo(2,5);expect(next.complete).toBe(false);expect(next.precision).toBe('algebraic');validateSolutionSet(solutionSetObject(problem,next));expect(previous.complete).toBe(true);
 });
 it('certifies bivariate candidates after exact linear elimination',()=>{
  const {problem}=setup(['m=1','n=1'],['m^2=2','n=m'],[['m','value'],['n','value']]),r=solve(problem);
  expect(r.branches).toHaveLength(2);expect(r.precision).toBe('algebraic');expect(r.complete).toBe(true);expect(r.exactAnalysis?.certified).toBe(true);expect(r.branches.every(b=>!!b.exactCertificate)).toBe(true);
 });
 it('retains conic intersections without claiming certified enumeration',()=>{
  const {problem}=setup(['c: x^2+y^2=pi','d: y=0'],['intersection(P,c,d)']);problem.points.push('P');
  const r=solve(problem);expect(r.branches).toHaveLength(2);expect(r.complete).toBe(false);expect(r.branches.every(b=>Math.abs(b.positions.P[0])>1)).toBe(true);
 });
});


describe('exact solver integration',()=>{
 it('solves a coupled parameter graph beyond two variables without search bounds',()=>{
  const {problem}=setup(['m=0','n=0','k=0','D=(m,n)'],['n=2*m','k=n+1','m^2=2','m>0'],[['m','value'],['n','value'],['k','value']]),r=solve(problem);
  expect(r.complete).toBe(true);expect(r.exactAnalysis?.reducedVariables).toBe(1);expect(r.branches[0].exactCertificate).toBeDefined();validateSolutionSet(solutionSetObject(problem,r));
 });
 it('preserves both allowed sine-angle branches in coordinate-free planar geometry',()=>{
  const points=['A','B','C'],problem:ConstraintProblem={mode:'plane',points,segments:[],conditions:['AB=2','BC=3','sin(vertexAngle(A,B,C))=1/2'].map(s=>parseCondition(s,points))},r=solve(problem);
  const lengths=r.branches.map(b=>Math.hypot(...b.positions.A.map((v,i)=>v-b.positions.C[i])));expect(Math.min(...lengths)).toBeLessThan(2);expect(Math.max(...lengths)).toBeGreaterThan(4);
  validateSolutionSet(solutionSetObject(problem,r));
 });
 it('computes all exact solutions independently of the twelve-branch display limit',()=>{
  const {problem}=setup(['a=0','b=0','c=0','d=0'],['a^2=2','b^2=3','c^2=5','d^2=7'],[['a','value'],['b','value'],['c','value'],['d','value']]),r=solve(problem);
  expect(r.branches).toHaveLength(12);expect(r.exactAnalysis?.totalSolutions).toBe(16);expect(r.exactAnalysis?.solutions).toHaveLength(16);expect(r.complete).toBe(false);validateSolutionSet(solutionSetObject(problem,r));
 });
 it('retains an implicit exact circle family and obtains a certified sample without a search box',()=>{
  const {problem}=setup(['c: x^2+y^2=4'],['onCurve(P,c)']);problem.points.push('P');const r=solve(problem);
  expect(r.exactAnalysis?.state).toBe('family');expect(r.exactAnalysis?.family?.conditions.length).toBeGreaterThan(0);expect(r.branches[0].exactCertificate).toBeDefined();expect(r.branches[0].dof).toBe(1);validateSolutionSet(solutionSetObject(problem,r));
 });
 it('rejects corrupted exact root metadata and source certificates on save',()=>{
  const {problem}=setup(['m=1'],['m^2=2','m>0'],[['m','value']]),r=solve(problem),bad=structuredClone(r),id=problem.planar!.unknowns[0].id;
  bad.branches[0].exactValues![id].polynomial=['-7','0','1'];expect(()=>validateSolutionSet(solutionSetObject(problem,bad))).toThrow();
  const forged=structuredClone(r);forged.branches[0].exactCertificate!.assignments.q_0='7';expect(()=>validateSolutionSet(solutionSetObject(problem,forged))).toThrow();
 });
 it('uses numerical fallback honestly when transcendental parameter motion cannot be certified',()=>{
  const {problem}=setup(['m=0','n=1'],['n=sin(m)'],[['m','value',-5,5],['n','value',-2,2]]),previous=solve(problem),variable=problem.planar!.unknowns[0].id;
  const next=solveConstraints({id:2,problem,previous,parameter:{branch:0,variable,target:0.5},budget:1000});expect(next.precision).toBe('approximate');expect(next.complete).toBe(false);expect(next.branches[0].exactCertificate).toBeUndefined();validateSolutionSet(solutionSetObject(problem,next));
 });
});


describe('planar shape mobility with imported definitions',()=>{
 it('does not subtract rigid motions already removed by definitions',()=>{
  const {problem}=setup(['m=1','A=(0,0)','B=(m,0)'],['m>0'],[['m','value']]);problem.mode='plane';const r=solve(problem);expect(r.branches[0].dof).toBe(1);
 });
 it('rejects an algebraic precision label with no evidence',()=>{
  const {problem}=setup(['A=(1,2)'],[]),r=solve(problem);r.precision='algebraic';expect(()=>validateSolutionSet(solutionSetObject(problem,r))).toThrow(/精确信息/);
 });
});


it('tracks the pointer side when planar exact motion has two algebraic candidates',()=>{
 const {problem}=setup(['c: x^2+y^2=4'],['onCurve(P,c)']);problem.points.push('P');const previous=solve(problem),next=solveConstraints({id:2,problem,previous,budget:1000,move:{branch:0,point:'P',target:[1,Math.sqrt(3),0]}});
 expect(next.branches[0].positions.P[1]).toBeGreaterThan(0);expect(next.branches[0].exactCertificate).toBeDefined();validateSolutionSet(solutionSetObject(problem,next));
});
