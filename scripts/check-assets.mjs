import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../assets/pet/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('integrity.json', root), 'utf8'));
let count = 0;
for (const action of manifest.actions) {
  const names = (await readdir(new URL(`${action.id}/`, root)))
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (names.length !== 8) throw new Error(`${action.id}: expected 8 frames`);
  for (let i = 0; i < 8; i++) {
    const frame = action.frames[i];
    if (frame.file !== `frame_${String(i + 1).padStart(2, '0')}.png`)
      throw new Error('Invalid sequence');
    const data = await readFile(new URL(`${action.id}/${frame.file}`, root));
    if (createHash('sha256').update(data).digest('hex') !== frame.sha256)
      throw new Error(`Hash changed: ${action.id}/${frame.file}`);
    if (data.readUInt32BE(16) < 1 || data.readUInt32BE(20) < 1 || data[25] !== 6)
      throw new Error('Expected RGBA PNG');
    count++;
  }
  const first = await readFile(new URL(`${action.id}/frame_01.png`, root));
  console.log(
    `${action.id}: 8 original RGBA frames, ${first.readUInt32BE(16)} x ${first.readUInt32BE(20)}`,
  );
}
console.log(`${count} SHA-256 checks passed.`);
