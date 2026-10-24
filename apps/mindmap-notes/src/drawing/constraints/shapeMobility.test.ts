import {describe,it,expect} from 'vitest';
import {shapeMobility} from './shapeMobility';
import {parseCondition} from './input';
import {evaluator,flatten} from './compile';
import {refreshSpatialMobility,solveConstraints} from './solver';
import type {ConstraintProblem,Positions,SolutionBranch} from './types';

function fixture(positions:Positions,sources:string[],reference:string[]){
  const points=Object.keys(positions),problem:ConstraintProblem={points,segments:[],conditions:sources.map(s=>parseCondition(s,points))};
  const branch:SolutionBranch={positions,reference,rigid:[],dof:3,loci:[],residual:0};
  expect(evaluator(problem).verify(flatten(points,positions)).valid).toBe(true);
  return {problem,branch};
}
describe('intrinsic spatial shape freedom',()=>{
  it('removes actual orbit dimensions instead of blindly subtracting six',()=>{
    for(const [points,rigid,dof] of [
      [[2,3,4],3,0],[[0,0,0,2,0,0],5,1],[[0,0,0,2,0,0,0,3,0],6,3],
    ] as const){const result=shapeMobility(()=>[],[...points],1);expect(result.rigid).toBe(rigid);expect(result.dof).toBe(dof);}
  });
  it('keeps a rigid triangle at zero under one-point and axis references',()=>{
    const positions:Positions={A:[0,0,0],B:[3,0,0],C:[0,4,0]};
    for(const reference of [['A'],['A','B'],['A','B','C']]){
      const {problem,branch}=fixture(positions,['AB=3','AC=4','BC=5'],reference);
      const b=refreshSpatialMobility(problem,branch);expect(b.dof).toBe(0);expect(b.motionDof).toBe(0);expect(b.positions).toBe(positions);
      expect(()=>solveConstraints({id:1,problem,previous:{status:'solved',complete:false,attempts:1,elapsed:0,diagnostics:[],branches:[b]},move:{branch:0,point:'C',target:[0,0,4]}})).toThrow();
    }
  });
  it('quotients residual axis rotation at a straightened flexible triangle',()=>{
    const positions:Positions={A:[0,0,0],B:[3,0,0],C:[4,0,0]};
    const {problem,branch}=fixture(positions,['AB=3','AC=4'],['A','B']);
    const b=refreshSpatialMobility(problem,branch);expect(b.dof).toBe(1);expect(b.motionDof).toBe(2);
    const locked=fixture(positions,['AB=3','AC=4','collinear(A,B,C)'],['A']);
    expect(refreshSpatialMobility(locked.problem,locked.branch).dof).toBe(0);
    const axial=fixture(positions,['AB=3','collinear(A,B,C)'],['A']);
    expect(refreshSpatialMobility(axial.problem,axial.branch).dof).toBe(1);
  });
  it('retains a genuine hinge and separates reference locks from shape constraints',()=>{
    const positions:Positions={A:[0,0,0],B:[3,0,0],C:[0,4,0],D:[0,0,4]},sources=['AB=3','AC=4','BC=5','AD=4','BD=5'];
    const cases:[string[],number][]=[[['A'],4],[['A','B'],2],[['A','B','C'],1],[Object.keys(positions),0]];
    for(const [reference,motion] of cases){const {problem,branch}=fixture(positions,sources,reference);const b=refreshSpatialMobility(problem,branch);expect(b.dof).toBe(1);expect(b.motionDof).toBe(motion);}
  });
  it('is unchanged by translation, rotation, and units',()=>{
    for(const scale of [.01,1,100]){
      const positions:Positions={A:[0,0,0],B:[3,0,0],C:[0,4,0]};
      for(const n of Object.keys(positions)){const [x,y,z]=positions[n];positions[n]=[scale*(7+y),scale*(-5+z),scale*(13+x)];}
      const {problem,branch}=fixture(positions,[`AB=${3*scale}`,`AC=${4*scale}`,`BC=${5*scale}`],['A']);
      expect(refreshSpatialMobility(problem,branch).dof).toBe(0);
    }
  });
  it('retains the visible pyramid flexibility until its base is constrained',()=>{
    const positions:Positions={A:[0,0,0],B:[2,0,0],C:[2,Math.sqrt(2),0],D:[0,4,0],P:[0,0,4]},sources=['pyramid(P,A,B,C,D)','perpendicular(PAD,ABC)','perpendicular(AB,AD)','perpendicular(PB,AD)','PA=4','AD=4','AB=2','BC=sqrt(2)'];
    const {problem,branch}=fixture(positions,sources,['A','B','D','P']);expect(refreshSpatialMobility(problem,branch).dof).toBe(1);
    // Fixing the remaining base direction fixes the shape without altering
    // the supplied lengths or adding an implicit rectangle assumption.
    const f=fixture(positions,[...sources,'parallel(BC,AD)'],['A']);
    expect(refreshSpatialMobility(f.problem,f.branch).dof).toBe(0);
  });
  it('refreshes the previous counting scheme without moving saved geometry',()=>{
    const {problem,branch}=fixture({A:[0,0,0],B:[3,0,0],C:[0,4,0]},['AB=3','AC=4','BC=5'],['A']);
    branch.mobility={version:1,linear:3,removed:0,checked:true};
    const b=refreshSpatialMobility(problem,branch);expect(b.dof).toBe(0);expect(b.mobility?.version).toBe(2);expect(b.positions).toBe(branch.positions);
  });
});
