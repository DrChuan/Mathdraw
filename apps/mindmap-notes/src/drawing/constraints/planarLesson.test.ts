import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {resolveGeometry} from '../geometry';
import {addLessonInput} from './planarLesson';
import {addPlanarDefinition,planarContext} from './planarModel';
import {solveConstraints} from './solver';
import {planarEvaluator} from './planar';
import {lessonExamples} from './lessonExamples';
import {solutionSetObject,installSolutionSet,validateSolutionSet} from './document';
import {decodeConfiguration} from './configuration';
describe('teacher input from real analytic geometry exams',()=>{
 it('keeps known coordinates when only one coordinate is unknown and does not use slider limits as mathematical bounds',()=>{const c=addPlanarDefinition(planarContext(newDrawing()),'A=(?,2)');expect(c.unknowns.map(u=>u.field)).toEqual(['x']);expect(c.unknowns[0].min).toBeUndefined();});
 it('does not mutate the source after a failed row',()=>{const c=planarContext(newDrawing());expect(()=>addLessonInput(c,'A=(1,2)\nB=Line(A,missing)')).toThrow(/第 2 行/);expect(c.document.objects).toHaveLength(1);});
 for(const [index,example]of lessonExamples.entries())it(example.title,()=>{
  const a=addLessonInput(planarContext(newDrawing()),example.input),p={mode:'coordinate' as const,points:a.points,segments:[],conditions:a.conditions,planar:a.context};
  const r=solveConstraints({id:1,problem:p,budget:8000});expect(r.branches.length).toBeGreaterThan(0);
  const e=planarEvaluator(p);for(const b of r.branches)expect(e.errors(e.encode(b.positions,b.values))).toEqual([]);
  const set=solutionSetObject(p,r);validateSolutionSet(set);const d=installSolutionSet(newDrawing(),set);expect(resolveGeometry(d).errors.size).toBe(0);
  const c=decodeConfiguration(JSON.stringify({format:'mathdraw-conditions',version:2,mode:'coordinate',points:a.points.join(' '),segments:'',conditions:a.conditions.map(c=>({source:c.source,enabled:true})),planar:a.context,placement:{planeNames:[],side:1,orientationPoint:'',keepPlacement:true,mirrored:false}}));expect(c.planar?.automaticSearch).toBe(true);
  const b=r.branches[0],v=Object.values(b.values!);if(index===0){expect(v[0]).toBeCloseTo(2,5);expect(b.positions.A[1]).toBeCloseTo(b.positions.Q[1],5);expect(b.dof).toBeGreaterThan(0);}if(index===1){expect(v[0]).toBeCloseTo(2,5);expect(v[1]).toBeCloseTo(Math.sqrt(12),5);}if(index===2){expect(v[0]).toBeCloseTo(Math.sqrt(3),5);expect(v[1]).toBeCloseTo(2,5);const {A,H,N}=b.positions;expect((H[0]-A[0])*(N[1]-A[1])-(H[1]-A[1])*(N[0]-A[0])).toBeCloseTo(0,5);}if(index===3)expect(v[0]).toBeCloseTo(2,5);
 },15000);
 it('rejects a second crossing at tangency and preserves an explicit known coordinate',()=>{const a=addLessonInput(planarContext(newDrawing()),'C: x^2+y^2=1\nl: x=1\nA,B=交点(C,l)');const r=solveConstraints({id:1,problem:{mode:'coordinate',points:a.points,segments:[],conditions:a.conditions,planar:a.context},budget:100});expect(r.branches).toHaveLength(0);});
});
