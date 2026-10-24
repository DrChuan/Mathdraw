import type {ConstraintProblem,Condition} from './types';
import {expandConditions} from './compile';
import {latexToExpression} from '../latex';
import {scalarRelation} from './scalarRelations';
import {parseVectorRelation} from './vectors';
import {entity,conditionValueSource} from './input';
import {substituteNames} from '../parameters';

export const sum=(v:string[])=>v.length?v.map(x=>`(${x})`).join('+'):'0';
export const difference=(a:string[],b:string[])=>a.map((x,i)=>`(${x})-(${b[i]})`);
export const productSum=(a:string[],b:string[])=>sum(a.map((x,i)=>`(${x})*(${b[i]})`));
export const crossSource=(a:string[],b:string[])=>[0,1,2].map(i=>`(${a[(i+1)%3]})*(${b[(i+2)%3]})-(${a[(i+2)%3]})*(${b[(i+1)%3]})`);
const square=(a:string[])=>productSum(a,a);
/** Exact trigonometric constants for written special angles or written trig
 * values. No near-integer recognition of a floating cosine is performed. */
export function angleConstant(c:Condition,sine=false):string|undefined{
 const m=c.source.trim().match(/^(sin|cos|tan)(?:Acute|Obtuse)?\s*\([\s\S]*\)\s*=\s*([\s\S]+)$/i);
 if(m){const v=`(${latexToExpression(m[2])})`,s=m[1].toLowerCase();if(sine)return s==='sin'?v:s==='cos'?`sqrt(1-${v}^2)`:`abs(${v})/sqrt(1+${v}^2)`;
  const cos=s==='cos'?v:s==='sin'?`sqrt(1-${v}^2)`:`1/sqrt(1+${v}^2)`;return s==='cos'||(c.value??0)<=90?cos:`-(${cos})`;
 }
 const written=c.source.split('=').at(-1)?.trim(),radians=written?.match(/^rad\(([\s\S]*)\)$/i);if(radians||written&&/\\pi|\bpi\b|π/.test(written))return `${sine?'sin':'cos'}(${latexToExpression(radians?.[1]??written!)})`;
 const cos:Record<number,string>={0:'1',30:'sqrt(3)/2',45:'sqrt(2)/2',60:'1/2',90:'0',120:'-1/2',135:'-sqrt(2)/2',150:'-sqrt(3)/2',180:'-1',210:'-sqrt(3)/2',225:'-sqrt(2)/2',240:'-1/2',270:'0',300:'1/2',315:'sqrt(2)/2',330:'sqrt(3)/2'};
 return cos[((sine?90-(c.value??0):c.value??0)%360+360)%360]??(sine&&c.value===180?'0':undefined);
}
function exactValue(c:Condition|undefined,fallback:number|undefined){
 const source=c&&conditionValueSource(c);
 if(source&&c&&!/^(sin|cos|tan)/i.test(c.source))return latexToExpression(source);
 return String(fallback??0);
}
/** Shared polynomial/semialgebraic compilation for planar and spatial geometry.
 * Unsupported checks remain explicit; they are never frozen as constants. */
export function symbolicGeometry(problem:ConstraintProblem,point:(name:string)=>string[]){
 const sources:string[]=[],unsupported:string[]=[],owners=new Map(problem.conditions.map(c=>[c.id,c]));
 const v=(r:string[])=>r.length===1?point(r[0]):difference(point(r[1]),point(r[0]));
 const normal=(r:string[])=>crossSource(difference(point(r[1]),point(r[0])),difference(point(r[2]),point(r[0])));
 const direction=(r:string[])=>r.length===1?point(r[0]):r.length===2?v(r):normal(r);
 const nonzero=(a:string[])=>sources.push(`${square(a)}>0`);
 const zero=(a:string[])=>sources.push(...a.map(x=>`${x}=0`));
 for(const c of expandConditions(problem)){
  const r=c.refs,owner=owners.get(c.owner),value=exactValue(owner,c.value),a=r[0]?direction(r[0]):[],b=r[1]?direction(r[1]):[];
  try{
   switch(c.kind){
    case 'distance':sources.push(`${square(v(r[0]))}=(${value})^2`,`(${value})>0`);break;
    case 'equal':case 'ratio':sources.push(`${square(v(r[0]))}=(${c.kind==='ratio'?value:'1'})^2*(${square(v(r[1]))})`);nonzero(v(r[0]));nonzero(v(r[1]));break;
    case 'vectorSum':zero(difference(point(r[0][0]).map((x,i)=>`(${x})+(${point(r[0][1])[i]})`),point(r[0][2]).map((x,i)=>`(${x})+(${point(r[0][3])[i]})`)));break;
    case 'vectorRelation':{const coefficients=c.coefficientSources??(owner?parseVectorRelation(owner.source,s=>entity(s,problem.points)).coefficientSources:undefined);if(!coefficients){unsupported.push(owner?.source??'向量系数');break;}zero([0,1,2].map(axis=>sum(r.map((ref,i)=>`(${coefficients[i]})*(${v(ref)[axis]})`))));break;}
    case 'division':{const t=`(${value})/(1+(${value}))`;zero(difference(point(r[0][0]),point(r[1][0]).map((x,i)=>`(${x})+(${t})*(${v(r[1])[i]})`)));nonzero(v(r[1]));break;}
    case 'vectorDot':sources.push(`${productSum(a,b)}=${value}`);break;
    case 'parallel':case 'perpendicular':{
     nonzero(a);nonzero(b);const same=r[0].length===r[1].length;
     if((c.kind==='parallel')===same)zero(crossSource(a,b));else sources.push(`${productSum(a,b)}=0`);break;
    }
    case 'collinear':zero(crossSource(difference(point(r[0][1]),point(r[0][0])),difference(point(r[0][2]),point(r[0][0]))));nonzero(difference(point(r[0][1]),point(r[0][0])));break;
    case 'coplanar':sources.push(`${productSum(normal(r[0]),difference(point(r[0][3]),point(r[0][0])))}=0`);nonzero(normal(r[0]));break;
    case 'onSegment':{
     const d=v(r[1]),delta=difference(point(r[0][0]),point(r[1][0]));nonzero(d);zero(crossSource(d,delta));sources.push(`${productSum(delta,d)}>=0`,`(${square(d)})-(${productSum(delta,d)})>=0`);break;
    }
    case 'pointLineDistance':{
     const d=v(r[1]),delta=difference(point(r[0][0]),point(r[1][0]));nonzero(d);sources.push(`${square(crossSource(delta,d))}=(${value})^2*(${square(d)})`,`(${value})>=0`);break;
    }
    case 'pointPlaneDistance':{
     const n=normal(r[1]),delta=difference(point(r[0][0]),point(r[1][0]));nonzero(n);sources.push(`(${productSum(delta,n)})^2=(${value})^2*(${square(n)})`,`(${value})>=0`);break;
    }
    case 'vertexAngle':case 'lineAngle':case 'linePlaneAngle':{
     const x=c.kind==='vertexAngle'?difference(point(r[0][0]),point(r[1][0])):a,y=c.kind==='vertexAngle'?difference(point(r[2][0]),point(r[1][0])):b;
     const k=owner&&angleConstant(owner,c.kind==='linePlaneAngle');if(k===undefined){unsupported.push(owner?.source??c.kind);break;}nonzero(x);nonzero(y);
     sources.push(`(${productSum(x,y)})^2=(${k})^2*(${square(x)})*(${square(y)})`);
     if(c.kind==='vertexAngle')sources.push(`(${productSum(x,y)})*(${k})>=0`);break;
    }
    case 'regularPolygon':{
     const names=r[0],n=names.length,ratios:Record<number,string[]>={3:['0','1'],4:['0','1','2'],5:['0','1','(3+sqrt(5))/2'],6:['0','1','3','4'],8:['0','1','2+sqrt(2)','3+2*sqrt(2)','4+2*sqrt(2)']},factors=ratios[n];
     if(!factors){unsupported.push(owner?.source??'正多边形');break;}const side=square(difference(point(names[1]),point(names[0])));sources.push(`${side}>0`);nonzero(normal(names));
     for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const k=Math.min(j-i,n-j+i);sources.push(`${square(difference(point(names[j]),point(names[i])))}=(${factors[k]})*(${side})`);}break;
    }
    case 'dihedral':{
     const axis=v(r[0]),x=difference(point(r[1][0]),point(r[0][0])),y=difference(point(r[2][0]),point(r[0][0])),aa=square(axis),u=x.map((v,i)=>`(${aa})*(${v})-(${productSum(x,axis)})*(${axis[i]})`),w=y.map((v,i)=>`(${aa})*(${v})-(${productSum(y,axis)})*(${axis[i]})`),k=owner&&angleConstant(owner);
     if(k===undefined){unsupported.push(owner?.source??'二面角');break;}nonzero(axis);nonzero(u);nonzero(w);sources.push(`(${productSum(u,w)})^2=(${k})^2*(${square(u)})*(${square(w)})`,`(${productSum(u,w)})*(${k})>=0`);break;
    }
    case 'scalarEquation':{const parsed=scalarRelation(owner!.source,problem.points);if(parsed.measures.some(m=>m.angle)){unsupported.push(owner!.source);break;}const replacements=Object.fromEntries(parsed.measures.map(m=>[m.name,`sqrt(${square(difference(point(m.points[1]),point(m.points[0])))})`]));sources.push(substituteNames(parsed.prepared,replacements));break;}
    case 'volume':{
     const names=r[0];if(c.solid==='pyramid'||c.solid==='prism'){
      const base=c.solid==='pyramid'?names.slice(1):names.slice(0,names.length/2),top=c.solid==='pyramid'?names[0]:names[names.length/2];
      const areaVector=[0,1,2].map(axis=>sum(base.slice(1,-1).map((_,i)=>crossSource(difference(point(base[i+1]),point(base[0])),difference(point(base[i+2]),point(base[0])))[axis])));
      const triple=productSum(areaVector,difference(point(top),point(base[0])));sources.push(`abs(${triple})=${c.solid==='pyramid'?6:2}*(${value})`,`(${value})>0`);if(base.length>3)unsupported.push(owner?.source??'多边形体积');
     }else if(['cylinder','cone','coneFrustum'].includes(c.solid!)){
      const [o,t,a,b]=names,radius=square(difference(point(a),point(o))),height=`sqrt(${square(difference(point(t),point(o)))})`,top=b?square(difference(point(b),point(t))):radius;
      sources.push(`pi*(${c.solid==='cone'?`(${radius})/3`:c.solid==='coneFrustum'?`((${radius})+sqrt((${radius})*(${top}))+(${top}))/3`:radius})*(${height})=${value}`,`(${value})>0`);
     }else unsupported.push(owner?.source??'曲面体积');break;
    }
    case 'area':{
     if(r[0].length===3){const n=normal(r[0]);sources.push(`${square(n)}=4*(${value})^2`,`(${value})>0`);}else unsupported.push(owner?.source??'多边形面积');break;
    }
    case 'similar':{
     const [x,y]=r,u=square(difference(point(x[1]),point(x[0]))),w=square(difference(point(y[1]),point(y[0])));sources.push(`${u}>0`,`${w}>0`);
     for(let i=0;i<x.length;i++)for(let j=i+1;j<x.length;j++)sources.push(`(${square(difference(point(x[j]),point(x[i])))})*(${w})=(${square(difference(point(y[j]),point(y[i])))})*(${u})`);break;
    }
    case 'homothety':{
     const [base,top]=r,x=difference(point(base[1]),point(base[0])),y=difference(point(top[1]),point(top[0])),ratio=`(${productSum(x,y)})/(${square(x)})`;nonzero(x);
     for(let i=1;i<base.length;i++)zero(difference(difference(point(top[i]),point(top[0])),difference(point(base[i]),point(base[0])).map(v=>`(${ratio})*(${v})`)));break;
    }
    case 'onCurve':case 'curveDefinition':{
     const curve=problem.curves?.find(k=>k.id===c.curve);if(!curve){unsupported.push('曲线定义缺失');break;}
     if(curve.type!=='circle'||curve.method==='threePoint'){unsupported.push(`曲线 ${curve.name}`);break;}
     const center=point(curve.points[0]),radius=curve.method==='centerRadius'?`(${curve.valueSource??curve.value})^2`:square(difference(point(curve.points[1]),center));sources.push(`${radius}>0`);
     const names=c.kind==='onCurve'?[r[0][0]]:curve.points.slice(1);
     for(const name of names)sources.push(`${square(difference(point(name),center))}=${radius}`);
     if(curve.plane){const n=normal(curve.plane);nonzero(n);for(const name of [...names,...curve.points])sources.push(`${productSum(difference(point(name),point(curve.plane[0])),n)}=0`);}break;
    }
    case 'circumradius':{
     const p=r[0],u=difference(point(p[1]),point(p[0])),w=difference(point(p[2]),point(p[0])),n=crossSource(u,w);nonzero(n);
     sources.push(`(${square(u)})*(${square(w)})*(${square(difference(point(p[2]),point(p[1])))})=4*(${value})^2*(${square(n)})`,`(${value})>0`);break;
    }
    case 'concyclic':{
     const p=r[0],origin=point(p[0]),u=difference(point(p[1]),origin),w=difference(point(p[2]),origin),uu=square(u),ww=square(w),uw=productSum(u,w),det=`(${uu})*(${ww})-(${uw})^2`,alpha=`(${ww})*((${uu})-(${uw}))/(2*(${det}))`,beta=`(${uu})*((${ww})-(${uw}))/(2*(${det}))`,delta=u.map((x,i)=>`(${alpha})*(${x})+(${beta})*(${w[i]})`),radius=square(delta);
     sources.push(`${det}>0`);for(const name of p){const d=difference(point(name),origin);sources.push(`${productSum(d,crossSource(u,w))}=0`,`${square(difference(d,delta))}=${radius}`);}if(c.value!==undefined)sources.push(`${radius}=(${value})^2`,`(${value})>0`);break;
    }
    case 'sphere':nonzero(difference(point(r[0][1]),point(r[0][0])));break;
    case 'cylinder':case 'cone':case 'coneFrustum':nonzero(difference(point(r[0][1]),point(r[0][0])));nonzero(difference(point(r[0][2]),point(r[0][0])));unsupported.push(owner?.source??c.kind);break;
    default:unsupported.push(owner?.source??c.kind);
   }
  }catch{unsupported.push(owner?.source??c.kind);}
 }
 // Original polygon validity (including self-intersection) is also checked by
 // the geometry evaluator. Until encoded here it prevents a coverage claim.
 for(const c of problem.conditions.filter(c=>c.enabled)){
  if(['parallelogram','rectangle','rhombus','square','cube'].includes(c.kind)){const p=c.refs[0];nonzero(normal([p[0],p[1],p[3]]));if(c.kind==='cube')sources.push(`(${productSum(normal([p[0],p[1],p[3]]),difference(point(p[4]),point(p[0])))})!=0`);}
  else if(['prism','pyramid','frustum'].includes(c.kind)){const p=c.refs[0],base=c.kind==='pyramid'?p.slice(1):p.slice(0,p.length/2),top=c.kind==='pyramid'?p[0]:p[p.length/2];nonzero(normal(base));sources.push(`(${productSum(normal(base),difference(point(top),point(base[0])))})!=0`);if(base.length>3||c.kind==='frustum')unsupported.push(`${c.source}: 多边形有效性仍需回代`);}
  else if(['congruent','similar'].includes(c.kind))for(const polygon of c.refs){nonzero(normal(polygon));if(polygon.length>3)unsupported.push(`${c.source}: 多边形有效性仍需回代`);}
 }
 return {sources,unsupported:[...new Set(unsupported)],complete:!unsupported.length};
}
