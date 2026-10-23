import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Homebrew bottle libraries can retain absolute references into a previous
 * project cache. Relocate only those references, using loader-relative paths
 * so subsequent moves work too. Never modify system or globally installed tools. */
export function prepareCachedLlvm(cache, llvmDirectory) {
  if (!llvmDirectory || !existsSync(llvmDirectory)) return 0;
  const root=realpathSync(cache),seen=new Set(),changes=[];
  const inside=p=>p===root||p.startsWith(root+sep);
  const files=[
    ...readdirSync(join(llvmDirectory,'lib')).filter(n=>n.endsWith('.dylib')).map(n=>join(llvmDirectory,'lib',n)),
    ...['clang-cl','llvm-ar','llvm-lib','llvm-rc','lld','lld-link'].map(n=>join(llvmDirectory,'bin',n)).filter(existsSync),
  ];
  for (const file of files) {
    const target=realpathSync(file);if(seen.has(target)||!inside(target))continue;seen.add(target);
    const lines=execFileSync('/usr/bin/otool',['-L',target],{encoding:'utf8'}).split('\n').slice(1);
    // A dylib's first entry is its own install name, not a dependency.
    const dependencies=target.endsWith('.dylib')?lines.slice(1):lines;
    const args=[];
    for(const line of dependencies) {
      const dependency=line.trim().replace(/ \(compatibility version.*$/,''),marker='/.build-cache/',index=dependency.lastIndexOf(marker);
      if(index<0)continue;
      const relocated=resolve(root,dependency.slice(index+marker.length));
      if(!inside(relocated)||!existsSync(relocated)||!inside(realpathSync(relocated)))throw new Error(`缓存编译工具缺少依赖：${dependency}；请恢复 ${relocated}`);
      args.push('-change',dependency,`@loader_path/${relative(dirname(target),relocated)}`);
    }
    if(args.length)changes.push({target,args});
  }
  // Resolve every dependency before changing any cached file.
  for(const {target,args} of changes) {
    execFileSync('/usr/bin/install_name_tool',[...args,target],{stdio:'pipe'});
    execFileSync('/usr/bin/codesign',['--force','--sign','-',target],{stdio:'pipe'});
  }
  return changes.length;
}

/** Tauri may override NSISDIR, so keep a relocatable wrapper that sets it
 * immediately before invoking the cached compiler. Never reinstall the tool. */
export function prepareCachedNsis(cache) {
  const root=join(cache,'nsis/makensis');
  if(!existsSync(root))return;
  const version=readdirSync(root,{withFileTypes:true})
    .filter(entry=>entry.isDirectory()&&/^\d+(?:\.\d+)*$/.test(entry.name))
    .map(entry=>entry.name)
    .filter(name=>existsSync(join(root,name,'bin/makensis'))&&existsSync(join(root,name,'share/nsis/Include')))
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
  if(!version)return;
  const bin=join(cache,'bin');mkdirSync(bin,{recursive:true});
  const wrapper=join(bin,'makensis');
  writeFileSync(wrapper,`#!/bin/sh
base=$(CDPATH= cd -- "$(dirname -- "$0")/../nsis/makensis/${version}" && pwd) || exit 1
NSISDIR="$base/share/nsis"
export NSISDIR
exec "$base/bin/makensis" "$@"
`,{mode:0o755});
  chmodSync(wrapper,0o755);
  return wrapper;
}
