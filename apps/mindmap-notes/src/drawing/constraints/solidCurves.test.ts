import {describe,it,expect} from 'vitest';
import {declarationProblem,defaultDeclaration} from './templates';
import {parseConditions,validateProblem} from './input';
import {curveGeometry} from './measures';
import {evaluator} from './compile';
describe('round solid base circle declarations',()=>{
 it('cone provides circle O and accepts one three-point incidence relation',()=>{const p=declarationProblem(defaultDeclaration('cone',3));expect(p.curves?.map(c=>c.name)).toEqual(['O']);p.points.push('B','C');p.conditions.push(...parseConditions('onCurve(A B C,O)',p.points,'incidence',p.curves));validateProblem(p);expect(p.conditions.at(-1)?.refs).toEqual([['A','B','C']]);expect(p.conditions.filter(c=>c.kind==='perpendicular'||c.kind==='equal')).toHaveLength(0);});
 it('uses the declared axis in arbitrary space and rejects off-plane points',()=>{const p=declarationProblem(defaultDeclaration('cone',3));p.points.push('B');p.conditions.push(...parseConditions('onCurve(A B,O)',p.points,'circle-points',p.curves));const pos={O:[1,2,3],P:[4,2,3],A:[1,4,3],B:[1,2,5]};const e=evaluator(p);expect(e.verify(p.points.flatMap(n=>pos[n as keyof typeof pos])).valid).toBe(true);pos.B=[2,2,5];expect(e.verify(p.points.flatMap(n=>pos[n as keyof typeof pos])).valid).toBe(false);});
 it('cylinder top circle keeps the base radius rather than a diagonal distance',()=>{const p=declarationProblem(defaultDeclaration('cylinder',3)),positions={O:[0,0,0],O_1:[0,0,3],A:[2,0,0]} as const;expect(p.curves).toHaveLength(2);const g=curveGeometry(p.curves![1],structuredClone(positions) as never);expect(g.radius).toBe(2);expect(g.center).toEqual([0,0,3]);});
 it('diameter stays a diameter condition until solver evaluation',()=>{const p=declarationProblem(defaultDeclaration('cone',3));p.points.push('E');p.conditions.push(...parseConditions('diameter(AE,O)',p.points,'diameter',p.curves));expect(p.conditions.at(-1)?.kind).toBe('diameter');const positions={O:[0,0,0],P:[0,0,3],A:[2,0,0],E:[-2,0,0]};const e=evaluator(p),v=p.points.flatMap(n=>positions[n as keyof typeof positions]);expect(e.verify(v).errors.every(e=>e.error<1e-6&&!e.degenerate)).toBe(true);});
});
