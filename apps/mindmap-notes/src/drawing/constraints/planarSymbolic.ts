import {planarRelationSource} from './planarRelations';
import {lineConicPoint} from './intersectionAlgebra';
import {squaredExpression,nonnegativeExpression,algebraicDomains} from './metricSymbolic';
import {normalizeRationalExpression,normalizeRationalRelations} from './exactSystem';
import {planarReference,mapPlanarMetrics} from './planarReferences';
import {knownConicFeature} from './knownConicFeatures';
import {entity} from './input';
import {splitArguments} from '../model';
import {latexToExpression} from '../latex';
import {standardConicPoint} from './conicPointSymbolic';
import type {ConstraintProblem,PlanarUnknown} from './types';
import type {GeometryObject} from '../types';
import {toPlane,affectedObjects} from '../geometry';
import {newDrawing} from '../types';
import {symbolicGeometry,angleConstant} from './symbolicGeometry';
import {coordinatePlane,objectSymbol} from './planarModel';
import {angleDegrees} from './angles';
import {parseExpression,evaluate} from '../expression';
import {eccentricityEquations,symbolicConicCoefficients,tangentConicEquations} from './conicAlgebra';
import {substituteNames,expressionNames} from '../parameters';
/** Source-level expressions for the rational subset of the dependency graph.
 * Unsupported constructions return no symbolic candidate; never freeze a
 * moving dependency to its current numerical coordinates to force an answer. */
export function symbolicPlanarEquations(problem:ConstraintProblem,variables:(PlanarUnknown&{point?:string;axis?:number})[]) {
  const context=problem.planar??{document:{...newDrawing(),objects:[]},unknowns:[],equations:[]};
  const doc=context.document,objects=new Map(doc.objects.map(o=>[objectSymbol(o),o])),plane=coordinatePlane(doc),tokens=variables.map((_,i)=>`q_${i}`),active=new Set<string>();
  const definitionGuards=new Set<string>(),memo=new Map<string,string>(),definitionUnsupported:string[]=[];
  const guard=(source:string)=>definitionGuards.add(source);
  const simplify=(source:string)=>{const result=normalizeRationalExpression(source,tokens);result?.guards.forEach(guard);return result?.source??source;};
  const object=(name:string)=>{const o=objects.get(name.trim());if(!o)throw Error('未知对象');return o;};
  const numeric=(source:string):string=>{
    const assumptions=context.equations.filter(q=>q.enabled).map(q=>q.source.replace(/\s/g,''));
    const ordered=source.replace(/\babs\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\^\s*2\s*-\s*([A-Za-z][A-Za-z0-9_]*)\s*\^\s*2\s*\)/g,(whole,a:string,b:string)=>{
      const positive=(n:string)=>assumptions.includes(`${n}>0`)||assumptions.includes(`0<${n}`);
      return positive(a)&&positive(b)&&(assumptions.includes(`${a}>${b}`)||assumptions.includes(`${b}<${a}`))?`(${a}^2-${b}^2)`:whole;
    });
    const prepared=ordered.replace(/\b([xy])\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g,(_,axis:string,n:string)=>`(${point(n,axis==='x'?0:1)})`);
    const referenced=new Set(expressionNames(prepared));
    const replacements:Record<string,string>={};for(const o of doc.objects)if(o.kind==='number'&&referenced.has(objectSymbol(o))){
      const index=variables.findIndex(u=>u.object===o.id&&u.field==='value');if(index>=0)replacements[objectSymbol(o)]=tokens[index];
      else if(active.has(o.id))continue;else {active.add(o.id);try{replacements[objectSymbol(o)]=`(${metric(o.expression)})`;}finally{active.delete(o.id);}}
    }return substituteNames(prepared,replacements);
  };
  const field=(o:GeometryObject,name:string,value:number)=>{const i=variables.findIndex(u=>u.object===o.id&&u.field===name),source=o.parameters?.fields[name];return i>=0?tokens[i]:typeof source==='string'?numeric(source):String(value);};
  const point=(name:string,axis:number):string=>{
    const index=variables.findIndex(u=>u.point===name&&u.axis===axis);if(index>=0)return tokens[index];
    const o=object(name);if(o.kind!=='point')throw Error('不是点');const c=o.construction,key=`${o.id}.${axis}`;if(memo.has(key))return memo.get(key)!;if(active.has(key))throw Error('循环引用');active.add(key);
    try{
    let s:string;
    if(c.type==='free'){
      const unknown=variables.findIndex(u=>u.object===o.id&&u.field===(axis?'y':'x'));if(unknown>=0){active.delete(key);return tokens[unknown];}
      const coords=o.parameters?.fields['construction.position'];
      s=coords&&typeof coords!=='string'?numeric(coords.coordinates[axis]):field(o,axis?'y':'x',toPlane(plane,c.position)[axis]);
    }else if(c.type==='origin')s=String(toPlane(plane,doc.coordinateFrame?.origin??[0,0,0])[axis]);
    else if(c.type==='alias')s=point(objectSymbol(doc.objects.find(o=>o.id===c.point)!),axis);
    else if(c.type==='division'){const a=objectSymbol(doc.objects.find(o=>o.id===c.a)!),b=objectSymbol(doc.objects.find(o=>o.id===c.b)!),t=field(o,'construction.t',c.t);guard(`((${point(b,0)})-(${point(a,0)}))^2+((${point(b,1)})-(${point(a,1)}))^2>0`);s=`(1-(${t}))*(${point(a,axis)})+(${t})*(${point(b,axis)})`;}
    else if(c.type==='intersection'){
      const first=doc.objects.find(o=>o.id===c.first),second=doc.objects.find(o=>o.id===c.second);if(!first||!second)throw Error('交点来源不存在');
      const firstCoefficients=symbolicConicCoefficients(curve(objectSymbol(first),'x','y'),tokens),secondCoefficients=symbolicConicCoefficients(curve(objectSymbol(second),'x','y'),tokens),firstLine=firstCoefficients.slice(0,3).every(s=>simplify(s)==='0'),secondLine=secondCoefficients.slice(0,3).every(s=>simplify(s)==='0');
      if(firstLine&&secondLine){
      const [a,b,f]=lineCoefficients(objectSymbol(first)),[d,e,g]=lineCoefficients(objectSymbol(second)),det=simplify(`(${a})*(${e})-(${b})*(${d})`);
      guard(`(${det})!=0`);if(c.branch!==0)guard('1=0');
      const x=simplify(`((${b})*(${g})-(${e})*(${f}))/(${det})`),y=simplify(`((${f})*(${d})-(${g})*(${a}))/(${det})`);
      incidenceDomain(objectSymbol(first),x,y);incidenceDomain(objectSymbol(second),x,y);s=axis?y:x;
      }else if(firstLine||secondLine){
        for(const o of [first,second]){const reference=planarReference(doc.objects,objectSymbol(o));if(reference.kind==='straight'&&reference.extent!=='line'||o.kind==='curve'&&(o.limits||o.followView===false))throw Error('有限范围交点需要保持过滤后的原生分支');}
        const result=lineConicPoint(firstLine?secondCoefficients:firstCoefficients,(firstLine?firstCoefficients:secondCoefficients).slice(3),c.branch,tokens);result.guards.forEach(guard);s=result.point[axis];
      }else throw Error('两条二次曲线的交点保留原生四次求交及分支校验');
    }
    else if(c.type==='reflection'){
      const origin=doc.objects.find(o=>o.id===c.point),line=doc.objects.find(o=>o.id===c.axis);if(!origin||!line)throw Error('对称来源不存在');
      const [a,b,f]=lineCoefficients(objectSymbol(line)),x=point(objectSymbol(origin),0),y=point(objectSymbol(origin),1),den=simplify(`(${a})^2+(${b})^2`);guard(`(${den})>0`);
      s=`(${axis?y:x})-2*((${a})*(${x})+(${b})*(${y})+(${f}))*(${axis?b:a})/(${den})`;
    }
    else if(c.type==='center'){
      const names=c.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)),xs=names.map(n=>point(n,0)),ys=names.map(n=>point(n,1));
      const area=simplify(`((${xs[1]})-(${xs[0]}))*((${ys[2]})-(${ys[0]}))-((${xs[2]})-(${xs[0]}))*((${ys[1]})-(${ys[0]}))`);guard(`(${area})!=0`);
      if(c.center==='centroid')s=`(${(axis?ys:xs).map(v=>`(${v})`).join('+')})/3`;
      else if(c.center==='circumcenter'||c.center==='orthocenter'){
        const d=simplify(`2*(${area})`),lengths=[1,2].map(i=>simplify(`(${xs[i]})^2+(${ys[i]})^2-(${xs[0]})^2-(${ys[0]})^2`)),cx=simplify(`((${lengths[0]})*((${ys[2]})-(${ys[0]}))-(${lengths[1]})*((${ys[1]})-(${ys[0]})))/(${d})`),cy=simplify(`(((${xs[1]})-(${xs[0]}))*(${lengths[1]})-((${xs[2]})-(${xs[0]}))*(${lengths[0]}))/(${d})`);
        s=c.center==='circumcenter'?(axis?cy:cx):`(${(axis?ys:xs).map(v=>`(${v})`).join('+')})-2*(${axis?cy:cx})`;
      }else {
        const lengths=[0,1,2].map(i=>`sqrt(((${xs[(i+1)%3]})-(${xs[(i+2)%3]}))^2+((${ys[(i+1)%3]})-(${ys[(i+2)%3]}))^2)`),den=lengths.join('+');guard(`(${den})>0`);s=`(${lengths.map((l,i)=>`(${l})*(${(axis?ys:xs)[i]})`).join('+')})/(${den})`;
      }
    }
    else if(c.type==='onPath'){
      const path=doc.objects.find(o=>o.id===c.path);if(!path)throw Error('路径来源不存在');
      const ref=planarReference(doc.objects,objectSymbol(path));if(ref.kind!=='straight'||ref.object?.relation)throw Error('该曲线路径参数尚未精确展开，保留来源定义');
      const [a,b]=ref.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!));let t=field(o,'construction.parameter',c.parameter);
      guard(`((${point(b,0)})-(${point(a,0)}))^2+((${point(b,1)})-(${point(a,1)}))^2>0`);
      if(ref.extent!=='line'){
        if(tokens.some(q=>new RegExp(`\\b${q}\\b`).test(t)))throw Error('路径端点采用截断分段定义，尚未精确分支展开');
        const v=evaluate(parseExpression(t));if(v<0)t='0';if(ref.extent==='segment'&&v>1)t='1';
      }
      s=`(1-(${t}))*(${point(a,axis)})+(${t})*(${point(b,axis)})`;
    }
    else if(c.type==='vertex'||c.type==='focus'||c.type==='curveCenter'){
      const curve=doc.objects.find(o=>o.id===c.curve);if(curve?.kind!=='curve')throw Error('找不到来源曲线');
      if(c.type==='focus'&&curve.preset?.angle)throw Error('旋转预置曲线的焦点序号尚未精确编译，保留来源构造');
      const source=curve.parameters?.fields.equation,index=c.type==='curveCenter'?0:c.index;
      const coordinates=standardConicPoint(typeof source==='string'?source:curve.equation,c.type,index,context.equations.filter(q=>q.enabled).map(q=>q.source))??knownConicFeature(curveSource(curve),c.type,index)?.point;
      if(!coordinates)throw Error('该圆锥曲线特征尚无确定的精确分支');s=numeric(coordinates[axis]);
    }
    else {
      throw Error('该构造尚无精确表达式，不能冻结为坐标常数');
    }
    s=simplify(s);memo.set(key,s);return s;
    }finally{active.delete(key);}
  };
  const curveSource=(o:Extract<GeometryObject,{kind:'curve'}>)=>curve(objectSymbol(o),'x','y');
  const curve=(name:string,x:string,y:string):string=>{
    const reference=planarReference(doc.objects,name);let source:string;
    if(reference.kind==='curve'){
      const o=reference.object;
      if(o.derived){
        const c=o.derived,key=`curve.${o.id}`;if(active.has(key))throw Error('曲线构造循环');
        if(c.type!=='conicFeature')throw Error('该派生曲线暂未提供精确表达式，保留依赖并参与数值联立');
        const parent=doc.objects.find(o=>o.id===c.curve);if(parent?.kind!=='curve')throw Error('来源曲线不存在');
        active.add(key);try{
          const line=knownConicFeature(curveSource(parent),c.feature,c.index)?.line;
          if(!line)throw Error('该准线或渐近线尚无精确表达式，保留来源定义');
          return substituteNames(line,{x:`(${x})`,y:`(${y})`});
        }finally{active.delete(key);}
      }
      const symbolic=o.parameters?.fields.equation;
      if(typeof symbolic==='string')source=numeric(symbolic);
      else if(o.circle){
        const names=o.circle.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)),px=names.map(n=>point(n,0)),py=names.map(n=>point(n,1));let cx=px[0],cy=py[0];
        if(o.circle.type==='incircle'){const lengths=[0,1,2].map(i=>`sqrt(((${px[(i+1)%3]})-(${px[(i+2)%3]}))^2+((${py[(i+1)%3]})-(${py[(i+2)%3]}))^2)`),perimeter=lengths.map(v=>`(${v})`).join('+');cx=px.map((v,i)=>`(${lengths[i]})*(${v})`).join('+');cy=py.map((v,i)=>`(${lengths[i]})*(${v})`).join('+');cx=`(${cx})/(${perimeter})`;cy=`(${cy})/(${perimeter})`;}
        if(o.circle.type==='threePoint'){const d=`2*((${px[0]})*((${py[1]})-(${py[2]}))+(${px[1]})*((${py[2]})-(${py[0]}))+(${px[2]})*((${py[0]})-(${py[1]})))`,r=px.map((x,i)=>`((${x})^2+(${py[i]})^2)`);guard(`(${d})!=0`);cx=`((${r[0]})*((${py[1]})-(${py[2]}))+(${r[1]})*((${py[2]})-(${py[0]}))+(${r[2]})*((${py[0]})-(${py[1]})))/(${d})`;cy=`((${r[0]})*((${px[2]})-(${px[1]}))+(${r[1]})*((${px[0]})-(${px[2]}))+(${r[2]})*((${px[1]})-(${px[0]})))/(${d})`;}
        const incircleRadius=`(((${py[1]})-(${py[0]}))*((${cx})-(${px[0]}))-((${px[1]})-(${px[0]}))*((${cy})-(${py[0]})))^2/(((${px[1]})-(${px[0]}))^2+((${py[1]})-(${py[0]}))^2)`;
        const radius=o.circle.type==='incircle'?incircleRadius:o.circle.type==='centerRadius'?`(${field(o,'circle.radius',o.circle.radius!)})^2`:`((${px[o.circle.type==='threePoint'?0:1]})-(${cx}))^2+((${py[o.circle.type==='threePoint'?0:1]})-(${cy}))^2`;guard(o.circle.type==='centerRadius'?`(${field(o,'circle.radius',o.circle.radius!)})>0`:`(${radius})>0`);source=`(x-(${cx}))^2+(y-(${cy}))^2=${radius}`;
      }else if(o.preset){const p=o.preset;const h=field(o,'preset.h',p.h),k=field(o,'preset.k',p.k),a=field(o,'preset.a',p.a),b=field(o,'preset.b',p.b);
        source=p.type==='parabola'?`(y-(${k}))^2=4*(${a})*(x-(${h}))`:p.type==='circle'?`(x-(${h}))^2+(y-(${k}))^2=(${a})^2`:`(x-(${h}))^2/(${a})^2${p.type==='hyperbola'?'-':'+'}(y-(${k}))^2/(${b})^2=1`;
      }else source=numeric(o.equation);
      if(o.preset&&o.preset.angle!==0){if(variables.some(u=>u.object===o.id&&u.field==='preset.angle'))throw Error('未知旋转角尚无代数编译');const condition={kind:'vertexAngle' as const,value:o.preset.angle,source:String(o.preset.angle),id:'',enabled:true,refs:[]},cos=angleConstant(condition),sin=angleConstant(condition,true);if(cos===undefined||sin===undefined)throw Error('旋转角的精确三角常数暂未支持');const h=field(o,'preset.h',o.preset.h),k=field(o,'preset.k',o.preset.k);source=substituteNames(source,{x:`(${h})+(${cos})*(x-(${h}))+(${sin})*(y-(${k}))`,y:`(${k})-(${sin})*(x-(${h}))+(${cos})*(y-(${k}))`});}
    }else if(reference.kind==='straight'){
      const [a,b]=reference.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)),line=reference.object;
      if(line?.normalPlane||line?.relation?.plane)throw Error('空间方向不能作为二维直线');
      if(line?.relation){
        const key=`line.${line.id}`;if(active.has(key))throw Error('直线构造循环');active.add(key);
        try{
          const r=line.relation;
          if(r.type==='bisector')source=`(x-((${point(a,0)})+(${point(b,0)}))/2)*((${point(b,0)})-(${point(a,0)}))+(y-((${point(a,1)})+(${point(b,1)}))/2)*((${point(b,1)})-(${point(a,1)}))=0`;
          else {
            const parent=doc.objects.find(o=>o.id===r.reference);if(!parent)throw Error('来源直线不存在');
            const [A,B,C,D,E]=symbolicConicCoefficients(curve(objectSymbol(parent),'x','y'),tokens);
            if([A,B,C].some(s=>s!=='0'))throw Error('来源不是直线');
            const nx=r.type==='parallel'?D:E,ny=r.type==='parallel'?E:`-(${D})`;
            source=`(${nx})*(x-(${point(a,0)}))+(${ny})*(y-(${point(a,1)}))=0`;
          }
        }finally{active.delete(key);}
      }else source=`(x-(${point(a,0)}))*((${point(b,1)})-(${point(a,1)}))-(y-(${point(a,1)}))*((${point(b,0)})-(${point(a,0)}))=0`;
    }
    else throw Error('未知曲线');return substituteNames(source,{x:`(${x})`,y:`(${y})`});
  };
  const lineCoefficients=(name:string):[string,string,string]=>{
    const [A,B,C,D,E,F]=symbolicConicCoefficients(curve(name,'x','y'),tokens);
    if([A,B,C].some(s=>s!=='0'))throw Error('该构造需要直线来源，不能把曲线当直线消去');
    const values=[D,E,F].map(simplify) as [string,string,string];guard(`(${values[0]})^2+(${values[1]})^2>0`);return values;
  };
  const incidenceDomain=(name:string,x:string,y:string)=>{
    const ref=planarReference(doc.objects,name);if(ref.kind!=='straight'||ref.extent==='line')return;
    if(ref.object?.relation)throw Error('关联射线或线段的端点域尚未精确展开');
    const [a,b]=ref.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)),dx=`(${point(b,0)})-(${point(a,0)})`,dy=`(${point(b,1)})-(${point(a,1)})`,dot=simplify(`((${x})-(${point(a,0)}))*(${dx})+((${y})-(${point(a,1)}))*(${dy})`);
    guard(`(${dot})>=0`);if(ref.extent==='segment')guard(`(${dx})^2+(${dy})^2-(${dot})>=0`);
  };
  const metric=(raw:string)=>{
    const vector=(name:string)=>{
      const o=objects.get(name),refs=o&&(o.kind==='segment'||o.kind==='vector')?o.points.map(id=>objectSymbol(doc.objects.find(o=>o.id===id)!)):entity(name,problem.points);
      if(refs.length!==2)throw Error('长度需引用两个端点或命名线段');
      return [0,1].map(axis=>`((${point(refs[1],axis)})-(${point(refs[0],axis)}))`);
    };
    const length=(name:string)=>{const v=vector(name);return `sqrt((${v[0]})^2+(${v[1]})^2)`;};
    let source=mapPlanarMetrics(latexToExpression(raw),(kind,args,original)=>{if(kind==='slope'){const [a,b]=lineCoefficients(args[0]);guard(`(${b})!=0`);return `(-(${a}))/(${b})`;}if(kind==='length')return `(${length(args[0])})`;if(kind==='dot'){const u=vector(args[0]),v=vector(args[1]);return `((${u[0]})*(${v[0]})+(${u[1]})*(${v[1]}))`;}return original;});
    source=source.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g,name=>{if(tokens.includes(name))return name;const o=objects.get(name);if(o&&o.kind!=='segment'&&o.kind!=='vector')return name;try{return `(${length(name)})`;}catch{return name;}});
    return numeric(source);
  };
  const sources:string[]=[],unsupported:string[]=[];
  for(const q of context.equations.filter(q=>q.enabled))try{
    const source=planarRelationSource(q.source);
    const incidenceCall=source.match(/^(onCurve|onLine|intersection)\s*\(([\s\S]*)\)$/i);
    const incidence=(name:string,ref:string)=>{
      const x=point(name,0),y=point(name,1);sources.push(curve(ref,x,y));const reference=planarReference(doc.objects,ref),o=reference.object;
      if(reference.kind==='straight'){
        if(reference.object?.relation){
          if(reference.extent!=='line')throw Error('关联射线或线段的定义域尚待精确编译');
          const [,,,D,E]=symbolicConicCoefficients(curve(ref,'x','y'),tokens);sources.push(`(${D})^2+(${E})^2>0`);return;
        }
        const a=objectSymbol(doc.objects.find(p=>p.id===reference.points[0])!),b=objectSymbol(doc.objects.find(p=>p.id===reference.points[1])!),dx=`(${point(b,0)})-(${point(a,0)})`,dy=`(${point(b,1)})-(${point(a,1)})`,den=`(${dx})^2+(${dy})^2`,dot=`((${x})-(${point(a,0)}))*(${dx})+((${y})-(${point(a,1)}))*(${dy})`;sources.push(`${den}>0`);if(reference.extent!=='line')sources.push(`${dot}>=0`);if(reference.extent==='segment')sources.push(`(${den})-(${dot})>=0`);
      }
      if(o?.kind==='curve'&&o.limits){for(const [axis,expression]of [['x',x],['y',y]] as const){const lo=o.limits[`${axis}Min`],hi=o.limits[`${axis}Max`];if(lo!==undefined)sources.push(`(${expression})>=${lo}`);if(hi!==undefined)sources.push(`(${expression})<=${hi}`);}}
    };
    const eccentric=source.match(/^(?:e|eccentricity)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*=\s*(.+)$/),reversed=source.match(/^(.+?)\s*=\s*(?:e|eccentricity)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)$/);
    const pointDistance=source.match(/^pointLineDistance\s*\((.*)\)$/i);
    const inclination=source.match(/^inclination\(\s*([^,]+),\s*(.+)\)$/i);
    const direction=source.match(/^(perpendicular|parallel)\s*\(([\s\S]*)\)$/i);
    const tangent=source.match(/^tangent\s*\(([\s\S]*)\)$/i);
    if(direction){const args=splitArguments(direction[2]);if(args.length!==2)throw Error('方向关系需要两条直线');const [a,b]=lineCoefficients(args[0]),[d,e]=lineCoefficients(args[1]);sources.push(direction[1].toLowerCase()==='perpendicular'?`(${a})*(${d})+(${b})*(${e})=0`:`(${a})*(${e})-(${b})*(${d})=0`);}
    else if(tangent){
      const args=splitArguments(tangent[1]);if(args.length!==2)throw Error('相切需要直线和曲线两个参数');
      sources.push(...tangentConicEquations(symbolicConicCoefficients(curve(args[1],'x','y'),tokens),lineCoefficients(args[0])));
    }
    else if(pointDistance){
      const args=splitArguments(pointDistance[1]);if(args.length!==3)throw Error('点线距离需要三个参数');
      const [A,B,C,D,E,F]=symbolicConicCoefficients(curve(args[1],'x','y'),tokens);
      if([A,B,C].some(v=>v!=='0'))throw Error('距离参照必须是直线');
      const radius=metric(args[2]),normal=`(${D})^2+(${E})^2`,signed=`(${D})*(${point(args[0],0)})+(${E})*(${point(args[0],1)})+(${F})`;
      sources.push(`(${signed})^2=(${squaredExpression(radius,tokens)})*(${normal})`,`${normal}>0`,`${radius}>=0`);
    }
    else if(inclination){const degrees=angleDegrees(inclination[2]);if(degrees<0||degrees>=180)throw Error('倾斜角必须在 [0,180°) 内');const c={kind:'vertexAngle' as const,value:degrees,source:`angle(A,B,C)=${inclination[2]}`,id:'',enabled:true,refs:[]},cos=angleConstant(c),sin=angleConstant(c,true);if(cos===undefined||sin===undefined)throw Error('该倾斜角的精确三角常数暂未支持');const [A,B,C,D,E]=symbolicConicCoefficients(curve(inclination[1],'x','y'),tokens);if([A,B,C].some(v=>v!=='0'))throw Error('倾斜角只能引用直线');sources.push(`(${D})*(${cos})+(${E})*(${sin})=0`, `(${D})^2+(${E})^2>0`);}
    else if(eccentric||reversed){const name=eccentric?.[1]??reversed![2],value=numeric(eccentric?.[2]??reversed![1]);sources.push(...eccentricityEquations(curve(name,'x','y'),value,tokens));}
    else if(incidenceCall){
      const args=splitArguments(incidenceCall[2]),intersection=incidenceCall[1].toLowerCase()==='intersection';
      if(args.length!==(intersection?3:2))throw Error('点线或曲线引用的参数数量不正确');
      for(const name of entity(args[0],problem.points)){incidence(name,args[1]);if(intersection)incidence(name,args[2]);}
    }
    else if(source.match(/\b(?:tangent|focus|directrix|center|a|b|c|e|eccentricity|focalDistance|radius|p)\s*\(/))unsupported.push(q.source);
    else sources.push(metric(source));
  }catch(error){unsupported.push(`${q.source}: ${(error as Error).message}`);}
  try{const geometry=symbolicGeometry(problem,name=>[point(name,0),point(name,1),'0']);sources.push(...geometry.sources.map(metric));unsupported.push(...geometry.unsupported);}catch(error){unsupported.push((error as Error).message);}
  if(problem.mode==='plane'&&!context.document.objects.some(o=>o.kind==='point')&&!context.equations.some(e=>e.enabled)){
    const [a,b]=problem.points;if(a)sources.push(`${point(a,0)}=0`,`${point(a,1)}=0`);if(b)sources.push(`${point(b,1)}=0`,`${point(b,0)}>=0`);
  }
  for(const [i,u]of variables.entries()){if(u.min!==undefined)sources.push(`${tokens[i]}>=${u.min}`);if(u.max!==undefined)sources.push(`${tokens[i]}<=${u.max}`);}
  const coordinates:Record<string,[string,string]>={};for(const name of problem.points)try{coordinates[name]=[point(name,0),point(name,1)];}catch{/* The unsupported construction remains a joint numerical check. */}
  // A dependent object is not a new independent variable. Compile its source
  // map and domain instead of rejecting a whole family because it has children.
  const affected=new Set(variables.flatMap(u=>u.object?[...affectedObjects(doc,u.object),u.object]:[])),eliminated:string[]=[];
  for(const o of doc.objects.filter(o=>affected.has(o.id)))try{
    if(o.kind==='point'){point(objectSymbol(o),0);point(objectSymbol(o),1);if(o.construction.type!=='free')eliminated.push(objectSymbol(o));}
    else if(o.kind==='line')lineCoefficients(objectSymbol(o));
    else if(o.kind==='segment'||o.kind==='vector'){if(o.normalPlane)throw Error('法向量定义域尚未精确编译');for(const id of o.points){const n=objectSymbol(doc.objects.find(o=>o.id===id)!);point(n,0);point(n,1);}}
    else if(o.kind==='curve'){
      if(o.parametric)throw Error('参数曲线定义域尚未精确展开');
      for(const side of curveSource(o).split('='))for(const domain of algebraicDomains(side,['x','y',...tokens]))if(!/\b[xy]\b/.test(domain))guard(domain);
    }
    else if(o.kind==='number')algebraicDomains(metric(o.expression),tokens).forEach(guard);
    else if(o.kind!=='label')throw Error('该从动图形的定义域尚未精确展开');
  }catch(e){definitionUnsupported.push(`${objectSymbol(o)}：${(e as Error).message}`);}
  const prepare=(source:string)=>{
    const m=source.match(/^(.*?)(!=|>=|<=|=|>|<)(.*)$/);if(!m)return source;
    if(m[2]==='>='&&m[3].trim()==='0'&&nonnegativeExpression(m[1],tokens))return '0=0';
    if(m[2]==='='&&/\bsqrt\(/.test(source)&&nonnegativeExpression(m[1],tokens)&&nonnegativeExpression(m[3],tokens))return `${squaredExpression(m[1],tokens)}=${squaredExpression(m[3],tokens)}`;
    return source;
  };
  const curves:Record<string,string>={};for(const o of doc.objects)if(o.kind==='curve')try{curves[objectSymbol(o)]=curveSource(o);}catch{/* An unsupported curve stays in the full model. */}
  const normalized=normalizeRationalRelations([...sources,...definitionGuards].map(prepare),tokens);
  return {sources:normalized,tokens,coordinates,curves,complete:!unsupported.length,unsupported,definitions:{complete:!definitionUnsupported.length,unsupported:definitionUnsupported,eliminated,guards:normalizeRationalRelations([...definitionGuards],tokens)}};
}
