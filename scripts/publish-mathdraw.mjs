import {findGithubRelease,releaseById} from './github-release.mjs';
import {publishGitee,checkGitee} from './gitee-release.mjs';
// Publish only explicitly named, signed release files, never the source tree or keys.
import { readFileSync,writeFileSync,statSync,existsSync } from 'node:fs';
import { resolve,join,basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash,createPublicKey,verify } from 'node:crypto';
const projectRoot=resolve(import.meta.dirname,'..'),workspaceRoot=projectRoot,app=join(projectRoot,'apps/mindmap-notes');
const version=JSON.parse(readFileSync(join(app,'src-tauri/tauri.conf.json'))).version;
const dir=resolve(process.argv[2]??join(projectRoot,'artifacts/mathdraw/releases',version));
const repo='DrChuan/Mathdraw',tag=`v${version}`;
const names=[`Mathdraw_${version}_x64-setup.exe`,'mathdraw.exe',`Mathdraw-${version}-macOS-universal.zip`,'Mathdraw.app.tar.gz'];
const required=[...names,`${names[0]}.sig`,'Mathdraw.app.tar.gz.sig'];
for(const name of required)if(statSync(join(dir,name)).size===0)throw new Error(`Empty release file: ${name}`);
// Verify both the payload and the trusted version comment before any upload.
const config=JSON.parse(readFileSync(join(app,'src-tauri/tauri.drawing.conf.json')));
const pubLines=Buffer.from(config.plugins.updater.pubkey,'base64').toString('utf8').trim().split(/\r?\n/);
const pub=Buffer.from(pubLines[1],'base64');
const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pub.subarray(10)]),format:'der',type:'spki'});
for(const name of [names[0],'Mathdraw.app.tar.gz']) {
  const lines=Buffer.from(readFileSync(join(dir,`${name}.sig`),'utf8').trim(),'base64').toString('utf8').trim().split(/\r?\n/);
  const sig=Buffer.from(lines[1],'base64'),comment=lines[2]?.replace(/^trusted comment: /,'');
  const payload=readFileSync(join(dir,name));
  if(pub.length!==42||sig.length!==74||sig.subarray(0,2).toString()!=='ED'||!pub.subarray(2,10).equals(sig.subarray(2,10))||
    !comment?.split('\t').includes(`version:${version}`)||
    !verify(null,createHash('blake2b512').update(payload).digest(),key,sig.subarray(10))||
    !verify(null,Buffer.concat([sig.subarray(10),Buffer.from(comment)]),key,Buffer.from(lines[3],'base64'))) {
    throw new Error(`Invalid updater signature or signed version: ${name}`);
  }
}
const url=name=>`https://github.com/${repo}/releases/download/${tag}/${name}`;
const signature=name=>readFileSync(join(dir,`${name}.sig`),'utf8').trim();
const option=name=>{const i=process.argv.indexOf(name);if(i<0)return undefined;if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw new Error(`Missing ${name}`);return process.argv[i+1];};
const notes=option('--summary')??`Mathdraw ${version} 更新。`;
const mac={url:url('Mathdraw.app.tar.gz'),signature:signature('Mathdraw.app.tar.gz')};
let manifest={version,notes,pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{url:url(names[0]),signature:signature(names[0])},'darwin-aarch64':mac,'darwin-x86_64':mac}};
// Resuming must reuse the exact manifest bytes already made public on GitHub.
if((process.argv.includes('--resume')||process.argv.includes('--gitee-only'))&&existsSync(join(dir,'latest.json'))){
  const saved=JSON.parse(readFileSync(join(dir,'latest.json'),'utf8'));
  if(saved.version!==version||Object.entries(manifest.platforms).some(([k,v])=>saved.platforms?.[k]?.signature!==v.signature||saved.platforms[k].url!==v.url))throw Error('Existing manifest does not match verified packages');
  manifest=saved;
}else writeFileSync(join(dir,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(dir,'SHA256SUMS.txt'),required.map(name=>`${createHash('sha256').update(readFileSync(join(dir,name))).digest('hex')}  ${name}`).join('\n')+'\n');
const body=option('--notes-file')?readFileSync(resolve(option('--notes-file')),'utf8'):`## 更新\n\n${notes}\n\n### 安装\n\nWindows 推荐下载 **${names[0]}**。独立 mathdraw.exe 需要预装 WebView2。\n\nmacOS 下载 **${names[2]}**。Mathdraw.app.tar.gz 为自动更新专用包。\n\n已安装版本可使用“文件 → 检查更新”。更新包经过签名校验；Windows 安装包尚无 Authenticode 证书，macOS 尚未公证。\n\n### 构建范围\n\nmacOS 通用版及 Windows x64 交叉编译。打包不代表完成平台实际运行检查，本脚本不运行自动化测试。\n`;
const bodyPath=join(dir,'release-notes.md');writeFileSync(bodyPath,body);
const gh=args=>execFileSync('gh',args,{stdio:'inherit'});
if(!process.argv.includes('--publish')&&!process.argv.includes('--gitee-only')){console.log(`Prepared ${dir}. Add --publish to upload to GitHub and Gitee.`);process.exit(0);}
const assets=[...required,'latest.json','SHA256SUMS.txt'];
await checkGitee();
if(!process.argv.includes('--gitee-only')){
  let published=false,release;
  if(process.argv.includes('--resume')) {
    release=findGithubRelease(repo,tag);
    if(!release)throw Error(`找不到待继续的发布 ${tag}`);
    published=!release.draft;
    if(!published)gh(['release','edit',tag,'--repo',repo,'--notes-file',bodyPath]);
  }else gh(['release','create',tag,'--repo',repo,'--draft','--title',`Mathdraw ${version}`,'--notes-file',bodyPath]);
  release??=findGithubRelease(repo,tag);
  if(!release)throw Error(`找不到刚创建的发布 ${tag}`);
  if(!published){
    const current=releaseById(repo,release.id);
    const pending=assets.filter(name=>{const a=current.assets?.find(a=>a.name===name);return a?.state!=='uploaded'||a.digest!==`sha256:${createHash('sha256').update(readFileSync(join(dir,name))).digest('hex')}`;});
    if(pending.length)gh(['release','upload',tag,'--repo',repo,...pending.map(n=>join(dir,n)),...(process.argv.includes('--resume')?['--clobber']:[])]);
    else console.log('GitHub 草稿附件已全部匹配，跳过重复上传。');
  }
  release??=findGithubRelease(repo,tag);
  if(!release)throw Error(`找不到刚创建的发布 ${tag}`);
  const releases=releaseById(repo,release.id);
  for(const name of assets){
    const asset=releases.assets?.find(a=>a.name===name),digest=`sha256:${createHash('sha256').update(readFileSync(join(dir,name))).digest('hex')}`;
    if(asset?.state!=='uploaded'||asset.digest!==digest)throw Error(`Uploaded checksum mismatch: ${name}; existing release retained`);
  }
  if(!published)gh(['release','edit',tag,'--repo',repo,'--draft=false','--latest']);
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
}
// Failure leaves GitHub's release intact. --resume verifies it and retries only
// the unfinished Gitee mirror, without rebuilding the public signed packages.
await publishGitee({dir,version,names:assets,manifest,notes:body});
