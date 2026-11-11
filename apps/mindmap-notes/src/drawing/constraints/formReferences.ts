import type {DrawingDocument} from '../types';
import type {ConstraintCurve} from './types';
import {resolveGeometry} from '../geometry';
import {conicCoefficients} from '../conics';
import type {FormReferences} from './form';

/** A name denotes the same native object in the picker and the compiler.
 * Unclassified equations remain curves; never label every native curve a circle. */
export function equationCurveLabel(equation:string):string {
 try{
  const q=conicCoefficients(equation);if(!q)return '曲线';
  const [A,B,C,D,E,F]=q,size=Math.max(Math.abs(A),Math.abs(B),Math.abs(C));
  if(size<1e-12)return Math.hypot(D,E)>1e-12?'直线':'曲线';
  const det=4*A*C*F+B*D*E-A*E*E-C*D*D-F*B*B;
  if(Math.abs(det)<1e-12)return '退化二次曲线';
  if(Math.abs(A-C)<1e-10*size&&Math.abs(B)<1e-10*size)return '圆';
  const discriminant=B*B-4*A*C;
  return Math.abs(discriminant)<1e-10*size*size?'抛物线':discriminant<0?'椭圆':'双曲线';
 }catch{return '曲线';}
}
export function conditionFormReferences(document:DrawingDocument|undefined,curves:ConstraintCurve[]=[]){
 let geometry:ReturnType<typeof resolveGeometry>|undefined;
 if(document)try{geometry=resolveGeometry(document);}catch{/* Invalid definitions retain their actual object names. */}
 const choices=(document?.objects.filter(o=>o.kind==='curve')??[]).map(o=>({id:o.id,name:o.symbol??o.name,label:o.circle?'圆':o.preset?({circle:'圆',ellipse:'椭圆',hyperbola:'双曲线',parabola:'抛物线'}[o.preset.type]):equationCurveLabel(geometry?.curves.get(o.id)?.equation??o.equation)}));
 const used=new Set(choices.map(c=>c.name));for(const c of curves)if(!used.has(c.name)){choices.push({id:c.id,name:c.name,label:c.type==='circle'?'圆':'椭圆'});used.add(c.name);}
 const references:FormReferences={objectNames:new Set([...(document?.objects.map(o=>o.symbol??o.name)??[]),...choices.map(c=>c.name)]),curveNames:new Set(choices.map(c=>c.name))};
 return {choices,references};
}
