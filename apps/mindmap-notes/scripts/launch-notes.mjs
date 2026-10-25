import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const appRoot = existsSync(path.join(root, 'src-tauri')) ? root : path.join(root, '枝间');
const isMac = process.platform === 'darwin';
const universal = path.join(appRoot, 'src-tauri/target/universal-apple-darwin/release/bundle/macos/Mindgrove.app');
const app = isMac ? existsSync(universal) ? universal : path.join(appRoot, 'src-tauri/target/release/bundle/macos/Mindgrove.app') : path.join(appRoot, 'src-tauri/target/release/mindgrove.exe');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function run(command, args, cwd) { await new Promise((resolve, reject) => { const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`构建未完成，退出码 ${code}`))); }); }
try {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('首版支持 macOS 和 Windows。');
  if (!existsSync(app)) {
    if (!existsSync(path.join(appRoot, 'node_modules/.bin/tauri'))) await run(npm, ['ci'], appRoot);
    await run(npm, ['run', 'bundle', '--', '--bundles', isMac ? 'app' : 'nsis'], appRoot);
  }
  const child = isMac ? spawn('open', [app], { detached: true, stdio: 'ignore' }) : spawn(app, [], { detached: true, stdio: 'ignore' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; }); child.unref();
} catch (error) { console.error(error.message); process.exitCode = 1; }
