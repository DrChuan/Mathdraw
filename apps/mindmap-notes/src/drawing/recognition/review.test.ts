import {describe,it,expect} from 'vitest';
import {parseExtraction,compileRecognition,extractionPrompt} from './model';
import {recognizedStatement,alignRecognitionClauses} from './review';
import type {RecognitionItem} from './types';
import {parseConditions,segmentsFrom,conditionExamples} from '../constraints/input';
import {constraintKinds} from '../constraints/types';
import {parsePlanarInput} from '../constraints/planarExpressions';
import {equationEnvironment} from '../constraints/planarExpressions';
import {solveConstraints} from '../constraints/solver';
const item=(source:string,quote='',role:RecognitionItem['role']='condition'):RecognitionItem=>({id:source,role,source,text:'模型说明不代表编译结果',quote,scope:'common',regions:['r1'],enabled:true,necessary:role!=='goal'});
const make=(items:RecognitionItem[],points='A B C D',mode='coordinate')=>parseExtraction(JSON.stringify({mode,points,segments:'',items,scopes:[{id:'common',label:'公共'}],paragraphs:[{text:'题干。',regions:['r1']}],warnings:[]}),{image:'data:image/png;base64,AAAA',width:1000,height:300,regions:[{id:'r1',text:'题干',box:[0,0,1000,300]}]});
describe('recognition grammar and readable correspondence',()=>{
 it('compiles nested triangle area as geometry and renders a readable condition',()=>{
  const names=['O','A','B'],source='area(Triangle(O,A,B)) = sqrt(2)';
  expect(parseConditions(source,names)[0]).toMatchObject({kind:'area',refs:[names],value:Math.SQRT2});
  expect(recognizedStatement(item(source),names)).toContain('三角形');expect(recognizedStatement(item(source),names)).not.toContain('area(');
  const q=make([item('O=(0,0)','','definition'),item('A=(1,0)','','definition'),item('B=(0,2*sqrt(2))','','definition'),item(source)],names.join(' '));const c=compileRecognition(q);
  expect(c.planar!.equations).toHaveLength(2); // The explicit built-in origin uses two coordinate equations.
  const result=solveConstraints({id:1,budget:1000,problem:{mode:'coordinate',points:names,segments:segmentsFrom(c.segments,names),conditions:c.conditions.flatMap(row=>parseConditions(row.source,names,row.id)),planar:c.planar}});
  expect(result.branches.length,result.diagnostics.join('\n')).toBeGreaterThan(0);
 });
 it('accepts typed references generally and preserves useful errors for invalid geometry',()=>{
  const names=['A','B','C','D','E','F'];
  expect(parseConditions('area(Polygon(A,B,C,D))=6',names)[0].refs).toEqual([names.slice(0,4)]);
  expect(parseConditions('circumradius(Triangle(A,B,C))=2',names)[0].kind).toBe('circumradius');
  expect(parseConditions('perpendicular(Line(A,B),Plane(C,D,E))',names)[0].refs).toEqual([['A','B'],['C','D','E']]);
  expect(()=>parsePlanarInput('area(Triangle(A,B))=2',names)).toThrow('顶点数量');
  expect(()=>parsePlanarInput('area(UnknownShape(A,B,C))=2',names)).toThrow('图形引用');
 });
 it('uses parser condition examples in the extraction contract',()=>{for(const kind of constraintKinds)expect(extractionPrompt).toContain(conditionExamples[kind]);expect(extractionPrompt).not.toContain('L=Intersect(c,l,1)');});
 it('splits one sentence into written relationship clauses without copying its source box',()=>{const original='已知 $AB=2$，$CD=3$';const rows=alignRecognitionClauses([item('AB=2\nCD=3',original)],['A','B','C','D']);expect(rows.map(r=>r.quote)).toEqual(['已知 $AB=2$','$CD=3$']);expect(rows.map(r=>r.source)).toEqual(['AB=2','CD=3']);});
 it('does not guess a clause when the same references appear in multiple relations',()=>{const rows=alignRecognitionClauses([item('AB=CD','已知 AB 与 CD 垂直，且 AB 与 CD 等长')],['A','B','C','D']);expect(rows[0].sharedQuote).toBe(true);});
 it('shows actual parsed relationships instead of repeating the whole model prose',()=>{expect(recognizedStatement(item('perpendicular(AB,CD)'),['A','B','C','D'])).toContain('\\perp');expect(recognizedStatement(item('regularPolygon(A,B,C)'),['A','B','C'])).toContain('正三');});
 it('blocks invalid relation arity and unknown functions even when their text looks valid',()=>{for(const source of ['onCurve(A)','perpendicular(A,B,C)','vertex(A,c)=1','unrecognized(2)=1','x(Missing)=2'])expect(()=>compileRecognition(make([item('c: x^2+y^2=4','','definition'),item(source)]))).toThrow();});
 it('keeps a compound literal relationship in one item when its original phrase is indivisible',()=>{const q=make([item('onCurve(A B C,O)\nregularPolygon(A,B,C)','ABC是圆O的内接正三角形')],'A B C O','spatial');expect(q.items).toHaveLength(1);expect(q.items[0].source.split('\n')).toHaveLength(2);});
 it('keeps degree and radian meanings consistent for named-line angles',()=>{const q=make([item('l: x=0','','definition'),item('s: y=x','','definition'),item('lineAngle(l,s,pi/4)')]);const c=compileRecognition(q),env=equationEnvironment(c.planar!.document);for(const angle of ['45','pi/4','rad(pi/4)'])expect(Math.abs(env.residual(`lineAngle(l,s,${angle})`)[0])).toBeLessThan(1e-10);});
 it('sorts bundled definitions before their dependent curve without re-declaring implicit variables',()=>{const q=make([item('c: x^2/a^2-y^2/b^2=1\na=?\nb=?\na>0\nb>0','','definition')],'A');const c=compileRecognition(q);expect(c.planar!.unknowns.filter(u=>u.field==='value')).toHaveLength(2);});
 it('compiles hyperbola foci, vertices, diameter circle, asymptote and both intersections',()=>{
  const definitions=['a=?','b=?','C: x^2/a^2-y^2/b^2=1','F_1=Focus(C,1)','F_2=Focus(C,2)','A_1=Vertex(C,1)','A_2=Vertex(C,2)','d=DiameterCircle(F_1,F_2)','l=Asymptote(C,1)','M,N=Intersect(d,l)'];
  const q=make([...definitions.map(s=>item(s,'','definition')),...['a>0','b>0','angle(N,A_1,M)=5*pi/6'].map(s=>item(s))],'F_1 F_2 A_1 A_2 M N');
  const c=compileRecognition(q),names=c.points.split(' ');expect(c.segments).toContain('N A_1');expect(c.segments).toContain('A_1 M');expect(c.planar!.document.objects.filter(o=>o.kind==='point'&&['M','N'].includes(o.symbol??''))).toHaveLength(2);
  const r=solveConstraints({id:1,budget:5000,problem:{mode:'coordinate',points:names,segments:segmentsFrom(c.segments,names),conditions:c.conditions.flatMap(row=>parseConditions(row.source,names,row.id)),planar:c.planar}});
  expect(r.branches.length,r.diagnostics.join('\n')).toBeGreaterThan(0);
 },10000);
});
