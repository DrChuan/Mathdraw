import {it,expect,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {newDrawing,type DrawingDocument,type DrawingSolutionSet} from '../types';
import {applyDefinition,nextSymbol} from '../model';
import {addLessonInput} from './planarLesson';
import {planarContext,objectSymbol} from './planarModel';
import {pointCreationSource} from './pointCreation';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {proposeCoordinateObjects,type CoordinateDraft} from '../coordinateWorkspace';
const setup=(source:string)=>{const a=addLessonInput(planarContext(newDrawing()),source);return {mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context};};
it('eliminates an internal intersection without requiring a visible point in wrong2',()=>{
 const doc=JSON.parse(readFileSync(new URL('./fixtures/director-without-intersection.json',import.meta.url),'utf8')) as DrawingDocument,set=doc.objects.find(o=>o.kind==='solutionSet') as DrawingSolutionSet,before=JSON.stringify(set.problem),r=solveConstraints({id:1,problem:set.problem,budget:1000});
 expect(r.precision).toBe('construction');expect(r.branches).toHaveLength(1);expect(r.branches[0].dof).toBe(1);expect(Object.keys(r.branches[0].positions).sort()).toEqual(['A','B','O']);expect(JSON.stringify(set.problem)).toBe(before);
 const moved=solveConstraints({id:2,problem:set.problem,previous:r,budget:350,move:{point:'A',branch:0,target:[2,0,0]}}),e=planarEvaluator(set.problem);expect(moved.precision).toBe('construction');expect(moved.branches[0].positions.A[0]).toBeCloseTo(2,7);expect(e.errors(e.encode(moved.branches[0].positions,moved.branches[0].values))).toEqual([]);
});
it.each(['through','native'])('keeps the whole incremental %s workflow analytic before and after perpendicularity, without drawing the intersection',kind=>{
 const base='椭圆 C x 参数 a,b,c,e\na=2\nb=1',points='A=(?,?)\nB=(?,?)\nonCurve(A,C)\nonCurve(B,C)',lines=kind==='native'?'l_1=Tangent(C,A,1)\nl_2=Tangent(C,B,1)':'l_1=过点直线(A)\nl_2=过点直线(B)\ntangent(l_1,C)\ntangent(l_2,C)';
 for(const source of kind==='native'?[base,base+'\n'+points,base+'\n'+points+'\nl_1=Tangent(C,A,1)',base+'\n'+points+'\n'+lines,base+'\n'+points+'\n'+lines+'\nl_1\\perp l_2']:[base+'\n'+points+'\n'+lines+'\nl_1\\perp l_2']){
  const p=setup(source),r=solveConstraints({id:1,problem:p,budget:1000}),e=planarEvaluator(p);expect(r.branches.length,source+' '+JSON.stringify(r.diagnostics)).toBeGreaterThan(0);expect(r.precision,source).not.toBe('approximate');for(const b of r.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
 }
});
it('creates native tangents from a free exterior point without requiring an incidence condition',()=>{
 const p=setup('C:x^2/9+y^2/4=1\nP=(?,?)\nl_1=Tangent(C,P,1)\nl_2=Tangent(C,P,2)'),r=solveConstraints({id:1,problem:p,budget:1000});expect(r.precision).toBe('construction');expect(r.branches[0].dof).toBe(2);
});
describe('names, derived parameter names and batched declarations',()=>{
 it.each(['l1','l_1','l_1_2','longLine_1'])('creates %s and its direction parameter without a second naming rule',name=>{
  const p=setup(`A=(0,0)\n${name}=过点直线(A)`);expect(p.planar.document.objects.some(o=>objectSymbol(o)===name)).toBe(true);expect(p.planar.document.objects.some(o=>objectSymbol(o)===name+'_t')).toBe(true);
 });
 it('uses uppercase curves and valid subscripted default line names, leaving textbook c available',()=>{
  let d=newDrawing();expect(nextSymbol(d,'curve')).toBe('C');d=applyDefinition(d,'A=(0,0)');d=applyDefinition(d,'B=(1,0)');d=applyDefinition(d,'l=Line(A,B)');expect(nextSymbol(d,'line')).toBe('l_1');d=applyDefinition(d,'l_1=Line(A,B)');expect(nextSymbol(d,'line')).toBe('l_2');
  const p=setup(`椭圆 ${nextSymbol(d,'curve')} x 参数 a,b,c,e`);expect(p.planar.document.objects.some(o=>objectSymbol(o)==='c'&&o.kind==='number')).toBe(true);
 });
 it('creates multiple points with incidences in one proposal and distinct free initial layouts',()=>{
  const base=setup('C:x^2/4+y^2=1'),draft:CoordinateDraft={context:base.planar,points:base.points.join(' '),segments:'',conditions:[],curves:[]},before=JSON.stringify(draft),s=pointCreationSource(base.planar.document,'A, B_1，D','','','C'),proposal=proposeCoordinateObjects(draft,s);
  expect(proposal.created.filter(o=>o.kind==='point')).toHaveLength(3);expect(proposal.relations).toHaveLength(3);expect(new Set(proposal.draft.context.unknowns.filter(u=>u.field==='x').map(u=>u.initial)).size).toBe(3);expect(JSON.stringify(draft)).toBe(before);
  expect(()=>pointCreationSource(base.planar.document,'A A','','')).toThrow('重复');
 });
});
it('does not block a conic family on entire-domain dependent outputs',()=>{
 const p=setup('P=(?,?)\nx(P)^2+y(P)^2=4\nf=sin(x(P))+cos(y(P))'),e=planarEvaluator(p),s=symbolicPlanarEquations(p,e.variables);expect(s.definitions.complete,s.definitions.unsupported.join(';')).toBe(true);const r=solveConstraints({id:1,problem:p,budget:1000});expect(r.precision).toBe('construction');expect(r.branches[0].loci[0].kind).toBe('conic');
});

it('accepts grouped point incidence as the same semantic input',()=>{
 const p=setup('C:x^2/4+y^2=1\nA=(?,?)\nB=(?,?)\nonCurve(A B,C)\nl_1=Tangent(C,A,1)\nl_2=Tangent(C,B,1)\nl_1\\perp l_2'),r=solveConstraints({id:1,problem:p,budget:1000});expect(r.precision).toBe('construction');expect(r.branches[0].dof).toBe(1);
});

it('does not reinterpret a subscripted geometric length equality as a scalar declaration',()=>{
 const p=setup('P=(?,?)\nF_1=(0,0)\nF_2=(1,0)\nPF_1=3PF_2');expect(p.planar.document.objects.some(o=>['PF_1','PF_2'].includes(objectSymbol(o)))).toBe(false);expect(p.conditions.some(c=>c.source==='PF_1=3PF_2')||p.planar.equations.some(c=>c.source==='PF_1=3PF_2')).toBe(true);expect(p.planar.unknowns).toHaveLength(2);
});
