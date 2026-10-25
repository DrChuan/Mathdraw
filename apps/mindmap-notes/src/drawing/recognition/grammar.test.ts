import {describe,it,expect} from 'vitest';
import {conditionExamples} from '../constraints/catalog';
import {constraintKinds,type ConstraintCurve} from '../constraints/types';
import {parseConditions} from '../constraints/input';
import {planarRelations} from '../constraints/planarRelations';
import {validatePlanarEquationSyntax} from '../constraints/planarSyntax';
import {addLessonInput} from '../constraints/planarLesson';
import {planarContext} from '../constraints/planarModel';
import {newDrawing} from '../types';
import {equationEnvironment} from '../constraints/planarExpressions';
import {symbolicPlanarEquations} from '../constraints/planarSymbolic';
import {solveConstraints} from '../constraints/solver';
import {compileRecognition,checkRecognitionScopes,extractionPrompt} from './model';
import type {RecognizedQuestion} from './types';
const names='A B C D E F G H M P O O_1 A_1 B_1 C_1'.split(' ');
const curves:ConstraintCurve[]=[{id:'c',name:'c',type:'circle',method:'centerPoint',points:['O','A']},{id:'O',name:'O',type:'circle',method:'centerPoint',points:['O','A']}];
const lesson=()=>addLessonInput(planarContext(newDrawing()),'A=(1,0)\nB=(0,1)\nP=(2,0)\nF=(1,0)\nc: x^2/4+y^2=1\nl: y=0\ns=Segment(O,A)\nt=Segment(O,B)\nh=Vector(O,A)\nj=Vector(O,B)');
const question=(source:string):RecognizedQuestion=>({version:1,id:'contract',image:'data:image/png;base64,AA==',width:100,height:100,regions:[{id:'r1',text:'直线的倾斜角为30度',box:[0,0,100,20]}],originalText:'题文',editedText:'题文',paragraphs:[],mode:'coordinate',points:'F_2',segments:'',scopes:[{id:'common',label:'公共题干'}],activeScope:'common',items:[{id:'d',role:'definition',source:'F_2=(1,0)\nk=?\nl: y=k*(x-x(F_2))+y(F_2)',text:'直线过焦点',quote:'直线过焦点',scope:'common',regions:['r1'],necessary:true,enabled:true},{id:'angle',role:'condition',source,text:'直线的倾斜角为30度',quote:'倾斜角为30度',scope:'common',regions:['r1'],necessary:true,enabled:true}],warnings:[],revision:0});
describe('executable recognition grammar contract',()=>{
 it.each(constraintKinds)('every geometric catalog example parses as its advertised kind: %s',kind=>{
  const result=parseConditions(conditionExamples[kind],names,'catalog',curves);expect(result.some(c=>c.kind===kind)).toBe(true);expect(extractionPrompt).toContain(conditionExamples[kind]);
 });
 it.each(Object.entries(planarRelations))('every named relation has a validated prompt signature: %s',(name,spec)=>{
  const {context}=lesson();expect(()=>validatePlanarEquationSyntax(spec.example,context.document,['O','A','B','P','F'])).not.toThrow();expect(extractionPrompt).toContain(spec.example);expect(()=>validatePlanarEquationSyntax(`${name}()`,context.document,['O','A','B','P','F'])).toThrow();
 });
 it('checks named-object relations at evaluation, including endpoint groups',()=>{
  const {context}=lesson(),env=equationEnvironment(context.document);
  for(const s of ['onCurve(P,c)','onLine(A,l)','parallel(l,OA)','perpendicular(l,OB)','lineAngle(l,OB,90)','inclination(l,0)','distance(s,1)','equal(s,t)','equal(s,OB)','ratio(s,OB,1)','ratio(s,t,1)','vectorDot(h,j,0)','vectorDot(h,OB,0)','pointLineDistance(P,l,0)'])expect(env.residual(s).every(v=>Math.abs(v)<1e-8),s).toBe(true);
 });
 it.each([0,30,90,150])('distinguishes inclination from acute line angles: %s',angle=>{
  const radians=angle*Math.PI/180,source=`l: ${Math.cos(radians)}*y-${Math.sin(radians)}*x=0`,{context}=addLessonInput(planarContext(newDrawing()),source),env=equationEnvironment(context.document);
  expect(Math.abs(env.residual(`inclination(l,${angle})`)[0])).toBeLessThan(1e-8);
  if(angle===150)expect(Math.abs(env.residual('inclination(l,30)')[0])).toBeGreaterThan(.1);
  expect(env.residual(`inclination(l,rad(${radians}))`)[0]).toBeCloseTo(0,8);
 });
 it('compiles and solves the screenshot pattern, preserving exact algebraic direction',()=>{
  const c=compileRecognition(question('inclination(l,30)')),p={mode:c.mode,points:c.points.split(' '),segments:[] as [string,string][],conditions:[],planar:c.planar};
  const symbolic=symbolicPlanarEquations(p,c.planar!.unknowns);expect(symbolic.complete,symbolic.unsupported.join(';')).toBe(true);expect(symbolic.sources.join(' ')).toContain('sqrt(3)');
  const r=solveConstraints({id:1,problem:p,budget:2000});expect(r.branches.length,r.diagnostics.join(';')).toBeGreaterThan(0);const o=c.planar!.document.objects.find(o=>o.symbol==='k')!;expect(r.branches[0].values![o.id+'.value']).toBeCloseTo(1/Math.sqrt(3),6);
 });
 it('rejects invented axes, absent references, bad arity and out-of-range angles before import',()=>{
  for(const source of ['angle(l,x_axis)=30','inclination(missing,30)','inclination(l,30,40)','inclination(l,180)','inclination(l,-1)','lineAngle(l,OA,150)'])expect(()=>compileRecognition(question(source)),source).toThrow();
 });
 it.each(['s=Segment(A,B)','l=Line(A,B)','h=Vector(A,B)','t=Triangle(A,B,C)','d=Circle(O,A)','d=Circle(O,2)','d=Circle3(A,B,C)','d=DiameterCircle(A,B)','F_1=Focus(c,1)','F_2=Focus(c,2)','A_1=Vertex(c,1)','A_2=Vertex(c,2)','l=Asymptote(c,1)','l=Directrix(c,1)','d=Circle(O,2)\nQ=CircleCenter(d)','l: y=0\nM,N=Intersect(c,l)','l: y=0\nM=Intersect(c,l,1)'])('coordinate constructor contract compiles: %s',source=>{
  const q=question('');q.points='A B C F_1 F_2 A_1 A_2 Q M N';q.items=[{...q.items[0],source:'A=(1,0)\nB=(0,1)\nC=(-1,0)\nc: x^2/4-y^2=1\n'+source}];expect(()=>compileRecognition(q)).not.toThrow();
 });
 it('checks inactive siblings independently without mixing their hypotheses',()=>{
  const q=question('inclination(l,30)');q.scopes.push({id:'p1',label:'第一问',parent:'common'},{id:'p2',label:'第二问',parent:'common'});q.items.push({...q.items[1],id:'bad',scope:'p2',source:'madeUp(l)=2'});q.activeScope='p1';expect(()=>compileRecognition(q)).not.toThrow();expect(checkRecognitionScopes(q).some(i=>i.itemId==='bad')).toBe(true);
 });
});
