import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { net, session } from 'electron';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  CODE_PATTERN,
  HEARTBEAT_MS,
  LEASE_MS,
  MAX_IMAGE,
  packImage,
  unpackImage,
  validText,
  type Choice,
  type Snapshot,
} from '../shared/protocol';
import type { AppState, ChatMessage } from '../shared/desktop';

export function normalizeRelay(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('中继地址只需填写 https://域名');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('中继地址必须使用 HTTPS');
  return url.origin;
}

export class Relay extends EventEmitter {
  private token = '';
  private room = '';
  private socket?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private retryCount = 0;
  private generation = 0;
  private lastPong = 0;
  private epoch = -1;
  private pending = new Map<string, NodeJS.Timeout>();
  private seen = new Set<string>();
  constructor(public state: AppState) {
    super();
  }
  changed() {
    this.emit('change');
  }
  private notice(text: string) {
    this.state.notice = text;
    this.changed();
  }
  private async request(path: string, token: string, body?: unknown, timeout = 12_000) {
    const url = normalizeRelay(this.state.preferences.relayUrl);
    const response = await net.fetch(url + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : '{}',
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `连接失败（${response.status}）`);
    return data;
  }
  async create() {
    if (this.room && (this.state.paired || this.state.codeExpiresAt > Date.now())) return;
    if (!this.state.preferences.relayUrl) throw new Error('请先在菜单的连接设置中填写中继地址');
    await this.cancel(false);
    const generation = this.generation;
    this.state.connection = 'connecting';
    this.state.notice = '正在生成配对码…';
    this.changed();
    const token = randomBytes(32).toString('hex');
    try {
      const data = await this.request('/v1/rooms', '', { token });
      if (generation !== this.generation) {
        await this.request(`/v1/rooms/${data.code}/leave`, token).catch(() => {});
        return;
      }
      this.token = token;
      this.room = data.code;
      this.state.code = data.code;
      this.state.codeExpiresAt = data.expiresAt;
      await this.connect(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.state.connection = 'idle';
        this.notice(error instanceof Error ? error.message : '连接失败');
      }
      throw error;
    }
  }
  async join(code: string) {
    code = code.replace(/[\s-]/g, '').toUpperCase();
    if (!CODE_PATTERN.test(code)) throw new Error('请输入 10 位配对码');
    if (code === this.room) throw new Error('请输入另一台电脑的配对码');
    await this.cancel(false);
    const generation = this.generation,
      token = randomBytes(32).toString('hex');
    this.state.connection = 'connecting';
    this.state.notice = '正在配对…';
    this.changed();
    try {
      await this.request(`/v1/rooms/${code}/join`, token);
      if (generation !== this.generation) {
        await this.request(`/v1/rooms/${code}/leave`, token).catch(() => {});
        return;
      }
      this.token = token;
      this.room = code;
      this.state.code = code;
      this.state.codeExpiresAt = 0;
      await this.connect(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.state.connection = 'idle';
        this.notice(error instanceof Error ? error.message : '配对失败');
      }
      throw error;
    }
  }
  private async connect(generation: number) {
    if (!this.token || generation !== this.generation) return;
    const http = normalizeRelay(this.state.preferences.relayUrl);
    const url = http.replace(/^http/, 'ws') + `/v1/rooms/${this.room}/socket`;
    const proxy = await session.defaultSession.resolveProxy(http).catch(() => 'DIRECT');
    if (generation !== this.generation) return;
    const proxyHost = proxy.match(/(?:^|;)\s*(?:PROXY|HTTPS)\s+([^;]+)/)?.[1];
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.token}`, 'X-Presence': this.state.own },
      handshakeTimeout: 12_000,
      maxPayload: MAX_IMAGE + 4096,
      perMessageDeflate: false,
      ...(proxyHost ? { agent: new HttpsProxyAgent(`http://${proxyHost}`) } : {}),
    });
    this.socket = ws;
    this.epoch = -1;
    ws.on('open', () => {
      if (generation !== this.generation) {
        ws.close();
        return;
      }
      this.lastPong = Date.now();
      this.retryCount = 0;
      this.state.connection = 'connected';
      ws.send(JSON.stringify({ type: 'status', choice: this.state.own }));
      ws.send(JSON.stringify({ type: 'ping' }));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > LEASE_MS) {
          ws.terminate();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, HEARTBEAT_MS);
      this.changed();
    });
    ws.on('message', (data, binary) => {
      if (generation !== this.generation || ws !== this.socket) return;
      this.lastPong = Date.now();
      if (binary) {
        const parsed = unpackImage(new Uint8Array(data as Buffer));
        if (
          !parsed ||
          this.state.effective !== 'online' ||
          this.state.own !== 'online' ||
          parsed.info.epoch !== this.epoch
        )
          return;
        this.receive({
          id: parsed.info.id,
          kind: 'image',
          image: `data:image/png;base64,${Buffer.from(parsed.png).toString('base64')}`,
          width: parsed.info.width,
          height: parsed.info.height,
          direction: 'in',
          time: Date.now(),
          delivery: 'delivered',
        });
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'state') {
          const snap = message as Snapshot;
          if (snap.epoch < this.epoch) return;
          this.epoch = snap.epoch;
          this.state.peer = snap.peer;
          this.state.paired = snap.paired;
          this.state.effective =
            this.state.own === 'busy' && snap.effective === 'online' ? 'busy' : snap.effective;
          this.state.notice = snap.paired
            ? snap.peer === 'offline'
              ? '等待对方重新连接'
              : this.state.effective === 'busy'
                ? '忙碌中，暂时不能聊天'
                : '你们都在线，可以聊天了'
            : '把配对码告诉另一台电脑';
          this.changed();
          return;
        }
        if (
          message.type === 'text' &&
          validText(message.text) &&
          this.state.effective === 'online' &&
          this.state.own === 'online' &&
          message.epoch === this.epoch
        ) {
          this.receive({
            id: message.id,
            kind: 'text',
            text: message.text,
            direction: 'in',
            time: Date.now(),
            delivery: 'delivered',
          });
          return;
        }
        if (message.type === 'delivered') {
          this.finish(message.id, 'delivered');
          return;
        }
        if (message.type === 'error') {
          if (message.id) this.finish(message.id, 'failed');
          this.notice(message.message);
          return;
        }
        if (message.type === 'ended') {
          const reason = message.message;
          void this.cancel(false, true).then(() => this.notice(reason));
        }
      } catch {
        this.notice('收到无法识别的数据，已忽略');
      }
    });
    ws.on('error', () => {
      if (generation === this.generation) this.notice('暂时无法连接中继，正在重试');
    });
    ws.on('close', (code) => {
      if (generation !== this.generation || ws !== this.socket) return;
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.state.peer = 'offline';
      this.state.effective = 'offline';
      this.failPending();
      if (code === 4002 || code === 4001) {
        void this.cancel(false, true).then(() => this.notice('配对已结束，请重新配对'));
        return;
      }
      this.state.connection = 'reconnecting';
      this.state.notice = '连接中断，正在重连…';
      this.changed();
      this.retry = setTimeout(
        () => void this.connect(generation).catch(() => this.notice('重连失败，请取消后重新配对')),
        Math.min(15_000, 1000 * 2 ** this.retryCount++),
      );
    });
    ws.on('unexpected-response', (_request, response) => {
      response.resume();
      ws.terminate();
      if ([403, 404, 410].includes(response.statusCode || 0))
        void this.cancel(false, true).then(() => this.notice('配对已失效，请重新配对'));
    });
  }
  private receive(message: ChatMessage) {
    if (!this.seen.has(message.id)) {
      this.seen.add(message.id);
      if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!);
      this.state.messages.push(message);
      this.trimMessages();
      this.changed();
    }
    this.socket?.send(JSON.stringify({ type: 'delivered', id: message.id }));
  }
  private trimMessages() {
    while (this.state.messages.length > 60) this.state.messages.shift();
    let bytes = this.state.messages.reduce(
      (sum, m) => sum + (m.image?.length || m.text?.length || 0),
      0,
    );
    while (bytes > 32 * 1024 * 1024 && this.state.messages.length > 1) {
      const m = this.state.messages.shift()!;
      bytes -= m.image?.length || m.text?.length || 0;
    }
  }
  private finish(id: string, delivery: 'delivered' | 'failed') {
    clearTimeout(this.pending.get(id));
    this.pending.delete(id);
    const message = this.state.messages.find((m) => m.id === id);
    if (message) {
      message.delivery = delivery;
      this.changed();
    }
  }
  private failPending() {
    for (const id of [...this.pending.keys()]) this.finish(id, 'failed');
  }
  private canSend() {
    if (
      this.state.effective !== 'online' ||
      this.state.own !== 'online' ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      throw new Error('只有双方在线且未忙碌时才能发送');
  }
  sendText(text: string) {
    if (!validText(text)) throw new Error('请输入 1 至 4000 个字符');
    this.canSend();
    const id = randomUUID();
    this.socket!.send(JSON.stringify({ type: 'text', id, epoch: this.epoch, text }));
    this.outgoing({
      id,
      kind: 'text',
      text,
      direction: 'out',
      time: Date.now(),
      delivery: 'sending',
    });
  }
  sendImage(png: Buffer, width: number, height: number) {
    this.canSend();
    const id = randomUUID();
    this.socket!.send(packImage({ id, epoch: this.epoch, width, height }, png));
    this.outgoing({
      id,
      kind: 'image',
      image: `data:image/png;base64,${png.toString('base64')}`,
      width,
      height,
      direction: 'out',
      time: Date.now(),
      delivery: 'sending',
    });
  }
  private outgoing(message: ChatMessage) {
    this.state.messages.push(message);
    this.trimMessages();
    this.pending.set(
      message.id,
      setTimeout(() => this.finish(message.id, 'failed'), 15_000),
    );
    this.changed();
  }
  setStatus(choice: Choice) {
    if (choice !== 'online' && choice !== 'busy') throw new Error('状态无效');
    this.state.own = choice;
    if (choice === 'busy' && this.state.effective === 'online') this.state.effective = 'busy';
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'status', choice }));
    this.changed();
  }
  async cancel(show = true, remote = false) {
    ++this.generation;
    const room = this.room,
      token = this.token;
    this.room = '';
    this.token = '';
    this.epoch = -1;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    const ws = this.socket;
    this.socket = undefined;
    this.failPending();
    this.seen.clear();
    Object.assign(this.state, {
      code: '',
      codeExpiresAt: 0,
      paired: false,
      peer: 'offline',
      effective: 'offline',
      connection: 'idle',
      messages: [],
      notice: show ? '已取消配对' : '',
    });
    this.changed();
    if (room && token && !remote) {
      // Reuse the authenticated connection and await the server's acknowledgement
      // before quitting. HTTP is a bounded fallback, not a fire-and-forget request.
      const released =
        ws?.readyState === WebSocket.OPEN &&
        (await new Promise<boolean>((resolve) => {
          const done = (ok: boolean) => {
            clearTimeout(timer);
            ws.off('message', onMessage);
            ws.off('close', onClose);
            resolve(ok);
          };
          const onMessage = (data: WebSocket.RawData, binary: boolean) => {
            if (binary) return;
            try {
              if (JSON.parse(data.toString()).type === 'ended') done(true);
            } catch {}
          };
          const onClose = (code: number) => done(code === 4002);
          const timer = setTimeout(() => done(false), 1200);
          ws.on('message', onMessage);
          ws.once('close', onClose);
          try {
            ws.send(JSON.stringify({ type: 'leave' }));
          } catch {
            done(false);
          }
        }));
      if (!released)
        await this.request(`/v1/rooms/${room}/leave`, token, undefined, 2500).catch(() => {});
    }
    if (ws?.readyState === WebSocket.OPEN) ws.close(1000, 'Pair ended');
    else if (ws?.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  reconnect() {
    if (this.socket) {
      this.socket.terminate();
    }
  }
}
