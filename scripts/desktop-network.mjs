import { spawn } from 'node:child_process';
import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/desktop-network.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'work/desktop-network.cjs',
  external: ['electron'],
});
const remote = process.env.DAFEYU_TEST_RELAY_URL;
const base = remote ? new URL(remote).origin : 'http://127.0.0.1:8789';
if (remote && !base.startsWith('https://')) throw new Error('Online tests require HTTPS');
const worker = remote
  ? null
  : spawn(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        '8789',
        '--persist-to',
        'work/desktop-network-state',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
let logs = '';
worker?.stdout.on('data', (data) => (logs += data));
worker?.stderr.on('data', (data) => (logs += data));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      ready = (await fetch(base + '/health')).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Worker unavailable\n' + logs.slice(-3000));
  const client = spawn(
    process.execPath,
    ['node_modules/electron/cli.js', 'work/desktop-network.cjs'],
    { stdio: 'inherit', windowsHide: true },
  );
  const timer = setTimeout(() => client.kill(), 90000);
  const code = await new Promise((resolve) => client.on('exit', resolve));
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Desktop network test failed (${code})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  worker?.kill();
}
