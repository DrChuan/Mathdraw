import {it,expect} from 'vitest';
import {planarRelationSource} from './planarRelations';
import {newDrawing} from '../types';
import {planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {planarEvaluator} from './planar';
import {symbolicPlanarEquations} from './planarSymbolic';
import {solveConstraints} from './solver';
import {validatePlanarEquationSyntax} from './planarSyntax';
it.each(['l\\perp m','l ⊥ m','l ⟂ m','l\\bot m','$l\\perp m$','\\(l\\perp m\\)','perpendicular(l,m)','Perpendicular(l,m)'])('uses the same perpendicular relation for validation, numeric evaluation and algebra: %s',source=>{
 const a=addLessonInput(planarContext(newDrawing()),`k=?\nl:y=k*x\nm:y=x\n${source}`),p={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},before=JSON.stringify(p),e=planarEvaluator(p);
 expect(()=>validatePlanarEquationSyntax(source,a.context.document,a.points)).not.toThrow();
 const s=symbolicPlanarEquations(p,e.variables);expect(s.complete,s.unsupported.join(';')).toBe(true);
 const result=solveConstraints({id:1,problem:p,budget:1000});expect(result.precision).not.toBe('approximate');expect(result.branches).toHaveLength(1);expect(Object.values(result.branches[0].values!)[0]).toBeCloseTo(-1,9);expect(e.errors(e.encode(result.branches[0].positions,result.branches[0].values))).toEqual([]);expect(JSON.stringify(p)).toBe(before);
});
it.each(['l\\parallel m','l ∥ m','l ‖ m','l//m','parallel(l,m)'])('uses the same parallel relation: %s',source=>{
 const a=addLessonInput(planarContext(newDrawing()),`k=?\nl:y=k*x+1\nm:y=2*x\n${source}`),p={mode:'coordinate' as const,points:a.points,conditions:a.conditions,segments:[],planar:a.context},r=solveConstraints({id:1,problem:p,budget:1000});
 expect(planarRelationSource(source)).toBe('parallel(l,m)');expect(r.precision).not.toBe('approximate');expect(Object.values(r.branches[0].values!)[0]).toBeCloseTo(2,9);
});
