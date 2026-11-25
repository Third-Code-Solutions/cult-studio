import * as Sentry from '@sentry/electron/main';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Error/crash reporting for main and renderer. Renderer events arrive over IPC and pass through beforeSend here.
 * The DSN is baked in at build time (VITE_SENTRY_DSN -> dist-electron/build.json by build:main); empty = off.
 * main.ts calls initSentry() before app ready.
 */
const SECRET_QS = /(\b[\w-]*(?:token|key|password|totp|secret)=)[^&#\s"']*/gi;
const BEARER = /Bearer\s+[\w.~+/=-]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
const SECRET_KEY = /^(authorization|cookies?|set-cookie)$/i;

/** Deep-scrubs a prepared (already normalized, plain-data) Sentry event in place. */
function scrub<T>(v: T, seen = new WeakSet<object>()): T {
  if (typeof v === 'string') return v.replace(SECRET_QS, '$1[Filtered]').replace(BEARER, 'Bearer [Filtered]').replace(EMAIL, '[email]') as T;
  if (v && typeof v === 'object' && !seen.has(v)) {
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (SECRET_KEY.test(k)) delete o[k];
      else if (k !== 'sdkProcessingMetadata') o[k] = scrub(o[k], seen);
    }
  }
  return v;
}

function buildDsn(): string {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, 'build.json'), 'utf8')).dsn ?? '');
  } catch {
    return ''; // no build-time DSN: reporting stays off
  }
}

export function initSentry(): void {
  const dsn = buildDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    // Classic IPC (preload) only: protocol mode would register a CSP-bypassing sentry-ipc:// scheme.
    ipcMode: Sentry.IPCMode.Classic,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], stackFrameVariables: false },
    beforeSend: (event) => scrub(event),
  });
}
