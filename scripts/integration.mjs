import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
const remote = process.env.DAFEYU_TEST_RELAY_URL;
const base = remote ? new URL(remote).origin : 'http://127.0.0.1:8788';
if (remote && !base.startsWith('https://')) throw new Error('Online tests require HTTPS');
const proxy = remote && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
const child = remote
  ? null
  : spawn(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        '8788',
        '--persist-to',
        'work/integration-state',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
let logs = '';
child?.stdout.on('data', (data) => {
  logs += data.toString();
});
child?.stderr.on('data', (data) => {
  logs += data.toString();
});
const clients = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, ms = remote ? 30_000 : 12_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await wait(20);
  }
  throw new Error('Timeout: ' + message);
}
async function post(path, token, data = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function connect(code, token, choice = 'online') {
  const ws = new WebSocket(base.replace('http', 'ws') + `/v1/rooms/${code}/socket`, {
    headers: { Authorization: 'Bearer ' + token, 'X-Presence': choice },
    agent,
  });
  const client = { ws, events: [], binary: [], state: null };
  clients.push(client);
  ws.on('message', (data, binary) => {
    if (binary) {
      client.binary.push(Buffer.from(data));
      return;
    }
    const event = JSON.parse(data.toString());
    client.events.push(event);
    if (event.type === 'state') client.state = event;
  });
  ws.on('error', () => {});
  await until(() => client.state, 'initial state');
  return client;
}
const event = (client, predicate) => client.events.find(predicate);
let cleanupCode = '',
  cleanupToken = '';
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      ready = (await fetch(base + '/health')).ok;
    } catch {}
    if (ready) break;
    await wait(500);
  }
  if (!ready) throw new Error('Worker unavailable\n' + logs.slice(-5000));
  const hostToken = randomBytes(32).toString('hex'),
    guestToken = randomBytes(32).toString('hex');
  const created = await post('/v1/rooms', '', { token: hostToken });
  assert.equal(created.status, 200);
  const code = created.body.code;
  cleanupCode = code;
  cleanupToken = hostToken;
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  const host = await connect(code, hostToken);
  assert.equal(host.state.effective, 'offline');
  const forbidden = randomUUID();
  host.ws.send(
    JSON.stringify({
      type: 'text',
      id: forbidden,
      epoch: host.state.epoch,
      text: '未配对不能发送',
    }),
  );
  await until(
    () => event(host, (e) => e.type === 'error' && e.id === forbidden),
    'unpaired rejected',
  );
  assert.equal((await post(`/v1/rooms/${code}/join`, guestToken)).status, 200);
  const guest = await connect(code, guestToken);
  await until(
    () => host.state?.effective === 'online' && guest.state?.effective === 'online',
    'both online',
  );
  assert.equal((await post(`/v1/rooms/${code}/join`, randomBytes(32).toString('hex'))).status, 409);
  assert.equal(
    (await post(`/v1/rooms/${code}/leave`, randomBytes(32).toString('hex'))).status,
    403,
  );
  console.log('PASS pairing, authentication and third-client rejection');
  for (const [a, b] of [
    ['busy', 'online'],
    ['busy', 'busy'],
    ['online', 'busy'],
    ['online', 'online'],
  ]) {
    host.ws.send(JSON.stringify({ type: 'status', choice: a }));
    guest.ws.send(JSON.stringify({ type: 'status', choice: b }));
    await until(
      () =>
        host.state.own === a &&
        host.state.peer === b &&
        guest.state.own === b &&
        guest.state.peer === a,
      'status propagation',
    );
    const expected = a === 'online' && b === 'online' ? 'online' : 'busy';
    assert.equal(host.state.effective, expected);
    assert.equal(guest.state.effective, expected);
    if (expected === 'busy') {
      const id = randomUUID();
      host.ws.send(
        JSON.stringify({ type: 'text', id, epoch: host.state.epoch, text: '应该被阻止' }),
      );
      await until(() => event(host, (e) => e.type === 'error' && e.id === id), 'busy rejected');
      assert.ok(!event(guest, (e) => e.id === id));
    }
  }
  console.log('PASS all busy/online combinations and server-side message gate');
  const textId = randomUUID();
  host.ws.send(
    JSON.stringify({ type: 'text', id: textId, epoch: host.state.epoch, text: '你好，小铃宝！' }),
  );
  await until(() => event(guest, (e) => e.type === 'text' && e.id === textId), 'text relay');
  guest.ws.send(JSON.stringify({ type: 'delivered', id: textId }));
  await until(
    () => event(host, (e) => e.type === 'delivered' && e.id === textId),
    'delivery acknowledgement',
  );
  host.ws.send(
    JSON.stringify({ type: 'text', id: textId, epoch: host.state.epoch, text: '重复包' }),
  );
  await wait(100);
  assert.equal(guest.events.filter((e) => e.type === 'text' && e.id === textId).length, 1);
  const png = await readFile('assets/pet/wave/frame_01.png'),
    imageId = randomUUID();
  const header = Buffer.from(
    JSON.stringify({ id: imageId, epoch: guest.state.epoch, width: 192, height: 208 }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const packet = Buffer.concat([length, header, png]);
  guest.ws.send(packet);
  await until(() => host.binary.length === 1, 'image relay');
  assert.deepEqual(host.binary[0], packet);
  host.ws.send(JSON.stringify({ type: 'delivered', id: imageId }));
  await until(
    () => event(guest, (e) => e.type === 'delivered' && e.id === imageId),
    'image delivered',
  );
  console.log('PASS bidirectional text/image bytes, acknowledgements and deduplication');
  const oldEpoch = host.state.epoch;
  guest.ws.send(JSON.stringify({ type: 'status', choice: 'busy' }));
  await until(() => host.state.peer === 'busy', 'busy before stale send');
  guest.ws.send(JSON.stringify({ type: 'status', choice: 'online' }));
  await until(() => host.state.effective === 'online', 'online after busy');
  const staleId = randomUUID();
  host.ws.send(
    JSON.stringify({ type: 'text', id: staleId, epoch: oldEpoch, text: '旧状态不能继续投递' }),
  );
  await until(
    () => event(host, (e) => e.type === 'error' && e.id === staleId),
    'stale epoch rejected',
  );
  guest.ws.terminate();
  await until(() => host.state.peer === 'offline', 'disconnect detection');
  const rejoined = await connect(code, guestToken, 'busy');
  await until(
    () => host.state.peer === 'busy' && rejoined.state.effective === 'busy',
    'resume with initial busy',
  );
  assert.equal((await post(`/v1/rooms/${code}/leave`, hostToken)).status, 200);
  await until(() => event(rejoined, (e) => e.type === 'ended'), 'cancel propagated');
  assert.equal((await post(`/v1/rooms/${code}/join`, randomBytes(32).toString('hex'))).status, 404);
  console.log('PASS stale-state rejection, disconnect/reconnect and cancellation');
  // The authenticated socket must release the pair without a second HTTP request.
  const makeRoom = async (connectGuest = true) => {
    const token = randomBytes(32).toString('hex'),
      other = randomBytes(32).toString('hex');
    const created = await post('/v1/rooms', '', { token });
    assert.equal(created.status, 200);
    const code = created.body.code,
      host = await connect(code, token);
    assert.equal((await post(`/v1/rooms/${code}/join`, other)).status, 200);
    const guest = connectGuest ? await connect(code, other) : null;
    return { code, token, other, host, guest };
  };
  const exiting = await makeRoom();
  exiting.guest.ws.send(JSON.stringify({ type: 'leave' }));
  await until(
    () => event(exiting.host, (e) => e.type === 'ended'),
    'socket exit releases other party',
  );
  assert.equal(
    (await post(`/v1/rooms/${exiting.code}/join`, randomBytes(32).toString('hex'))).status,
    404,
  );
  console.log('PASS explicit socket exit frees pair immediately');
  const abandoned = await makeRoom(),
    incomplete = await makeRoom(false),
    resumed = await makeRoom();
  const keepAlive = setInterval(() => {
    for (const client of clients)
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ type: 'ping' }));
  }, 5000);
  try {
    abandoned.guest.ws.terminate();
    resumed.guest.ws.terminate();
    await until(() => resumed.host.state.peer === 'offline', 'short disconnect');
    const recovered = await connect(resumed.code, resumed.other);
    await until(() => recovered.state.effective === 'online', 'resume inside lease');
    await until(
      () =>
        event(abandoned.host, (e) => e.type === 'ended') &&
        event(incomplete.host, (e) => e.type === 'ended'),
      '30-second abandoned-slot cleanup',
      38000,
    );
    for (const room of [abandoned, incomplete]) {
      assert.equal(
        (await post(`/v1/rooms/${room.code}/join`, randomBytes(32).toString('hex'))).status,
        404,
      );
    }
    // Wait beyond the former reconnect deadline: recovery must cancel it.
    await wait(1200);
    assert.ok(!event(resumed.host, (e) => e.type === 'ended'));
    const id = randomUUID();
    recovered.ws.send(
      JSON.stringify({ type: 'text', id, epoch: recovered.state.epoch, text: '重连保留会话' }),
    );
    await until(
      () => event(resumed.host, (e) => e.id === id && e.type === 'text'),
      'resumed room survives former deadline',
    );
    await post(`/v1/rooms/${resumed.code}/leave`, resumed.token);
    console.log(
      'PASS abandoned socket and incomplete join expire; recovered connection stays usable',
    );
  } finally {
    clearInterval(keepAlive);
    for (const room of [abandoned, incomplete, resumed])
      await post(`/v1/rooms/${room.code}/leave`, room.token).catch(() => {});
  }
  console.log(`All ${remote ? 'live Cloudflare' : 'local Worker'} integration checks passed.`);
} catch (error) {
  console.error(error);
  console.error(logs.slice(-4000));
  process.exitCode = 1;
} finally {
  if (cleanupCode) await post(`/v1/rooms/${cleanupCode}/leave`, cleanupToken).catch(() => {});
  for (const client of clients) client.ws.terminate();
  child?.kill();
}
