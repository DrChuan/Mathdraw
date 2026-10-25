import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve,join,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareCachedNsis,prepareCachedLlvm} from '../../数学绘图/scripts/release-tools.mjs';
const app=resolve(import.meta.dirname,'..'),cache=resolve(app,'../数学绘图/.build-cache');
const llvm=join(cache,'llvm/llvm',readdirSync(join(cache,'llvm/llvm')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1));
prepareCachedNsis(cache);prepareCachedLlvm(cache,llvm);
const env={...process.env,PATH:[join(cache,'bin'),join(llvm,'bin'),join(homedir(),'.cargo/bin'),'/opt/homebrew/bin',process.env.PATH].join(delimiter),XWIN_ARCH:'x86_64',XWIN_CACHE_DIR:join(cache,'xwin'),TAURI_SIGNING_PRIVATE_KEY:join(app,'.build-cache/signing/mindgrove.key'),TAURI_SIGNING_PRIVATE_KEY_PASSWORD:''};
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:app,env,stdio:'inherit'});
const version=JSON.parse(readFileSync(join(app,'package.json'))).version;
const out=join(app,'产物/releases',version);mkdirSync(out,{recursive:true});
run('npm',['run','bundle','--','--runner','cargo-xwin','--target','x86_64-pc-windows-msvc','--bundles','nsis']);
const release=join(app,'src-tauri/target/x86_64-pc-windows-msvc/release');
const setup=`Mindgrove_${version}_x64-setup.exe`;
for(const name of [setup,setup+'.sig'])copyFileSync(join(release,'bundle/nsis',name),join(out,name));
copyFileSync(join(release,'mindgrove.exe'),join(out,'mindgrove.exe'));
writeFileSync(join(out,'latest.json'),JSON.stringify({version,notes:'枝间 Windows 版',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature:readFileSync(join(out,setup+'.sig'),'utf8').trim(),url:`https://github.com/DrChuan/Mindgrove/releases/download/v${version}/${setup}`}}},null,2));
writeFileSync(join(out,'SHA256SUMS.txt'),[setup,setup+'.sig','mindgrove.exe','latest.json'].map(n=>`${createHash('sha256').update(readFileSync(join(out,n))).digest('hex')}  ${n}`).join('\n')+'\n');
if(process.argv.includes('--publish')){
 run('gh',['auth','status']);
 try{run('gh',['repo','view','DrChuan/Mindgrove']);}catch{run('gh',['repo','create','DrChuan/Mindgrove','--public','--description','枝间 Mindgrove 桌面版安装包与更新']);}
 try{execFileSync('gh',['api','repos/DrChuan/Mindgrove/commits','--jq','length'],{env,stdio:'pipe'});}catch{run('gh',['api','repos/DrChuan/Mindgrove/contents/README.md','--method','PUT','-f','message=Initialize releases','-f',`content=${Buffer.from('# 枝间 Mindgrove\n\nWindows desktop releases.\n').toString('base64')}`,'--silent']);}
 run('gh',['release','create',`v${version}`,...[setup,setup+'.sig','mindgrove.exe','latest.json','SHA256SUMS.txt'].map(n=>join(out,n)),'--repo','DrChuan/Mindgrove','--title',`枝间 ${version}`,'--notes','Windows x64 安装包，支持自动检查更新。']);
}
console.log(out);
