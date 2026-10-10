import { app, session } from 'electron';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Relay } from '../app/main/relay';
import type { AppState } from '../app/shared/desktop';
import { animationPreferences } from '../app/shared/actions';
import { createServer } from 'node:http';
const fresh = (): AppState => ({
  preferences: {
    ...animationPreferences(),
    scale: 1,
    alwaysOnTop: false,
    autoStart: false,
    relayUrl: process.env.DAFEYU_TEST_RELAY_URL || 'http://127.0.0.1:8789',
  },
  own: 'online',
  peer: 'offline',
  effective: 'offline',
  connection: 'idle',
  paired: false,
  code: '',
  codeExpiresAt: 0,
  messages: [],
  notice: '',
  dock: 'right',
});
const until = async (check: () => boolean, label: string) => {
  const start = Date.now();
  while (Date.now() - start < (process.env.DAFEYU_TEST_RELAY_URL ? 30000 : 15000)) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Timeout: ' + label);
};
app.whenReady().then(async () => {
  if (process.env.DAFEYU_TEST_DIRECT === '1')
    await session.defaultSession.setProxy({ mode: 'direct' });
  let brokenProxy: ReturnType<typeof createServer> | undefined;
  if (process.env.DAFEYU_TEST_CLOSED_PROXY === '1') {
    brokenProxy = createServer((_request, response) => response.destroy());
    brokenProxy.on('connect', (_request, socket) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      // Close during TLS negotiation, reproducing Chromium's CONNECTION_CLOSED.
      socket.once('data', () => socket.end());
    });
    await new Promise<void>((resolve) => brokenProxy!.listen(0, '127.0.0.1', resolve));
    const address = brokenProxy.address();
    if (!address || typeof address === 'string') throw Error('Proxy fixture unavailable');
    await session.defaultSession.setProxy({
      proxyRules: `127.0.0.1:${address.port}`,
      proxyBypassRules: '<-loopback>',
    });
    let reproduced = '';
    try {
      await session.defaultSession.fetch(fresh().preferences.relayUrl + '/health');
    } catch (error) {
      reproduced = error instanceof Error ? error.message : String(error);
    }
    assert.match(
      reproduced,
      /ERR_(CONNECTION_CLOSED|EMPTY_RESPONSE|CONNECTION_RESET|TUNNEL_CONNECTION_FAILED)/,
    );
    console.log('Reproduced raw network failure:', reproduced);
  }
  const host = new Relay(fresh()),
    guest = new Relay(fresh());
  let failed = false;
  try {
    await host.create();
    await until(() => host.state.connection === 'connected', 'host connected');
    await guest.join(host.state.code);
    await until(
      () => host.state.effective === 'online' && guest.state.effective === 'online',
      'paired clients online',
    );
    host.sendText('来自真实 Electron 主进程的消息');
    await until(
      () =>
        guest.state.messages.some((message) => message.text === '来自真实 Electron 主进程的消息'),
      'desktop text receive',
    );
    await until(
      () => host.state.messages[0]?.delivery === 'delivered',
      'desktop delivery acknowledgement',
    );
    guest.setStatus('busy');
    await until(() => host.state.effective === 'busy', 'desktop busy state');
    assert.throws(() => host.sendText('不能发送'), /双方在线/);
    guest.setStatus('online');
    await until(
      () => host.state.effective === 'online' && guest.state.effective === 'online',
      'desktop resume',
    );
    const png = await readFile('assets/pet/wave/frame_01.png');
    guest.sendImage(png, 192, 208);
    await until(
      () => host.state.messages.some((message) => message.kind === 'image'),
      'desktop image receive',
    );
    await until(
      () =>
        guest.state.messages.some(
          (message) => message.direction === 'out' && message.delivery === 'delivered',
        ),
      'desktop image acknowledged',
    );
    await guest.cancel();
    await until(() => !host.state.code && !host.state.paired, 'desktop cancellation received');
    assert.equal(host.state.messages.length, 0);
    assert.equal(guest.state.messages.length, 0);
    console.log(
      'PASS actual Electron clients: pairing, text, image, busy gate, receipts and cancellation cleanup',
    );
    if (process.env.DAFEYU_TEST_DIRECT === '1') console.log('Network mode: direct (no proxy)');
    if (brokenProxy)
      console.log(
        'PASS automatic recovery from closed proxy; HTTP and WebSocket use the recovered route',
      );
  } catch (error) {
    failed = true;
    console.error(error);
    console.error(
      'Connection states:',
      host.state.connection,
      guest.state.connection,
      host.state.notice,
      guest.state.notice,
    );
  } finally {
    await Promise.all([host.cancel(false), guest.cancel(false)]);
    brokenProxy?.close();
    app.exit(failed ? 1 : 0);
  }
});
