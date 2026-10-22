#!/usr/bin/env node
// Interactive release entry point for the existing macOS build workstation.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, cpSync, renameSync, rmSync, openSync, closeSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const root=resolve(import.meta.dirname,'..'),app=join(root,'apps/mindmap-notes');
const cache=join(root,'.build-cache'),repo='DrChuan/Mathdraw';
const readJSON=p=>JSON.parse(readFileSync(p,'utf8'));
const current=readJSON(join(app,'package.json')).version;
const resume=process.argv.includes('--resume');
const llvmRoot=join(cache,'llvm/llvm');
const llvm=existsSync(llvmRoot)?readdirSync(llvmRoot).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1):undefined;
const env={...process.env,PATH:[join(cache,'bin'),...(llvm?[join(llvmRoot,llvm,'bin')]:[]),join(homedir(),'.cargo/bin'),'/opt/homebrew/bin','/usr/local/bin',process.env.PATH??''].join(delimiter)};
const capture=(command,args)=>execFileSync(command,args,{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const rl=createInterface({input:process.stdin,output:process.stdout});
let lock,locked=false;
const lockPath=join(cache,'mathdraw-release.lock');
let dir;
let releaseStarted=false,published=false;

async function run(label,command,args,logName) {
  console.log(`\n${label}…`);
  const fd=openSync(join(dir,logName),'a');
  try {
    await new Promise((ok,fail)=>{
      const child=spawn(command,args,{cwd:root,env,stdio:['ignore',fd,fd]});
      child.once('error',fail);
      child.once('exit',(code,signal)=>code===0?ok():fail(new Error(`${label}失败（${signal??code}），请查看 ${join(dir,logName)}`)));
    });
  } finally {closeSync(fd);}
  console.log(`${label}完成。`);
}

function bump(version,index) {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('当前版本不是三段数字，无法自动升级');
  const parts=version.split('.').map(Number);parts[index]++;
  for(let i=index+1;i<3;i++)parts[i]=0;
  return parts.join('.');
}

function setVersion(version) {
  const originals=new Map(),changes=new Map();
  const put=(relative,transform)=>{
    const p=join(app,relative),text=readFileSync(p,'utf8');originals.set(p,text);changes.set(p,transform(text));
  };
  for(const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json'])put(file,text=>{
    const d=JSON.parse(text);if(d.version!==current)throw new Error(`${file} 的版本不一致，请先处理`);
    d.version=version;
    if(file==='package-lock.json'){
      if(d.packages[''].version!==current)throw new Error('package-lock 根包版本不一致');
      d.packages[''].version=version;
    }
    return JSON.stringify(d,null,2)+'\n';
  });
  put('src-tauri/Cargo.toml',text=>{
    const section=text.match(/\[package\][\s\S]*?(?=\n\[|$)/)?.[0];
    if(!section?.includes(`version = "${current}"`))throw new Error('Cargo.toml 版本不一致');
    return text.replace(section,section.replace(`version = "${current}"`,`version = "${version}"`));
  });
  put('src-tauri/Cargo.lock',text=>{
    const before=`name = "mindgrove"\nversion = "${current}"`;
    if(!text.includes(before))throw new Error('Cargo.lock 版本不一致');
    return text.replace(before,`name = "mindgrove"\nversion = "${version}"`);
  });
  try {for(const [p,text] of changes)writeFileSync(p,text);}
  catch(e){for(const [p,text] of originals)writeFileSync(p,text);throw e;}
}

try {
  if(process.platform!=='darwin')throw new Error('这个一键发布入口用于当前 Mac 构建机；Windows 本机打包请使用 build-mathdraw-windows.ps1');
  if(!process.stdin.isTTY)throw new Error('请双击“发布Mathdraw.command”，在终端中选择版本');
  mkdirSync(cache,{recursive:true});
  try {lock=openSync(lockPath,'wx',0o600);locked=true;writeFileSync(lock,`${process.pid}\n`);}
  catch {throw new Error(`另一个发布流程可能正在运行。若已异常退出，请确认后删除 ${lockPath} 再重试。`);}

  console.log(`Mathdraw 一键发布\n当前版本：${current}\n目标：Windows x64 + macOS 通用版 → GitHub ${repo}`);
  let version=current;
  if(!resume) {
    console.log(`\n1. 第一位 → ${bump(current,0)}\n2. 第二位 → ${bump(current,1)}\n3. 第三位 → ${bump(current,2)}\n0. 取消`);
    const choice=(await rl.question('选择升级哪一位 [3]：')).trim()||'3';
    if(choice==='0'){console.log('已取消。');process.exitCode=0;}
    else if(!['1','2','3'].includes(choice))throw new Error('请输入 1、2、3 或 0');
    else version=bump(current,Number(choice)-1);
    if(choice==='0')version=undefined;
  }
  if(version) {
    // Preflight before touching any version files or release output.
    for(const [tool,args] of [['npm',['--version']],['cargo',['--version']],['cargo-xwin',['--version']],['makensis',['-VERSION']],['gh',['--version']]]) {
      try {capture(tool,args);}catch {throw new Error(`缺少或无法运行 ${tool}，请先安装/配置后重试`);}
    }
    // Rust/Tauri builds use the compiler and macOS SDK. Apple's standalone
    // Command Line Tools provide both without the full Xcode application.
    try {
      const clang=capture('xcrun',['--sdk','macosx','--find','clang']);
      const sdk=capture('xcrun',['--sdk','macosx','--show-sdk-path']);
      if(!existsSync(clang)||!existsSync(sdk))throw new Error('编译器或 SDK 路径不存在');
      capture('xcrun',['--sdk','macosx','--find','ld']);
    } catch {
      throw new Error('Apple 编译工具或 macOS SDK 不可用。请安装 Command Line Tools（xcode-select --install），或检查当前开发工具目录；无需安装完整 Xcode');
    }
    for(const tool of ['/usr/bin/codesign','/usr/bin/ditto'])if(!existsSync(tool))throw new Error(`找不到系统打包工具 ${tool}`);
    const targets=capture('rustup',['target','list','--installed']);
    for(const target of ['aarch64-apple-darwin','x86_64-apple-darwin','x86_64-pc-windows-msvc'])
      if(!targets.split('\n').includes(target))throw new Error(`缺少 Rust 目标 ${target}，请先运行 rustup target add ${target}`);
    if(!existsSync(join(app,'node_modules/.bin/tauri')))throw new Error('请先在 apps/mindmap-notes 安装前端依赖');
    const key=env.TAURI_SIGNING_PRIVATE_KEY??join(cache,'signing/mathdraw.key');
    if(!existsSync(key))throw new Error(`找不到更新签名密钥文件：${key}。不能重新生成密钥替代，否则旧版无法更新。`);
    env.TAURI_SIGNING_PRIVATE_KEY=key;
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD??='';
    env.XWIN_ARCH='x86_64';env.XWIN_CACHE_DIR=join(cache,'xwin');
    const releases=JSON.parse(capture('gh',['api',`repos/${repo}/releases?per_page=100`]));
    const tag=`v${version}`,remote=releases.find(r=>r.tag_name===tag);
    if(remote&&(!resume||!remote.draft))throw new Error(`${tag} 已存在${remote.draft?'发布草稿，请选择继续上次发布':'，不能覆盖公开版本'}`);
    const greater=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
    if(releases.some(r=>!r.draft&&!r.prerelease&&/^v\d+\.\d+\.\d+$/.test(r.tag_name)&&!greater(version,r.tag_name.slice(1))))throw new Error('目标版本不高于 GitHub 上的公开版本，请先同步代码/版本');
    dir=join(root,'artifacts/mathdraw/releases',version);
    if(existsSync(dir)&&!resume)throw new Error(`本地已有 ${version} 的输出，请使用“继续上次发布”`);
    const summary=(await rl.question('更新说明（可留空）：')).trim()||`Mathdraw ${version} 更新。`;
    const answer=(await rl.question(`\n将${resume?'继续':'升级到'} ${version}，构建并公开发布到 GitHub。确认？[y/N]：`)).trim().toLowerCase();
    if(!['y','yes'].includes(answer))console.log('已取消，未修改版本。');
    else {
      mkdirSync(dir,{recursive:true});
      if(!resume)setVersion(version);
      releaseStarted=true;
      // Keep the bumped version on failure so --resume uses the same signed tag.
      await run('Windows 打包','npm',['run','bundle:drawing','--prefix',app,'--','--runner','cargo-xwin','--target','x86_64-pc-windows-msvc','--bundles','nsis'],'build-windows.log');
      const win=join(app,'src-tauri/target/x86_64-pc-windows-msvc/release');
      for(const p of [join(win,'mathdraw.exe'),join(win,`bundle/nsis/Mathdraw_${version}_x64-setup.exe`),join(win,`bundle/nsis/Mathdraw_${version}_x64-setup.exe.sig`)])copyFileSync(p,join(dir,p.split('/').at(-1)));
      await run('Mac 通用版打包','npm',['run','bundle:drawing','--prefix',app,'--','--target','universal-apple-darwin','--bundles','app'],'build-macos.log');
      const mac=join(app,'src-tauri/target/universal-apple-darwin/release/bundle/macos'),bundle=join(mac,'Mathdraw.app');
      capture('codesign',['--verify','--deep','--strict',bundle]);
      for(const name of ['Mathdraw.app.tar.gz','Mathdraw.app.tar.gz.sig'])copyFileSync(join(mac,name),join(dir,name));
      await run('压缩 Mac 应用','ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,join(dir,`Mathdraw-${version}-macOS-universal.zip`)],'archive.log');
      await run('校验签名并发布 GitHub',process.execPath,[join(root,'scripts/publish-mathdraw.mjs'),dir,'--publish','--summary',summary,...(remote?['--resume']:[])],'publish.log');
      published=true;
      // Update only generated local artifacts after the release is public.
      const local=join(root,'artifacts/mathdraw/Mathdraw.app'),backup=join(root,`artifacts/mathdraw/previous/Mathdraw-before-${version}.app`);
      mkdirSync(resolve(backup,'..'),{recursive:true});
      if(existsSync(local)){if(!existsSync(backup))renameSync(local,backup);else rmSync(local,{recursive:true});}
      cpSync(bundle,local,{recursive:true,verbatimSymlinks:true});
      copyFileSync(join(dir,`Mathdraw-${version}-macOS-universal.zip`),join(root,'artifacts/mathdraw/Mathdraw-macOS-universal.zip'));
      console.log(`\n发布完成：${version}\nhttps://github.com/${repo}/releases/tag/${tag}\n安装包与日志：${dir}\n已有用户启动软件或检查更新即可升级。\n本流程完成构建和签名校验，不代替平台实际操作检查。`);
    }
  }
} catch(e) {
  const next=published?'GitHub 发布已完成；本地应用副本更新失败，请查看上述错误，无需再次发布。':releaseStarted?'修复原因后，可以双击入口选择“继续上次发布”，不会再次增加版本号。':'尚未开始构建，版本号未改变。修复原因后，请重新选择“发布新版本”；若本来就是恢复未完成发布，则仍选择“继续上次发布”。';
  console.error(`\n${published?'发布完成，但本地收尾失败':'发布未完成'}：${e.message}\n${next}`);
  process.exitCode=1;
} finally {
  rl.close();if(lock!==undefined)closeSync(lock);if(locked)rmSync(lockPath,{force:true});
}
