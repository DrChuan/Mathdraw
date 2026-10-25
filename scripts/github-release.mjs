import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const api=(path,body)=>JSON.parse(execFileSync('gh',['api',path,'-H','Cache-Control: no-cache',...(body?['--method','POST','--input','-']:[])],{encoding:'utf8',...(body?{input:JSON.stringify(body)}:{})}));
/** Lists are only for discovering existing releases. Creation uses its returned ID. */
export function findGithubRelease(repo,tag){
  const pages=JSON.parse(execFileSync('gh',['api',`repos/${repo}/releases?per_page=100`,'-H','Cache-Control: no-cache','--paginate','--slurp'],{encoding:'utf8'}));
  return pages.flat().find(r=>r.tag_name===tag);
}
export function releaseById(repo,id){
  if(!Number.isSafeInteger(id)||id<=0)throw Error('GitHub 发布 ID 无效');
  return api(`repos/${repo}/releases/${id}`);
}
export function createGithubRelease(repo,tag,title,body){
  const release=api(`repos/${repo}/releases`,{tag_name:tag,name:title,body,draft:true});
  if(!Number.isSafeInteger(release.id)||release.tag_name!==tag||!release.draft)throw Error('GitHub 未返回有效的发布草稿');
  return release;
}
export function editGithubRelease(repo,id,fields){
  return JSON.parse(execFileSync('gh',['api',`repos/${repo}/releases/${id}`,'--method','PATCH','--input','-'],{encoding:'utf8',input:JSON.stringify(fields)}));
}
/** Upload by immutable release ID; no immediately-consistent tag lookup required. */
export async function uploadGithubAsset(repo,id,name,path){
  const release=releaseById(repo,id);if(!release.draft)throw Error('拒绝修改已公开的 GitHub 发布附件');
  const previous=release.assets?.find(a=>a.name===name);
  if(previous)execFileSync('gh',['api',`repos/${repo}/releases/assets/${previous.id}`,'--method','DELETE'],{stdio:'inherit'});
  const token=execFileSync('gh',['auth','token','--hostname','github.com'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const response=await fetch(`https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/octet-stream'},body:readFileSync(path),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok)throw Error(`GitHub 附件上传失败：${name}（${response.status}）；草稿保留，可继续发布`);
  const asset=await response.json();if(asset.name!==name||asset.state!=='uploaded')throw Error(`GitHub 未确认附件上传：${name}`);
  console.log(`GitHub 已上传：${name}`);return asset;
}
