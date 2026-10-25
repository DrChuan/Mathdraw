import {describe,it,expect} from 'vitest';
import {createTextDraft} from './pipeline';
import {repairRecognitionSymbols} from './symbols';
import {compileRecognition} from './model';
import type {RecognitionItem} from './types';
const row=(id:string,source:string,scope='common',quote=''):RecognitionItem=>({id,source,scope,quote,text:quote||source,role:'definition',enabled:true,necessary:true,regions:['r1']});
const make=(items:RecognitionItem[],points='T')=>({...createTextDraft({image:'data:image/png;base64,AAAA',width:100,height:100}),textOnly:false,points,scopes:[{id:'common',label:'公共'},{id:'p2',label:'(2)',parent:'common'},{id:'p3',label:'(3)',parent:'common'}],activeScope:'p2',regions:[{id:'r1',text:'题干',box:[0,0,100,100] as [number,number,number,number]}],items});
describe('local helper symbol allocation after recognition',()=>{
 it('keeps ellipse b and renames a line intercept with all its local references',()=>{
  const q=make([row('ellipse','a=?\nb=?\nc: x^2/a^2+y^2/b^2=1','common','椭圆 $x^2/a^2+y^2/b^2=1$'),{...row('line','k=?\nb=?\nl: y=k*x+b\nT=(0,-2)\nonLine(T,l)','p2','过点 (0,-2) 的直线 l'),role:'condition'}]);
  const next=repairRecognitionSymbols(q);expect(next.items[0].source).toContain('y^2/b^2');expect(next.items[1].source).toContain('b_1=?');expect(next.items[1].source).toContain('y=k*x+b_1');expect(next.items[1].quote).toBe(q.items[1].quote);expect(next.items[1].symbolRenames).toEqual([{from:'b',to:'b_1'}]);expect(()=>compileRecognition(next)).not.toThrow();expect(repairRecognitionSymbols(next)).toEqual(next);
 });
 it('accounts for implicitly introduced coefficients and preserves original formula references',()=>{
  const q=make([row('ellipse','c: x^2/a^2+y^2/b^2=1'),row('line','b=?\nl: y=x+b','p2'),{...row('original-bound','a>b','p2','$a>b$'),role:'condition'}]);const next=repairRecognitionSymbols(q);expect(next.items[1].source).toContain('b_1');expect(next.items[2].source).toBe('a>b');expect(q.items[1].source).toBe('b=?\nl: y=x+b');
 });
 it('propagates helper references within a scope while isolating sibling branches',()=>{const q=make([row('b','b=?','common','$b$'),row('h','b=?\nl:y=x+b','p2'),{...row('v','b=-2','p2'),role:'condition'},row('s','m:y=b*x','p3')]);const next=repairRecognitionSymbols(q);expect(next.items[2].source).toBe('b_1=-2');expect(next.items[3].source).toBe('m:y=b*x');});
 it('avoids existing points, future subscript names and reserved numeric names',()=>{const q=make([row('h','b=?\ne=?\nl:y=b*x+e','p2'),row('future','b_1=(1,2)','p3')],'b T b_1');const next=repairRecognitionSymbols(q);expect(next.items[0].source).toContain('b_2=?');expect(next.items[0].source).toContain('e_1=?');});
 it('does not rename point or curve arguments, commands, or explicit original symbols',()=>{const q=make([row('h','b=?\nl:y=b*x+x(b)+b(c)','p2')],'b T');const next=repairRecognitionSymbols(q);expect(next.items[0].source).toContain('y=b_1*x+x(b)+b(c)');});
 it('preserves equation axes and object declaration names while renaming helper coefficients',()=>{const q=make([row('h','x=?\nl=?\nl:y=x+l\nT=(l,2)','p2')]);const next=repairRecognitionSymbols(q);expect(next.items[0].source).toContain('x_1=?');expect(next.items[0].source).toContain('l_1=?');expect(next.items[0].source).toContain('l:y=x+l_1');expect(next.items[0].source).toContain('T=(l_1,2)');});
 it('merges explicit repeated question parameter declarations and preserves manual edits',()=>{const q=make([row('b','b=?','common','$b$'),row('repeat','b=?','p2','$b$'),{...row('manual','b=?\nl:y=x+b','p3'),modified:true}]);const next=repairRecognitionSymbols(q);expect(next.items[1].enabled).toBe(false);expect(next.items[2].source).toBe(q.items[2].source);});
 it('uses named relation argument roles for helper renaming',()=>{const q=make([row('b','b=?','common','$b$'),row('helper','b=?\nvectorDot(h,j,b)\ninclination(l,b)\nfocus(F,b,1)','p2')]);const next=repairRecognitionSymbols(q);expect(next.items[1].source).toContain('vectorDot(h,j,b_1)');expect(next.items[1].source).toContain('inclination(l,b_1)');expect(next.items[1].source).toContain('focus(F,b,1)');});

});
