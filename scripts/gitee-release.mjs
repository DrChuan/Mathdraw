// Gitee credentials stay in the environment or macOS Keychain, never artifacts.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const giteeRepo='liu_chuanning/mathdraw';
const api=`https://gitee.com/api/v5/repos/${giteeRepo}`;
export function giteeToken(){
  if(process.env.GITEE_TOKEN?.trim())return process.env.GITEE_TOKEN.trim();
  if(process.platform==='darwin')try{return execFileSync('/usr/bin/security',['find-generic-password','-a','liu_chuanning','-s','lab.chuan.mathdraw.gitee-publish','-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{}
  throw Error('尚未配置 Gitee 发布令牌。请双击“配置Gitee发布.command”；只需配置一次。也可使用 GITEE_TOKEN 环境变量。');
}
async function request(path,token,{method='GET',body,allow404=false,timeout=30000}={}){
  const headers={Accept:'application/json',Authorization:`Bearer ${token}`};
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  const response=await fetch(api+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(allow404&&response.status===404)return null;
  if(!response.ok){let reason='';try{const data=await response.json();reason=String(data.message??'').split(token).join('[已隐藏]').slice(0,240);}catch{}throw Error(`Gitee ${method} ${path.split('?')[0]} 失败（${response.status}）：${reason}。已上传内容保留，可继续上次发布。`);}
  return response.status===204?null:response.json();
}
export async function checkGitee(){
  const token=giteeToken(),repo=await request('',token);
  if(repo.full_name?.toLowerCase()!==giteeRepo||repo.private)throw Error('Gitee 发布仓库不存在或尚未公开');
  return repo;
}
async function putFile(path,content,token,message){
  const found=await request(`/contents/${path}?ref=master`,token,{allow404:true}),existing=found?.sha?found:null;
  const encoded=Buffer.from(content).toString('base64');
  if(existing?.content?.replace(/\s/g,'')===encoded)return;
  if(path==='latest.json'&&existing?.content){
    const old=JSON.parse(Buffer.from(existing.content.replace(/\s/g,''),'base64').toString('utf8')),next=JSON.parse(content);
    const a=old.version.split('.').map(Number),b=next.version.split('.').map(Number);
    if((a[0]-b[0]||a[1]-b[1]||a[2]-b[2])>0)throw Error('拒绝回退 Gitee 更新版本');
  }
  await request(`/contents/${path}`,token,{method:existing?'PUT':'POST',body:{content:encoded,message,branch:'master',...(existing?{sha:existing.sha}:{})}});
}
async function digestDownload(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error(`Gitee 附件无法公开下载（${response.status}）`);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){hash.update(chunk);size+=chunk.length;}
  return {hash:hash.digest('hex'),size};
}
/** Only called after publish-mathdraw verifies the original signed packages. */
export async function publishGitee({dir,version,names,manifest,notes}){
  await checkGitee();const token=giteeToken(),tag=`v${version}`;
  // A release requires a commit. No source or user drawings are copied here.
  const branch=await request('/branches/master',token,{allow404:true});
  if(!branch)await putFile('README.md','# Mathdraw\n\n数学绘图桌面工具的安装包与自动更新镜像。\n\nGitHub: https://github.com/DrChuan/Mathdraw/releases\n\n下载请使用本仓库的发行版（Releases）。\n',token,'初始化安装包镜像');
  let release=await request(`/releases/tags/${tag}`,token,{allow404:true});
  if(!release)release=await request('/releases',token,{method:'POST',body:{tag_name:tag,target_commitish:'master',name:`Mathdraw ${version}`,body:notes,prerelease:false}});
  const urls=new Map();let attachments=await request(`/releases/${release.id}/attach_files`,token);
  if(!Array.isArray(attachments))attachments=attachments?.data??[];
  for(const name of names){
    const bytes=readFileSync(join(dir,name)),expected=createHash('sha256').update(bytes).digest('hex');
    let attachment=attachments.find(a=>(a.name??a.file_name)===name);
    if(!attachment){
      const body=new FormData();body.append('file',new Blob([bytes]),name);
      attachment=await request(`/releases/${release.id}/attach_files`,token,{method:'POST',body,timeout:180000});
      attachment=attachment?.data??attachment;
    }
    const url=attachment.browser_download_url??attachment.download_url??`https://gitee.com/api/v5/repos/${giteeRepo}/releases/${release.id}/attach_files/${attachment.id}/download`;
    const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Gitee 返回的附件地址不是 HTTPS');
    const actual=await digestDownload(url);
    if(actual.hash!==expected||actual.size!==bytes.length)throw Error(`Gitee 附件校验不一致：${name}。保留现有附件，请检查后重试；不会覆盖公开附件。`);
    urls.set(name,url);console.log(`Gitee 已校验：${name}`);
  }
  const mirrored=structuredClone(manifest);
  for(const [platform,entry]of Object.entries(mirrored.platforms))entry.url=urls.get(platform.startsWith('windows-')?`Mathdraw_${version}_x64-setup.exe`:'Mathdraw.app.tar.gz');
  const text=JSON.stringify(mirrored,null,2)+'\n';writeFileSync(join(dir,'latest-gitee.json'),text);
  // Advertise only after every payload is publicly downloadable and byte-verified.
  const current=await request('/contents/latest.json?ref=master',token,{allow404:true});
  if(current?.content){const old=JSON.parse(Buffer.from(current.content.replace(/\s/g,''),'base64').toString('utf8'));const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];};if(compare(old.version,version)>0)throw Error('拒绝将 Gitee 更新入口回退到较旧版本');}
  await putFile('latest.json',text,token,`更新 Mathdraw ${version}`);
  const advertised=await fetch(`https://gitee.com/${giteeRepo}/raw/master/latest.json`,{signal:AbortSignal.timeout(15000)});
  if(!advertised.ok||(await advertised.text()).trim()!==text.trim())throw Error('Gitee 更新入口尚未通过公开读取校验，请稍后继续发布');
  console.log(`Gitee 发布完成：https://gitee.com/${giteeRepo}/releases/tag/${tag}`);
}
if(process.argv.includes('--check'))await checkGitee().then(()=>console.log('Gitee 发布权限可用。'));
