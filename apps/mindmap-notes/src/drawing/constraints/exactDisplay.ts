import type {ConstraintProblem,SolutionBranch} from './types';
import {substituteNames} from '../parameters';
export function exactCoordinateSource(branch:SolutionBranch,id:string,problem?:ConstraintProblem):string|undefined{
 const known=branch.exactValues?.[id]?.expression;if(known)return known;
 if(!problem||!branch.exactCertificate)return;
 const originals=new Set(problem.planar?.document.objects.filter(o=>o.kind==='point').map(o=>o.symbol??o.name)??[]);
 const ids=[...(problem.planar?.unknowns.map(u=>u.id)??[]),...problem.points.filter(n=>!originals.has(n)).flatMap(n=>[0,1].map(k=>`point.${n}.${k}`))];
 const index=ids.indexOf(id);if(index<0)return;
 const c=branch.exactCertificate,token=c.variables[index],expression=c.assignments[token];
 if(!expression)return;
 return substituteNames(expression,Object.fromEntries(Object.entries(c.roots).map(([name,r],i)=>[name,r.expression?`(${r.expression})`:`t_${i+1}`])));
}
