import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../assets/pet/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('integrity.json', root), 'utf8'));
let count = 0;
for (const action of manifest.actions) {
  const names = (await readdir(new URL(`${action.id}/`, root)))
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (!action.frames.length || names.length !== action.frames.length)
    throw new Error(`${action.id}: expected ${action.frames.length} frames`);
  let dimensions;
  for (let i = 0; i < action.frames.length; i++) {
    const frame = action.frames[i];
    if (frame.file !== `frame_${String(i + 1).padStart(2, '0')}.png` || names[i] !== frame.file)
      throw new Error('Invalid sequence');
    const data = await readFile(new URL(`${action.id}/${frame.file}`, root));
    if (
      data.length !== frame.bytes ||
      createHash('sha256').update(data).digest('hex') !== frame.sha256
    )
      throw new Error(`Hash changed: ${action.id}/${frame.file}`);
    if (
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      data.readUInt32BE(16) < 1 ||
      data.readUInt32BE(20) < 1 ||
      data[25] !== 6
    )
      throw new Error('Expected RGBA PNG');
    const size = `${data.readUInt32BE(16)} x ${data.readUInt32BE(20)}`;
    if (dimensions && size !== dimensions) throw new Error(`${action.id}: inconsistent frame size`);
    dimensions = size;
    count++;
  }
  const first = await readFile(new URL(`${action.id}/frame_01.png`, root));
  console.log(
    `${action.id}: ${action.frames.length} original RGBA frames, ${first.readUInt32BE(16)} x ${first.readUInt32BE(20)}`,
  );
}
console.log(`${count} SHA-256 checks passed.`);
