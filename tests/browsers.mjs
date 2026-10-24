// Cross-browser checks in Chromium, Firefox and WebKit through Playwright, which this project does
// not depend on: point PLAYWRIGHT_DIR at a folder where `npm i playwright` was run (and
// PLAYWRIGHT_BROWSERS_PATH at its browsers, if they are not in the default place).
//
//   PLAYWRIGHT_DIR=... node tests/browsers.mjs [--shots DIR] [--only chromium,firefox,webkit]
//
// Without Playwright it prints SKIPPED and exits with code 2: a browser that did not run is never
// counted as passing.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '../tools/lib/static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const shots = arg('--shots') ? resolve(arg('--shots')) : null;
const only = (arg('--only') || 'chromium,firefox,webkit').split(',');
let pw;
try { pw = createRequire(join(resolve(process.env.PLAYWRIGHT_DIR || '.'), 'package.json'))('playwright'); } catch (e) {
  console.error('SKIPPED: Playwright not found; set PLAYWRIGHT_DIR to a folder with node_modules/playwright');
  process.exit(2);
}

const VIEWS = ['items', 'item/u:Harlequin Crest', 'calc', 'sim', 'grail', 'mf', 'runes', 'accuracy'];
const SIZES = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '375x667', width: 375, height: 667, mobile: true },
];
const VISIBLE = "(() => { const s = document.querySelector('main section:not([hidden])'); return !!(s && s.children.length > 0); })()";
const results = {};
let passed = 0, failed = 0;
let step = ''; // the step a check is on, named in its failure

const server = await serve({ mounts: [{ prefix: '/d2looter/', dir: ROOT }] });
const base = `${server.origin}/d2looter/`;

// Problems a page reports: errors, failed or outside requests.
function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { if (!/^blob:/.test(r.url())) problems.push('failed: ' + r.url() + ' ' + (r.failure() || {}).errorText); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(server.origin) && !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push('outside request: ' + u); });
  return problems;
}
// Layout faults: sideways page scroll, and text cut off inside a control.
const LAYOUT = `(() => {
  const out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page is ' + document.documentElement.scrollWidth + 'px wide');
  for (const el of document.querySelectorAll('button, .chip, .tag, th, td, .stat .k, .stat .v, .card .name, .card .meta, label, h2, h3, .brand-name, .tagline, summary, .banner, p, dt, dd, li')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || el.closest('[hidden]')) continue; // hidden or screen-reader-only
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) out.push('clipped: ' + el.tagName + ' ' + el.textContent.trim().slice(0, 40));
    if (r.right > innerWidth + 1 && !el.closest('.table-wrap, .tabs')) out.push('off screen: ' + el.tagName + ' ' + el.textContent.trim().slice(0, 40));
  }
  return out;
})()`;

async function check(engine, name, fn) {
  step = '';
  try { await fn(); passed++; (results[engine] ||= { passed: 0, failed: 0 }).passed++; console.log(`ok   ${engine}: ${name}`); }
  catch (e) { failed++; (results[engine] ||= { passed: 0, failed: 0 }).failed++; console.error(`FAIL ${engine}: ${name}${step ? ' (at: ' + step + ')' : ''}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
}

for (const engine of only) {
  let browser;
  try { browser = await pw[engine].launch(); } catch (e) {
    console.error(`SKIPPED ${engine}: ${String(e.message).split('\n')[0]}`);
    results[engine] = { skipped: true };
    continue;
  }
  results[engine] = { passed: 0, failed: 0, version: browser.version() };
  console.log(`--- ${engine} ${browser.version()}`);
  const dir = shots && join(shots, engine);
  if (dir) mkdirSync(dir, { recursive: true });

  // Every view at every size: no errors, no sideways scrolling, no clipped text.
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, ...(size.mobile && engine !== 'firefox' ? { isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    const problems = watch(page);
    await check(engine, `${size.name}: every view loads cleanly and fits`, async () => {
      for (const v of VIEWS) {
        await page.goto(base + '#' + v);
        await page.waitForFunction(VISIBLE, null, { timeout: 20000 });
        await page.waitForTimeout(150);
        const layout = await page.evaluate(LAYOUT);
        assert.deepEqual(layout, [], `${v}`);
        if (dir && (size.name === '1920x1080' || size.name === '390x844')) await page.screenshot({ path: join(dir, `${size.name}-${v.replace(/[^a-z]/gi, '_')}.png`), fullPage: size.mobile ? false : true });
      }
      assert.deepEqual(problems, []);
    });
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = watch(page);

  await check(engine, 'themes: System, Light, Dark and Unique apply and are remembered', async () => {
    for (const theme of ['system', 'light', 'dark', 'unique']) {
      await page.goto(base + '#items');
      await page.evaluate((t) => localStorage.setItem('d2looter:v1:settings', JSON.stringify({ theme: t })), theme);
      await page.reload();
      await page.waitForFunction(VISIBLE);
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'system');
      assert.equal(attr, theme);
      assert.match(await page.textContent('#theme'), new RegExp(theme, 'i'));
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.ok(bg && bg !== 'rgba(0, 0, 0, 0)', 'body has a background');
      if (dir) {
        await page.screenshot({ path: join(dir, `theme-${theme}-items.png`) });
        await page.goto(base + '#calc'); await page.waitForSelector('.result-big .big');
        await page.screenshot({ path: join(dir, `theme-${theme}-calc.png`) });
      }
    }
    await page.evaluate(() => localStorage.clear());
    assert.deepEqual(problems, []);
  });

  await check(engine, 'keyboard: skip link, visible focus, tabs, item picker with arrows and Enter, Escape', async () => {
    await page.goto(base + '#calc');
    await page.waitForSelector('.result-big .big');
    await page.keyboard.press('Tab');
    // Safari (WebKit) tabs only between form controls unless Option+Tab or its setting is used,
    // so there the first stop is the version list rather than the skip link.
    assert.equal(await page.evaluate(() => document.activeElement.className), engine === 'webkit' ? 'select' : 'skip');
    // Walk the controls: each focused element shows an outline or a focus ring.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tag: a.tagName, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, border: cs.borderColor }; });
      if (f.tag === 'BODY') break; // past the last control (WebKit has fewer stops: no links)
      assert.ok(f.outline || f.tag === 'SELECT' || f.tag === 'INPUT', `focus visible on ${f.tag}`);
    }
    step = 'tab link with Enter';
    await page.focus('a[data-view="sim"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#sim');
    await page.goto(base + '#calc');
    await page.waitForSelector('input[role=combobox]');
    await page.click('input[role=combobox]');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('ber rune');
    await page.waitForSelector('[role=listbox]:not([hidden]) [role=option]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Ber/.test(document.querySelector('#view-calc h3').textContent));
    step = 'click back in and type a new name';
    await page.click('input[role=combobox]');
    await page.keyboard.type('shako');
    await page.waitForSelector('[role=listbox]:not([hidden])');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('[role=listbox]').hidden), true);
    assert.deepEqual(problems, []);
  });

  await check(engine, 'dropdowns: version, difficulty, source and area selects recalculate', async () => {
    await page.goto(base + '#calc');
    await page.waitForSelector('.result-big .big');
    for (const id of ['lod-114d', 'd2r-rotw', 'd2r-base']) {
      await page.selectOption('#profile', id);
      await page.waitForFunction((i) => window.D2LOOTER_DATA && window.D2LOOTER_DATA[i] && document.querySelector('#view-calc p.muted') && document.querySelector('.result-big .big, .unavailable'), id, { timeout: 20000 });
    }
    const selects = page.locator('#view-calc select');
    await selects.nth(1).selectOption('1'); // Nightmare
    await page.waitForSelector('.result-big .big, .unavailable');
    await selects.nth(0).selectOption('area');
    await page.waitForFunction(() => document.querySelectorAll('#view-calc select').length >= 7);
    await page.waitForSelector('.result-big .big, .unavailable');
    assert.deepEqual(problems, []);
  });

  await check(engine, 'Holy Grail: mark, reload, switch version, export, import into a fresh profile, replace, restore, bad files', async () => {
    await page.goto(base + '#grail');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('other-app', 'keep me'); });
    await page.reload();
    await page.waitForFunction(VISIBLE);
    const boxes = page.locator('#view-grail .checklist input');
    step = 'mark two items';
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.waitForFunction(() => /^2 of \d+ found$/.test(document.querySelector('#view-grail .sub').textContent));
    await page.reload();
    await page.waitForFunction(() => /^2 of \d+ found$/.test((document.querySelector('#view-grail .sub') || {}).textContent || ''));
    step = 'switch to 1.14d and back';
    await page.selectOption('#profile', 'lod-114d');
    await page.waitForFunction(() => /1\.14d/.test(document.querySelector('#view-grail p.muted').textContent) && /found$/.test(document.querySelector('#view-grail .sub').textContent), null, { timeout: 20000 });
    await page.selectOption('#profile', 'd2r-base');
    await page.waitForFunction(() => /LoD ruleset/.test(document.querySelector('#view-grail p.muted').textContent) && /^2 of/.test(document.querySelector('#view-grail .sub').textContent), null, { timeout: 20000 });
    step = 'export';
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup', exact: true }).click()]);
    const file = join(tmpdir(), `d2looter-grail-${engine}-${Date.now()}.json`);
    await download.saveAs(file);

    // A fresh browser profile: import, choose Merge.
    step = 'fresh profile import, Merge';
    const fresh = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p2 = await fresh.newPage();
    const prob2 = watch(p2);
    await p2.goto(base + '#grail');
    await p2.waitForFunction(VISIBLE);
    await p2.setInputFiles('#view-grail input[type=file]', file);
    await p2.waitForSelector('dialog[open]');
    await p2.locator('dialog[open]').getByRole('button', { name: 'Merge', exact: true }).click();
    await p2.waitForFunction(() => /^2 of \d+ found$/.test(document.querySelector('#view-grail .sub').textContent));
    // Replace with a one-item backup, then restore the previous Grail.
    step = 'Replace with one item';
    const one = join(tmpdir(), `d2looter-one-${engine}-${Date.now()}.json`);
    writeFileSync(one, JSON.stringify({ format: 'd2looter-grail', version: 1, found: { 'u:The Stone of Jordan': '2026-10-23' } }));
    await p2.setInputFiles('#view-grail input[type=file]', one);
    await p2.waitForSelector('dialog[open]');
    await p2.locator('dialog[open]').getByRole('button', { name: 'Replace', exact: true }).click();
    await p2.waitForFunction(() => /^1 of \d+ found$/.test(document.querySelector('#view-grail .sub').textContent));
    step = 'Restore previous';
    await p2.getByRole('button', { name: 'Restore previous', exact: true }).click();
    await p2.waitForSelector('dialog[open]');
    await p2.locator('dialog[open]').getByRole('button', { name: 'Restore', exact: true }).click();
    await p2.waitForFunction(() => /^2 of \d+ found$/.test(document.querySelector('#view-grail .sub').textContent));
    // Cancel changes nothing; a broken file changes nothing.
    await p2.setInputFiles('#view-grail input[type=file]', one);
    await p2.waitForSelector('dialog[open]');
    await p2.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await p2.waitForTimeout(200);
    assert.match(await p2.textContent('#view-grail .sub'), /^2 of/);
    step = 'broken file';
    const broken = join(tmpdir(), `d2looter-broken-${engine}-${Date.now()}.json`);
    writeFileSync(broken, '{"format":"d2looter-grail","version":1,"found":');
    await p2.setInputFiles('#view-grail input[type=file]', broken);
    await p2.waitForFunction(() => /not valid JSON/.test(document.getElementById('toast').textContent));
    step = 'newer format';
    const newer = join(tmpdir(), `d2looter-newer-${engine}-${Date.now()}.json`);
    writeFileSync(newer, JSON.stringify({ format: 'd2looter-grail', version: 2, found: {} }));
    await p2.setInputFiles('#view-grail input[type=file]', newer);
    await p2.waitForFunction(() => /newer version/.test(document.getElementById('toast').textContent));
    assert.match(await p2.textContent('#view-grail .sub'), /^2 of/);
    assert.equal(await p2.locator('dialog[open]').count(), 0);
    assert.deepEqual(prob2, []);
    await fresh.close();
    // The first profile's unrelated storage is untouched and only d2looter keys were written.
    step = 'storage keys';
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.equal(await page.evaluate(() => localStorage.getItem('other-app')), 'keep me');
    assert.ok(keys.every((k) => k === 'other-app' || k.startsWith('d2looter:v1:')), keys.join(', '));
    assert.deepEqual(problems, []);
  });

  await check(engine, 'the page cannot contact any server (Content-Security-Policy)', async () => {
    await page.goto(base + '#items');
    await page.waitForFunction(VISIBLE);
    const blocked = await page.evaluate(async () => {
      try { await fetch('https://example.com/'); return false; } catch (e) { return true; }
    });
    assert.equal(blocked, true, 'fetch to another server is refused');
    const injected = await page.evaluate(() => new Promise((ok) => {
      const s = document.createElement('script');
      s.src = 'https://example.com/x.js';
      s.onerror = () => ok('blocked'); s.onload = () => ok('loaded');
      document.head.appendChild(s);
      setTimeout(() => ok('blocked'), 3000);
    }));
    assert.equal(injected, 'blocked');
  });

  await check(engine, 'opens from the file (file://)', async () => {
    const c = await browser.newContext();
    const p = await c.newPage();
    const pr = watch(p);
    await p.goto(pathToFileURL(join(ROOT, 'index.html')).href + '#calc');
    await p.waitForSelector('.result-big .big', { timeout: 20000 });
    assert.deepEqual(pr, []);
    await c.close();
  });

  await ctx.close();
  await browser.close();
}
await server.close();
console.log('\nsummary');
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v.skipped ? 'SKIPPED' : `${v.passed} passed, ${v.failed} failed (${v.version})`}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
if (Object.values(results).some((v) => v.skipped)) process.exit(2);
