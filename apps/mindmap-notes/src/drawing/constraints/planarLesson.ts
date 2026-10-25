import {splitArguments} from '../model';
import {isVariableSymbol,numericFunctions} from '../symbols';
import type { PlanarContext,Condition,ConstraintCurve } from './types';
import { addPlanarDefinition,contextPoints,objectSymbol } from './planarModel';
import { parsePlanarInput } from './planarExpressions';
import { entity } from './input';
import { pointObject,resolveGeometry } from '../geometry';
import { conicCoefficients } from '../conics';

/** Transactional teacher input: definitions and conditions share one ordered list.
 * Templates introduce unknowns, never values inferred from the requested conclusion. */
export function addLessonInput(context:PlanarContext,source:string,points:string[]=contextPoints(context),curves:ConstraintCurve[]=[]){
  let next=structuredClone(context);const conditions:Condition[]=[];
  const add=(s:string)=>{const before=new Set(next.document.objects.map(o=>o.id));next=addPlanarDefinition(next,s);const created=new Set(next.document.objects.filter(o=>o.kind==='curve'&&!before.has(o.id)).map(o=>o.id));for(const o of next.document.objects)if(o.kind==='curve'&&created.has(o.id))o.autoFoci=false;next.document.objects=next.document.objects.filter(o=>!(o.kind==='point'&&['focus','curveCenter'].includes(o.construction.type)&&'curve'in o.construction&&created.has(o.construction.curve)&&!before.has(o.id)));};
  const equation=(s:string)=>next.equations.push({id:crypto.randomUUID(),source:s,enabled:true});
  const unknown=(name:string,initial:number)=>{add(`${name}=?`);const u=next.unknowns.at(-1)!;u.initial=initial;const o=next.document.objects.find(o=>o.id===u.object)!;if(o.kind==='number'){o.value=initial;o.expression=String(initial);o.hidden=true;}};
  const rows=source.split(/[\n;；]+/).map(s=>s.trim().replace(/＝/g,'=')).filter(s=>s&&!s.startsWith('#'));
  if(!rows.length)throw Error('请先录入题目条件');
  if(rows.length>200)throw Error('一次最多录入 200 行');
  for(const [index,row]of rows.entries())try{
    const lineEquation=row.match(/^直线\s+([A-Za-z][A-Za-z0-9_]*)\s*[:：](.+)$/);
    const conic=row.match(/^(椭圆|双曲线|抛物线)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+([xy]))?(?:\s+参数\s+([A-Za-z][A-Za-z0-9_]*),([A-Za-z][A-Za-z0-9_]*),([A-Za-z][A-Za-z0-9_]*),([A-Za-z][A-Za-z0-9_]*))?$/);
    const distinct=row.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:!=|≠)\s*([A-Za-z][A-Za-z0-9_]*)$/);
    const diameterCircle=row.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*DiameterCircle\(\s*([A-Za-z][A-Za-z0-9_]*)\s*,\s*([A-Za-z][A-Za-z0-9_]*)\s*\)$/);
    const pair=row.match(/^([A-Za-z][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z][A-Za-z0-9_]*))?\s*=\s*(?:交点|Intersect)\(([^,]+),([^,)]+)\)$/i);
    const axisRelation=row.match(/^(.+?)\s*(⊥|∥|\/\/)\s*([xy])轴$/);
    const focus=row.match(/^([A-Za-z][A-Za-z0-9_]*)[是为]([A-Za-z][A-Za-z0-9_]*)的(左|右|上|下)焦点$/);
    const incidence=row.match(/^([A-Za-z][A-Za-z0-9_]*)在([A-Za-z][A-Za-z0-9_]*)上$/);
    const through=row.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*过点直线\(([^)]+)\)$/);
    if(distinct){const [,a,b]=distinct;if(a===b||![a,b].every(n=>points.includes(n)||contextPoints(next).includes(n)))throw Error('互异关系需要两个已声明的不同点');equation(`(x(${a})-x(${b}))^2+(y(${a})-y(${b}))^2>0`);}
    else if(diameterCircle){const [,name,a,b]=diameterCircle;const names=[...new Set([...points,...contextPoints(next)])];if(a===b||!names.includes(a)||!names.includes(b))throw Error('直径圆需要两个不同的已声明点');add(`${name}: (x-x(${a}))*(x-x(${b}))+(y-y(${a}))*(y-y(${b}))=0`);}
    else if(lineEquation){const [,name,body]=lineEquation;add(`${name}: ${body}`);const o=next.document.objects.find(o=>objectSymbol(o)===name)!;const curve=resolveGeometry(next.document).curves.get(o.id),q=curve&&conicCoefficients(curve.equation);if(!q||Math.hypot(q[0],q[1],q[2])>1e-12||Math.hypot(q[3],q[4])<1e-12)throw Error('请输入有效的一次直线方程，例如 y=2*x+1 或 x=3');}
    else if(axisRelation){const [,edge,relation,axis]=axisRelation;const ends=entity(edge,[...new Set([...points,...contextPoints(next)])]);if(ends.length!==2)throw Error('请填写两个端点，例如 MF⊥x轴');const coordinate=(relation==='⊥')===(axis==='x')?'x':'y';equation(`${coordinate}(${ends[0]})=${coordinate}(${ends[1]})`);}
    else if(focus){const [,p,c,side]=focus,index=['右','上'].includes(side)?2:1;if(next.document.objects.some(o=>objectSymbol(o)===p))equation(`focus(${p},${c},${index})`);else add(`${p}=Focus(${c},${index})`);}
    else if(incidence)equation(`onCurve(${incidence[1]},${incidence[2]})`);
    else if(conic){const [,kind,name,axis,pa,pb,pc,pe]=conic,a=pa??`${name}_a`,b=pb??`${name}_b`,p=pa??`${name}_p`,c=pc??`${name}_c`,e=pe??`${name}_e`;
      if(kind==='抛物线'){unknown(p,1);add(`${name}: ${axis==='y'?'x^2':'y^2'}=2*${p}*${axis==='y'?'y':'x'}`);equation(`${p}>0`);add(`${e}=1`);}
      else{unknown(a,2);unknown(b,1);const x=axis==='y'?'y':'x',y=axis==='y'?'x':'y';add(`${name}: ${x}^2/${a}^2${kind==='椭圆'?'+':'-'}${y}^2/${b}^2=1`);equation(`${a}>0`);equation(`${b}>0`);if(kind==='椭圆'&&axis)equation(`${a}>${b}`);add(`${c}=sqrt(${kind==='椭圆'?`abs(${a}^2-${b}^2)`:`${a}^2+${b}^2`})`);add(`${e}=${c}/${kind==='椭圆'&&!axis?`max(${a},${b})`:a}`);}
    }else if(pair){const [,a,b,first,second]=pair,refs=[first,second].map(n=>{const o=next.document.objects.find(o=>objectSymbol(o)===n.trim());if(!o||!['line','segment','vector','curve'].includes(o.kind))throw Error(`找不到线或曲线 ${n}`);return o.id;});
      for(const [branch,name]of [a,b].filter(Boolean).entries()){if(next.document.objects.some(o=>objectSymbol(o)===name))throw Error(`符号 ${name} 已被使用`);next.document.objects.push({...pointObject(name,[0,0,0]),symbol:name,construction:{type:'intersection',first:refs[0],second:refs[1],branch}});}
      // Two named crossings must be distinct, even at tangency.
      if(b)equation(`(x(${a})-x(${b}))^2+(y(${a})-y(${b}))^2>0`);
    }else if(through){const [,name,p]=through,t=`${name}_t`;unknown(t,-.15);add(`${name}: cos(${t})*(y-y(${p}))-sin(${t})*(x-x(${p}))=0`);}
    else if(/^[A-Za-z][A-Za-z0-9_]*\s*[:：]/.test(row)||/^[A-Za-z][A-Za-z0-9_]*\s*=\s*\?$/.test(row)||(()=>{const body=row.match(/^[A-Za-z][A-Za-z0-9_]*\s*=\s*(\(.*\))$/)?.[1];return !!body&&[2,3].includes(splitArguments(body.slice(1,-1)).length);})()||(()=>{const fn=row.match(/^[A-Za-z][A-Za-z0-9_]*\s*=\s*([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff]*)\(/)?.[1];const name=row.match(/^([A-Za-z][A-Za-z0-9_]*)/)?.[1];return !!fn&&!numericFunctions.has(fn.toLowerCase())&&!next.document.objects.some(o=>o.kind==='number'&&objectSymbol(o)===name);})())add(row);
    else if(/^([A-Za-z][A-Za-z0-9_]*)\s*=/.test(row)&&(()=>{const n=row.match(/^([A-Za-z][A-Za-z0-9_]*)/)![1];return (isVariableSymbol(n)||n==='e')&&!next.document.objects.some(o=>objectSymbol(o)===n)&&!points.includes(n);})())add(row);
    else if(/^vectorRelation\s*\(/.test(row))equation(row);
    else{const parsed=parsePlanarInput(row,[...new Set([...points,...contextPoints(next)])],curves);conditions.push(...parsed.conditions);next.equations.push(...parsed.equations);}
  }catch(e){throw Error(`第 ${index+1} 行「${row}」：${(e as Error).message}`);}
  if(next.equations.length+conditions.length>200)throw Error('最多支持 200 条条件');
  next.automaticSearch=true;
  return {context:next,conditions,points:[...new Set([...points,...contextPoints(next)])]};
}
