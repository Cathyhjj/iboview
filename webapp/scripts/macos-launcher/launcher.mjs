import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const resources = dirname(fileURLToPath(import.meta.url));
const { projectPath, port } = JSON.parse(readFileSync(join(resources, 'config.json'), 'utf8'));
const url = `http://127.0.0.1:${port}/`;
const logPath = join(homedir(), 'Library', 'Logs', 'IboView', 'server.log');

async function isIboView() {
  try {
    const page = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!page.ok || !/<title>IboView · Molecular workspace<\/title>/.test(await page.text())) return false;
    const icon = await fetch(`${url}favicon.svg`, { signal: AbortSignal.timeout(1500) });
    return icon.ok && (await icon.text()).trim() === readFileSync(join(projectPath, 'public', 'favicon.svg'), 'utf8').trim();
  } catch {
    return false;
  }
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (used) => { socket.destroy(); resolve(used); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}

async function launch() {
  if (!(await isIboView())) {
    if (await portInUse()) {
      await delay(1000);
      if (!(await isIboView())) throw new Error(`端口 ${port} 已被其他程序占用。请关闭占用该端口的程序后重试。`);
    } else {
      const vite = join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js');
      if (!existsSync(vite)) throw new Error(`找不到 IboView 的启动文件。请确认项目仍位于：\n${projectPath}`);
      if (!existsSync(join(projectPath, 'dist', 'index.html'))) throw new Error(`找不到已构建的 IboView 网页。请先在项目 webapp 目录运行 npm run build。`);
      mkdirSync(dirname(logPath), { recursive: true });
      const log = openSync(logPath, 'a');
      const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: projectPath,
        detached: true,
        stdio: ['ignore', log, log],
      });
      closeSync(log);
      let startError;
      server.once('error', (error) => { startError = error; });
      server.unref();
      const deadline = Date.now() + 30000;
      while (!(await isIboView())) {
        if (startError) throw startError;
        if (Date.now() > deadline) throw new Error(`IboView 未能启动。日志：\n${logPath}`);
        await delay(300);
      }
      console.log(`Started IboView server (PID ${server.pid}).`);
    }
  }
  if (!process.argv.includes('--no-open')) {
    await new Promise((resolve, reject) => {
      const browser = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
      browser.once('error', reject);
      browser.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`无法打开浏览器，请访问 ${url}`)));
    });
  }
  console.log(`IboView ready: ${url}`);
}

launch().catch((error) => { console.error(error.message); process.exitCode = 1; });
