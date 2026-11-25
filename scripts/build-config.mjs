// Build-time defaults for the main process, written to dist-electron/build.json by `build:main`:
//   VITE_SENTRY_DSN (public key; empty = reporting off), VITE_API_BASE and VITE_STUDIO_URL (default server addresses).
// Unset addresses fall back to the local dev stack. `--release` checks a finished build instead (dist:* run it before
// packaging): both addresses must be public https hostnames and no loopback/LAN host may appear in the bundles.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-electron', 'build.json');

/** https on a DNS name that isn't local. IP literals are refused outright, so no private range slips through. */
function isPublicHttps(u) {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol !== 'https:' || hostname.startsWith('[') || /^[\d.]+$/.test(hostname) || !hostname.includes('.')) return false;
    return !/(^|\.)(localhost|local|lan|internal|home|test|invalid)$/i.test(hostname);
  } catch {
    return false;
  }
}
assert(isPublicHttps('https://cult-api.up.railway.app') && isPublicHttps('https://cult-live.vercel.app/studio'));
assert(!['http://127.0.0.1:4000', 'https://127.0.0.1', 'https://192.168.1.20:4000', 'https://[::1]:4000', 'https://localhost:4000', 'https://studio.local', 'http://cult-api.up.railway.app'].some(isPublicHttps));

// A URL pointing at loopback/LAN (plain `hostname === 'localhost'` checks in libraries are fine).
const LOCAL_HOST = /[a-z]+:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])/i;
assert(LOCAL_HOST.test('"http://127.0.0.1:4000"') && LOCAL_HOST.test('ws://192.168.1.4') && !LOCAL_HOST.test('a===`localhost`'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

if (process.argv.includes('--release')) {
  const cfg = JSON.parse(fs.readFileSync(out, 'utf8'));
  const bad = ['apiBase', 'studioUrl'].filter((k) => !isPublicHttps(cfg[k]));
  if (bad.length) {
    console.error(`[build-config] release build needs public https addresses, got ${bad.map((k) => `${k}=${cfg[k]}`).join(', ')}. Set VITE_API_BASE and VITE_STUDIO_URL and rebuild.`);
    process.exit(1);
  }
  const leaks = [...walk(path.join(root, 'dist-electron')), ...walk(path.join(root, 'dist'))]
    .filter((f) => /\.(js|json|html|css)$/.test(f))
    .filter((f) => LOCAL_HOST.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f));
  if (leaks.length) {
    console.error(`[build-config] loopback/LAN host found in release bundle: ${leaks.join(', ')}`);
    process.exit(1);
  }
  console.log(`[build-config] release OK: api ${cfg.apiBase}, studio ${cfg.studioUrl}, sentry ${cfg.dsn ? 'on' : 'off'}`);
} else {
  const cfg = {
    dsn: process.env.VITE_SENTRY_DSN || '',
    apiBase: process.env.VITE_API_BASE || 'http://127.0.0.1:4000',
    studioUrl: process.env.VITE_STUDIO_URL || 'http://localhost:5173/studio',
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(cfg));
}
