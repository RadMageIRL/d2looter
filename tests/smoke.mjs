// Browser smoke tests. Run with `node tests/smoke.mjs`; needs Chrome (or set CHROME_PATH).
// `--shots DIR` also saves screenshots of every view.
//
// The app is opened over http from a local server that refuses anything outside /d2looter/, and
// straight from the file (file://), the way launch.cmd opens it.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, launchChrome } from './lib/cdp.mjs';
import { serve } from '../tools/lib/static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });
if (!findChrome()) { console.error('SKIPPED: Chrome not found; set CHROME_PATH to run the browser tests'); process.exit(2); }

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
const VISIBLE = "(() => { const s = document.querySelector('main section:not([hidden])'); return s && s.children.length > 0 && s.id; })()";
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`;

const server = await serve({ mounts: [{ prefix: '/d2looter/', dir: ROOT }] });
const base = `${server.origin}/d2looter/`;
const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.viewport(1280, 900);
  const clean = () => {
    assert.deepEqual(server.outside(), [], 'requests outside /d2looter/');
    assert.deepEqual(page.problems, [], 'browser problems');
    assert.ok(page.requests.every((u) => u.startsWith(server.origin) || u.startsWith('data:') || u.startsWith('blob:')), 'no request leaves the page\'s own origin');
  };
  const go = async (hash) => { await page.goto(base + hash); await page.waitFor(VISIBLE, 15000); };
  const snap = async (name) => { if (shots) await page.screenshot(join(shots, name + '.png'), { height: 1500 }); };

  await test('loads with the D2Looter header, the RadMage Labs links and no errors', async () => {
    await go('#items');
    assert.equal(await page.eval(text('.brand-name')), 'D2Looter');
    assert.ok(await page.eval("[...document.querySelectorAll('a')].some(a => a.href === 'https://radmagelabs.com/' && a.closest('footer'))"), 'footer links radmagelabs.com');
    assert.equal(await page.eval("document.querySelectorAll('#profile option').length"), 3);
    assert.ok(await page.eval("document.querySelectorAll('.cards .card').length") >= 60);
    clean();
    await snap('items');
  });

  await test('item search finds the Stone of Jordan and its page shows properties and sources', async () => {
    await page.eval("(() => { const q = document.getElementById('item-q'); q.value = 'jordan'; q.dispatchEvent(new Event('input')); })()");
    await page.waitFor("document.querySelectorAll('.cards .card').length === 1");
    await page.eval("document.querySelector('.cards .card').click()");
    await page.waitFor("location.hash.indexOf('#item/') === 0 && document.querySelector('.tooltip')");
    const lines = await page.eval("[...document.querySelectorAll('.tooltip .tt-line')].map(n => n.textContent)");
    assert.deepEqual(lines, ['+1 to All Skills', 'Adds 1-12 lightning damage', '+20 to Mana', 'Increase Maximum Mana 25%']);
    assert.ok(await page.eval("document.querySelectorAll('.detail table.grid tbody tr').length") >= 5, 'bosses that drop it');
    assert.match(await page.eval("document.querySelector('.detail table.grid tbody tr td:nth-child(4)').textContent"), /^1 in [\d,]+$/);
    clean();
    await snap('item');
  });

  await test('the drop calculator shows a chance, the run table and the explanation', async () => {
    await page.eval("localStorage.removeItem('d2looter:v1:settings')");
    await go('#calc');
    await page.waitFor("document.querySelector('.result-big .big')");
    assert.match(await page.eval(text('.result-big .big')), /^1 in [\d,]+$/);
    assert.equal(await page.eval("document.querySelectorAll('.stats .stat').length"), 7);
    assert.ok(await page.eval("document.querySelector('details.why') !== null"));
    // Switching the monster to an area monster keeps working.
    await page.eval("(() => { const s = document.querySelector('#view-calc select'); s.value = 'area'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("document.querySelectorAll('#view-calc select').length >= 7");
    clean();
    await snap('calc');
  });

  await test('switching to 1.14d loads its data and recalculates', async () => {
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'lod-114d'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("window.D2LOOTER_DATA && window.D2LOOTER_DATA['lod-114d'] && /1\\.14d/.test(document.querySelector('#view-calc p.muted').textContent)", 15000);
    await page.waitFor("document.querySelector('.result-big .big') || document.querySelector('.unavailable')");
    clean();
  });

  await test('Reign of the Warlock shows the experimental notice', async () => {
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'd2r-rotw'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("/Experimental ruleset/.test(document.getElementById('profile-note').textContent)", 15000);
    clean();
  });

  await test('odds: 1:1500 over 1000 runs is 48.67%, with runs for 50/75/90/99%', async () => {
    await go('#sim');
    await page.eval("(() => { const i = document.querySelectorAll('#view-sim input'); i[0].value = '1:1500'; i[0].dispatchEvent(new Event('input')); i[1].value = '1000'; i[1].dispatchEvent(new Event('input')); })()");
    // 1 - (1 - 1/1500)^1000 = 0.48668
    await page.waitFor("document.querySelector('#view-sim .result-big .big').textContent === '48.67%'");
    const stats = await page.eval("[...document.querySelectorAll('#view-sim .stat .v')].map(n => n.textContent)");
    assert.ok(stats.includes('1,040') && stats.includes('6,906'), stats.join(' | ')); // 50% and 99%
    await page.eval("(() => { const i = document.querySelector('#view-sim input'); i.value = 'nonsense'; i.dispatchEvent(new Event('input')); })()");
    await page.waitFor("document.querySelector('#view-sim .unavailable')");
    clean();
    await snap('sim');
  });

  await test('Holy Grail: marking an item updates the total and survives a reload', async () => {
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'd2r-base'; s.dispatchEvent(new Event('change')); })()");
    await go('#grail');
    const before = await page.eval(text('#view-grail .sub'));
    await page.eval("document.querySelector('#view-grail .checklist input').click()");
    await page.waitFor(`document.querySelector('#view-grail .sub').textContent !== ${JSON.stringify(before)}`);
    assert.match(await page.eval(text('#view-grail .sub')), /^1 of \d+ found$/);
    await page.reload();
    await page.waitFor(VISIBLE);
    assert.match(await page.eval(text('#view-grail .sub')), /^1 of \d+ found$/);
    const saved = JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:grail')"));
    assert.equal(saved.format, 'd2looter-grail');
    assert.equal(Object.keys(saved.found).length, 1);
    clean();
    await snap('grail');
  });

  await test('Holy Grail: a corrupted save is set aside, not lost, and the page still works', async () => {
    await page.eval("localStorage.setItem('d2looter:v1:grail', '{oops')");
    await page.reload();
    await page.waitFor(VISIBLE);
    assert.match(await page.eval(text('#view-grail .banner')), /could not be read/);
    assert.equal(await page.eval("localStorage.getItem('d2looter:v1:grail.broken')"), '{oops');
    clean();
  });

  await test('Magic Find: 300% gives 136 / 187 / 200 / 300', async () => {
    await go('#mf');
    await page.eval("(() => { const i = document.querySelector('#view-mf input[type=number]'); i.value = '300'; i.dispatchEvent(new Event('input')); })()");
    await page.waitFor("/136%/.test(document.querySelector('#view-mf table').textContent)");
    const cells = await page.eval("[...document.querySelectorAll('#view-mf table tbody tr td:nth-child(2)')].slice(0, 4).map(n => n.textContent)");
    assert.deepEqual(cells, ['136%', '187%', '200%', '300%']);
    assert.ok(await page.eval("document.querySelectorAll('#view-mf svg path.line').length === 4"));
    clean();
    await snap('mf');
  });

  await test('runes: 33 runes, and owning Tal, Thul, Ort and Amn makes Spirit', async () => {
    await go('#runes');
    assert.equal(await page.eval("document.querySelectorAll('#view-runes table.grid tbody tr').length"), 33);
    await page.eval("(() => { for (const n of ['Tal', 'Thul', 'Ort', 'Amn']) { const i = document.querySelector('#view-runes input[aria-label=\"' + n + ' owned\"]'); i.value = '1'; i.dispatchEvent(new Event('input')); } })()");
    await page.eval("(() => { const c = [...document.querySelectorAll('#view-runes label.check input')][0]; c.click(); })()");
    await page.waitFor("[...document.querySelectorAll('#view-runes details summary strong')].some(s => s.textContent === 'Spirit')");
    clean();
    await snap('runes');
  });

  await test('accuracy page lists sources and limits', async () => {
    await go('#accuracy');
    const t = await page.eval("document.getElementById('view-accuracy').textContent");
    for (const s of ['blizzhackers/d2data', 'silospen/DropCalc', 'Not modeled yet', 'Where sources disagree']) assert.ok(t.includes(s), s);
    clean();
    await snap('accuracy');
  });

  await test('themes cycle system, light, dark, unique and are remembered', async () => {
    await go('#items');
    const seen = [];
    for (let i = 0; i < 4; i++) { await page.eval("document.getElementById('theme').click()"); seen.push(await page.eval("document.documentElement.getAttribute('data-theme') || 'system'")); }
    assert.equal(new Set(seen).size, 4, seen.join(','));
    while (await page.eval("document.documentElement.getAttribute('data-theme')") !== 'unique') await page.eval("document.getElementById('theme').click()");
    await new Promise((r) => setTimeout(r, 300));
    await page.reload();
    await page.waitFor(VISIBLE);
    assert.equal(await page.eval("document.documentElement.getAttribute('data-theme')"), 'unique');
    await snap('items-unique');
    clean();
  });

  await test('phone width: no sideways scrolling on any view', async () => {
    await page.viewport(390, 844, true);
    for (const v of ['#items', '#item/u:Harlequin Crest', '#calc', '#sim', '#grail', '#mf', '#runes', '#accuracy']) {
      await go(v);
      const w = await page.eval('document.documentElement.scrollWidth');
      assert.ok(w <= 390, `${v} is ${w}px wide`);
    }
    await snap('phone-calc');
    await page.viewport(1280, 900);
    clean();
  });

  await test('opens straight from the file (file://), as launch.cmd does', async () => {
    const p2 = await chrome.newPage();
    await p2.goto(pathToFileURL(join(ROOT, 'index.html')).href + '#calc');
    await p2.waitFor("document.querySelector('.result-big .big')", 15000);
    assert.deepEqual(p2.problems, []);
  });
} finally {
  await chrome.close();
  await server.close();
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
