import {describe,it,expect} from 'vitest';
import {newDrawing} from '../types';
import {resolveGeometry,validateDrawing} from '../geometry';
import {applyDefinition,normalizeDrawing} from '../model';
import {conicCoefficients,conicFeatureEquation,conicVertices} from '../conics';
import {addLessonInput} from './planarLesson';
import {planarContext,objectSymbol,applyValues} from './planarModel';
import {solveConstraints} from './solver';
const line=(source:string,x:number,y:number)=>{const q=conicCoefficients(source)!;return q[3]*x+q[4]*y+q[5];};
describe('conic companion objects and equation lines',()=>{
 it.each([['x^2/25+y^2/9=1',1,-25/4,0],['x^2/25+y^2/9=1',2,25/4,0],['y^2/25-x^2/9=1',1,0,-25/Math.sqrt(34)],['y^2/25-x^2/9=1',2,0,25/Math.sqrt(34)],['y^2=8*x',1,-2,0],['x^2=8*y',1,0,-2],['(y-3)^2=8*(x-2)',1,0,3]] as const)('constructs the directrix of %s (%s)',(s,i,x,y)=>{expect(line(conicFeatureEquation(s,'directrix',i-1),x,y)).toBeCloseTo(0,8);});
 it('constructs both translated hyperbola asymptotes',()=>{for(const i of [0,1]){const s=conicFeatureEquation('(x-2)^2/9-(y+1)^2/4=1','asymptote',i);expect(line(s,2,-1)).toBeCloseTo(0,8);expect(Math.min(Math.abs(line(s,5,1)),Math.abs(line(s,5,-3)))).toBeLessThan(1e-8);}expect(()=>conicFeatureEquation('x^2/9+y^2/4=1','asymptote',0)).toThrow(/双曲线/);});
 it('retains dependencies through parameter updates and file reload',()=>{const a=addLessonInput(planarContext(newDrawing()),'双曲线 C x\nF_1=Focus(C,1)\nF_2=Focus(C,2)\nd_1=Directrix(C,1)\nd_2=Directrix(C,2)\nl_1=Asymptote(C,1)\nl_2=Asymptote(C,2)');const values=Object.fromEntries(a.context.unknowns.map(u=>[u.id,u===a.context.unknowns[0]?3:4]));const d=applyValues(a.context,values);validateDrawing(d);const reopened=normalizeDrawing(JSON.parse(JSON.stringify(d))),g=resolveGeometry(reopened);expect(g.errors.size).toBe(0);const named=(n:string)=>reopened.objects.find(o=>objectSymbol(o)===n)!;expect(g.points.get(named('F_2').id)!.p[0]).toBeCloseTo(5);expect(line(g.curves.get(named('d_2').id)!.equation,9/5,0)).toBeCloseTo(0);expect(line(g.curves.get(named('l_1').id)!.equation,3,4)*line(g.curves.get(named('l_2').id)!.equation,3,4)).toBeCloseTo(0);});
 it('solves unknown conic parameters with companion curves present',()=>{const a=addLessonInput(planarContext(newDrawing()),'椭圆 C x\nF=Focus(C,2)\nd=Directrix(C,2)\nM=(1,3/2)\nonCurve(M,C)\nMF⊥x轴');const r=solveConstraints({id:1,problem:{mode:'coordinate',points:a.points,segments:[],conditions:a.conditions,planar:a.context},budget:3000});expect(r.branches.length).toBeGreaterThan(0);expect(Object.values(r.branches[0].values!)[0]).toBeCloseTo(2,6);});
 it.each(['2x+3y-6=0','y=2x+1','x=3'])('accepts a straight equation %s',eq=>{const a=addLessonInput(planarContext(newDrawing()),`直线 l: ${eq}`);expect(resolveGeometry(a.context.document).errors.size).toBe(0);expect(a.context.document.objects.some(o=>o.symbol==='l')).toBe(true);});
 it.each(['x^2+y^2=1','0=0','x=x'])('rejects non-lines %s',eq=>{expect(()=>addLessonInput(planarContext(newDrawing()),`直线 l: ${eq}`)).toThrow();});
 it('keeps directrices accessible from normal object definitions',()=>{let d=applyDefinition(newDrawing(),'C: x^2/25+y^2/9=1');d=applyDefinition(d,'d=Directrix(C,2)');expect(resolveGeometry(d).errors.size).toBe(0);});
});

describe('conic vertices',()=>{
 it('orders all four ellipse endpoints on major and minor axes',()=>{const expected=[[-5,0],[5,0],[0,-3],[0,3]],points=conicVertices('x^2/25+y^2/9=1');points.forEach((p,i)=>p.forEach((v,j)=>expect(v).toBeCloseTo(expected[i][j],8)));const vertical=conicVertices('x^2/9+y^2/25=1');expect(vertical[0][1]).toBeCloseTo(-5);expect(vertical[2][0]).toBeCloseTo(-3);});
 it('provides only real hyperbola vertices and the single parabola vertex',()=>{const h=conicVertices('(y-2)^2/9-(x+1)^2/4=1');expect(h).toHaveLength(2);expect(h[0][0]).toBeCloseTo(-1);expect(h[0][1]).toBeCloseTo(-1);const p=conicVertices('(y-3)^2=8*(x-2)');expect(p).toHaveLength(1);expect(p[0][0]).toBeCloseTo(2);expect(p[0][1]).toBeCloseTo(3);});
 it('retains live vertex dependencies and file round trips',()=>{const a=addLessonInput(planarContext(newDrawing()),'椭圆 C x\nV_1=Vertex(C,1)\nV_4=Vertex(C,4)');const d=applyValues(a.context,Object.fromEntries(a.context.unknowns.map((u,i)=>[u.id,i===0?5:3])));const reopened=normalizeDrawing(JSON.parse(JSON.stringify(d)));validateDrawing(reopened);const g=resolveGeometry(reopened);expect(g.errors.size).toBe(0);const vertex=(s:string)=>g.points.get(reopened.objects.find(o=>o.symbol===s)!.id)!.p;expect(vertex('V_1')[0]).toBeCloseTo(-5);expect(vertex('V_4')[1]).toBeCloseTo(3);});
});
