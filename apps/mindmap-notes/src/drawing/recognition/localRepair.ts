import type {RecognizedQuestion} from './types';
import {extractionPrompt,parseExtraction,validateRecognition,activeItems} from './model';
import {pointNames,segmentsFrom} from '../constraints/input';
import {replyText} from './adapter';
/** A local proposal replaces exactly one item. All other records retain IDs,
 * source boxes, scopes, enabled state and manual edits. Never commit directly. */
export async function proposeItemRepair(q:RecognizedQuestion,itemId:string,id:string,call:(id:string,stage:'ocr'|'extract',image:string,prompt?:string)=>Promise<unknown>){
 const item=q.items.find(i=>i.id===itemId);
 if(!item?.quote?.trim()||item.sharedQuote)throw Error('请先在编辑区为本条填写独立原文片段，再局部提取。');
 const prompt=extractionPrompt+'\n本次为局部修订。只提取下面【本条原文】，不读取图片中的其他条件；不重识别全文，不推导。已有对象可引用，不要重新定义，也不要生成其他小问条件。输出协议仍相同，scopes 仅 common，所有新条目归 common；paragraphs 只含本条原文。若缺少必要定义，用 uncertain，不猜。\n已有点名：'+q.points+'\n已有定义（只供引用）：\n'+activeItems({...q,activeScope:item.scope}).filter(i=>i.role==='definition'&&i.id!==itemId).map(i=>i.source).join('\n')+'\n当前模式：'+q.mode+'，必须保持；points 返回既有点名列表。\n【本条原文】\n'+item.quote;
 const response=await call(id,'extract',q.image,prompt);
 const extracted=parseExtraction(replyText(response),{image:q.image,width:q.width,height:q.height,regions:q.regions});
 if(extracted.mode!==q.mode)throw Error('局部提取改变了作图模式，请使用全文提取核对。');
 const knownPoints=new Set(q.points.split(/\s+/).filter(Boolean));
 if(extracted.points.split(/\s+/).some(n=>n&&!knownPoints.has(n)))throw Error('局部结果需要新增点，请改用全文提取核对对象。');
 const normalize=(s:string)=>s.replace(/[\s${}]/g,'');
 const quote=normalize(item.quote);
 const replacements=extracted.items.map((i,n)=>{
  if(!i.quote||!quote.includes(normalize(i.quote)))throw Error('局部结果包含原文片段之外的条件，请编辑该条或使用全文提取。');
  return {...i,id:n===0?item.id:`item-${crypto.randomUUID()}`,scope:item.scope,regions:item.regions,enabled:item.enabled,modified:true,originalSource:item.originalSource??item.source};
 });
 if(!replacements.length)throw Error('没有提取到可核对的新条目，原条目未修改。');
 const segments=segmentsFrom([q.segments,extracted.segments].filter(Boolean).join(', '),pointNames(q.points)).map(e=>e.join(' ')).join(', ');
 const next={...q,segments,revision:q.revision+1,items:q.items.flatMap(i=>i.id===itemId?replacements:[i])};
 validateRecognition(next);return next;
}
export function recognitionScopePath(q:RecognizedQuestion){const path:string[]=[],seen=new Set<string>();let scope=q.scopes.find(s=>s.id===q.activeScope);while(scope&&!seen.has(scope.id)){seen.add(scope.id);path.unshift(scope.label);scope=q.scopes.find(s=>s.id===scope!.parent);}return path.join(' → ');}
