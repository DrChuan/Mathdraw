import type {RecognizedQuestion} from './types';
import {extractionPrompt,ocrRegions,parseExtraction,recognitionText,normalizeQuestionParagraphs,validateRecognition} from './model';
import {replyText} from './adapter';
export type RecognitionAction='text'|'all'|'conditions';
type ImageSource=Pick<RecognizedQuestion,'image'|'width'|'height'>;
export function createTextDraft(image:ImageSource):RecognizedQuestion{return {...image,version:1,id:crypto.randomUUID(),regions:[],originalText:'',editedText:'',paragraphs:[],mode:'coordinate',points:'',segments:'',scopes:[{id:'common',label:'公共题干'}],activeScope:'common',items:[],warnings:[],revision:0,textOnly:true,inputSource:'image'};}
/** OCR is independently useful. Never discard it because a later model reply
 * is malformed, and never turn unmeasured generated boxes into source regions. */
export function ocrTextDocument(raw:unknown,image:ImageSource):RecognizedQuestion {
 let regions:RecognizedQuestion['regions']=[],warnings:string[]=[];
 try{regions=ocrRegions(raw,image.width,image.height);}catch{warnings.push('OCR 位置无效，保留题文但无法定位原图，请核对。');}
 const markdown=(text:string)=>recognitionText(text.replace(/\\+\(/g,()=>'$').replace(/\\+\)/g,()=>'$').replace(/\\+\[/g,()=>'$$').replace(/\\+\]/g,()=>'$$'));
 let paragraphs=regions.map(r=>({text:markdown(r.text),regions:[r.id]}));
 if(!paragraphs.length){let text=replyText(raw).trim();try{const rows=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));if(Array.isArray(rows)&&rows.every(row=>row&&typeof row.text==='string'))text=rows.map(row=>row.text).join('\n');}catch{/* Plain OCR text remains plain text. */}if(!text)throw Error('OCR 未返回题文');paragraphs=[{text:markdown(text),regions:[]}];warnings.push('OCR 未返回实测来源区域，可编辑文本后提取条件；不会生成虚构来源框。');}
 paragraphs=normalizeQuestionParagraphs(paragraphs);const originalText=paragraphs.map(p=>p.text).join('\n\n');
 const q:RecognizedQuestion={...image,version:1,id:crypto.randomUUID(),regions,originalText,editedText:originalText,paragraphs,mode:'coordinate',points:'',segments:'',scopes:[{id:'common',label:'公共题干'}],activeScope:'common',items:[],warnings,revision:0,textOnly:true,inputSource:'image'};
 validateRecognition(q);return q;
}
/** User-selected stages only, no retries. Cancelled/stale replies cannot launch
 * another stage or overwrite edited text. The text route never re-runs OCR. */
export async function recognizeQuestion(options:{image:ImageSource;previous?:RecognizedQuestion;revised:boolean;action?:RecognitionAction;id:string;call:(id:string,stage:'ocr'|'extract',image:string,prompt?:string)=>Promise<unknown>;active:()=>boolean;progress:(s:string)=>void;onText?:(q:RecognizedQuestion)=>void}){
 const {image,previous,id,call,active,progress,onText}=options,action=options.action??(options.revised?'conditions':'all');
 let regions=previous?.regions.filter(r=>r.localization!=='model')??[];
 if(action==='conditions'&&!previous?.editedText.trim())throw Error('请先识别或输入题文，再提取条件');
 if(action!=='conditions'){
  progress('正在识别题文与公式…');const ocr=await call(id,'ocr',image.image);if(!active())return;
  const text=ocrTextDocument(ocr,image);regions=text.regions;
  if(action==='text')return text;
  onText?.(text);if(!active())return;
 }
 progress(action==='conditions'?'正在从当前题文提取条件…':'正在将截图题文整理为条件…');
 const prompt=extractionPrompt+'\nOCR 区域：\n'+JSON.stringify(regions.map(r=>({id:r.id,text:r.text})))+(action==='conditions'?'\n本次只根据以下当前文本提取条件，全文必须原样保留。原图与 OCR 只用于寻找文本来源，不得用截图覆盖用户改写的数值、名称、条件或添加文本中没有的条件。引用不到原图的片段 regions 留空，quote 必须摘录当前文本：\n'+previous!.editedText:'');
 const response=await call(id,'extract',image.image,prompt);if(!active())return;
 const next=parseExtraction(replyText(response),{...image,regions});
 return action==='conditions'&&previous?{...mergeRecognitionCandidate(previous,next),warnings:next.warnings.map(w=>w.includes('未返回来源区域')?w.replace('请核对或重框来源','来源以当前题文为准，截图可手动关联'):w),textOnly:false,inputSource:'text' as const}:next;
}
export function mergeRecognitionCandidate(previous:RecognizedQuestion,next:RecognizedQuestion):RecognizedQuestion {
 const used=new Set<string>();return {...next,id:previous.id,originalText:previous.originalText,editedText:previous.editedText,paragraphs:previous.paragraphs,revision:previous.revision+1,items:next.items.map(item=>{
  const original=previous.items.find(old=>!used.has(old.id)&&old.role===item.role&&old.scope===item.scope&&old.source===item.source&&(item.source!==''||old.text===item.text));
  const id=original?.id??`item-${crypto.randomUUID()}`;used.add(id);return {...item,id,originalSource:original?.originalSource,modified:original?.modified};
 })};
}
