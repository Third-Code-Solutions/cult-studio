import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

/**
 * Everything that talks to the CULT API lives here, in the main process. The renderer never sees the account
 * token or the WHIP publish token: it calls narrow IPC verbs and an allowlisted request proxy.
 */

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; details?: unknown };

const httpUrl = z
  .string()
  .trim()
  .max(300)
  .url()
  .refine((u) => /^https?:$/.test(new URL(u).protocol), 'Use an http(s) address');
export const settingsSchema = z.object({ apiBase: httpUrl, studioUrl: httpUrl });
export type Settings = z.infer<typeof settingsSchema>;

// Baked in by build:main (scripts/build-config.mjs): the local dev stack, or production for release builds.
const DEFAULT_SETTINGS: Settings = settingsSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'build.json'), 'utf8')));

const file = (name: string) => path.join(app.getPath('userData'), name);

let settings: Settings = DEFAULT_SETTINGS;
const normalize = (s: Settings): Settings => ({ ...s, apiBase: s.apiBase.replace(/\/+$/, '') });

export function loadSettings(): void {
  let saved: unknown = {};
  try {
    saved = JSON.parse(fs.readFileSync(file('settings.json'), 'utf8'));
  } catch {
    /* first run */
  }
  const merged = { ...DEFAULT_SETTINGS, ...(typeof saved === 'object' && saved ? saved : {}) } as Record<string, unknown>;
  if (process.env.CULT_API_BASE) merged.apiBase = process.env.CULT_API_BASE;
  const parsed = settingsSchema.safeParse(merged);
  settings = normalize(parsed.success ? parsed.data : DEFAULT_SETTINGS);
}

export const getSettings = (): Settings => settings;

export function saveSettings(s: Settings): void {
  settings = normalize(s);
  fs.writeFileSync(file('settings.json'), JSON.stringify(settings, null, 2));
}

// ── Account token: encrypted with the OS keystore (DPAPI on Windows) via safeStorage, never written in plaintext ──
let token: string | null = null;

export function loadToken(): void {
  try {
    if (safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(fs.readFileSync(file('session.bin')));
  } catch {
    token = null;
  }
}

function storeToken(t: string | null): void {
  token = t;
  try {
    if (!t) fs.rmSync(file('session.bin'), { force: true });
    // Without OS encryption the session stays in memory only (sign in again next launch).
    else if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(file('session.bin'), safeStorage.encryptString(t));
  } catch {
    /* keep the in-memory session */
  }
}

export const getToken = () => token;

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T = unknown>(method: string, apiPath: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const base = settings.apiBase;
  try {
    const res = await fetch(`${base}${apiPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': `CULT-Live-Studio/${app.getVersion()}`,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return { ok: true, data: data as T };
    if (res.status === 401 && apiPath !== '/v1/auth/login') storeToken(null); // session revoked/expired → sign in again
    return { ok: false, status: res.status, code: data?.error?.code ?? `HTTP_${res.status}`, message: data?.error?.message ?? res.statusText, details: data?.error?.details };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', message: `Can’t reach CULT at ${base}.` };
  }
}

// ── Allowlisted request proxy: the only API surface the renderer can reach ──
const ID = '[A-Za-z0-9_]{1,64}';
const ROUTES: [string, RegExp][] = [
  ['GET', /^\/v1\/me$/],
  ['GET', /^\/v1\/config$/],
  ['GET', /^\/v1\/creator\/status$/],
  ['POST', /^\/v1\/creator\/apply$/], // one-tick broadcasting-rules acceptance from the go-live gate
  ['GET', /^\/v1\/me\/notifications$/],
  ['GET', /^\/v1\/creator\/ingest-keys$/],
  ['POST', /^\/v1\/creator\/ingest-keys$/],
  ['POST', /^\/v1\/broadcasts$/],
  ['GET', new RegExp(`^/v1/broadcasts/${ID}$`)],
  ['PATCH', new RegExp(`^/v1/broadcasts/${ID}$`)],
  ['POST', new RegExp(`^/v1/broadcasts/${ID}/(heartbeat|end)$`)],
  ['GET', new RegExp(`^/v1/broadcasts/${ID}/live-stats$`)],
];
const MAX_BODY = 32 * 1024;

export const apiRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH']),
  path: z.string().max(200),
  body: z.record(z.string(), z.unknown()).optional(),
});

export function proxy(req: z.infer<typeof apiRequestSchema>): Promise<Result> {
  if (!ROUTES.some(([m, re]) => m === req.method && re.test(req.path))) return Promise.resolve({ ok: false, status: 0, code: 'NOT_ALLOWED', message: 'This request isn’t available in the desktop app.' });
  if (req.body !== undefined && JSON.stringify(req.body).length > MAX_BODY) return Promise.resolve({ ok: false, status: 0, code: 'TOO_LARGE', message: 'Request too large.' });
  if (req.method === 'GET' && req.body !== undefined) return Promise.resolve({ ok: false, status: 0, code: 'NOT_ALLOWED', message: 'GET requests have no body.' });
  return request(req.method, req.path, req.body);
}

// ── Auth verbs ──
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export async function login(b: z.infer<typeof loginSchema>): Promise<Result<{ me?: unknown; mfaRequired?: boolean }>> {
  const r = await request<{ token?: string; me?: unknown; mfaRequired?: boolean }>('POST', '/v1/auth/login', b);
  if (!r.ok) return r;
  if (r.data.mfaRequired) return { ok: true, data: { mfaRequired: true } };
  if (!r.data.token) return { ok: false, status: 0, code: 'LOGIN_FAILED', message: 'Sign-in failed.' };
  storeToken(r.data.token);
  return { ok: true, data: { me: r.data.me } };
}

export async function session(): Promise<Result> {
  if (!token) return { ok: false, status: 401, code: 'SIGN_IN_REQUIRED', message: 'Sign in' };
  return request('GET', '/v1/me');
}

export async function logout(): Promise<Result> {
  if (token) await request('POST', '/v1/auth/logout', {});
  storeToken(null);
  whip.clear();
  return { ok: true, data: null };
}

// ── Broadcast start + WHIP: the publish token stays here ──
type WhipSession = { url: string; bearer: string; resource: string | null };
const whip = new Map<string, WhipSession>();
export const streamIdSchema = z.object({ streamId: z.string().regex(new RegExp(`^${ID}$`)) });

export async function startBroadcast(streamId: string): Promise<Result> {
  const r = await request<any>('POST', `/v1/broadcasts/${streamId}/start`, { confirm: true, ingest: 'whip' });
  if (!r.ok) return r;
  const url = String(r.data?.ingest?.whipUrl ?? '');
  const bearer = String(r.data?.ingest?.bearerToken ?? '');
  if (!/^https?:\/\//.test(url) || !bearer) return { ok: false, status: 0, code: 'BAD_INGEST', message: 'The server didn’t return a WHIP address.' };
  whip.set(streamId, { url, bearer, resource: null });
  return { ok: true, data: { ...r.data, ingest: { whipUrl: url } } };
}

export const offerSchema = streamIdSchema.extend({ sdp: z.string().min(10).max(200_000).startsWith('v=0') });

export async function whipOffer(streamId: string, sdp: string): Promise<Result<{ sdp: string }>> {
  const s = whip.get(streamId);
  if (!s) return { ok: false, status: 0, code: 'NOT_STARTED', message: 'Start the broadcast first.' };
  if (s.resource) void deleteResource(s); // a re-publish replaces the previous WHIP session
  try {
    const res = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/sdp', authorization: `Bearer ${s.bearer}` }, body: sdp, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      const auth = res.status === 401 || res.status === 403;
      return { ok: false, status: res.status, code: auth ? 'WHIP_REFUSED' : 'WHIP_FAILED', message: auth ? 'The media server refused this session. Go LIVE again.' : `The media server didn’t accept the stream (HTTP ${res.status}).` };
    }
    const loc = res.headers.get('location');
    s.resource = loc ? new URL(loc, s.url).toString() : null;
    return { ok: true, data: { sdp: await res.text() } };
  } catch {
    return { ok: false, status: 0, code: 'MEDIA_UNREACHABLE', message: 'Can’t reach the media server. Check your connection and retry.' };
  }
}

async function deleteResource(s: WhipSession): Promise<void> {
  const resource = s.resource;
  s.resource = null;
  if (resource) await fetch(resource, { method: 'DELETE', headers: { authorization: `Bearer ${s.bearer}` }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

export async function whipStop(streamId: string): Promise<Result> {
  const s = whip.get(streamId);
  if (s) await deleteResource(s);
  whip.delete(streamId);
  return { ok: true, data: null };
}
