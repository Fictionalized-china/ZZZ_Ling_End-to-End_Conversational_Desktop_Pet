import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createServer } from 'vite';
import electron from 'electron';
await build({
  entryPoints: { index: 'app/main/index.ts', preload: 'app/preload/index.ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist/main',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  define: {
    __RELAY_URL__: JSON.stringify(process.env.DAFEYU_RELAY_URL || 'http://127.0.0.1:8787'),
  },
});
const vite = await createServer();
await vite.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, PET_DEV_URL: 'http://127.0.0.1:5173' },
});
child.on('exit', async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
