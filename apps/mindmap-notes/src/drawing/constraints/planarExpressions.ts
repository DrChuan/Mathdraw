import {splitArguments} from '../model';
import type { DrawingDocument,Vec2 } from '../types';
import {constraintKinds,type Condition,type ConstraintCurve,type PlanarEquation} from './types';
import { resolveGeometry,toPlane } from '../geometry';
import { parseExpression,evaluate } from '../expression';
import { conicCoefficients,conicFoci,circleCenter } from '../conics';
import { curveFunction } from '../constructions';
import {planarRelationPattern,lateBoundPlanarCommands,namedAngleSyntaxHint} from './planarRelations';
import type { Quadratic } from '../quadratic';
import { parseConditions,entity } from './input';
import { coordinatePlane,objectSymbol } from './planarModel';

export function parsePlanarInput(source:string,names:string[],curves:ConstraintCurve[]=[]):{conditions:Condition[];equations:PlanarEquation[]} {
  namedAngleSyntaxHint(source);
  try{
    if(/\b(?:x|y|a|b|c|e|p|radius|eccentricity|focalDistance)\s*\(/.test(source))throw Error('坐标或曲线参数表达式');
    const conditions=parseConditions(source,names,undefined,curves);
    if(conditions.some(c=>c.kind==='vectorRelation')&&!/vectorRelation\s*\(|\bvec\s*\(|\\(?:vec|overrightarrow)\b/.test(source))throw Error('无向量标记的代数式按长度表达式处理');
    return {conditions,equations:[]};}
  catch(error) {
    // Geometric commands with invalid arguments are not arbitrary numerical
    // equations. Keep their real parser error instead of later reporting that
    // the letters in "area" are unsupported variables.
    const command=source.trim().match(/^([A-Za-z]+)\s*\(/)?.[1].toLowerCase();
    const lateBound=lateBoundPlanarCommands;
    if(command&&[...constraintKinds.map(k=>k.toLowerCase()),'midpoint','angle'].includes(command)&&!lateBound.has(command))throw error;
    if(!source.trim()||source.length>2048)throw Error('请输入有效条件（最多 2048 字符）');
    const normalized=source.replace(/＝/g,'=').replace(/\\(?:leq|le)\b|≤/g,'<=').replace(/\\(?:geq|ge)\b|≥/g,'>=');
    const parts=normalized.split(/(<=|>=|<|>|=)/);
    const sources=parts.length>3?parts.filter((_,i)=>i%2===0).slice(0,-1).map((s,i)=>`${s}${parts[2*i+1]}${parts[2*i+2]}`):[normalized];
    return {conditions:[],equations:sources.map(source=>({id:crypto.randomUUID(),source:source.trim(),enabled:true}))};
  }
}
export function equationEnvironment(doc:DrawingDocument) {
  const g=resolveGeometry(doc),plane=coordinatePlane(doc),objects=new Map(doc.objects.map(o=>[objectSymbol(o),o]));
  const object=(name:string)=>{const o=objects.get(name.trim());if(!o)throw Error(`找不到对象 ${name}`);return o;};
  const point=(name:string):Vec2=>{const o=object(name),p=g.points.get(o.id);if(!p)throw Error(`${name}：点定义失效`);return toPlane(plane,p.p);};
  const quadratic=(name:string):Quadratic=>{
    const o=objects.get(name.trim());if(!o){const refs=entity(name,pointNames);if(refs.length!==2)throw Error(`需要两个端点或命名直线：${name}`);const a=point(refs[0]),b=point(refs[1]);return [0,0,0,b[1]-a[1],a[0]-b[0],b[0]*a[1]-a[0]*b[1]];}if(o.kind==='curve'){const c=g.curves.get(o.id);if(!c||c.parametric)throw Error(`${name} 不是二次曲线`);const q=conicCoefficients(c.equation);if(!q)throw Error(`${name} 不是二次曲线`);return q;}
    const r=g.straightReference(o.id),a=toPlane(plane,r.a),b=toPlane(plane,r.b);return [0,0,0,b[1]-a[1],a[0]-b[0],b[0]*a[1]-a[0]*b[1]];
  };
  const line=(name:string)=>{const q=quadratic(name);if(Math.hypot(q[0],q[1],q[2])>1e-10)throw Error(`${name} 不是直线`);const n=Math.hypot(q[3],q[4]);if(n<1e-12)throw Error('直线退化');return q.map(v=>v/n) as Quadratic;};
  const pointNames=doc.objects.filter(o=>o.kind==='point').map(objectSymbol);
  const vector=(name:string):Vec2=>{const o=objects.get(name);if(o&&['line','segment','vector'].includes(o.kind)){const r=g.straightReference(o.id),a=toPlane(plane,r.a),b=toPlane(plane,r.b);return [b[0]-a[0],b[1]-a[1]];}const p=entity(name,pointNames);if(p.length!==2)throw Error('向量需要两个端点');const a=point(p[0]),b=point(p[1]);return [b[0]-a[0],b[1]-a[1]];};
  const properties=(name:string)=>{
    const [A,B,C,D,E,F]=quadratic(name),theta=.5*Math.atan2(B,A-C),c=Math.cos(theta),s=Math.sin(theta),delta=Math.hypot(A-C,B),l1=(A+C+delta)/2,l2=(A+C-delta)/2,d1=D*c+E*s,d2=-D*s+E*c;
    if(Math.abs(l1*l2)<1e-12){const curved=Math.abs(l1)>Math.abs(l2)?l1:l2,linear=Math.abs(l1)>Math.abs(l2)?d2:d1;return {a:NaN,b:NaN,c:NaN,e:1,p:Math.abs(linear/(2*curved)),r:NaN};}
    const k=-F+d1*d1/(4*l1)+d2*d2/(4*l2),r=[k/l1,k/l2],ellipse=l1*l2>0;
    const a=Math.sqrt(ellipse?Math.max(...r):r.find(v=>v>0)??NaN),b=Math.sqrt(ellipse?Math.min(...r):-(r.find(v=>v<0)??NaN)),f=Math.sqrt(ellipse?a*a-b*b:a*a+b*b);
    return {a,b,c:f,e:f/a,p:NaN,r:circleCenter(g.curves.get(object(name).id)?.equation??'')?a:NaN};
  };
  const scope:Record<string,number>={};for(const o of doc.objects)if(o.kind==='number')scope[objectSymbol(o)]=g.numbers.get(o.id)??o.value;
  const numeric=(raw:string)=>{
    let source=raw.replace(/\b([xy])\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,axis:string,n:string)=>`(${point(n)[axis==='x'?0:1]})`);
    source=source.replace(/\b(a|b|c|e|p|radius|eccentricity|focalDistance)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,prop:string,n:string)=>{const p=properties(n),key=({radius:'r',eccentricity:'e',focalDistance:'c'} as Record<string,string>)[prop]??prop;return `(${p[key as keyof typeof p]*(prop==='focalDistance'?2:1)})`;});
    source=source.replace(/\b(?:length|Length)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,name:string)=>{const o=objects.get(name);if(o&&!['segment','vector'].includes(o.kind))throw Error('长度需要线段或向量；无限直线没有长度');return `(${Math.hypot(...vector(name))})`;});
    source=source.replace(/\bdot\s*\(\s*([A-Za-z][A-Za-z0-9_]*),\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,a:string,b:string)=>{const u=vector(a),v=vector(b);return `(${u[0]*v[0]+u[1]*v[1]})`;});
    source=source.replace(/\b(sin|cos|tan)Angle\s*\(\s*([A-Za-z][A-Za-z0-9_]*),\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,fn:string,a:string,b:string)=>{const u=line(a),v=line(b),c=Math.min(1,Math.abs(u[3]*v[3]+u[4]*v[4])),s=Math.sqrt(Math.max(0,1-c*c));return `(${fn==='cos'?c:fn==='sin'?s:s/c})`;});
    source=source.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g,name=>{if(name in scope)return name;const o=objects.get(name);if(o){if(['segment','vector'].includes(o.kind))return `(${Math.hypot(...vector(name))})`;return name;}try{const p=entity(name,pointNames);if(p.length===2){const v=vector(name);return `(${Math.hypot(...v)})`;}}catch{/* It may be a numerical function. */}return name;});
    const ast=parseExpression(source,Object.keys(scope)),value=evaluate(ast,scope);if(!Number.isFinite(value)||Math.abs(value)>1e15)throw Error('表达式无定义或数值超限');return value;
  };
  const at=(p:Vec2,name:string)=>{const o=object(name);if(o.kind==='curve'){const c=g.curves.get(o.id);if(!c)throw Error(`曲线 ${name} 失效`);if(c.parametric)throw Error('参数曲线上的点请使用参数定义，不能按占位方程参与隐式求交');const f=curveFunction(c),v=f(...p),h=1e-5,gradient=Math.hypot((f(p[0]+h,p[1])-f(p[0]-h,p[1]))/(2*h),(f(p[0],p[1]+h)-f(p[0],p[1]-h))/(2*h));return v/Math.max(1,gradient);}
    const q=line(name);return q[3]*p[0]+q[4]*p[1]+q[5];};
  const bounds=(p:Vec2,name:string):number[]=>{
    const o=object(name);if(o.kind==='curve'){const c=g.curves.get(o.id),l=c?.limits;return [l?.xMin===undefined?0:Math.max(0,l.xMin-p[0]),l?.xMax===undefined?0:Math.max(0,p[0]-l.xMax),l?.yMin===undefined?0:Math.max(0,l.yMin-p[1]),l?.yMax===undefined?0:Math.max(0,p[1]-l.yMax)];}
    if(o.kind==='segment'||o.kind==='vector'||o.kind==='line'&&o.ray){const r=g.straightReference(o.id),a=toPlane(plane,r.a),b=toPlane(plane,r.b),d=[b[0]-a[0],b[1]-a[1]],t=((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/Math.max(1e-24,d[0]**2+d[1]**2);return [Math.max(0,-t),o.kind==='line'?0:Math.max(0,t-1),0,0];}return [0,0,0,0];
  };
  const residual=(raw:string):number[]=>{
    let source=raw.trim().replace(/^\$\$?([\s\S]*?)\$\$?$/,'$1').replace(/\\(?:perp|bot)\b|⊥/g,'⟂').replace(/\\parallel\b|∥/g,'//');
    const relation=source.match(/^(.+?)\s*(⟂|\/\/)\s*(.+)$/);if(relation)source=`${relation[2]==='⟂'?'perpendicular':'parallel'}(${relation[1]},${relation[3]})`;
    if(/^vectorRelation\s*\(/i.test(source)||/\bvec\s*\(|\\(?:vec|overrightarrow)\b/.test(source)){
      const body=source.replace(/^vectorRelation\s*\(([\s\S]*)\)$/i,'$1'),vectors:Record<string,Vec2>={};
      const prepare=(s:string)=>s.replace(/\b([xy])\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,axis:string,n:string)=>`(${point(n)[axis==='x'?0:1]})`).replace(/(?:vec\s*\(([^)]+)\)|\\(?:vec|overrightarrow)\s*\{([^{}]+)\})/g,(_,a:string,b:string)=>{const name=`vector_${Object.keys(vectors).length}`;vectors[name]=vector((a??b).trim());return name;});
      const parts=body.split('=');if(parts.length!==2)throw Error('向量关系需要一个等号');
      const parsed=parts.map(prepare),names=[...Object.keys(scope),...Object.keys(vectors)],walk=(ast:ReturnType<typeof parseExpression>):number|Vec2=>{
        if(ast.type==='number')return ast.value;if(ast.type==='variable')return vectors[ast.name]??scope[ast.name];
        if(ast.type==='unary'){const a=walk(ast.value);return typeof a==='number'?a*ast.sign:[a[0]*ast.sign,a[1]*ast.sign];}
        if(ast.type==='call')return evaluate(ast,scope);
        const a=walk(ast.left),b=walk(ast.right);if(typeof a==='number'&&typeof b==='number')return evaluate(ast,scope);
        if(ast.op==='+'||ast.op==='-'){if(typeof a==='number'||typeof b==='number')throw Error('向量只能与向量相加减');const sign=ast.op==='+'?1:-1;return[a[0]+sign*b[0],a[1]+sign*b[1]];}
        if(ast.op==='*'&&typeof a==='number'&&Array.isArray(b))return[a*b[0],a*b[1]];
        if((ast.op==='*'||ast.op==='/')&&typeof b==='number'&&Array.isArray(a)){const k=ast.op==='*'?b:1/b;return[a[0]*k,a[1]*k];}throw Error('向量仅支持线性数乘和加减');
      };
      const values=parsed.map(s=>walk(parseExpression(s,names))).map(v=>typeof v==='number'?v===0?[0,0] as Vec2:undefined:v);if(!values[0]||!values[1])throw Error('向量等式不能与非零标量相等');return [values[0][0]-values[1][0],values[0][1]-values[1][1]];
    }
    const call=source.match(planarRelationPattern);
    if(call){const args=splitArguments(call[2]),name=call[1].toLowerCase();
      if(name==='pointlinedistance'){const distance=numeric(args[2]);if(distance<0)throw Error('距离不能为负数');const l=line(args[1]),p=point(args[0]);return [(Math.abs(l[3]*p[0]+l[4]*p[1]+l[5])-distance)/Math.max(1,distance)];}
      if(name==='oncurve'||name==='online')return args.slice(0,-1).flatMap(arg=>entity(arg,pointNames)).flatMap(n=>[at(point(n),args.at(-1)!),...bounds(point(n),args.at(-1)!)]);
      if(name==='intersection')return [at(point(args[0]),args[1]),...bounds(point(args[0]),args[1]),at(point(args[0]),args[2]),...bounds(point(args[0]),args[2])];
      if(name==='distance')return [(numeric(`length(${args[0]})`)-numeric(args[1]))/Math.max(1,Math.abs(numeric(args[1])))];
      if(name==='equal'||name==='ratio')return [(numeric(`length(${args[0]})`)-numeric(`length(${args[1]})`)*(name==='ratio'?numeric(args[2]):1))/Math.max(1,numeric(`length(${args[0]})`),numeric(`length(${args[1]})`))];
      if(name==='inclination'){const l=line(args[0]),raw=args[1],rad=raw.match(/^rad\(([\s\S]*)\)$/i),angle=numeric(rad?.[1]??raw)*(rad||/\\pi|\bpi\b|π/.test(raw)?1:Math.PI/180);if(angle<0||angle>=Math.PI)throw Error('倾斜角必须在 [0,180°) 内');return [l[3]*Math.cos(angle)+l[4]*Math.sin(angle)];}
      if(name==='lineangle'){const a=line(args[0]),b=line(args[1]),raw=args[2],rad=raw.match(/^rad\(([\s\S]*)\)$/i),angle=numeric(rad?.[1]??raw)*(rad||/\\pi|\bpi\b|π/.test(raw)?1:Math.PI/180);if(angle<0||angle>Math.PI/2)throw Error('线线夹角必须在 0～90° 内');return [Math.abs(a[3]*b[3]+a[4]*b[4])-Math.cos(angle)];}
      if(name==='vectordot'){const a=vector(args[0]),b=vector(args[1]),value=a[0]*b[0]+a[1]*b[1];return [(value-numeric(args[2]))/Math.max(1,Math.abs(value),Math.abs(numeric(args[2])))];}
      if(name==='parallel'||name==='perpendicular'){const a=line(args[0]),b=line(args[1]);return [name==='parallel'?a[3]*b[4]-a[4]*b[3]:a[3]*b[3]+a[4]*b[4]];}
      if(name==='tangent'){
        const l=line(args[0]),q=quadratic(args[1]),o:Vec2=[-l[5]*l[3],-l[5]*l[4]],d:Vec2=[-l[4],l[3]],at=(x:number,y:number)=>q[0]*x*x+q[1]*x*y+q[2]*y*y+q[3]*x+q[4]*y+q[5];
        const a=q[0]*d[0]**2+q[1]*d[0]*d[1]+q[2]*d[1]**2,b=2*q[0]*o[0]*d[0]+q[1]*(o[0]*d[1]+o[1]*d[0])+2*q[2]*o[1]*d[1]+q[3]*d[0]+q[4]*d[1],c=at(...o);
        if(Math.abs(a)<1e-12)throw Error('此直线不是有限切点处的切线');return [(b*b-4*a*c)/Math.max(1,b*b,Math.abs(4*a*c))];
      }
      const curve=g.curves.get(object(args[1]).id);if(!curve)throw Error('请选择曲线');
      if(name==='center'||name==='focus'){const p=point(args[0]),center=circleCenter(curve.equation),foci=conicFoci(curve.equation),q=name==='center'?center??(()=>{const [A,B,C,D,E]=quadratic(args[1]),det=4*A*C-B*B;return Math.abs(det)>1e-12?[(B*E-2*C*D)/det,(B*D-2*A*E)/det] as Vec2:null;})():foci?.[Number(args[2]??1)-1];if(!q)throw Error('该曲线没有指定的中心或焦点');return [p[0]-q[0],p[1]-q[1]];}
      // A directrix is obtained from the focus and its perpendicular principal
      // axis, for every real noncircular conic (including parabolas).
      const f=conicFoci(curve.equation)?.[Number(args[2]??1)-1];if(!f)throw Error('该曲线没有准线');
      const [A,B,C,D,E,F]=quadratic(args[1]),l=line(args[0]),prop=properties(args[1]);
      let vertex:Vec2,axis:Vec2,offset:number;
      if(Number.isFinite(prop.a)){
        const det=4*A*C-B*B;vertex=[(B*E-2*C*D)/det,(B*D-2*A*E)/det];const length=Math.hypot(f[0]-vertex[0],f[1]-vertex[1]);axis=[(f[0]-vertex[0])/length,(f[1]-vertex[1])/length];offset=prop.a/prop.e;
      }else{
        const theta=.5*Math.atan2(B,A-C),c=Math.cos(theta),s=Math.sin(theta),l1=A*c*c+B*c*s+C*s*s,l2=A*s*s-B*c*s+C*c*c,d1=D*c+E*s,d2=-D*s+E*c;
        const uv=Math.abs(l1)>Math.abs(l2)?[-d1/(2*l1),-(F-d1*d1/(4*l1))/d2]:[-(F-d2*d2/(4*l2))/d1,-d2/(2*l2)];vertex=[c*uv[0]-s*uv[1],s*uv[0]+c*uv[1]];const length=Math.hypot(f[0]-vertex[0],f[1]-vertex[1]);axis=[(f[0]-vertex[0])/length,(f[1]-vertex[1])/length];offset=-length;
      }
      const q:Vec2=[vertex[0]+axis[0]*offset,vertex[1]+axis[1]*offset];return [l[3]*axis[1]-l[4]*axis[0],l[3]*q[0]+l[4]*q[1]+l[5]];
    }
    const m=source.match(/^([\s\S]+?)(<=|>=|<|>|=)([\s\S]+)$/);if(!m)throw Error('请输入等式、范围条件或几何关系');
    const a=numeric(m[1]),b=numeric(m[3]),scale=Math.max(1,Math.abs(a),Math.abs(b));
    return [m[2]==='='?(a-b)/scale:m[2].includes('<')?Math.max(0,(a-b+(m[2]==='<'?1e-7:0))/scale):Math.max(0,(b-a+(m[2]==='>'?1e-7:0))/scale)];
  };
  const satisfied=(source:string)=>{
    const m=source.trim().match(/^([\s\S]+?)(<=|>=|<|>)([\s\S]+)$/);if(!m)return true;
    const a=numeric(m[1]),b=numeric(m[3]);return m[2]==='<'?a<b:m[2]==='>'?a>b:m[2]==='<='?a<=b+1e-9*Math.max(1,Math.abs(b)):a>=b-1e-9*Math.max(1,Math.abs(b));
  };
  return {g,object,point,quadratic,numeric,residual,scope,satisfied};
}
