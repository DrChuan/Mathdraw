import type {ConstraintProblem,PlanarUnknown} from './types';
import type {GeometryObject} from '../types';
import {toPlane} from '../geometry';
import {newDrawing} from '../types';
import {symbolicGeometry,angleConstant} from './symbolicGeometry';
import {coordinatePlane,objectSymbol} from './planarModel';
import {angleDegrees} from './angles';
import {eccentricityEquations,symbolicConicCoefficients} from './conicAlgebra';
import {substituteNames,expressionNames} from '../parameters';
/** Source-level expressions for the rational subset of the dependency graph.
 * Unsupported constructions return no symbolic candidate; never freeze a
 * moving dependency to its current numerical coordinates to force an answer. */
export function symbolicPlanarEquations(problem:ConstraintProblem,variables:(PlanarUnknown&{point?:string;axis?:number})[]) {
  const context=problem.planar??{document:{...newDrawing(),objects:[]},unknowns:[],equations:[]};
  const doc=context.document,objects=new Map(doc.objects.map(o=>[objectSymbol(o),o])),plane=coordinatePlane(doc),tokens=variables.map((_,i)=>`q_${i}`),active=new Set<string>();
  const object=(name:string)=>{const o=objects.get(name.trim());if(!o)throw Error('未知对象');return o;};
  const numeric=(source:string):string=>{
    const prepared=source.replace(/\b([xy])\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,axis:string,n:string)=>`(${point(n,axis==='x'?0:1)})`);
    const referenced=new Set(expressionNames(prepared));
    const replacements:Record<string,string>={};for(const o of doc.objects)if(o.kind==='number'&&referenced.has(objectSymbol(o))){
      const index=variables.findIndex(u=>u.object===o.id&&u.field==='value');if(index>=0)replacements[objectSymbol(o)]=tokens[index];
      else if(active.has(o.id))continue;else {active.add(o.id);replacements[objectSymbol(o)]=`(${numeric(o.expression)})`;active.delete(o.id);}
    }return substituteNames(prepared,replacements);
  };
  const field=(o:GeometryObject,name:string,value:number)=>{const i=variables.findIndex(u=>u.object===o.id&&u.field===name),source=o.parameters?.fields[name];return i>=0?tokens[i]:typeof source==='string'?numeric(source):String(value);};
  const point=(name:string,axis:number):string=>{
    const index=variables.findIndex(u=>u.point===name&&u.axis===axis);if(index>=0)return tokens[index];
    const o=object(name);if(o.kind!=='point')throw Error('不是点');const c=o.construction,key=`${o.id}.${axis}`;if(active.has(key))throw Error('循环引用');active.add(key);
    let s:string;
    if(c.type==='free'){
      const unknown=variables.findIndex(u=>u.object===o.id&&u.field===(axis?'y':'x'));if(unknown>=0){active.delete(key);return tokens[unknown];}
      const coords=o.parameters?.fields['construction.position'];
      s=coords&&typeof coords!=='string'?numeric(coords.coordinates[axis]):field(o,axis?'y':'x',toPlane(plane,c.position)[axis]);
    }else if(c.type==='origin')s=String(toPlane(plane,doc.coordinateFrame?.origin??[0,0,0])[axis]);
    else if(c.type==='alias')s=point(objectSymbol(doc.objects.find(o=>o.id===c.point)!),axis);
    else if(c.type==='division'){const a=objectSymbol(doc.objects.find(o=>o.id===c.a)!),b=objectSymbol(doc.objects.find(o=>o.id===c.b)!);s=`(1-(${c.t}))*(${point(a,axis)})+(${c.t})*(${point(b,axis)})`;}
    else {
      throw Error('该构造尚无精确表达式，不能冻结为坐标常数');
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
        if(o.circle.type==='incircle'){const lengths=[0,1,2].map(i=>`sqrt(((${px[(i+1)%3]})-(${px[(i+2)%3]}))^2+((${py[(i+1)%3]})-(${py[(i+2)%3]}))^2)`),perimeter=lengths.map(v=>`(${v})`).join('+');cx=px.map((v,i)=>`(${lengths[i]})*(${v})`).join('+');cy=py.map((v,i)=>`(${lengths[i]})*(${v})`).join('+');cx=`(${cx})/(${perimeter})`;cy=`(${cy})/(${perimeter})`;}
        if(o.circle.type==='threePoint'){const d=`2*((${px[0]})*((${py[1]})-(${py[2]}))+(${px[1]})*((${py[2]})-(${py[0]}))+(${px[2]})*((${py[0]})-(${py[1]})))`,r=px.map((x,i)=>`((${x})^2+(${py[i]})^2)`);cx=`((${r[0]})*((${py[1]})-(${py[2]}))+(${r[1]})*((${py[2]})-(${py[0]}))+(${r[2]})*((${py[0]})-(${py[1]})))/(${d})`;cy=`((${r[0]})*((${px[2]})-(${px[1]}))+(${r[1]})*((${px[0]})-(${px[2]}))+(${r[2]})*((${px[1]})-(${px[0]})))/(${d})`;}
        const incircleRadius=`(((${py[1]})-(${py[0]}))*((${cx})-(${px[0]}))-((${px[1]})-(${px[0]}))*((${cy})-(${py[0]})))^2/(((${px[1]})-(${px[0]}))^2+((${py[1]})-(${py[0]}))^2)`;
        const radius=o.circle.type==='incircle'?incircleRadius:o.circle.type==='centerRadius'?`(${field(o,'circle.radius',o.circle.radius!)})^2`:`((${px[o.circle.type==='threePoint'?0:1]})-(${cx}))^2+((${py[o.circle.type==='threePoint'?0:1]})-(${cy}))^2`;source=`(x-(${cx}))^2+(y-(${cy}))^2=${radius}`;
      }else if(o.preset){const p=o.preset;const h=field(o,'preset.h',p.h),k=field(o,'preset.k',p.k),a=field(o,'preset.a',p.a),b=field(o,'preset.b',p.b);
        source=p.type==='parabola'?`(y-(${k}))^2=4*(${a})*(x-(${h}))`:p.type==='circle'?`(x-(${h}))^2+(y-(${k}))^2=(${a})^2`:`(x-(${h}))^2/(${a})^2${p.type==='hyperbola'?'-':'+'}(y-(${k}))^2/(${b})^2=1`;
      }else source=numeric(o.equation);
      if(o.preset&&o.preset.angle!==0){if(variables.some(u=>u.object===o.id&&u.field==='preset.angle'))throw Error('未知旋转角尚无代数编译');const condition={kind:'vertexAngle' as const,value:o.preset.angle,source:String(o.preset.angle),id:'',enabled:true,refs:[]},cos=angleConstant(condition),sin=angleConstant(condition,true);if(cos===undefined||sin===undefined)throw Error('旋转角的精确三角常数暂未支持');const h=field(o,'preset.h',o.preset.h),k=field(o,'preset.k',o.preset.k);source=substituteNames(source,{x:`(${h})+(${cos})*(x-(${h}))+(${sin})*(y-(${k}))`,y:`(${k})-(${sin})*(x-(${h}))+(${cos})*(y-(${k}))`});}
    }else if(['line','segment','vector'].includes(o.kind)&&'points'in o){const [a,b]=o.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!));source=`(x-(${point(a,0)}))*((${point(b,1)})-(${point(a,1)}))-(y-(${point(a,1)}))*((${point(b,0)})-(${point(a,0)}))=0`;}
    else throw Error('未知曲线');return substituteNames(source,{x:`(${x})`,y:`(${y})`});
  };
  const sources:string[]=[],unsupported:string[]=[];
  for(const q of context.equations.filter(q=>q.enabled))try{
    const m=q.source.match(/^on(?:Curve|Line)\s*\(\s*([^,]+),\s*([^,)]+)\s*\)$/i),k=q.source.match(/^intersection\s*\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/i);
    const incidence=(name:string,ref:string)=>{
      const x=point(name,0),y=point(name,1);sources.push(curve(ref,x,y));const o=object(ref);
      if((o.kind==='segment'||o.kind==='vector'||o.kind==='line')&&'points'in o){const a=objectSymbol(doc.objects.find(p=>p.id===o.points[0])!),b=objectSymbol(doc.objects.find(p=>p.id===o.points[1])!),dx=`(${point(b,0)})-(${point(a,0)})`,dy=`(${point(b,1)})-(${point(a,1)})`,den=`(${dx})^2+(${dy})^2`,dot=`((${x})-(${point(a,0)}))*(${dx})+((${y})-(${point(a,1)}))*(${dy})`;sources.push(`${den}>0`);if(o.kind!=='line'||o.ray)sources.push(`${dot}>=0`);if(o.kind!=='line')sources.push(`(${den})-(${dot})>=0`);}
      if(o.kind==='curve'&&o.limits){for(const [axis,expression]of [['x',x],['y',y]] as const){const lo=o.limits[`${axis}Min`],hi=o.limits[`${axis}Max`];if(lo!==undefined)sources.push(`(${expression})>=${lo}`);if(hi!==undefined)sources.push(`(${expression})<=${hi}`);}}
    };
    const eccentric=q.source.trim().match(/^(?:e|eccentricity)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*=\s*(.+)$/),reversed=q.source.trim().match(/^(.+?)\s*=\s*(?:e|eccentricity)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)$/);
    const inclination=q.source.trim().match(/^inclination\(\s*([^,]+),\s*(.+)\)$/i);
    if(inclination){const degrees=angleDegrees(inclination[2]);if(degrees<0||degrees>=180)throw Error('倾斜角必须在 [0,180°) 内');const c={kind:'vertexAngle' as const,value:degrees,source:`angle(A,B,C)=${inclination[2]}`,id:'',enabled:true,refs:[]},cos=angleConstant(c),sin=angleConstant(c,true);if(cos===undefined||sin===undefined)throw Error('该倾斜角的精确三角常数暂未支持');const [A,B,C,D,E]=symbolicConicCoefficients(curve(inclination[1],'x','y'),tokens);if([A,B,C].some(v=>v!=='0'))throw Error('倾斜角只能引用直线');sources.push(`(${D})*(${cos})+(${E})*(${sin})=0`, `(${D})^2+(${E})^2>0`);}
    else if(eccentric||reversed){const name=eccentric?.[1]??reversed![2],value=numeric(eccentric?.[2]??reversed![1]);sources.push(...eccentricityEquations(curve(name,'x','y'),value,tokens));}
    else if(m)incidence(m[1],m[2]);else if(k){incidence(k[1],k[2]);incidence(k[1],k[3]);}
    else if(q.source.match(/\b(?:tangent|focus|directrix|center|a|b|c|e|eccentricity|focalDistance|radius|p)\s*\(/))unsupported.push(q.source);
    else sources.push(numeric(q.source));
  }catch(error){unsupported.push(`${q.source}: ${(error as Error).message}`);}
  try{const geometry=symbolicGeometry(problem,name=>[point(name,0),point(name,1),'0']);sources.push(...geometry.sources);unsupported.push(...geometry.unsupported);}catch(error){unsupported.push((error as Error).message);}
  if(problem.mode==='plane'&&!context.document.objects.some(o=>o.kind==='point')&&!context.equations.some(e=>e.enabled)){
    const [a,b]=problem.points;if(a)sources.push(`${point(a,0)}=0`,`${point(a,1)}=0`);if(b)sources.push(`${point(b,1)}=0`,`${point(b,0)}>=0`);
  }
  for(const [i,u]of variables.entries()){if(u.min!==undefined)sources.push(`${tokens[i]}>=${u.min}`);if(u.max!==undefined)sources.push(`${tokens[i]}<=${u.max}`);}
  const coordinates:Record<string,[string,string]>={};for(const name of problem.points)try{coordinates[name]=[point(name,0),point(name,1)];}catch{/* The unsupported construction remains a joint numerical check. */}
  return {sources,tokens,coordinates,complete:!unsupported.length,unsupported};
}
