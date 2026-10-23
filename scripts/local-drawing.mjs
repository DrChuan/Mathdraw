import {existsSync,readdirSync,readFileSync,mkdirSync,cpSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

/** Track source contents, so launching after a source update cannot reuse a stale app. */
export function drawingSourceHash(appRoot){
  const hash=createHash('sha256');
  const visit=relative=>{const p=join(appRoot,relative);if(!existsSync(p))return;const entries=readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));for(const entry of entries){const next=join(relative,entry.name);if(entry.isDirectory())visit(next);else if(entry.isFile()){hash.update(next);hash.update('\0');hash.update(readFileSync(join(appRoot,next)));}}};
  for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs','src-tauri/tauri.conf.json','src-tauri/tauri.drawing.conf.json'])if(existsSync(join(appRoot,file))){hash.update(file);hash.update(readFileSync(join(appRoot,file)));}
  for(const dir of ['src','public','src-tauri/src','src-tauri/icons','src-tauri/capabilities','src-tauri/installer'])visit(dir);
  return hash.digest('hex');
}
export function installLocalDrawing(source,destination,cache,hash){
  const stage=destination+`.next-${process.pid}`,backup=destination+`.previous-local`;
  mkdirSync(resolve(destination,'..'),{recursive:true});mkdirSync(cache,{recursive:true});
  rmSync(stage,{recursive:true,force:true});cpSync(source,stage,{recursive:true,verbatimSymlinks:true});
  // Only replace a generated local application after the new one is complete.
  if(existsSync(backup))rmSync(backup,{recursive:true,force:true});
  const hadPrevious=existsSync(destination);if(hadPrevious)renameSync(destination,backup);
  try{renameSync(stage,destination);}catch(error){if(hadPrevious)renameSync(backup,destination);throw error;}
  writeFileSync(join(cache,'local-drawing-build.json'),JSON.stringify({sourceHash:hash,application:destination})+'\n');
}
