import type {ConstraintProblem,PlanarUnknown,SpatialLocus} from './types';
import type {DrawingCurve,DrawingDocument,Vec3} from '../types';
import {defaultStyle} from '../types';
import {parseExpression} from '../expression';
import {conicVertices,conicPath,conicCoefficients} from '../conics';
import {symbolicPlanarEquations} from './planarSymbolic';
import {symbolicConicCoefficients} from './conicAlgebra';
import {substituteNames} from '../parameters';
import {objectSymbol} from './planarModel';
import {nonnegativeExpression} from './metricSymbolic';
import {q,rational,plus,minus,times,divide,neg,gcd,str,type Q} from './exactArithmetic';
type Ast=ReturnType<typeof parseExpression>;
/** No decimal reconstruction: only rational constant ASTs enter this fast path. */
function constant(a:Ast):Q{
 if(a.type==='number')return rational(a.constant??a.literal??a.value);
 if(a.type==='unary')return a.sign===-1?neg(constant(a.value)):constant(a.value);
 if(a.type!=='binary')throw Error('系数尚非有理常量');
 const l=constant(a.left),r=constant(a.right);
 if(a.op==='+')return plus(l,r);if(a.op==='-')return minus(l,r);if(a.op==='*')return times(l,r);if(a.op==='/')return divide(l,r);
 if(r.d!==1n||r.n<0n||r.n>12n)throw Error('指数超限');let p=q(1n);for(let i=0n;i<r.n;i++)p=times(p,l);return p;
}
export function planarConicFamily(problem:ConstraintProblem,variables:(PlanarUnknown&{point?:string;axis?:number})[],compiled?:ReturnType<typeof symbolicPlanarEquations>){
 if(problem.mode!=='coordinate'||variables.length!==2)return;
 const doc=problem.planar?.document;if(!doc)return;
 const o=doc.objects.find(o=>o.id===variables[0].object);
 if(o?.kind!=='point'||o.construction.type!=='free'||variables.some(u=>u.object!==o.id)||!['x','y'].every(f=>variables.some(u=>u.field===f)))return;
 const symbolic=compiled??symbolicPlanarEquations(problem,variables);if(!symbolic.complete||!symbolic.definitions.complete)return;
 const substitutions=Object.fromEntries(variables.map((u,i)=>[symbolic.tokens[i],u.field]));
 let primary:string|undefined;
 try{
  for(const raw of symbolic.sources){
   const parts=raw.split(/(!=|<=|>=|<|>|=)/);if(parts.length!==3)return;
   const uses=symbolic.tokens.some(t=>new RegExp(`\\b${t}\\b`).test(raw));
   if(!uses){const l=constant(parseExpression(parts[0])),r=constant(parseExpression(parts[2])),s=minus(l,r).n;if(!(parts[1]==='='?s===0n:parts[1]==='!='?s!==0n:parts[1]==='>'?s>0n:parts[1]==='<'?s<0n:parts[1]==='>='?s>=0n:s<=0n))return;continue;}
   if(parts[1]!=='='){
    if(parts[1]==='>='&&constant(parseExpression(parts[2])).n===0n&&nonnegativeExpression(parts[0],symbolic.tokens))continue;
    return; // A further inequality may cut the conic. Never draw the superset.
   }
   if(primary)return;primary=substituteNames(raw,substitutions);
  }
  if(!primary)return;
  return conicEquationFamily(primary,objectSymbol(o),doc);
 }catch{return;}
}
/** Exact rational conic normalization shared by geometric elimination plans. */
export function conicEquationFamily(primary:string,point:string,doc:DrawingDocument){
 try{
  const coefficients=symbolicConicCoefficients(primary,[]).map(s=>constant(parseExpression(s))),den=coefficients.reduce((l,c)=>l*c.d/gcd(l,c.d),1n),ints=coefficients.map(c=>c.n*(den/c.d)),factor=ints.reduce(gcd)||1n,orientation=ints.find(n=>n!==0n)!<0n?-1n:1n;
  const normalized=ints.map(n=>n/factor*orientation);
  let equation=normalized.flatMap((n,i)=>{if(!n)return [];const magnitude=n<0n?-n:n,monomial=['x^2','x*y','y^2','x','y',''][i];return [(n<0n?'-':'+')+(monomial?(magnitude===1n?'':String(magnitude)+'*')+monomial:String(magnitude))];}).join('').replace(/^\+/,'')+'=0';
  if(normalized[1]===0n&&normalized[3]===0n&&normalized[4]===0n&&normalized[5]!==0n&&normalized[0]!==0n&&normalized[2]!==0n){
    const rhs=-normalized[5];equation=[0,2].map((i,k)=>{const ratio=divide(q(rhs),q(normalized[i])),negative=ratio.n<0n,denominator=str(negative?neg(ratio):ratio);return (negative?'-':'+')+(denominator==='1'?`${k?'y':'x'}^2`:`${k?'y':'x'}^2/(${denominator})`);}).join('').replace(/^\+/,'')+'=1';
  }
  const discriminant=normalized[1]**2n-4n*normalized[0]*normalized[2];
  const curve:DrawingCurve={id:'analytic-conic',name:'解析轨迹',kind:'curve',equation,range:[-10,10,-10,10],planeId:doc.view.planeId,style:defaultStyle()};
  const points=conicVertices(equation);if(!points.length)return;
  const seeds=(discriminant>0n?points.slice(0,2):points.slice(0,1)).map(p=>[p[0],p[1],0] as Vec3),closed=discriminant<0n;
  const locus=(seed:Vec3):SpatialLocus=>{
   const path=conicPath(curve,[seed[0],seed[1]]);if(!path||!conicCoefficients(equation))throw Error('轨迹参数化失效');
   return {point,kind:'conic',origin:[0,0,0],u:[1,0,0],v:[0,1,0],radius:10,complete:true,conic:{equation,x:path.x,y:path.y,min:path.tMin,max:path.tMax,closed,components:seeds.map(seed=>{const p=conicPath(curve,[seed[0],seed[1]])!;return {x:p.x,y:p.y,min:p.tMin,max:p.tMax};})}};
  };
  seeds.forEach(locus);return {point,equation,seeds,locus};
 }catch{return;}
}
