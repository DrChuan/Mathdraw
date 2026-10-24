import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ConstraintWorkbench from '../ConstraintWorkbench';
import {newDrawing} from '../types';
import {parseCondition} from './input';
import {solveConstraints} from './solver';
import {evaluator,flatten} from './compile';
import {planarEvaluator} from './planar';
describe('live condition workspaces',()=>{
 for(const dimension of ['2d','3d'] as const)it(`always shows input and preview for ${dimension}`,()=>{
  const d=newDrawing();d.dimension=dimension;const docRef={current:d};
  const html=renderToStaticMarkup(createElement(ConstraintWorkbench,{docRef,change:()=>true,close:()=>{},highlight:()=>{}}));
  expect(html).toContain('live-workspace');expect(html).toContain('constraint-live-preview');expect(html).not.toContain('求解条件</button>');expect(html).not.toContain('声明与条件</button>');
 });
 it('verifies new constraints instead of accepting old positions as a solution',()=>{
  const p={points:['A','B'],segments:[['A','B'] as [string,string]],conditions:[parseCondition('AB=2',['A','B'])]};
  const old=solveConstraints({id:1,problem:p,budget:200});expect(old.branches.length).toBeGreaterThan(0);
  const next={...p,conditions:[parseCondition('AB=3',p.points)]};const solved=solveConstraints({id:2,problem:next,seeds:old.branches.map(b=>b.positions),budget:400});
  expect(solved.branches.length).toBeGreaterThan(0);solved.branches.forEach(b=>expect(evaluator(next).verify(flatten(p.points,b.positions)).valid).toBe(true));
  const bad={...next,conditions:[...next.conditions,parseCondition('AB=5',p.points)]};expect(solveConstraints({id:3,problem:bad,seeds:solved.branches.map(b=>b.positions),budget:200}).branches).toHaveLength(0);
 });
 it('supports unconstrained layouts and seed correction in genuinely 2D solving',()=>{
  const p={mode:'plane' as const,points:['A','B'],segments:[['A','B'] as [string,string]],conditions:[]};
  const first=solveConstraints({id:1,problem:p,budget:200});expect(first.branches.length).toBeGreaterThan(0);
  const next={...p,conditions:[parseCondition('AB=4',p.points)]},result=solveConstraints({id:2,problem:next,seeds:first.branches.map(b=>b.positions),budget:500});
  expect(result.branches.length).toBeGreaterThan(0);const e=planarEvaluator(next);result.branches.forEach(b=>{expect(e.errors(e.encode(b.positions,b.values))).toHaveLength(0);Object.values(b.positions).forEach(p=>expect(p[2]).toBe(0));});
 });
});
import {currentConstraintRevision} from '../useLiveConstraints';
it('rejects late replies after editing, cancellation, mode switching and closing',()=>{
 expect(currentConstraintRevision(3,3,'a','a',true)).toBe(true);
 expect(currentConstraintRevision(2,3,'a','a',true)).toBe(false);
 expect(currentConstraintRevision(3,3,'a','b',true)).toBe(false);
 expect(currentConstraintRevision(3,3,'a','a',false)).toBe(false);
});
it('does not collapse newly declared unconstrained points into one point',()=>{
 const p={mode:'plane' as const,points:['A','B','C'],segments:[['A','B'] as [string,string],['B','C'] as [string,string],['C','A'] as [string,string]],conditions:[]};
 const r=solveConstraints({id:1,problem:p,budget:200});expect(r.branches.length).toBeGreaterThan(0);const q=r.branches[0].positions;
 expect(Math.hypot(...q.B.map((v,i)=>v-q.A[i]))).toBeGreaterThan(1);
 expect(Math.abs((q.B[0]-q.A[0])*(q.C[1]-q.A[1])-(q.B[1]-q.A[1])*(q.C[0]-q.A[0]))).toBeGreaterThan(1);
});
