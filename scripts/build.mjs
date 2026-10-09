import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { readFile } from 'node:fs/promises';
let relay = process.env.DAFEYU_RELAY_URL || '';
if (!relay) {
  try {
    relay = (await readFile('.env', 'utf8')).match(/^DAFEYU_RELAY_URL=(.+)$/m)?.[1]?.trim() || '';
  } catch {}
}
await build({
  entryPoints: { index: 'app/main/index.ts', preload: 'app/preload/index.ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist/main',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  define: { __RELAY_URL__: JSON.stringify(relay) },
});
await viteBuild();
console.log(
  relay
    ? 'Relay URL embedded.'
    : 'No relay URL embedded. Configure one in the menu before pairing.',
);
