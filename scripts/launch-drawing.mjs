import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const appRoot = path.join(root, 'apps', 'mindmap-notes');
const mac = process.platform === 'darwin';
const candidates = mac ? [
  'artifacts/mathdraw/Mathdraw.app',
  'apps/mindmap-notes/src-tauri/target/universal-apple-darwin/release/bundle/macos/Mathdraw.app',
  'apps/mindmap-notes/src-tauri/target/release/bundle/macos/Mathdraw.app',
] : ['artifacts/mathdraw/mathdraw.exe', 'apps/mindmap-notes/src-tauri/target/release/mathdraw.exe'];
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: appRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`构建未完成，退出码 ${code}`)));
  });
}
try {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('支持 macOS 和 Windows。');
  let app = candidates.map(p => path.join(root,p)).find(existsSync);
  if (!app) {
    if (!existsSync(path.join(appRoot, 'node_modules/.bin/tauri'))) await run(['ci']);
    await run(['run', 'bundle:drawing', '--', '--bundles', mac ? 'app' : 'nsis']);
    app = candidates.map(p => path.join(root,p)).find(existsSync);
  }
  if (!app) throw new Error('未找到数学绘图程序，请先完成打包。');
  const child = mac ? spawn('open', [app], { detached:true, stdio:'ignore' }) : spawn(app, [], { detached:true, stdio:'ignore' });
  child.on('error', e => { console.error(e.message); process.exitCode=1; });
  child.unref();
} catch(e) { console.error(e.message); process.exitCode=1; }
