import type {ConstraintProblem,Positions} from './types';
import {symbolicGeometry} from './symbolicGeometry';
export function symbolicSpatialEquations(problem:ConstraintProblem,gauge=true){
 const tokens=problem.points.flatMap((_,i)=>[0,1,2].map(k=>`q_${i*3+k}`)),point=(name:string)=>{const i=problem.points.indexOf(name);if(i<0)throw Error('未知点');return tokens.slice(i*3,i*3+3);};
 const compiled=symbolicGeometry(problem,point),[a,b,c]=problem.points;
 if(gauge&&a)compiled.sources.push(...point(a).map(v=>`${v}=0`));
 if(gauge&&b)compiled.sources.push(`${point(b)[1]}=0`,`${point(b)[2]}=0`,`${point(b)[0]}>=0`);
 if(gauge&&c)compiled.sources.push(`${point(c)[2]}=0`,`${point(c)[1]}>=0`);
 return {...compiled,tokens,point};
}
export function spatialExactValues(problem:ConstraintProblem,p:Positions){return problem.points.flatMap(n=>p[n]);}
