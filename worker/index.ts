import { DurableObject } from 'cloudflare:workers';
import {
  CODE_PATTERN,
  ID_PATTERN,
  LEASE_MS,
  MAX_IMAGE,
  effectiveStatus,
  unpackImage,
  validText,
  type Choice,
  type Role,
} from '../app/shared/protocol';

interface Env {
  ROOMS: DurableObjectNamespace<PairRoom>;
}
interface RoomMeta {
  host: string;
  guest?: string;
  expires: number;
  epoch: number;
  touched: number;
  reconnectBy?: Partial<Record<Role, number>>;
}
interface Attachment {
  role: Role;
  hash: string;
  choice: Choice;
  seen: number;
  sent: string[];
  delivered: string[];
  burst: number;
  burstAt: number;
}
const INVITE_MS = 10 * 60_000;
const RECONNECT_MS = 30_000;
const tokenPattern = /^[a-f0-9]{64}$/;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > 2048) {
      await reader.cancel();
      throw new Error('请求过大');
    }
    chunks.push(part.value);
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(data));
}
const createLimits = new Map<string, { count: number; until: number }>();
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.headers.get('Origin')) return json({ error: '请从桌宠程序连接' }, 403);
      if (url.pathname === '/health') return json({ ok: true, service: 'dafeyu', protocol: 1 });
      if (url.pathname === '/v1/rooms' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        const now = Date.now(),
          limit = createLimits.get(ip);
        if (limit && limit.until > now && limit.count >= 8)
          return json({ error: '创建过于频繁，请稍后再试' }, 429);
        if (createLimits.size > 2000) createLimits.clear();
        createLimits.set(ip, {
          count: limit && limit.until > now ? limit.count + 1 : 1,
          until: limit && limit.until > now ? limit.until : now + 60_000,
        });
        const input = await body(request);
        if (typeof input.token !== 'string' || !tokenPattern.test(input.token))
          return json({ error: '无效的连接凭证' }, 400);
        const hostHash = await hash(input.token);
        // A retry with the same 256-bit token reaches the same room. This avoids
        // orphan invites when the response is lost after the server creates it.
        const code = Array.from(
          { length: 10 },
          (_, i) => alphabet[parseInt(hostHash.slice(i * 2, i * 2 + 2), 16) % alphabet.length],
        ).join('');
        const stub = env.ROOMS.getByName(code);
        const result = await stub.fetch(
          new Request('https://room/create', {
            method: 'POST',
            body: JSON.stringify({ hash: hostHash }),
          }),
        );
        if (!result.ok) return result;
        const created = await result.json<{ expiresAt: number }>();
        return json({ code, expiresAt: created.expiresAt });
      }
      const match = url.pathname.match(/^\/v1\/rooms\/([A-Z2-9]+)\/(join|socket|leave)$/);
      if (!match || !CODE_PATTERN.test(match[1])) return json({ error: '配对码无效' }, 404);
      if (
        (match[2] === 'socket' && request.method !== 'GET') ||
        (match[2] !== 'socket' && request.method !== 'POST')
      )
        return json({ error: '请求方式无效' }, 405);
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
      if (!tokenPattern.test(token)) return json({ error: '缺少连接凭证' }, 401);
      // Join/leave do not forward a body stream into the Durable Object. Finish
      // reading it before returning, including when a client closes abruptly.
      if (match[2] !== 'socket') await body(request);
      const headers = new Headers(request.headers);
      headers.delete('Content-Length');
      const internal = new Request(`https://room/${match[2]}`, { method: request.method, headers });
      internal.headers.set('X-Token-Hash', await hash(token));
      internal.headers.delete('Authorization');
      return env.ROOMS.getByName(match[1]).fetch(internal);
    } catch {
      return json({ error: '请求无法处理，请检查输入后重试' }, 400);
    }
  },
};

export class PairRoom extends DurableObject<Env> {
  private meta: RoomMeta | null = null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<RoomMeta>('control')) || null;
    });
  }
  private attachment(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }
  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }
  private save() {
    if (this.meta) this.ctx.waitUntil(this.ctx.storage.put('control', this.meta));
  }
  private bump() {
    if (this.meta) {
      this.meta.epoch++;
      this.meta.touched = Date.now();
      this.save();
    }
  }
  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }
  private peer(ws: WebSocket) {
    const role = this.attachment(ws).role;
    return this.sockets().find((other) => this.attachment(other).role !== role);
  }
  private live(ws?: WebSocket) {
    return (
      !!ws && ws.readyState === WebSocket.OPEN && Date.now() - this.attachment(ws).seen < LEASE_MS
    );
  }
  private allowed(ws: WebSocket, epoch: unknown) {
    const peer = this.peer(ws);
    return (
      !!this.meta?.guest &&
      epoch === this.meta.epoch &&
      this.live(ws) &&
      this.live(peer) &&
      this.attachment(ws).choice === 'online' &&
      !!peer &&
      this.attachment(peer).choice === 'online'
    );
  }
  private broadcast() {
    for (const ws of this.sockets()) {
      const own = this.attachment(ws),
        peer = this.peer(ws);
      const peerStatus = this.live(peer) && peer ? this.attachment(peer).choice : 'offline';
      const paired = !!this.meta?.guest;
      this.send(ws, {
        type: 'state',
        epoch: this.meta?.epoch || 0,
        own: own.choice,
        peer: peerStatus,
        paired,
        effective: effectiveStatus(this.live(ws) ? own.choice : 'offline', peerStatus, paired),
      });
    }
  }
  private armAlarm() {
    if (!this.meta) return;
    // A missing participant has a bounded reconnect lease, including a join
    // whose socket handshake never completes. Older stored rooms migrate here.
    this.refreshAbsences();
    const times = this.sockets().map((ws) => this.attachment(ws).seen + LEASE_MS);
    times.push(...Object.values(this.meta.reconnectBy || {}));
    if (!this.meta.guest) times.push(this.meta.expires);
    const next = Math.min(...times);
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Math.max(Date.now() + 100, next)));
  }
  private refreshAbsences() {
    if (!this.meta) return;
    this.meta.reconnectBy ||= {};
    let changed = false;
    for (const role of ['host', 'guest'] as const) {
      if (!this.meta[role]) continue;
      const socket = this.sockets().find((ws) => this.attachment(ws).role === role);
      if (!socket && !this.meta.reconnectBy[role]) {
        this.meta.reconnectBy[role] = Date.now() + RECONNECT_MS;
        changed = true;
      }
    }
    if (changed) this.save();
  }
  private async expireIfNeeded() {
    if (!this.meta) return;
    this.refreshAbsences();
    if (Object.values(this.meta.reconnectBy || {}).some((deadline) => deadline <= Date.now()))
      await this.destroy('对方已离线，配对已解除，请重新配对');
    else if (!this.meta.guest && this.meta.expires <= Date.now())
      await this.destroy('配对码已过期，请重新生成');
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname,
      token = request.headers.get('X-Token-Hash') || '';
    if (path === '/create') {
      const input = await request.json<{ hash: string }>();
      if (this.meta)
        return this.meta.host === input.hash
          ? json({ ok: true, expiresAt: this.meta.expires })
          : json({ error: '请重新生成配对码' }, 409);
      this.meta = {
        host: input.hash,
        expires: Date.now() + INVITE_MS,
        epoch: 0,
        touched: Date.now(),
      };
      await this.ctx.storage.put('control', this.meta);
      this.armAlarm();
      return json({ ok: true, expiresAt: this.meta.expires });
    }
    await this.expireIfNeeded();
    if (!this.meta) return json({ error: '配对码不存在或已经取消' }, 404);
    if (path === '/join') {
      if (token === this.meta.host) return json({ error: '不能与自己配对' }, 409);
      if (this.meta.guest === token) return json({ ok: true });
      if (this.meta.guest) return json({ error: '这组配对已有两人' }, 409);
      if (Date.now() > this.meta.expires)
        return json({ error: '配对码已过期，请让对方重新生成' }, 410);
      const host = this.sockets().find((ws) => this.attachment(ws).role === 'host');
      if (!this.live(host)) return json({ error: '对方尚未连接，请稍后再试' }, 409);
      this.meta.guest = token;
      this.bump();
      this.broadcast();
      this.armAlarm();
      return json({ ok: true });
    }
    const role: Role | null =
      token === this.meta.host ? 'host' : token === this.meta.guest ? 'guest' : null;
    if (!role) return json({ error: '配对凭证无效' }, 403);
    if (path === '/leave') {
      await this.destroy('对方已取消配对或退出程序');
      return json({ ok: true });
    }
    if (path === '/socket') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return json({ error: '需要 WebSocket 连接' }, 426);
      for (const old of this.sockets())
        if (this.attachment(old).role === role) old.close(4001, 'Connection replaced');
      const pair = new WebSocketPair();
      const choice = request.headers.get('X-Presence') === 'busy' ? 'busy' : 'online';
      pair[1].serializeAttachment({
        role,
        hash: token,
        choice,
        seen: Date.now(),
        sent: [],
        delivered: [],
        burst: 0,
        burstAt: Date.now(),
      } satisfies Attachment);
      this.ctx.acceptWebSocket(pair[1]);
      if (this.meta.reconnectBy) delete this.meta.reconnectBy[role];
      this.bump();
      this.broadcast();
      this.armAlarm();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json({ error: '请求不存在' }, 404);
  }
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (!this.meta) {
      ws.close(4002, 'Pair ended');
      return;
    }
    const attachment = this.attachment(ws);
    if (attachment.hash !== this.meta[attachment.role]) {
      ws.close(4002, 'Pair ended');
      return;
    }
    const now = Date.now();
    if (now - attachment.burstAt > 10_000) {
      attachment.burst = 0;
      attachment.burstAt = now;
    }
    attachment.burst++;
    if (attachment.burst > 60) {
      this.send(ws, { type: 'error', message: '发送过快，请稍后再试' });
      return;
    }
    attachment.seen = now;
    ws.serializeAttachment(attachment);
    this.armAlarm();
    if (typeof data !== 'string') {
      const parsed = unpackImage(new Uint8Array(data));
      if (!parsed) {
        this.send(ws, { type: 'error', message: '图片格式或大小不符合要求' });
        return;
      }
      this.relay(ws, parsed.info.id, parsed.info.epoch, data);
      return;
    }
    if (data.length > MAX_IMAGE || data.length > 24_000) {
      ws.close(1009, 'Message too large');
      return;
    }
    try {
      const message = JSON.parse(data);
      if (message.type === 'leave') {
        await this.destroy('对方已取消配对或退出程序');
        return;
      }
      if (message.type === 'ping') {
        this.send(ws, { type: 'pong' });
        this.broadcast();
        return;
      }
      if (message.type === 'status' && (message.choice === 'online' || message.choice === 'busy')) {
        if (attachment.choice !== message.choice) {
          attachment.choice = message.choice;
          ws.serializeAttachment(attachment);
          this.bump();
        }
        this.broadcast();
        return;
      }
      if (message.type === 'text' && ID_PATTERN.test(message.id) && validText(message.text)) {
        this.relay(
          ws,
          message.id,
          message.epoch,
          JSON.stringify({
            type: 'text',
            id: message.id,
            epoch: message.epoch,
            text: message.text,
          }),
        );
        return;
      }
      if (message.type === 'delivered' && ID_PATTERN.test(message.id)) {
        const peer = this.peer(ws);
        if (peer) {
          const other = this.attachment(peer);
          if (other.sent.includes(message.id)) {
            other.delivered = [
              ...other.delivered.filter((id) => id !== message.id),
              message.id,
            ].slice(-80);
            peer.serializeAttachment(other);
            this.send(peer, { type: 'delivered', id: message.id });
          }
        }
        return;
      }
      this.send(ws, {
        type: 'error',
        id: typeof message.id === 'string' ? message.id : undefined,
        message: '消息格式不正确',
      });
    } catch {
      this.send(ws, { type: 'error', message: '无法识别消息' });
    }
  }
  private relay(ws: WebSocket, id: string, epoch: number, data: string | ArrayBuffer) {
    const attachment = this.attachment(ws),
      peer = this.peer(ws);
    if (attachment.sent.includes(id)) {
      this.send(ws, { type: attachment.delivered.includes(id) ? 'delivered' : 'accepted', id });
      return;
    }
    if (!this.allowed(ws, epoch) || !peer) {
      this.send(ws, { type: 'error', id, message: '当前状态不能聊天，请等双方在线后重新发送' });
      this.broadcast();
      return;
    }
    try {
      peer.send(data);
      attachment.sent = [...attachment.sent, id].slice(-80);
      ws.serializeAttachment(attachment);
      this.send(ws, { type: 'accepted', id });
    } catch {
      this.send(ws, { type: 'error', id, message: '对方连接已断开，消息未送达' });
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Connection closed');
    } catch {}
    if (this.meta) {
      // Also release sessions from pre-1.0.1 clients that send only this close.
      const role = this.attachment(ws).role;
      if (
        code === 1000 &&
        reason === 'Pair ended' &&
        !this.sockets().some((other) => this.attachment(other).role === role)
      ) {
        await this.destroy('对方已取消配对或退出程序');
        return;
      }
      this.bump();
      this.broadcast();
      this.armAlarm();
    }
  }
  webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, 'Connection error');
    } catch {}
    this.bump();
    this.broadcast();
    this.armAlarm();
  }
  async alarm() {
    await this.expireIfNeeded();
    if (!this.meta) return;
    let changed = false;
    for (const ws of this.sockets())
      if (!this.live(ws)) {
        ws.close(4003, 'Heartbeat timeout');
        changed = true;
      }
    if (changed) {
      this.bump();
      this.broadcast();
    }
    this.armAlarm();
  }
  private async destroy(reason: string) {
    this.meta = null;
    for (const ws of this.sockets()) {
      this.send(ws, { type: 'ended', message: reason });
      ws.close(4002, 'Pair ended');
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
}
