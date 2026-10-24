import {describe,it,expect} from 'vitest';
import {solveConstraints} from './solver';
import {parseCondition} from './input';
import {evaluator,flatten} from './compile';
import {symbolicSpatialEquations} from './spatialExact';
import {solveExactSystem,validateExactCertificate} from './exactSystem';
import {solutionSetObject,validateSolutionSet} from './document';
import type {ConstraintProblem} from './types';
function problem(names:string,conditions:string[],mode:'plane'|'spatial'='spatial'):ConstraintProblem{const points=names.split(' ');return {mode,points,segments:[],conditions:conditions.map(s=>parseCondition(s,points))};}
describe('exact geometric compilation',()=>{
 it('certifies a spatial triangle with written radical lengths',()=>{const p=problem('A B C',['AB=sqrt(2)','AC=2','BC=sqrt(2)']),r=solveConstraints({id:1,problem:p,budget:2000});expect(r.status).toBe('solved');expect(r.exactAnalysis?.certified,r.exactAnalysis?.reason).toBe(true);expect(r.branches[0].exactCertificate).toBeDefined();validateSolutionSet(solutionSetObject(p,r));});
 it('preserves numeric operands inside function calls',()=>{const p=problem('A B C',['distance(A,B,sqrt(2))','distance(A,C,2)','distance(B,C,sqrt(2))']),s=symbolicSpatialEquations(p);expect(s.sources.join(' ')).toContain('sqrt(2)');const r=solveExactSystem(s.sources,s.tokens,{deadline:Date.now()+5000});expect(r.complete,r.reason).toBe(true);expect(r.candidates).toHaveLength(1);});
 it('retains exact fractional vector coefficients in the common compiler',()=>{const p=problem('A B P',['AB=3','vectorRelation(vec(AP)=vec(AB)/3)']),s=symbolicSpatialEquations(p),r=solveExactSystem(s.sources,s.tokens,{deadline:Date.now()+5000});expect(s.complete).toBe(true);expect(r.complete,r.reason).toBe(true);expect(r.candidates[0].values[6]).toBe(1);});
 it('certifies line, segment-range and zero-distance incidence without changing the original checks',()=>{const p=problem('A B P',['AB=2','AP=0.5','onSegment(P,A,B)']),r=solveConstraints({id:1,problem:p,budget:2000});expect(r.complete).toBe(true);expect(r.branches).toHaveLength(1);expect(evaluator(p).verify(flatten(p.points,r.branches[0].positions)).valid).toBe(true);validateSolutionSet(solutionSetObject(p,r));});
 it('represents square and triangle conditions through the same polynomial layer',()=>{const p=problem('A B C D',['square(A,B,C,D)','AB=2'],'plane'),r=solveConstraints({id:1,problem:p,budget:2000});expect(r.exactAnalysis?.certified,r.exactAnalysis?.reason).toBe(true);expect(r.branches).toHaveLength(2);validateSolutionSet(solutionSetObject(p,r));});
 it('validates a spatial motion certificate against intrinsic conditions without imposing a new coordinate frame',()=>{const p=problem('A B C P',['AB=3','AC=4','BC=5','AP=2','coplanar(A,B,C,P)']),s=symbolicSpatialEquations(p,false),add=['q_0=0','q_1=0','q_2=0','q_3=3','q_4=0','q_5=0','q_6=0','q_7=4','q_8=0','q_9=1'],r=solveExactSystem([...s.sources,...add],s.tokens,{deadline:Date.now()+5000});expect(r.complete,r.reason).toBe(true);expect(r.candidates).toHaveLength(2);for(const c of r.candidates)validateExactCertificate(c.certificate,c.values,s.sources,s.tokens);});
 it('tracks the requested side when exact spatial motion has two algebraic candidates',()=>{
  const p=problem('A B C P',['AB=3','AC=4','BC=5','AP=2','coplanar(A,B,C,P)']),previous=solveConstraints({id:1,problem:p,budget:2000});
  previous.branches[0].positions={A:[0,0,0],B:[3,0,0],C:[0,4,0],P:[2,0,0]};previous.branches[0].reference=['A','B','C'];
  const r=solveConstraints({id:2,problem:p,previous,budget:1500,move:{point:'P',target:[1,Math.sqrt(3),0],branch:0}});
  expect(r.branches[0].positions.P[1]).toBeGreaterThan(0);expect(r.branches[0].exactCertificate).toBeDefined();validateSolutionSet(solutionSetObject(p,r));
 });
 it('handles prescribed external radius without converting its radical source to a decimal',()=>{const p=problem('A B C',['AB=2','AC=2','circumradius(ABC)=sqrt(2)']),s=symbolicSpatialEquations(p);expect(s.complete).toBe(true);const r=solveExactSystem(s.sources,s.tokens,{deadline:Date.now()+5000});expect(r.kind,r.reason).toBe('finite');expect(r.candidates.length).toBeGreaterThan(0);for(const c of r.candidates)validateExactCertificate(c.certificate,c.values,s.sources,s.tokens);});
});
