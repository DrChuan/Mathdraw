import {invoke} from '@tauri-apps/api/core';
import type {RecognitionSettings} from './types';
export const recognitionAdapter={
 chooseImage:()=>invoke<string|null>('recognition_choose_image'),
 pasteImage:()=>invoke<string>('recognition_paste_image'),
 settings:()=>invoke<RecognitionSettings>('recognition_settings'),
 save:(settings:RecognitionSettings,key:string,forget=false)=>invoke<void>('recognition_save_settings',{settings,key,forget}),
 call:(id:string,stage:'ocr'|'extract',image:string,prompt='')=>invoke<unknown>('recognition_call',{id,stage,image,prompt}),
 cancel:(id:string)=>invoke<void>('recognition_cancel',{id}),
};
export function replyText(value:unknown):string{
 const v=value as {output?:{choices?:{message?:{content?:{text?:string}[]|string}}[]}};
 const content=v.output?.choices?.[0]?.message?.content;
 if(typeof content==='string')return content;
 if(Array.isArray(content))return content.flatMap(p=>typeof p.text==='string'?[p.text]:[]).join('\n');
 throw Error('百炼未返回识别文本');
}
export async function imageData(file:Blob|string):Promise<{image:string;width:number;height:number}>{
 if(typeof file!=='string'&&(!['image/png','image/jpeg'].includes(file.type)||file.size>8*1024*1024))throw Error('请选择 8 MB 以内的 PNG/JPEG 题干截图');
 // data: is permitted by the desktop CSP; blob: URLs are deliberately not used.
 const url=typeof file==='string'?file:await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('读取截图失败，请重新选择'));reader.readAsDataURL(file);});
 if(!/^data:image\/(png|jpeg);base64,/.test(url)||url.length>12*1024*1024)throw Error('截图格式或大小无效');
 const img=new Image();
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{img.onload=null;img.onerror=null;reject(Error('加载截图超时，请重新选择'));},15000);img.onload=()=>{clearTimeout(timer);resolve();};img.onerror=()=>{clearTimeout(timer);reject(Error('无法解码截图，请选择有效的 PNG/JPEG 图片'));};img.src=url;});
 if(img.width>12000||img.height>12000||img.width*img.height>16000000)throw Error('图片过大，请先裁剪题干');
  const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d')!.drawImage(img,0,0);const image=canvas.toDataURL('image/png');if(image.length>6*1024*1024)throw Error('截图超过保存大小限制，请裁剪或压缩');return {image,width:img.width,height:img.height};
}
