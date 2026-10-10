// 启动真实 Worker，以发布界面和第二个真实 Relay 客户端做端到端检查。
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/electron-ui.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'work/electron-ui.cjs',
  external: ['electron'],
});
const worker = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '8790',
    '--persist-to',
    'work/desktop-ui-state',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  },
);
let logs = '';
worker.stdout.on('data', (data) => (logs += data));
worker.stderr.on('data', (data) => (logs += data));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      ready = (await fetch('http://127.0.0.1:8790/health')).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw Error('Worker unavailable\n' + logs.slice(-3000));
  const client = spawn(process.execPath, ['node_modules/electron/cli.js', 'work/electron-ui.cjs'], {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, DAFEYU_RELAY_URL: 'http://127.0.0.1:8790' },
  });
  const timer = setTimeout(() => client.kill(), 60000);
  const code = await new Promise((resolve) => client.on('exit', resolve));
  clearTimeout(timer);
  if (code !== 0) throw Error(`Desktop UI test failed (${code})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  worker.kill();
}
