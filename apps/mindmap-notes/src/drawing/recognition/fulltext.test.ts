import {describe,it,expect} from 'vitest';
import katex from 'katex';
import {formatQuestionMath,questionMathWarnings} from './fulltext';
import {ocrTextDocument} from './pipeline';
import {parseExtraction,quoteInText} from './model';

const sample=String.raw`已知椭圆 $\Gamma$: $\frac{x^2}{a^2}+\frac{y^2}{b^2}=1$ ($a>b>0$) 的离心率为 $\frac{1}{2}$，短轴长为 2√3.
(1) 求椭圆 Γ 的方程.
(2)设A,B,C三点均为椭圆Γ上的动点.
(i)若直线AC、直线BC分别过Γ的左、右焦点，记直线 AC, AB, BC 的斜率分别为 k1,k2,k3，当 k1,k2,k3 成等差数列时，求点 C 的坐标；
成等差数列时，求点C的坐标；
(ii)若△ABC的重心是坐标原点O,证明:△ABC的面积是定值.`;
const image={image:'data:image/png;base64,AAAA',width:1000,height:200};
describe('recognized full problem text uses consistent LaTeX',()=>{
 it('formats the reported mixture without removing or rewriting problem text',()=>{
  const text=formatQuestionMath(sample);
  for(const math of ['$2\\sqrt{3}$','$A,B,C$','$\\Gamma$','$AC$','$k_{1},k_{2},k_{3}$','$\\triangle ABC$','$O$'])expect(text).toContain(math);
  for(const label of ['(1)','(2)','(i)','(ii)'])expect(text).toContain(label);
  expect(text.match(/成等差数列时/g)).toHaveLength(2); // Formatting is not content deduplication.
  expect(formatQuestionMath(text)).toBe(text);
  expect(questionMathWarnings(text)).toEqual([]);
  for(const match of text.matchAll(/\$([^$]+)\$/g))expect(()=>katex.renderToString(match[1],{throwOnError:true})).not.toThrow();
  const prose=text.replace(/\$[^$]+\$/g,'').replace(/\((?:\d+|[ivx]+)\)/g,'');
  expect(prose).not.toMatch(/[A-Za-zΓ√△]/);
 });
 it.each([
  ['设F_1、F_2为焦点，∠NA_1M=5π/6。','设$F_{1}$、$F_{2}$为焦点，$\\angle NA_{1}M=5\\pi /6$。'],
  ['短轴长为sqrt(3)，向量为\\vec{AB}。','短轴长为$\\sqrt{3}$，向量为$\\vec{AB}$。'],
  ['由x²+y²=1及a₁>0得AB⊥CD。','由$x^{2}+y^{2}=1$及$a_{1}>0$得$AB\\perp CD$。'],
  ['过点(0,-2)，倾斜角为30°，值为1+2。','过点$(0,-2)$，倾斜角为$30^{\\circ}$，值为$1+2$。'],
  [String.raw`已知 \(A=(1,2)\)，\[y=√(x+1)\]。`,'已知 $A=(1,2)$，$$y=\\sqrt{x+1}$$。'],
 ])('normalizes notation: %s',(raw,want)=>{const text=formatQuestionMath(raw);expect(text).toBe(want);expect(formatQuestionMath(text)).toBe(text);});
 it('preserves prose, labels, code, links and already correct math',()=>{
  const text='18. 已知 $A_1=(2,0)$。\n(1) 求证。\n(ii) 证明。\nA.1 B.2\nMarkdown 与 LaTeX，`A=(9,9)` [链接](https://example.com/A) https://example.com/ABC';
  expect(formatQuestionMath(text)).toBe('18. 已知 $A_{1}=(2,0)$。\n(1) 求证。\n(ii) 证明。\nA.1 B.2\nMarkdown 与 LaTeX，`A=(9,9)` [链接](https://example.com/A) https://example.com/ABC');
 });
 it('does not silently complete unfinished LaTeX or infer a missing radical extent',()=>{
  expect(formatQuestionMath('设 $x+')).toBe('设 $x+');
  expect(formatQuestionMath('长为√3+1。')).toBe('长为$\\sqrt{3}+1$。');
  expect(formatQuestionMath('长为(x+1。')).toBe('长为(x+1。');
 });
 it('applies the same formatter to text-only and extracted fulltext, not executable source or measured OCR',()=>{
  const raw='点A在圆Γ上，长度为2√3。';
  const ocr={output:{choices:[{message:{content:[{ocr_result:{words_info:[{text:raw,rotate_rect:[500,50,980,80,0]}]}}]}}]}};
  const text=ocrTextDocument(ocr,image);expect(text.originalText).toBe(formatQuestionMath(raw));expect(text.regions[0].text).toBe(raw);
  const q=parseExtraction(JSON.stringify({mode:'coordinate',points:'A',segments:'',scopes:[{id:'common',label:'公共'}],paragraphs:[{text:raw,regions:['r1']}],items:[{id:'a',role:'definition',text:'点A的坐标',source:'A=(1,2)',quote:'点A',scope:'common',regions:['r1'],enabled:true,necessary:true}],warnings:[]}),{...image,regions:text.regions});
  expect(q.originalText).toBe(text.originalText);expect(q.items[0].source).toBe('A=(1,2)');expect(q.items[0].quote).toBe('点A');
 });
 it('keeps provenance comparisons stable across formatting but still rejects changed values',()=>{
  expect(quoteInText('短轴长为2√3',formatQuestionMath('短轴长为2√3。'))).toBe(true);
  expect(quoteInText('k1,k2,k3',formatQuestionMath('斜率为k1,k2,k3。'))).toBe(true);
  expect(quoteInText('点Γ', '点 $\\Gamma$')).toBe(true);
  expect(quoteInText('2√3','长度为 $2\\sqrt{5}$')).toBe(false);
 });
 it('reports malformed formulas without pretending they were repaired',()=>{
  expect(questionMathWarnings('已知 $\\frac{1}$。')[0]).toContain('排版检查');
  expect(questionMathWarnings('已知 $x+')[0]).toContain('未闭合');
  expect(questionMathWarnings('`$源码`，已知 $\\sqrt{3}$')).toEqual([]);
 });
});
