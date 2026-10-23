import {describe,it,expect} from 'vitest';
import {localMobility} from './mobility';
import {parseCondition} from './input';
import {evaluator,flatten} from './compile';
import {refreshSpatialMobility,solveConstraints} from './solver';
import type {ConstraintProblem,SolutionBranch,Positions} from './types';

function prism(volume:number,scale=1){
  const points=['A','B','C','A_1','B_1','C_1'],sources=['prism(A,B,C,A_1,B_1,C_1)',...['AB','BC','CA','AA_1'].map(s=>`${s}=${2*scale}`),'angle(A_1,A,B)=60',`volume(prism(A,B,C,A_1,B_1,C_1))=${volume*scale**3}`];
  const p:ConstraintProblem={points,segments:[],conditions:sources.map(s=>parseCondition(s,points))};
  const z=volume/Math.sqrt(3),y=Math.sqrt(Math.max(0,3-z*z)),raw:Positions={A:[0,0,0],B:[2,0,0],C:[1,y,z],A_1:[1,Math.sqrt(3),0],B_1:[3,Math.sqrt(3),0],C_1:[2,y+Math.sqrt(3),z]};
  for(const name of points)raw[name]=raw[name].map(v=>v*scale) as [number,number,number];
  const branch:SolutionBranch={positions:raw,reference:['A','B','A_1','B_1'],rigid:[['A','B','A_1','B_1']],dof:1,loci:[{point:'C',kind:'circle',origin:[scale,0,0],u:[0,0,1],v:[0,1,0],radius:Math.sqrt(3)*scale,complete:false}],residual:0};
  return {p,branch};
}
describe('finite mobility at singular constraints',()=>{
  it('removes a zero-derivative direction at an extremum',()=>{
    expect(localMobility(([x])=>[x*x],[0])).toMatchObject({linear:1,dof:0,removed:1,checked:true});
  });
  it('recognizes an isolated tangent intersection',()=>{
    expect(localMobility(([x,y])=>[(x+1)**2+y*y-1,(x-1)**2+y*y-1],[0,0])).toMatchObject({linear:1,dof:0});
  });
  it('retains real circular and spherical motion, including redundant equations',()=>{
    expect(localMobility(([x,y])=>[x*x+y*y-1,2*(x*x+y*y-1)],[1,0]).dof).toBe(1);
    expect(localMobility(([x,y,z])=>[x*x+y*y+z*z-1],[1,0,0]).dof).toBe(2);
    expect(localMobility(([x,y])=>[y-x*x],[0,0]).dof).toBe(1);
  });
  it('handles multiple semidefinite obstructions without freezing a free axis',()=>{
    expect(localMobility(([x,y])=>[x*x,y*y],[0,0,0])).toMatchObject({linear:3,dof:1,removed:2});
  });
  it('does not treat an indefinite second-order cone as a proof of rigidity',()=>{
    expect(localMobility(([x,y])=>[x*y],[0,0]).dof).toBeGreaterThan(0);
    expect(localMobility(([x,y])=>[x*x-1e-6*y*y],[0,0]).removed).toBe(0);
  });
  it('does not invent a proof of rigidity for a higher-order obstruction',()=>{
    expect(localMobility(([x])=>[x**4],[0]).removed).toBe(0);
  });
  it('does not mistake an absolute-value kink for a smooth Hessian',()=>{
    expect(localMobility(([x,y])=>[y, y+Math.max(0,x)],[0,0]).removed).toBe(0);
  });
  it('fixes the saved prism at maximal volume across coordinate scales',()=>{
    for(const scale of [.01,1,100]){
      const {p,branch}=prism(3,scale);expect(evaluator(p).verify(flatten(p.points,branch.positions)).valid).toBe(true);
      const fixed=refreshSpatialMobility(p,branch);expect(fixed.dof).toBe(0);expect(fixed.loci).toEqual([]);expect(fixed.mobility?.removed).toBe(1);expect(fixed.positions).toBe(branch.positions);
    }
  });
  it('preserves two finite branches below the maximum rather than claiming a continuous hinge',()=>{
    // Fixing a non-extreme volume also fixes the hinge angle. Its Jacobian is
    // regular there, and the two reflected possibilities are discrete.
    const {p,branch}=prism(2.7);expect(refreshSpatialMobility(p,branch).dof).toBe(0);
  });
  it('keeps a genuine prism hinge when the volume condition is removed',()=>{
    const {p,branch}=prism(3);p.conditions=p.conditions.filter(c=>c.kind!=='volume');expect(refreshSpatialMobility(p,branch).dof).toBe(1);
  });
  it('reports the reason instead of silently projecting a locked drag back',()=>{
    const {p,branch}=prism(3);expect(()=>solveConstraints({id:1,problem:p,previous:{status:'solved',complete:false,attempts:1,elapsed:0,diagnostics:[],branches:[branch]},move:{point:'C',target:[1,1,1],branch:0}})).toThrow('锁定');
  });
});
