import { z } from 'zod';
import { getSettings, getToken } from './api';

/**
 * Realtime proxy: the main process owns the /v1/realtime WebSocket (it carries the account token) and relays frames.
 * Reconnects with backoff and re-subscribes with `sinceSeq` so chat reconciles after a drop.
 */

const channel = z.string().regex(/^stream:[A-Za-z0-9_]{1,64}$/);
export const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('subscribe'), channel }),
  z.object({ t: z.literal('unsubscribe'), channel }),
  z.object({ t: z.literal('chat.send'), channel, clientMsgId: z.string().min(8).max(64), body: z.string().min(1).max(300) }),
]);

type Emit = (event: 'rt:event' | 'rt:state', payload: unknown) => void;

const PING_MS = 25_000;
let ws: WebSocket | null = null;
let emit: Emit = () => undefined;
let retry = 0;
let timer: NodeJS.Timeout | null = null;
let ping: NodeJS.Timeout | null = null;
let wanted = false;
const channels = new Map<string, number | undefined>(); // channel → last chat seq
const queue: string[] = [];

export function initRealtime(e: Emit): void {
  emit = e;
}

function url(): string {
  const base = new URL(getSettings().apiBase);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/v1/realtime';
  const t = getToken();
  if (t) base.searchParams.set('token', t);
  return base.toString();
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  wanted = true;
  emit('rt:state', retry ? 'reconnecting' : 'connecting');
  const sock = new WebSocket(url());
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    emit('rt:state', 'open');
    for (const [ch, sinceSeq] of channels) sock.send(JSON.stringify({ t: 'subscribe', channel: ch, sinceSeq }));
    for (const q of queue.splice(0)) sock.send(q);
    if (ping) clearInterval(ping);
    ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"t":"ping"}'), PING_MS); // keeps presence fresh
  };
  sock.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg?.channel && typeof msg.lastSeq === 'number' && channels.has(msg.channel)) channels.set(msg.channel, msg.lastSeq);
    if (msg?.t === 'chat.message' && channels.has(msg.channel) && msg.message?.seq > (channels.get(msg.channel) ?? 0)) channels.set(msg.channel, msg.message.seq);
    if (msg?.t !== 'pong') emit('rt:event', msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (ping) clearInterval(ping);
    if (!wanted) return emit('rt:state', 'closed');
    emit('rt:state', 'reconnecting');
    timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++) + Math.random() * 300);
  };
  sock.onerror = () => sock.close();
}

export function send(msg: z.infer<typeof clientMessage>): void {
  if (msg.t === 'subscribe') {
    if (channels.has(msg.channel)) return;
    channels.set(msg.channel, undefined);
  }
  if (msg.t === 'unsubscribe') channels.delete(msg.channel);
  connect();
  const s = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN) ws.send(s);
  else if (msg.t !== 'subscribe') queue.push(s); // subscriptions are replayed on open
}

/** Drop the socket (sign-out / settings change); channels are forgotten. */
export function closeRealtime(): void {
  wanted = false;
  channels.clear();
  queue.length = 0;
  if (timer) clearTimeout(timer);
  if (ping) clearInterval(ping);
  const sock = ws;
  ws = null;
  sock?.close();
  emit('rt:state', 'closed');
}
