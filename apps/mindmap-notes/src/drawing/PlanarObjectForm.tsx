import {useState} from 'react';
import type {DrawingDocument} from './types';
import {nextSymbol} from './model';
import {objectSymbol} from './constraints/planarModel';

/** UI fields describe the geometry; serialization stays inside the workbench. */
export default function PlanarObjectForm({document,submit}:{document:DrawingDocument;submit:(source:string)=>boolean}){
 const [kind,setKind]=useState('point'),[name,setName]=useState('A'),[secondName,setSecondName]=useState('B'),[axis,setAxis]=useState('x'),[first,setFirst]=useState(''),[second,setSecond]=useState(''),[x,setX]=useState(''),[y,setY]=useState(''),[a,setA]=useState(''),[b,setB]=useState(''),[side,setSide]=useState('右');
 const [lineEquation,setLineEquation]=useState(''),[features,setFeatures]=useState<Record<string,boolean>>({}),[featureNames,setFeatureNames]=useState<Record<string,string>>({});
 const points=document.objects.filter(o=>o.kind==='point').map(objectSymbol),curves=document.objects.filter(o=>o.kind==='curve').map(objectSymbol),shapes=document.objects.filter(o=>['curve','line','segment','vector'].includes(o.kind)).map(objectSymbol);
 const choice=(label:string,value:string,change:(s:string)=>void,options:string[])=><label>{label}<select required value={value} onChange={e=>change(e.target.value)}><option value="">请选择</option>{options.map(n=><option key={n} value={n}>{n}</option>)}</select></label>;
 const conic=['ellipse','hyperbola','parabola'].includes(kind);
 const companionOptions=kind==='parabola'?[['focus1','焦点','F','Focus',1],['directrix1','准线','d','Directrix',1]]:[['focus1',axis==='y'?'下焦点':axis?'左焦点':'第1焦点（左/下）','F_1','Focus',1],['focus2',axis==='y'?'上焦点':axis?'右焦点':'第2焦点（右/上）','F_2','Focus',2],['directrix1',axis==='y'?'下准线':axis?'左准线':'第1准线（左/下）','d_1','Directrix',1],['directrix2',axis==='y'?'上准线':axis?'右准线':'第2准线（右/上）','d_2','Directrix',2],...(kind==='hyperbola'?[['asymptote1','渐近线1','l_1','Asymptote',1],['asymptote2','渐近线2','l_2','Asymptote',2]]:[])];
 const vertexOptions=kind==='parabola'?[['vertex1','顶点','V','Vertex',1]]:[['vertex1',axis==='y'?'下顶点':axis?'左顶点':'长轴负向顶点','V_1','Vertex',1],['vertex2',axis==='y'?'上顶点':axis?'右顶点':'长轴正向顶点','V_2','Vertex',2],...(kind==='ellipse'?[['vertex3',axis==='y'?'左顶点':axis?'下顶点':'短轴负向顶点','V_3','Vertex',3],['vertex4',axis==='y'?'右顶点':axis?'上顶点':'短轴正向顶点','V_4','Vertex',4]]:[])];
 const allocated=[name,...Object.entries(featureNames).filter(([k])=>!k.startsWith('vertex')).map(([,v])=>v)];
 const featureOptions=[...vertexOptions.map(option=>{const key=String(option[0]),fallback=featureNames[key]||nextSymbol(document,'point',allocated);allocated.push(fallback);return [option[0],option[1],fallback,option[3],option[4]];}),...companionOptions];
 const source=()=>{
  if(kind==='equationLine')return `直线 ${name}: ${lineEquation}`;
  if(kind==='point')return `${name}=(${x.trim()||'?'},${y.trim()||'?'})`;
  if(conic){const type={ellipse:'椭圆',hyperbola:'双曲线',parabola:'抛物线'}[kind as 'ellipse'];const statements=[`${type} ${name}${axis?' '+axis:''}`];if(a.trim())statements.push(`${name}_${kind==='parabola'?'p':'a'}=${a}`);if(kind!=='parabola'&&b.trim())statements.push(`${name}_b=${b}`);for(const [key,,fallback,command,index]of featureOptions)if(features[String(key)])statements.push(`${featureNames[String(key)]||fallback}=${command}(${name},${index})`);return statements.join('\n');}
  if(kind==='focus')return `${name}是${first}的${side}焦点`;
  if(kind==='intersection')return `${name}${secondName.trim()?','+secondName:''}=交点(${first},${second})`;
  if(kind==='through')return `${name}=过点直线(${first})`;
  return `${name}=${{midpoint:'Midpoint',line:'Line',segment:'Segment'}[kind]}(${first},${second})`;
 };
 return <section className="planar-object-form"><strong>添加对象</strong><form className="constraint-full-form" onSubmit={e=>{e.preventDefault();submit(source());}}>
 <label>对象类型<select aria-label="新建对象类型" value={kind} onChange={e=>{const k=e.target.value;setKind(k);setName(k==='point'?'A':['ellipse','hyperbola','parabola'].includes(k)?'C':k==='focus'?'F':k==='midpoint'?'N':k==='intersection'?'A':'l');setFirst('');setSecond('');setAxis('x');setA('');setB('');setX('');setY('');setFeatures({});setFeatureNames({});setLineEquation('');}}>{Object.entries({point:'点',ellipse:'椭圆',hyperbola:'双曲线',parabola:'抛物线',equationLine:'直线（输入方程）',through:'过一点的直线',line:'过两点的直线',segment:'线段',midpoint:'中点',focus:'焦点',intersection:'交点'}).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>
 <label>{kind==='intersection'?'第一个交点名称':'名称'}<input required aria-label="新建对象名称" value={name} onChange={e=>setName(e.target.value)} pattern="[A-Za-z][A-Za-z0-9_]*"/></label>
 {kind==='equationLine'&&<label>直线方程<input required aria-label="直线方程" value={lineEquation} onChange={e=>setLineEquation(e.target.value)} placeholder="例如 2x+3y-6=0、y=2x+1、x=3"/></label>}
 {kind==='point'&&<><label>横坐标<input aria-label="新建点横坐标" value={x} onChange={e=>setX(e.target.value)} placeholder="未知可留空"/></label><label>纵坐标<input aria-label="新建点纵坐标" value={y} onChange={e=>setY(e.target.value)} placeholder="未知可留空"/></label></>}
 {conic&&<><label>{kind==='ellipse'?'长轴方向':kind==='hyperbola'?'实轴方向':'开口方向'}<select value={axis} onChange={e=>setAxis(e.target.value)}>{kind==='ellipse'&&<option value="">题目未指定</option>}<option value="x">{kind==='parabola'?'x 轴正方向':'x 轴'}</option><option value="y">{kind==='parabola'?'y 轴正方向':'y 轴'}</option></select></label><label>{kind==='parabola'?'参数 p':axis?'半轴 a':'x 方向半轴'}<input value={a} onChange={e=>setA(e.target.value)} placeholder="未知可留空"/></label>{kind!=='parabola'&&<label>{axis?'半轴 b':'y 方向半轴'}<input value={b} onChange={e=>setB(e.target.value)} placeholder="未知可留空"/></label>}<small>{kind==='parabola'?'顶点为坐标原点；使用 y²=2px 或 x²=2py。':'中心为坐标原点，对称轴为两条坐标轴。'}未知参数由后续条件确定。</small></>}
 {conic&&<fieldset className="planar-conic-features"><legend>同时创建（可选）</legend>{featureOptions.map(([key,label,fallback])=><div key={String(key)}><label><input type="checkbox" checked={!!features[String(key)]} onChange={e=>setFeatures(v=>({...v,[String(key)]:e.target.checked}))}/>{label}</label>{features[String(key)]&&<label>名称<input required aria-label={`${label}名称`} pattern="[A-Za-z][A-Za-z0-9_]*" value={featureNames[String(key)]??String(fallback)} onChange={e=>setFeatureNames(v=>({...v,[String(key)]:e.target.value}))}/></label>}</div>)}</fieldset>}
 {kind==='focus'&&<>{choice('曲线',first,setFirst,curves)}<label>焦点位置<select value={side} onChange={e=>setSide(e.target.value)}>{['左','右','上','下'].map(s=><option value={s} key={s}>{s}焦点</option>)}</select></label></>}
 {kind==='intersection'&&<><label>第二个交点名称<input value={secondName} onChange={e=>setSecondName(e.target.value)} placeholder="只需一个交点时留空"/></label>{choice('第一图形',first,setFirst,shapes)}{choice('第二图形',second,setSecond,shapes.filter(n=>n!==first))}</>}
 {['through','line','segment','midpoint'].includes(kind)&&choice(kind==='through'?'经过的点':'第一点',first,setFirst,points)}
 {['line','segment','midpoint'].includes(kind)&&choice('第二点',second,setSecond,points.filter(n=>n!==first))}
 <button type="submit">添加对象</button></form></section>;
}
