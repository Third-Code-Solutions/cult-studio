// Source right-click menu checks, run from studio.e2e.mjs in its own scene. Every assertion reads the compositor's
// canvas pixels (what goes out in the stream) or the overlay box geometry. Synthetic media only: a generated
// 4-colour test image and text. The projector is opened Windowed only, never fullscreen on a real display.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 200×100 BMP: top-left red, top-right blue, bottom-left green, bottom-right yellow. */
function quadBmp(file) {
  const w = 200, h = 100, row = w * 3, size = 54 + row * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22); // bottom-up rows
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    const top = h - 1 - y < h / 2; // row y is stored bottom-up
    for (let x = 0; x < w; x++) {
      const left = x < w / 2;
      const [r, g, bl] = top ? (left ? [255, 0, 0] : [0, 0, 255]) : left ? [0, 255, 0] : [255, 255, 0];
      const o = 54 + y * row + x * 3;
      b[o] = bl;
      b[o + 1] = g;
      b[o + 2] = r;
    }
  }
  fs.writeFileSync(file, b);
}

export async function sourceMenuChecks({ page, app, check, shot, addSource, dir }) {
  const QUAD = path.join(dir, 'quad.bmp');
  quadBmp(QUAD);
  const frame = () => page.waitForTimeout(250); // a few compositor ticks
  const stageBox = (name) => page.locator(`.stage .box[aria-label="${name}"]`);
  const row = (name) => page.locator('.sources .row', { hasText: name });
  const ctx = page.locator('.ctx').first();
  const item = (label) => page.getByRole('menuitem', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

  /** Right-click `target`, then click through `labels` (submenu parents first). */
  const menu = async (target, ...labels) => {
    await target.click({ button: 'right' });
    await ctx.waitFor();
    for (const l of labels) await item(l).click();
    await frame();
  };
  /** Overlay geometry of an item, in % of the canvas. */
  const geo = (name) =>
    stageBox(name).first().evaluate((el) => {
      const p = (k) => parseFloat(el.style[k]);
      return { x: p('left'), y: p('top'), w: p('width'), h: p('height') };
    });
  /** Average colour of the program canvas at (fx, fy) inside the item's visual box. */
  const px = (name, fx, fy) =>
    stageBox(name).first().evaluate((el, [fx, fy]) => {
      const c = el.closest('.canvas-wrap').querySelector('canvas');
      const p = (k) => parseFloat(el.style[k]) / 100;
      const x = Math.round((p('left') + p('width') * fx) * c.width);
      const y = Math.round((p('top') + p('height') * fy) * c.height);
      const d = c.getContext('2d').getImageData(x - 1, y - 1, 3, 3).data;
      const avg = [0, 1, 2].map((i) => Math.round((d[i] + d[i + 4] + d[i + 8] + d[i + 12] + d[i + 16] + d[i + 20] + d[i + 24] + d[i + 28] + d[i + 32]) / 9));
      return avg;
    }, [fx, fy]);
  /** Count of 'white' or 'red' pixels in the item's box. */
  const count = (name, pred, nth = 0) =>
    stageBox(name).nth(nth).evaluate((el, src) => {
      const f = src === 'white' ? (r, g, b) => r > 200 && g > 200 && b > 200 : (r, g, b) => r > 200 && g < 60 && b < 60; // no eval under the app CSP
      const c = el.closest('.canvas-wrap').querySelector('canvas');
      const p = (k) => parseFloat(el.style[k]) / 100;
      const x = Math.max(0, Math.round(p('left') * c.width)), y = Math.max(0, Math.round(p('top') * c.height));
      const w = Math.min(c.width - x, Math.round(p('width') * c.width)), h = Math.min(c.height - y, Math.round(p('height') * c.height));
      const d = c.getContext('2d').getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++;
      return n;
    }, pred);
  const is = (c, [r, g, b], tol = 60) => Math.abs(c[0] - r) < tol && Math.abs(c[1] - g) < tol && Math.abs(c[2] - b) < tol;
  const RED = [255, 0, 0], BLUE = [0, 0, 255], GREEN = [0, 255, 0], YELLOW = [255, 255, 0];
  const corners = async (name) => ({ tl: await px(name, 0.25, 0.25), tr: await px(name, 0.75, 0.25), bl: await px(name, 0.25, 0.75), br: await px(name, 0.75, 0.75) });
  const near = (a, b, tol = 0.6) => Math.abs(a - b) < tol;

  // Fresh scene, so the other flows are untouched.
  await page.getByRole('button', { name: 'Add scene' }).click();
  await addSource('Image', () => page.locator('input[type=file]').setInputFiles(QUAD));
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const Q = 'quad.bmp';
  await stageBox(Q).waitFor();
  await frame();
  const c0 = await corners(Q);
  check('ctx: test image drawn (TL red, TR blue, BL green, BR yellow)', is(c0.tl, RED) && is(c0.tr, BLUE) && is(c0.bl, GREEN) && is(c0.br, YELLOW), JSON.stringify(c0));
  const home = await geo(Q);

  // Menu layout (right-click on the canvas item)
  await stageBox(Q).click({ button: 'right' });
  await ctx.waitFor();
  const labels = await page.locator('.ctx [role=menuitem]').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.disabled]));
  const want = ['Settings', 'Reset', 'Delete', 'Rename', 'CopyCtrl+C', 'Paste as referenceCtrl+V', 'Paste as duplicate', 'Full screen', 'Center', 'CropALT+drag', 'Rotate', 'Flip', 'Layer', 'Project on screen', 'Shape', 'Advanced filters'];
  check('ctx: menu has every item in TikTok order', JSON.stringify(labels.map((l) => l[0])) === JSON.stringify(want), labels.map((l) => l[0]).join(' | '));
  check('ctx: paste disabled before any copy', labels[5][1] === true && labels[6][1] === true);
  const inside = await ctx.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  check('ctx: menu inside the window', inside);
  await item('Rotate').hover();
  await item('90° clockwise').waitFor();
  await shot('ctx-01-menu');
  await page.keyboard.press('Escape');
  await ctx.waitFor({ state: 'detached' });
  check('ctx: Escape closes the menu', true);

  // Keyboard: arrows to Rotate, Right opens the submenu, Enter runs 90° CW
  await stageBox(Q).click({ button: 'right' });
  await ctx.waitFor();
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('ArrowRight');
  const subFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('Enter');
  await frame();
  const g90 = await geo(Q);
  const r90 = await corners(Q);
  check('ctx: keyboard reaches Rotate › 90° clockwise', focused === 'Rotate' && subFocus === '90° clockwise', `${focused} > ${subFocus}`);
  check('ctx: rotate 90° CW (box turns, TL shows green, TR red)', near((g90.w / 100) * 1080, (home.h / 100) * 1920, 3) && is(r90.tl, GREEN) && is(r90.tr, RED), JSON.stringify({ g90, r90 }));
  await shot('ctx-02-rotated');

  await menu(stageBox(Q), 'Reset');
  const reset = await corners(Q);
  const gReset = await geo(Q);
  check('ctx: reset restores transform', is(reset.tl, RED) && near(gReset.x, home.x) && near(gReset.w, home.w), JSON.stringify(gReset));

  await menu(stageBox(Q), 'Rotate', '180°');
  check('ctx: rotate 180° (TL yellow)', is((await corners(Q)).tl, YELLOW));
  await menu(stageBox(Q), 'Reset');
  await menu(stageBox(Q), 'Flip', 'Horizontal');
  check('ctx: flip horizontal (TL blue)', is((await corners(Q)).tl, BLUE));
  await menu(stageBox(Q), 'Flip', 'Horizontal');
  await menu(stageBox(Q), 'Flip', 'Vertical');
  check('ctx: flip vertical (TL green)', is((await corners(Q)).tl, GREEN));
  await menu(stageBox(Q), 'Reset');

  // Full screen › stretch / fill / fit
  await menu(stageBox(Q), 'Full screen', 'Stretch to screen');
  const gs = await geo(Q);
  check('ctx: stretch fills the canvas exactly', near(gs.x, 0) && near(gs.y, 0) && near(gs.w, 100) && near(gs.h, 100), JSON.stringify(gs));
  await menu(stageBox(Q), 'Full screen', 'Fill screen');
  const gf = await geo(Q);
  check('ctx: fill covers the canvas (keeps 2:1)', near(gf.h, 100) && gf.w > 300 && is(await px(Q, 0.45, 0.25), RED), JSON.stringify(gf));
  await menu(stageBox(Q), 'Full screen', 'Fit to screen');
  const gfit = await geo(Q);
  check('ctx: fit to screen', near(gfit.w, 100) && near(gfit.h, 28.125) && near(gfit.y, 35.94), JSON.stringify(gfit));

  // Center: shrink and move it off-centre first (resize handle + drag), then Center › Both
  const sel = await stageBox(Q).boundingBox();
  await page.mouse.move(sel.x + sel.width - 1, sel.y + sel.height - 1);
  const se = page.locator('.stage .box.sel .h.se');
  const seb = await se.boundingBox();
  await page.mouse.move(seb.x + seb.width / 2, seb.y + seb.height / 2);
  await page.mouse.down();
  await page.mouse.move(seb.x - sel.width / 2, seb.y - sel.height / 2, { steps: 5 });
  await page.mouse.up();
  const small = await stageBox(Q).boundingBox();
  await page.mouse.move(small.x + 10, small.y + 10);
  await page.mouse.down();
  await page.mouse.move(small.x + 10, small.y + 10 + 80, { steps: 5 });
  await page.mouse.up();
  await frame();
  await menu(stageBox(Q), 'Center', 'Horizontally');
  const gh = await geo(Q);
  await menu(stageBox(Q), 'Center', 'Vertically');
  const gv = await geo(Q);
  check('ctx: center horizontally then vertically', near(gh.x, (100 - gh.w) / 2) && near(gv.y, (100 - gv.h) / 2) && near(gv.x, gh.x), JSON.stringify({ gh, gv }));
  await menu(stageBox(Q), 'Full screen', 'Fit to screen');

  // Crop: menu Crop, drag the right edge in by half → shows only the left (red/green) half, not squashed
  await menu(stageBox(Q), 'Crop');
  check('ctx: crop mode on', (await page.locator('.stage .box.crop').count()) === 1);
  const before = await stageBox(Q).boundingBox();
  const eb = await page.locator('.stage .box.sel .h.e').boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2 - before.width / 2, eb.y + eb.height / 2, { steps: 6 });
  await page.mouse.up();
  await frame();
  const gc = await geo(Q);
  const cc = await corners(Q);
  check('ctx: crop right half (box halves, TR now red not blue)', near(gc.w, 50, 2) && is(cc.tr, RED) && is(cc.br, GREEN), JSON.stringify({ gc, cc }));
  await shot('ctx-03-cropped');
  await page.keyboard.press('Escape');
  check('ctx: Escape leaves crop mode', (await page.locator('.stage .box.crop').count()) === 0);
  // Alt+drag on the bottom edge crops too (no crop mode)
  const b2 = await stageBox(Q).boundingBox();
  const sb = await page.locator('.stage .box.sel .h.s').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 - b2.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await frame();
  const ga = await corners(Q);
  check('ctx: Alt+drag crops the bottom half (only red left)', is(ga.bl, RED) && is(ga.br, RED), JSON.stringify(ga));
  await menu(stageBox(Q), 'Reset');
  check('ctx: reset clears crop', is((await corners(Q)).tr, BLUE));
  // Crop on a rotated item: the visual right edge still crops what you see on the right
  await menu(stageBox(Q), 'Rotate', '90° clockwise');
  await menu(stageBox(Q), 'Crop');
  const rb = await stageBox(Q).boundingBox();
  const reb = await page.locator('.stage .box.sel .h.e').boundingBox();
  await page.mouse.move(reb.x + reb.width / 2, reb.y + reb.height / 2);
  await page.mouse.down();
  await page.mouse.move(reb.x + reb.width / 2 - rb.width / 2, reb.y + reb.height / 2, { steps: 6 });
  await page.mouse.up();
  await frame();
  const rc = await corners(Q);
  check('ctx: crop after rotate keeps the visual left half (green over yellow)', is(rc.tr, GREEN) && is(rc.br, YELLOW), JSON.stringify(rc));
  await page.keyboard.press('Escape');
  await menu(stageBox(Q), 'Reset');

  // Shape: circle
  await menu(stageBox(Q), 'Shape');
  await page.getByRole('dialog').getByRole('button', { name: 'Circle' }).click();
  await frame();
  const corner = await px(Q, 0.03, 0.05);
  const inCircle = await px(Q, 0.4, 0.3);
  check('ctx: circle shape masks corners (corner black, inside red)', corner.every((v) => v < 40) && is(inCircle, RED), JSON.stringify({ corner, inCircle }));
  await shot('ctx-04-circle'); // shape dialog is docked right, canvas stays visible
  await page.getByRole('dialog').getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // Advanced filters: opacity, then brightness
  await menu(stageBox(Q), 'Advanced filters');
  await page.getByLabel('Opacity value').fill('50');
  await frame();
  const op = await px(Q, 0.25, 0.25);
  await page.getByRole('button', { name: 'Reset opacity' }).click();
  await page.getByLabel('Brightness value').fill('50');
  await frame();
  const br = await px(Q, 0.25, 0.25);
  await shot('ctx-05-filters');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset all' }).click();
  await frame();
  const clean = await px(Q, 0.25, 0.25);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  check('ctx: opacity 50% halves red over black', op[0] > 100 && op[0] < 160, JSON.stringify(op));
  check('ctx: brightness 50% halves red', br[0] > 100 && br[0] < 160, JSON.stringify(br));
  check('ctx: reset all filters', is(clean, RED, 20), JSON.stringify(clean));

  // Layer: a text over the stretched image; Bring to front hides it, Send to back shows it
  const T = 'Layer test';
  await addSource('Text', () => page.getByLabel('Text').fill(T));
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await menu(row(Q), 'Full screen', 'Stretch to screen'); // right-click on the Sources row this time
  const white = 'white';
  const w0 = await count(T, white);
  await menu(row(Q), 'Layer', 'Bring to front');
  const w1 = await count(T, white);
  const order1 = await page.locator('.sources .row .name').allInnerTexts();
  await menu(row(Q), 'Layer', 'Send to back');
  const w2 = await count(T, white);
  const order2 = await page.locator('.sources .row .name').allInnerTexts();
  check('ctx: bring to front covers the text; list order follows', w0 > 50 && w1 === 0 && order1[0] === Q, JSON.stringify({ w0, w1, order1 }));
  check('ctx: send to back shows it again', w2 > 50 && order2[0] === T, JSON.stringify({ w2, order2 }));
  await menu(row(Q), 'Layer', 'Bring forward');
  const order3 = await page.locator('.sources .row .name').allInnerTexts();
  await menu(row(Q), 'Layer', 'Send backward');
  const order4 = await page.locator('.sources .row .name').allInnerTexts();
  check('ctx: bring forward / send backward', order3[0] === Q && order4[0] === T, JSON.stringify({ order3, order4 }));

  // Rename (inline, Sources list)
  await menu(row(Q), 'Rename');
  await page.getByLabel('Source name').fill('Quad');
  await page.getByLabel('Source name').press('Enter');
  check('ctx: rename', (await row('Quad').count()) === 1 && (await stageBox('Quad').count()) === 1);
  await menu(stageBox('Quad'), 'Reset');

  // Copy the text, paste into another scene as reference and as duplicate, then recolour the original
  await menu(stageBox(T), 'Copy');
  const scenes = await page.locator('.row', { hasText: /^Scene \d/ }).allInnerTexts();
  const thisScene = `Scene ${scenes.length}`;
  await page.locator('.row', { hasText: 'Scene 2' }).first().click();
  await page.waitForTimeout(300);
  const empty = page.locator('.stage .overlay').first();
  await empty.click({ button: 'right', position: { x: 20, y: 20 } });
  await ctx.waitFor();
  check('ctx: empty canvas menu offers paste', (await item('Paste as reference').isEnabled()) && (await page.locator('.ctx [role=menuitem]').count()) === 2);
  await item('Paste as reference').click();
  await empty.click({ button: 'right', position: { x: 20, y: 20 } });
  await item('Paste as duplicate').click();
  await frame();
  const dup = await stageBox(T).nth(1).boundingBox();
  await page.mouse.move(dup.x + dup.width / 2, dup.y + dup.height / 2);
  await page.mouse.down();
  await page.mouse.move(dup.x + dup.width / 2, dup.y + dup.height / 2 + 300, { steps: 6 });
  await page.mouse.up();
  await page.locator('.row', { hasText: thisScene }).first().click();
  await page.waitForTimeout(300);
  await menu(stageBox(T), 'Settings');
  await page.getByRole('dialog').getByLabel('Colour').fill('#ff0000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.locator('.row', { hasText: 'Scene 2' }).first().click();
  await page.waitForTimeout(400);
  const red = 'red';
  const tops = await stageBox(T).evaluateAll((els) => els.map((e) => parseFloat(e.style.top)));
  const refIdx = tops[0] < tops[1] ? 0 : 1;
  const refRed = await count(T, red, refIdx);
  const dupRed = await count(T, red, 1 - refIdx);
  const dupWhite = await count(T, white, 1 - refIdx);
  check('ctx: paste as reference follows the original’s settings (red)', refRed > 50, `${refRed}`);
  check('ctx: paste as duplicate stays independent (white)', dupRed === 0 && dupWhite > 50, JSON.stringify({ dupRed, dupWhite }));
  await shot('ctx-06-ref-vs-dup');

  // Ctrl+V on the focused stage pastes; Delete from the menu removes it
  await page.locator('.stage .overlay').first().click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+V');
  await frame();
  const n3 = await stageBox(T).count();
  await menu(stageBox(T).last(), 'Delete');
  const n4 = await stageBox(T).count();
  check('ctx: Ctrl+V pastes, Delete removes', n3 === 3 && n4 === 2, `${n3} -> ${n4}`);

  // Project on screen › Windowed (never a real display)
  await page.locator('.row', { hasText: thisScene }).first().click();
  await page.waitForTimeout(300);
  await stageBox('Quad').click({ button: 'right' });
  await item('Project on screen').click();
  const subs = await page.locator('.ctx .ctx [role=menuitem]').allInnerTexts();
  check('ctx: project submenu lists Windowed', subs.includes('Windowed'), subs.join(' | '));
  const [proj] = await Promise.all([app.waitForEvent('window', { timeout: 10000 }), item('Windowed').click()]);
  await proj.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  }, null, { timeout: 10000 });
  const pv = await proj.evaluate(() => {
    const v = document.querySelector('video');
    return { w: v.videoWidth, h: v.videoHeight, hasBridge: typeof window.cult !== 'undefined', node: typeof window.require !== 'undefined' };
  });
  check('ctx: projector window shows the item (video frames)', pv.w > 0 && Math.abs(pv.w / pv.h - 2) < 0.05, JSON.stringify(pv));
  check('ctx: projector has no node, no IPC bridge', !pv.node && !pv.hasBridge);
  await proj.waitForTimeout(400);
  await proj.screenshot({ path: path.join(dir, 'desktop-ctx-07-projector.png') });
  const closed = proj.waitForEvent('close', { timeout: 5000 }).then(() => true, () => false);
  await proj.keyboard.press('Escape').catch(() => undefined); // the window can close before keyup lands
  check('ctx: Escape closes the projector', await closed);

  await page.locator('.row', { hasText: 'Scene 1' }).first().click();
}
