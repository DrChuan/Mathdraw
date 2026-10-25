import {useState} from 'react';
import type {DrawingDocument,GeometryObject,DrawingChange} from './types';
import {validSymbol} from './model';
import {dependencies} from './geometry';
export default function SymbolRename({doc,obj,change,editConditions}:{doc:DrawingDocument;obj:GeometryObject;change:DrawingChange;editConditions:()=>void}){
 const [name,setName]=useState(obj.symbol??''),[error,setError]=useState('');
 const used=doc.objects.some(o=>o.id!==obj.id&&o.symbol===name),affected=doc.objects.filter(o=>o.id!==obj.id&&dependencies(o).includes(obj.id));
 const managed=!!obj.constraintSet||obj.kind==='point'&&obj.construction.type==='constraint';
 return <details className="symbol-rename"><summary>引用符号：{obj.symbol} · 安全改名</summary><small>{obj.symbolHistory?.length?`曾用符号：${obj.symbolHistory.join("、")}。`:""}显示名称只改变图中文字；引用符号用于公式与条件。现有关联通过对象ID保留。</small>{managed?<button onClick={editConditions}>到条件体系中修改</button>:<form onSubmit={e=>{e.preventDefault();if(!validSymbol(name)||used){setError('符号无效、保留或已被其他对象使用');return;}try{if(change({...doc,objects:doc.objects.map(o=>o.id===obj.id?{...o,symbol:name,symbolHistory:[...new Set([...(o.symbolHistory??[]),o.symbol??o.name])].slice(-20),name:o.name===o.symbol?name:o.name}:o)}))setError('');}catch(ex){setError((ex as Error).message);}}}><label>新符号<input value={name} onChange={e=>{setName(e.target.value);setError('');}}/></label><small>{affected.length?`将保持以下对象的关联：${affected.map(o=>o.symbol??o.name).join('、')}`:'没有其他对象直接引用它。'}{used?' · 新符号已占用':''}</small><button disabled={name===obj.symbol||used||!validSymbol(name)}>确认改名</button></form>}{error&&<small role="alert">{error}</small>}</details>;
}
