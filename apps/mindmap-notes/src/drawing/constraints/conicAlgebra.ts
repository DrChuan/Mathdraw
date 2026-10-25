import {equation,parseExpression} from '../expression';
type Ast=ReturnType<typeof parseExpression>;
type Polynomial=Map<string,string>;
const operation=(a:string,op:string,b:string):string=>{
 if(op==='+'&&a==='0')return b;if(op==='+'&&b==='0'||op==='-'&&b==='0')return a;
 if(op==='-'&&a===b)return '0';if(op==='*'&&(a==='0'||b==='0'))return '0';
 if(op==='*'&&a==='1')return b;if((op==='*'||op==='/')&&b==='1')return a;
 if(op==='/'&&a==='0')return '0';
 if(/^-?\d+$/.test(a)&&/^-?\d+$/.test(b)&&['+','-','*'].includes(op)){const x=Number(a),y=Number(b),v=op==='+'?x+y:op==='-'?x-y:x*y;if(Number.isSafeInteger(v))return String(v);}
 return `(${a})${op}(${b})`;
};
const add=(a:Polynomial,b:Polynomial,subtract=false)=>{const out=new Map(a);for(const [k,v]of b)out.set(k,operation(out.get(k)??'0',subtract?'-':'+',v));return out;};
const multiply=(a:Polynomial,b:Polynomial)=>{const out:Polynomial=new Map();for(const [ka,va]of a)for(const [kb,vb]of b){if(va==='0'||vb==='0')continue;const pa=ka.split(',').map(Number),pb=kb.split(',').map(Number),x=pa[0]+pb[0],y=pa[1]+pb[1];if(x+y>2)throw Error('仅支持二次曲线');const key=`${x},${y}`;out.set(key,operation(out.get(key)??'0','+',operation(va,'*',vb)));}return out;};
/** Extract symbolic coefficients without evaluating unknowns at their initial
 * values. Translation, xy terms, equation scaling and rational parameters stay. */
export function symbolicConicCoefficients(source:string,variables:string[]):string[]{
 const constant=(s:string):Polynomial=>new Map([['0,0',s]]),zero=(p:Polynomial)=>[...p].every(([key,value])=>key==='0,0'||value==='0');
 const walk=(a:Ast):Polynomial=>{
  if(a.type==='number')return constant(a.constant??a.literal??String(a.value));
  if(a.type==='variable')return ['x','y','u','v'].includes(a.name)?new Map([[['x','u'].includes(a.name)?'1,0':'0,1','1']]):constant(a.name);
  if(a.type==='unary')return a.sign===1?walk(a.value):new Map([...walk(a.value)].map(([k,v])=>[k,operation('0','-',v)]));
  if(a.type==='call'){const args=a.args.map(walk);if(!args.every(zero))throw Error('曲线含非二次坐标函数');return constant(`${a.name}(${args.map(p=>p.get('0,0')??'0').join(',')})`);}
  const l=walk(a.left),r=walk(a.right);
  if(a.op==='+'||a.op==='-')return add(l,r,a.op==='-');
  if(a.op==='*')return multiply(l,r);
  if(a.op==='/'){if(!zero(r))throw Error('分母含坐标变量');return new Map([...l].map(([k,v])=>[k,operation(v,'/',r.get('0,0')??'0')]));}
  if(!zero(r))throw Error('指数含坐标变量');const n=r.get('0,0')??'0';
  if(zero(l))return constant(operation(l.get('0,0')??'0','^',n));
  if(n==='0')return constant('1');if(n==='1')return l;if(n==='2')return multiply(l,l);throw Error('曲线次数超过二次');
 };
 const parsed=equation(source,variables);let p=walk(parsed.ast);
 if(parsed.type!=='implicit')p=add(p,new Map([[parsed.type==='y'?'0,1':'1,0','1']]),true);
 return ['2,0','1,1','0,2','1,0','0,1','0,0'].map(k=>p.get(k)??'0');
}
/** Rotation-invariant eccentricity equations for every real nondegenerate conic.
 * The sign guards retain the real ellipse / transverse hyperbola / parabola,
 * excluding imaginary ellipses, degenerate pairs and roots introduced by squaring. */
export function eccentricityEquations(source:string,value:string,variables:string[]):string[]{
 const [A,B,C,D,E,F]=symbolicConicCoefficients(source,variables),op=operation,square=(s:string)=>op(s,'*',s),trace=op(A,'+',C),det=op(op(A,'*',C),'-',op(square(B),'/','4'));
 const g=op(op(op(C,'*',square(D)),'-',op(op(B,'*',D),'*',E)),'+',op(op(A,'*',square(E)),'-',op(op('4','*',det),'*',F)));
 const r=square(value),factor=op('2','-',r);
 const rows=[`${op(det,'*',square(factor))}=${op(square(trace),'*',op('1','-',r))}`,`${value}>=0`,`${op(square(trace),'+',square(det))}>0`,`${square(g)}>0`,`${op(op(g,'*',trace),'*',factor)}>=0`];
 if(rows.some(s=>s.length>30000))throw Error('圆锥曲线表达式过于复杂，暂未完成精确展开');return rows;
}
