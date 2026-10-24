import type {ConstraintProblem,PlanarUnknown} from './types';
import type {GeometryObject} from '../types';
import {resolveGeometry,toPlane,dependencies} from '../geometry';
import {coordinatePlane,objectSymbol} from './planarModel';
import {substituteNames,expressionNames} from '../parameters';
/** Source-level expressions for the rational subset of the dependency graph.
 * Unsupported constructions return no symbolic candidate; never freeze a
 * moving dependency to its current numerical coordinates to force an answer. */
export function symbolicPlanarEquations(problem:ConstraintProblem,variables:(PlanarUnknown&{point?:string;axis?:number})[]) {
  const context=problem.planar;if(!context)return;
  const doc=context.document,objects=new Map(doc.objects.map(o=>[objectSymbol(o),o])),g=resolveGeometry(doc),plane=coordinatePlane(doc),tokens=variables.map((_,i)=>`q_${i}`),active=new Set<string>();
  const object=(name:string)=>{const o=objects.get(name.trim());if(!o)throw Error('未知对象');return o;};
  const numeric=(source:string):string=>{
    const prepared=source.replace(/\b([xy])\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,axis:string,n:string)=>`(${point(n,axis==='x'?0:1)})`);
    const referenced=new Set(expressionNames(prepared));
    const replacements:Record<string,string>={};for(const o of doc.objects)if(o.kind==='number'&&referenced.has(objectSymbol(o))){
      const index=variables.findIndex(u=>u.object===o.id&&u.field==='value');if(index>=0)replacements[objectSymbol(o)]=tokens[index];
      else if(active.has(o.id))continue;else {active.add(o.id);replacements[objectSymbol(o)]=`(${numeric(o.expression)})`;active.delete(o.id);}
    }return substituteNames(prepared,replacements);
  };
  const field=(o:GeometryObject,name:string,value:number)=>{const i=variables.findIndex(u=>u.object===o.id&&u.field===name);return i>=0?tokens[i]:String(value);};
  const point=(name:string,axis:number):string=>{
    const index=variables.findIndex(u=>u.point===name&&u.axis===axis);if(index>=0)return tokens[index];
    const o=object(name);if(o.kind!=='point')throw Error('不是点');const c=o.construction,key=`${o.id}.${axis}`;if(active.has(key))throw Error('循环引用');active.add(key);
    let s:string;
    if(c.type==='free'){
      const coords=o.parameters?.fields['construction.position'];
      s=coords&&typeof coords!=='string'?numeric(coords.coordinates[axis]):field(o,axis?'y':'x',toPlane(plane,c.position)[axis]);
    }else if(c.type==='alias')s=point(objectSymbol(doc.objects.find(o=>o.id===c.point)!),axis);
    else if(c.type==='division'){const a=objectSymbol(doc.objects.find(o=>o.id===c.a)!),b=objectSymbol(doc.objects.find(o=>o.id===c.b)!);s=`(1-(${c.t}))*(${point(a,axis)})+(${c.t})*(${point(b,axis)})`;}
    else {
      // A source depending on an unknown must be symbolically translated or
      // left for joint numerical evaluation, rather than sampled as a constant.
      const depends=(id:string,seen=new Set<string>()):boolean=>{if(seen.has(id))return false;seen.add(id);if(variables.some(u=>u.object===id))return true;const p=doc.objects.find(o=>o.id===id);return !!p&&dependencies(p).some(v=>depends(v,seen));};
      if(depends(o.id)||variables.some(u=>u.object&&JSON.stringify(c).includes(u.object)))throw Error('该构造尚无有理表达式');const p=g.points.get(o.id);if(!p)throw Error('点失效');s=String(toPlane(plane,p.p)[axis]);
    }
    active.delete(key);return s;
  };
  const curve=(name:string,x:string,y:string):string=>{
    const o=object(name);let source:string;
    if(o.kind==='curve'){
      if(o.derived)throw Error('派生曲线保留依赖并参与数值联立');
      const symbolic=o.parameters?.fields.equation;
      if(typeof symbolic==='string')source=numeric(symbolic);
      else if(o.circle){
        const names=o.circle.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)),px=names.map(n=>point(n,0)),py=names.map(n=>point(n,1));let cx=px[0],cy=py[0];
        if(o.circle.type==='incircle')throw Error('内切圆含根式');
        if(o.circle.type==='threePoint'){const d=`2*((${px[0]})*((${py[1]})-(${py[2]}))+(${px[1]})*((${py[2]})-(${py[0]}))+(${px[2]})*((${py[0]})-(${py[1]})))`,r=px.map((x,i)=>`((${x})^2+(${py[i]})^2)`);cx=`((${r[0]})*((${py[1]})-(${py[2]}))+(${r[1]})*((${py[2]})-(${py[0]}))+(${r[2]})*((${py[0]})-(${py[1]})))/(${d})`;cy=`((${r[0]})*((${px[2]})-(${px[1]}))+(${r[1]})*((${px[0]})-(${px[2]}))+(${r[2]})*((${px[1]})-(${px[0]})))/(${d})`;}
        const radius=o.circle.type==='centerRadius'?`(${field(o,'circle.radius',o.circle.radius!)})^2`:`((${px[o.circle.type==='threePoint'?0:1]})-(${cx}))^2+((${py[o.circle.type==='threePoint'?0:1]})-(${cy}))^2`;source=`(x-(${cx}))^2+(y-(${cy}))^2=${radius}`;
      }else if(o.preset){const p=o.preset;if(p.angle!==0)throw Error('旋转参数留待数值联立');const h=field(o,'preset.h',p.h),k=field(o,'preset.k',p.k),a=field(o,'preset.a',p.a),b=field(o,'preset.b',p.b);
        source=p.type==='parabola'?`(y-(${k}))^2=4*(${a})*(x-(${h}))`:p.type==='circle'?`(x-(${h}))^2+(y-(${k}))^2=(${a})^2`:`(x-(${h}))^2/(${a})^2${p.type==='hyperbola'?'-':'+'}(y-(${k}))^2/(${b})^2=1`;
      }else source=numeric(o.equation);
    }else if(['line','segment','vector'].includes(o.kind)&&'points'in o){const [a,b]=o.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!));source=`(x-(${point(a,0)}))*((${point(b,1)})-(${point(a,1)}))-(y-(${point(a,1)}))*((${point(b,0)})-(${point(a,0)}))=0`;}
    else throw Error('未知曲线');return substituteNames(source,{x:`(${x})`,y:`(${y})`});
  };
  try{
    const sources=context.equations.filter(q=>q.enabled).flatMap(q=>{const m=q.source.match(/^on(?:Curve|Line)\s*\(\s*([^,]+),\s*([^,)]+)\s*\)$/i),k=q.source.match(/^intersection\s*\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/i);
      if(m)return[curve(m[2],point(m[1],0),point(m[1],1))];if(k)return[curve(k[2],point(k[1],0),point(k[1],1)),curve(k[3],point(k[1],0),point(k[1],1))];
      if(q.source.match(/\b(?:onCurve|tangent|focus|directrix|center|a|b|eccentricity|radius|p)\s*\(/))return[];
      return[numeric(q.source)];});
    return {sources,tokens};
  }catch{return;}
}
