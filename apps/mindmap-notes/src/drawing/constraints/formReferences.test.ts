import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {planarContext} from './planarModel';
import {addLessonInput} from './planarLesson';
import {formConditionSource} from './form';
import {conditionFormReferences,equationCurveLabel} from './formReferences';
import {equationEnvironment} from './planarExpressions';
import {validatePlanarEquationSyntax} from './planarSyntax';
import type {ConstraintKind} from './types';
const fixture=()=>addLessonInput(planarContext(newDrawing()),'A=(2,0)\nB=(0,sqrt(3))\nc:x^2/4+y^2/3=1\nl:y=0\nm:x=0\ns=Segment(O,A)\nh=Vector(O,A)\nj=Vector(O,B)');
describe('condition forms use actual coordinate object references and signatures',()=>{
 it('submits a point on an existing native ellipse with exactly two arguments',()=>{
  const lesson=fixture(),catalog=conditionFormReferences(lesson.context.document);
  expect(catalog.choices.find(c=>c.name==='c')?.label).toBe('椭圆');
  expect(catalog.choices.find(c=>c.name==='l')?.label).toBe('直线');
  const source=formConditionSource('onCurve',['A','c'],lesson.points,'3','degrees','both','prism',[],catalog.references);
  expect(source).toBe('onCurve(A,c)');
  const next=addLessonInput(lesson.context,source,lesson.points);expect(next.context.equations.at(-1)?.source).toBe(source);
  validatePlanarEquationSyntax(source,next.context.document,lesson.points);expect(equationEnvironment(next.context.document).residual(source).every(v=>Math.abs(v)<1e-9)).toBe(true);
 });
 it.each([
  ['perpendicular',['l','m'],'3','degrees'],['parallel',['l','OA'],'3','degrees'],
  ['distance',['s'],'2','degrees'],['equal',['s','OA'],'3','degrees'],['ratio',['s','OA'],'1','degrees'],
  ['vectorDot',['h','j'],'0','degrees'],['lineAngle',['l','m'],'90','degrees'],
  ['lineAngle',['l','m'],'pi/2','radians'],['lineAngle',['l','m'],'1','sin'],['lineAngle',['l','m'],'0','cos'],
  ['vectorDot',['h','OB'],'0','degrees'],['lineAngle',['l','OB'],'1','sin'],['lineAngle',['OA','m'],'0','cos'],
 ] as const)('validates and evaluates the form-generated %s relationship',(kind,fields,value,mode)=>{
  const lesson=fixture(),{references}=conditionFormReferences(lesson.context.document);
  const source=formConditionSource(kind,[...fields],lesson.points,value,mode,'both','prism',[],references);
  const next=addLessonInput(lesson.context,source,lesson.points);
  for(const e of next.context.equations){validatePlanarEquationSyntax(e.source,next.context.document,lesson.points);expect(Math.max(...equationEnvironment(next.context.document).residual(e.source).map(Math.abs))).toBeLessThan(1e-9);}
 });
 it('does not add a numeric argument to nonnumeric geometric properties',()=>{
  const lesson=fixture(),{references}=conditionFormReferences(lesson.context.document);
  for(const kind of ['rectangle','square','regularPolygon','convexPolygon'] as ConstraintKind[])expect(formConditionSource(kind,['OAB'],lesson.points,'3','degrees','both','prism',[],references)).toBe(`${kind}(O A B)`);
  for(const kind of ['similar','congruent'] as ConstraintKind[])expect(formConditionSource(kind,['OAB','OBA'],lesson.points,'3','degrees','both','prism',[],references)).toBe(`${kind}(O A B,O B A)`);
 });
 it('keeps standalone declared curves and rejects missing curve selection',()=>{
  const curves=[{id:'c1',name:'C',type:'circle' as const,method:'centerRadius' as const,points:['O'],value:2,enabled:true}];
  expect(conditionFormReferences(undefined,curves).choices).toEqual([{id:'c1',name:'C',label:'圆'}]);
  expect(formConditionSource('onCurve',['A','C'],['O','A'],'3','degrees','both','prism',curves)).toBe('onCurve(A,C)');
  expect(()=>formConditionSource('onCurve',['A','missing'],['A'],'3','degrees','both')).toThrow('已声明');
 });
 it.each([
  ['x^2/4+y^2/3=1','椭圆'],['(x+y)^2/8+(x-y)^2/4=1','椭圆'],['x^2+y^2=4','圆'],
  ['x^2-y^2=1','双曲线'],['y^2=4*x','抛物线'],['x=2','直线'],['y=sin(x)','曲线'],['x^2-y^2=0','退化二次曲线'],['x^2/a^2+y^2/b^2=1','曲线'],
 ])('does not invent a circle label for %s',(source,label)=>expect(equationCurveLabel(source)).toBe(label));
});
