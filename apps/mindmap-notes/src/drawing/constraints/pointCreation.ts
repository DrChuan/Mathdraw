import type {DrawingDocument} from '../types';
import {objectSymbol} from './planarModel';
import {validSymbol} from '../model';
export function pointCreationNames(source:string){
 const names=source.trim().split(/[\s,，、]+/).filter(Boolean);
 if(!names.length)throw Error('请输入点名');if(names.length>50)throw Error('一次最多创建 50 个点');
 if(names.some(n=>!validSymbol(n)))throw Error('点名使用字母、数字或下划线，多个点用空格或逗号分隔');
 if(new Set(names).size!==names.length)throw Error('点名不能重复');return names;
}
/** Multiple points and explicit incidences form one creation transaction. */
export function pointCreationSource(document:DrawingDocument,name:string,x:string,y:string,path=''){
 const names=pointCreationNames(name);
 if(path){const object=document.objects.find(o=>objectSymbol(o)===path);if(!object||!['curve','line','segment','vector'].includes(object.kind))throw Error('请选择已有的曲线或直线');}
 return names.flatMap(n=>[`${n}=(${x.trim()||'?'},${y.trim()||'?'})`,...(path?[`onCurve(${n},${path})`]:[])]).join('\n');
}
