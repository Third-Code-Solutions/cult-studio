// Smoke test of the packaged app (win-unpacked, or the .app binary on macOS): it starts, loads app://studio from the
// asar and shows sign-in against the baked-in server. A login with an account that can't exist must come back from
// that server (not a network error). With CULT_E2E_PASSWORD set it also signs in, reaches the studio and signs out.
// No media, no broadcast, no screen capture; screenshots come from the app's own page.
//   APP_EXE="release/win-unpacked/CULT Live Studio.exe" EXPECT_SERVER=cult-api.up.railway.app SHOTS=<dir> node e2e/packaged.smoke.mjs
import { _electron as electron } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const exe = path.resolve(process.env.APP_EXE ?? 'release/win-unpacked/CULT Live Studio.exe');
const shots = process.env.SHOTS ?? 'e2e/shots';
const profile = path.join(shots, 'packaged-profile');
fs.rmSync(profile, { recursive: true, force: true });

// CULT_FAKE_MEDIA: never open the real mic or camera in tests.
const app = await electron.launch({ executablePath: exe, env: { ...process.env, CULT_USER_DATA: profile, CULT_FAKE_MEDIA: '1' } });
let ok = false;
try {
  const page = await app.firstWindow();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.getByLabel('Email or username').waitFor({ timeout: 30000 });
  const server = (await page.getByText(/^Server: /).innerText()).replace('Server: ', '');
  console.log(`[smoke] sign-in screen up, server ${server}`);
  if (process.env.EXPECT_SERVER && server !== process.env.EXPECT_SERVER) throw new Error(`expected server ${process.env.EXPECT_SERVER}, got ${server}`);
  await page.screenshot({ path: path.join(shots, 'packaged-signin.png') });

  await page.getByLabel('Email or username').fill('smoke-check@example.invalid');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const alert = await page.getByRole('alert').innerText({ timeout: 20000 });
  console.log(`[smoke] bad login answered: ${alert}`);
  if (/Can’t reach CULT/.test(alert)) throw new Error('the app could not reach its API');

  if (process.env.CULT_E2E_PASSWORD) {
    await page.getByLabel('Email or username').fill(process.env.CULT_E2E_USER ?? 'kitchenbeats@cult.dev');
    await page.getByLabel('Password').fill(process.env.CULT_E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Go LIVE' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shots, 'desktop-13-packaged.png') });
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email or username').waitFor();
  }
  if (consoleErrors.length) throw new Error(`renderer console errors:\n${consoleErrors.join('\n')}`);
  ok = true;
} catch (e) {
  console.error('[smoke] FAIL', e);
} finally {
  await app.close().catch(() => undefined);
}
console.log(`[smoke] packaged app ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
