import { existsSync,readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync,openSync,closeSync } from 'node:fs';
import { spawn,execFileSync } from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {drawingSourceHash,installLocalDrawing} from './local-drawing.mjs';
const here=path.resolve(import.meta.dirname,'..');
const projectRoot=here,appRoot=path.join(here,'apps/mindmap-notes');
const outputRoot=path.join(projectRoot,'artifacts/mathdraw'),cache=path.join(projectRoot,'.build-cache');
const mac=process.platform==='darwin';
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:appRoot,stdio:'inherit',shell:process.platform==='win32'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`构建未完成，退出码 ${code}`)));});}
let lock;
const lockPath=path.join(cache,'local-drawing-build.lock');
try{
  if(!['darwin','win32'].includes(process.platform))throw Error('支持 macOS 和 Windows。');
  mkdirSync(cache,{recursive:true});
  const app=path.join(outputRoot,mac?'Mathdraw.app':'mathdraw.exe'),hash=drawingSourceHash(appRoot);
  let saved;try{saved=JSON.parse(readFileSync(path.join(cache,'local-drawing-build.json'),'utf8'));}catch{}
  if(!existsSync(app)||saved?.sourceHash!==hash||saved?.application!==app){
    try{lock=openSync(lockPath,'wx');}catch{throw Error('另一个启动构建正在进行，请等待完成后重试。');}
    console.log('正在更新本机数学绘图程序，首次或代码变更后需要编译…');
    if(!existsSync(path.join(appRoot,'node_modules/.bin/tauri')))await run(['ci']);
    const temporary=mkdtempSync(path.join(tmpdir(),'mathdraw-local-'));
    try{
      const config=path.join(temporary,'local.conf.json');writeFileSync(config,JSON.stringify({bundle:{createUpdaterArtifacts:false}}));
      await run(['run','bundle:drawing','--','--config',config,...(mac?['--target','universal-apple-darwin']:[]),'--bundles',mac?'app':'nsis']);
      const built=path.join(appRoot,mac?'src-tauri/target/universal-apple-darwin/release/bundle/macos/Mathdraw.app':'src-tauri/target/release/mathdraw.exe');
      if(mac)execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',built]);
      installLocalDrawing(built,app,cache,hash);
    }finally{rmSync(temporary,{recursive:true,force:true});}
  }
  if(mac)execFileSync('/usr/bin/open',[app]);
  else await new Promise((resolve,reject)=>{const child=spawn(app,[],{detached:true,stdio:'ignore'});child.on('error',reject);child.on('spawn',()=>{child.unref();resolve();});});
}catch(e){console.error(e.message);process.exitCode=1;}
finally{if(lock!==undefined){closeSync(lock);rmSync(lockPath,{force:true});}}
