import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import electron from 'electron';
import WebSocket from 'ws';
const base = 'http://127.0.0.1:8791';
const worker = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '8791',
    '--persist-to',
    'work/quit-state',
  ],
  {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  },
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await wait(40);
  }
  throw Error('Timeout: ' + label);
}
const post = (path, token) =>
  fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' });
let client,
  socket,
  code = '',
  exited = false,
  exitCode,
  ended = false,
  state,
  log = '';
try {
  await until(async () => {
    try {
      return (await fetch(base + '/health')).ok;
    } catch {
      return false;
    }
  }, 'worker');
  client = spawn(electron, ['scripts/electron-quit.cjs'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DAFEYU_RELAY_URL: base },
  });
  client.stdout.on('data', (data) => {
    log += data;
    const match = log.match(/"testPairCode":"([A-Z2-9]+)"/);
    if (match) code = match[1];
  });
  client.on('exit', (value) => {
    exited = true;
    exitCode = value;
  });
  await until(() => !!code, 'real app creates pair');
  const token = randomBytes(32).toString('hex');
  assert.equal((await post(`/v1/rooms/${code}/join`, token)).status, 200);
  socket = new WebSocket(base.replace('http', 'ws') + `/v1/rooms/${code}/socket`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'ended') ended = true;
    if (message.type === 'state') state = message;
  });
  socket.on('error', () => {});
  await until(() => state?.effective === 'online', 'pair online');
  const started = Date.now();
  socket.send(
    JSON.stringify({
      type: 'text',
      id: randomUUID(),
      epoch: state.epoch,
      text: 'quit-regression-trigger',
    }),
  );
  await until(() => ended && exited, 'real before-quit releases pair', 6500);
  assert.equal(exitCode, 0);
  assert.equal((await post(`/v1/rooms/${code}/join`, randomBytes(32).toString('hex'))).status, 404);
  console.log(
    `PASS actual app quit: peer notified, process exited, old code invalid (${Date.now() - started}ms)`,
  );
} catch (error) {
  console.error(error);
  console.error({ ended, exited, exitCode });
  process.exitCode = 1;
} finally {
  socket?.terminate();
  if (!exited) client?.kill();
  worker.kill();
}
