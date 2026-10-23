import { parseExpression,evaluate } from '../expression';
import { entity,normalizeConditionNotation } from './input';
import type { Positions } from './types';
import { sub,norm,dot } from './math';

/** Unmarked geometric expressions are scalar lengths and angles, never vectors. */
export function scalarRelation(source:string,names:string[]) {
  const measures:{name:string;points:string[];angle:boolean}[]=[];
  const measure=(points:string[],angle=false)=>{
    const name=`measure_${measures.length}`;measures.push({name,points,angle});return name;
  };
  let prepared=normalizeConditionNotation(source,names).replace(/＝/g,'=').replace(/⋅/g,'*');
  prepared=prepared.replace(/\bangle\s*\(([^)]+)\)/gi,(_,s:string)=>{
    const points=entity(s,names);if(points.length!==3)throw Error('角需要三个点');return measure(points,true);
  });
  prepared=prepared.replace(/(?<![\\A-Za-z_])[A-Za-z][A-Za-z0-9_]*/g,(token,offset:number)=>{
    if(token.startsWith('measure_')||/^\s*\(/.test(prepared.slice(offset+token.length))||['pi','e'].includes(token))return token;
    const points=entity(token,names);if(points.length!==2)throw Error(`“${token}”不是长度或角`);return measure(points);
  });
  // Geometric angle values are degrees; trigonometric functions consume radians.
  prepared=prepared.replace(/\b(sin|cos|tan)\s*\(\s*(measure_\d+)\s*\)/g,'$1($2*pi/180)');
  const parts=prepared.split('=');if(parts.length!==2||parts.some(s=>!s.trim())||!measures.length)throw Error('请输入长度或角的等式');
  const ast=parts.map(s=>parseExpression(s,measures.map(m=>m.name))),refs=[...new Set(measures.flatMap(m=>m.points))].map(n=>[n]);
  return {refs,residual:(positions:Positions)=>{
    const scope=Object.fromEntries(measures.map(m=>{
      const ps=m.points.map(n=>positions[n]);if(ps.some(p=>!p))throw Error('条件引用的点不存在');
      if(!m.angle)return [m.name,norm(sub(ps[1],ps[0]))];
      const u=sub(ps[0],ps[1]),v=sub(ps[2],ps[1]),den=norm(u)*norm(v);
      if(den<1e-16)throw Error('角的边退化');
      return [m.name,Math.acos(Math.max(-1,Math.min(1,dot(u,v)/den)))*180/Math.PI];
    }));
    const [a,b]=ast.map(a=>evaluate(a,scope));if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('长度或角表达式无效');
    return (a-b)/Math.max(1,Math.abs(a),Math.abs(b));
  }};
}
