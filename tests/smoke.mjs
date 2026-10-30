// Browser smoke tests. Run with `node tests/smoke.mjs`; needs Chrome (or set CHROME_PATH).
// `--shots DIR` also saves screenshots of every view.
//
// The app is opened over http from a local server that refuses anything outside /d2looter/, and
// straight from the file (file://), the way launch.cmd opens it.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
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

// The news list as radmagelabs.com would pass it through, from a saved page of Blizzard's list.
const News = createRequire(import.meta.url)('../js/core/news.js');
const NEWS_FILE = join(ROOT, 'tests', 'fixtures', 'blizzard-d2r-news-2026-10-26.json');
const NEWS_LIST = JSON.parse(readFileSync(NEWS_FILE, 'utf8'));
const routes = { '/d2looter/news.json': async () => ({ status: 200, type: 'application/json', body: readFileSync(NEWS_FILE) }) };
const server = await serve({ mounts: [{ prefix: '/d2looter/', dir: ROOT }], routes });
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

  // Where to farm. Inputs are filled the way typing ends: an input event per change, then change.
  const farmRows = "[...document.querySelectorAll('#view-farm .farm-table tbody tr')].map((r) => r.dataset.key)";
  const typeInto = (sel, value) => page.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(value)};
    i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await test('where to farm: the item page button opens it with the item picked, every target ranked by chance per run', async () => {
    await page.eval("localStorage.removeItem('d2looter:v1:settings')");
    await go('#item/u:Harlequin Crest');
    await page.eval("document.querySelector('#view-item a.button[href^=\"#farm/\"]').click()");
    await page.waitFor("location.hash === '#farm/u%3AHarlequin%20Crest' && document.querySelectorAll('#view-farm .farm-table tbody tr').length > 0");
    assert.equal(await page.eval("document.querySelector('#view-farm input[role=combobox]').value"), 'Harlequin Crest (Shako)');
    assert.equal(await page.eval("document.querySelector('.tabs a[aria-current=page]').dataset.view"), 'farm');
    assert.match(await page.eval(text('#view-farm h3')), /^Harlequin Crest on all three difficulties$/);
    assert.match(await page.eval("document.getElementById('view-farm').textContent"), /Ranked by chance per run, because no run times are entered/);
    const keys = await page.eval(farmRows);
    assert.equal(keys.length, 15, 'the first fifteen');
    assert.ok(keys.includes('g:Act 4 - Diablo 1@2') && keys.includes('b:mephisto@2'), keys.join(', '));
    const perRun = await page.eval("[...document.querySelectorAll('#view-farm .farm-table tbody tr td:nth-child(4)')].map((td) => Number(td.firstChild.textContent.replace(/^1 in |,/g, '')))");
    for (let i = 1; i < perRun.length; i++) assert.ok(perRun[i] >= perRun[i - 1], `row ${i}: 1 in ${perRun[i]} after 1 in ${perRun[i - 1]}`);
    assert.ok(await page.eval("[...document.querySelectorAll('#view-farm .more button')].some((b) => /^Show more/.test(b.textContent))"));
    // A target opens the drop calculator on its difficulty.
    await page.eval("document.querySelector('#view-farm tr[data-key=\"b:mephisto@2\"] button.link').click()");
    await page.waitFor("location.hash === '#calc' && document.querySelector('#view-calc h3')");
    assert.equal(await page.eval(text('#view-calc h3')), 'Harlequin Crest from Mephisto in Durance of Hate Level 3 (Hell)');
    clean();
  });
  await test('where to farm: a run time ranks that run by chance per hour and keeps the cursor; an unreadable time is flagged and not used', async () => {
    await go('#farm/u:Harlequin Crest');
    await page.waitFor("document.querySelectorAll('#view-farm .farm-table tbody tr').length > 0");
    await typeInto('#view-farm tr[data-key="b:baalcrab@2"] input.time', '45');
    await page.waitFor("document.querySelectorAll('#view-farm h4').length === 2");
    assert.deepEqual(await page.eval("[...document.querySelectorAll('#view-farm h4')].map((h) => h.textContent)"), ['Your runs, by chance per hour', 'Other targets, by chance per run']);
    assert.equal(await page.eval("document.activeElement.getAttribute('data-focus') + ' ' + document.activeElement.value"), 'time:b:baalcrab@2 0:45', 'focus follows the row, and 45 reads as 0:45');
    await typeInto('#view-farm tr[data-key="b:mephisto@2"] input.time', '1:15');
    await page.waitFor("document.querySelectorAll('#view-farm .farm-table')[0].querySelectorAll('tbody tr').length === 2");
    // 1 in 1,709 every 45 s beats 1 in 1,648 every 75 s.
    assert.deepEqual(await page.eval("[...document.querySelectorAll('#view-farm .farm-table')[0].querySelectorAll('tbody tr')].map((r) => r.dataset.key)"), ['b:baalcrab@2', 'b:mephisto@2']);
    const meph = await page.eval("[...document.querySelectorAll('#view-farm tr[data-key=\"b:mephisto@2\"] td')].map((td) => td.textContent)");
    assert.equal(meph[7], '2.87%', 'chance per hour: 1 - (1 - 1/1648)^48');
    assert.equal(meph[8], '34 h', 'a drop every 1,648 x 75 s on average');
    assert.equal(meph[9], '5.66%96 runs', 'two hours: 96 whole runs');
    assert.match(await page.eval(text('#view-farm .farm-best')), /^Best of your runs: Baal on Hell, [\d.]+% per hour, a drop every [\d.]+ h on average\.$/);
    await new Promise((r) => setTimeout(r, 300)); // settings are saved a moment after a change
    const saved = JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:settings')")).farm.times;
    assert.deepEqual(saved, { 'b:baalcrab@2': 45, 'b:mephisto@2': 75 });
    // Unreadable: flagged, not saved, not ranked.
    await typeInto('#view-farm tr[data-key="b:andariel@2"] input.time', '1:5');
    const bad = await page.eval("(() => { const i = document.querySelector('#view-farm tr[data-key=\"b:andariel@2\"] input.time'); return [i.getAttribute('aria-invalid'), i.nextElementSibling.hidden, i.nextElementSibling.textContent, i.closest('tr').classList.contains('notime')]; })()");
    assert.deepEqual(bad, ['true', false, 'Type a time like 1:30 or 90s.', true]);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!('b:andariel@2' in JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:settings')")).farm.times));
    // Clearing a time moves the run back.
    await typeInto('#view-farm tr[data-key="b:mephisto@2"] input.time', '');
    await page.waitFor("document.querySelectorAll('#view-farm .farm-table')[0].querySelectorAll('tbody tr').length === 1");
    await page.eval("[...document.querySelectorAll('#view-farm button')].find((b) => b.textContent === 'Clear these run times').click()");
    await page.waitFor("document.querySelectorAll('#view-farm h4').length === 0");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:settings')")).farm.times, {});
    clean();
    await snap('farm');
  });
  await test('where to farm: switching the game version keeps the item; an item missing from a version, and an empty difficulty, say why', async () => {
    await go('#farm/u:Bloodletter');
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'd2r-rotw'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("/Reign of the Warlock/.test(document.querySelector('#view-farm .view-head p').textContent) && document.querySelector('#view-farm h3')", 15000);
    const why = await page.eval("document.querySelector('#view-farm > div:last-child').textContent");
    assert.ok(why.includes('Ladder only in Season 15, and the game is set to non-ladder.'), why);
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'lod-114d'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("/1\\.14d/.test(document.querySelector('#view-farm .view-head p').textContent) && document.querySelectorAll('#view-farm .farm-table tbody tr').length > 0", 15000);
    assert.match(await page.eval(text('#view-farm h3')), /^Bloodletter on all three difficulties$/);
    await go("#farm/u:Defender's Bile");
    assert.equal(await page.eval("document.querySelector('#view-farm > div:last-child').textContent"), 'That item is not in Diablo II: LoD 1.14d. Pick one above.');
    await page.eval("(() => { const s = document.getElementById('profile'); s.value = 'd2r-base'; s.dispatchEvent(new Event('change')); })()");
    await go('#farm/u:Harlequin Crest');
    await page.eval("(() => { const s = document.querySelector('#view-farm select'); s.value = '0'; s.dispatchEvent(new Event('change')); })()");
    await page.waitFor("/No boss or superunique drops it on Normal/.test(document.getElementById('view-farm').textContent)");
    assert.ok((await page.eval("document.getElementById('view-farm').textContent")).includes('No boss or superunique has its base, Shako, in its treasure class on Normal.'));
    await page.eval("(() => { const s = document.querySelector('#view-farm select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()");
    await go('#calc');
    clean();
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
    // Diablo Clone's Annihilus is calculated; meeting him is not modeled.
    assert.ok(t.includes('Diablo Clone (Uber Diablo) is calculated from his treasure class') && !t.includes('Annihilus (Diablo Clone)'), 'Annihilus disclosure');
    assert.ok(t.includes('How often you meet an Uber boss.'));
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

  // The news panel: closed and silent until opened, then Blizzard's D2R headlines. This test server
  // answers /d2looter/news.json with a saved page of Blizzard's list, as radmagelabs.com answers it
  // with the live one. Only the item search shows the panel.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const asked = () => page.requests.filter((u) => /\/d2looter\/news\.json$/.test(u)).length;
  const settingsNow = async () => JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:settings') || '{}'"));
  const freshItems = async (settings) => {
    await go('#items');
    await sleep(300); // let a pending settings save land first
    const set = settings ? `localStorage.setItem('d2looter:v1:settings', ${JSON.stringify(JSON.stringify(settings))})` : "localStorage.removeItem('d2looter:v1:settings')";
    await page.eval(`(() => { localStorage.removeItem('d2looter:v1:news'); ${set}; })()`);
    await page.reload();
    await page.waitFor(VISIBLE);
  };
  await test("the news panel starts closed on the item search, asks for nothing until opened, then shows Blizzard's D2R headlines, keeps them 15 minutes and remembers it was open", async () => {
    await freshItems(null);
    const before = asked();
    await sleep(500);
    assert.deepEqual(await page.eval("(() => { const n = document.getElementById('news'); return [n.hidden, n.open]; })()"), [false, false], 'shown and closed');
    assert.equal(asked(), before, 'nothing asked for while closed');
    await page.eval("document.getElementById('news').open = true");
    await page.waitFor("document.querySelectorAll('#news-list li').length > 0");
    assert.equal(asked(), before + 1);
    const shown = await page.eval(`[...document.querySelectorAll('#news-list li')].map((li) => { const a = li.querySelector('a'), t = li.querySelector('time');
      return { link: a.href, title: a.textContent, target: a.target, rel: a.rel, date: t && t.getAttribute('datetime'), text: t && t.textContent }; })`);
    assert.deepEqual(shown.map((s) => [s.title, s.link, s.date]), News.parseFeed(NEWS_LIST).map((a) => [a.title, a.link, a.date]), 'the D2R posts, newest first');
    for (const s of shown) {
      assert.ok(s.link.startsWith('https://news.blizzard.com/en-us/') && s.target === '_blank' && /noopener/.test(s.rel), s.link);
      assert.match(s.text, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    }
    assert.match(await page.eval(text('#news-note')), /^Headlines from Blizzard News, checked at \d{1,2}:\d{2}\s[AP]M\.$/);
    assert.equal(await page.eval("document.querySelector('.news-all a').href"), 'https://news.blizzard.com/en-us/feed/diablo-2-resurrected');
    const kept = JSON.parse(await page.eval("localStorage.getItem('d2looter:v1:news')"));
    assert.ok(Number.isFinite(kept.fetchedAt) && kept.items.length === shown.length, 'kept in this browser');
    await sleep(300);
    assert.equal((await settingsNow()).newsOpen, true, 'saved as open');
    // A reload opens it again with the kept headlines, without asking again.
    await page.reload();
    await page.waitFor(VISIBLE);
    await page.waitFor("document.getElementById('news').open && document.querySelectorAll('#news-list li').length > 0");
    assert.equal(asked(), before + 1);
    // Other views hide it, and coming back within 15 minutes asks for nothing.
    await go('#calc');
    assert.equal(await page.eval("document.getElementById('news').hidden"), true);
    await go('#items');
    assert.equal(await page.eval("document.getElementById('news').hidden"), false);
    assert.equal(asked(), before + 1);
    await page.eval("document.getElementById('news').open = false");
    await sleep(400);
    assert.equal((await settingsNow()).newsOpen, false, 'saved as closed');
    clean();
    await snap('items-news');
  });

  await test('the news panel says when the headlines could not load, when there are no D2R posts and where they load, and keeps the old ones when an update fails', async () => {
    await freshItems({ newsOpen: false });
    // A clock that can jump past the 15 minutes headlines are kept, and a fetch that can be swapped.
    await page.eval("(() => { const real = Date.now, realFetch = window.fetch; window.__later = 0; Date.now = () => real() + window.__later; window.__realFetch = realFetch; })()");
    const reopen = async (fetchSource, keepHeadlines) => {
      await page.eval("document.getElementById('news').open = false");
      await sleep(100);
      await page.eval(`(() => { window.__later += 16 * 60000; ${keepHeadlines ? '' : "localStorage.removeItem('d2looter:v1:news');"} const f = ${fetchSource}; window.__calls = 0;
        window.fetch = (...a) => { window.__calls++; return f(...a); }; document.getElementById('news').open = true; })()`);
      await page.waitFor("window.__calls === 1 && document.getElementById('news-body').getAttribute('aria-busy') === 'false'");
      return page.eval("({ note: document.getElementById('news-note').textContent, items: document.querySelectorAll('#news-list li').length, listHidden: document.getElementById('news-list').hidden })");
    };
    const answer = (status, type, body) => `() => Promise.resolve(new Response(${JSON.stringify(body)}, { status: ${status}, headers: { 'content-type': '${type}' } }))`;
    let r = await reopen("() => Promise.reject(new TypeError('offline'))");
    assert.match(r.note, /could not load right now/); assert.equal(r.items, 0); assert.ok(r.listHidden);
    r = await reopen(answer(404, 'application/json', '{"error":"not found"}'));
    assert.match(r.note, /could not load right now/, "Blizzard's own not found, in JSON");
    r = await reopen(answer(200, 'application/json', '{"error":"gone"}'));
    assert.match(r.note, /could not load right now/, 'a list in another shape');
    r = await reopen(answer(502, 'text/plain', 'bad gateway'));
    assert.match(r.note, /could not load right now/, 'HTTP 502');
    const d4only = { contentItems: [{ contentType: 'blogs', properties: { title: 'Diablo V is Coming Spring 2029', newsUrl: 'https://news.blizzard.com/en-us/article/24297203/x', lastUpdated: '2026-09-12T18:20:45Z', cxpProduct: { segment: 'diablo-4' } } }] };
    r = await reopen(answer(200, 'application/json', JSON.stringify(d4only)));
    assert.match(r.note, /no Diablo II: Resurrected posts in its latest list/); assert.equal(r.items, 0);
    r = await reopen('window.__realFetch');
    assert.match(r.note, /^Headlines from Blizzard News, checked /); assert.equal(r.items, News.parseFeed(NEWS_LIST).length);
    r = await reopen("() => Promise.reject(new TypeError('offline'))", true);
    assert.match(r.note, /could not be reached just now; these headlines were checked /); assert.equal(r.items, News.parseFeed(NEWS_LIST).length, 'the kept headlines stay');
    // A 404 page means this address doesn't pass the list through (GitHub Pages): say where headlines load, and don't ask again.
    r = await reopen(answer(404, 'text/html', '<h1>404</h1>'));
    assert.match(r.note, /^Headlines load at radmagelabs\.com\/d2looter\/\.$/); assert.equal(r.items, 0);
    assert.equal(await page.eval("document.querySelector('#news-note a').href"), 'https://radmagelabs.com/d2looter/');
    await page.eval("document.getElementById('news').open = false"); await sleep(100);
    await page.eval("(() => { window.__later += 16 * 60000; window.__calls = 0; document.getElementById('news').open = true; })()"); await sleep(400);
    assert.equal(await page.eval('window.__calls'), 0, 'not asked again where nothing answers');
    assert.equal(await page.eval("document.querySelector('.news-all a').href"), 'https://news.blizzard.com/en-us/feed/diablo-2-resurrected');
    await page.eval("document.getElementById('news').open = false");
    await sleep(300);
    await page.reload();
    await page.waitFor(VISIBLE);
    clean();
  });
  await test('Share passes https://radmagelabs.com/d2looter/ to the share sheet, or copies it where there is none', async () => {
    const canonical = 'https://radmagelabs.com/d2looter/';
    const r = await page.eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const set = (name, value) => Object.defineProperty(navigator, name, { configurable: true, value });
      const toast = () => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; };
      const out = { shared: [] };
      let copied = null;
      set('share', async (d) => { out.shared.push(d.url + ' | ' + d.title); });
      for (const b of document.querySelectorAll('.navbar [data-share], .footer [data-share]')) { b.click(); await sleep(100); }
      set('clipboard', { writeText: async (t) => { copied = t; } });
      set('share', async () => { throw new DOMException('closed', 'AbortError'); });
      document.querySelector('.navbar [data-share]').click(); await sleep(100);
      out.afterClosedSheet = copied;
      set('share', async () => { throw new DOMException('blocked', 'NotAllowedError'); });
      document.querySelector('.navbar [data-share]').click(); await sleep(100);
      out.afterFailedSheet = copied; copied = null;
      set('share', undefined);
      document.querySelector('.footer [data-share]').click(); await sleep(100);
      out.withoutSheet = copied; out.toastCopied = toast();
      set('clipboard', { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
      document.querySelector('.footer [data-share]').click(); await sleep(100);
      out.toastManual = toast();
      return out;
    })()`);
    const title = 'D2Looter: Diablo II Drop Calculator, Item Search & Holy Grail';
    assert.deepEqual(r.shared, [`${canonical} | ${title}`, `${canonical} | ${title}`], 'header and footer Share');
    assert.equal(r.afterClosedSheet, null, 'closing the sheet copies nothing');
    assert.equal(r.afterFailedSheet, canonical, 'a failed sheet copies the link');
    assert.equal(r.withoutSheet, canonical);
    assert.equal(r.toastCopied, 'Link copied: ' + canonical);
    assert.equal(r.toastManual, 'Copy this link: ' + canonical);
    await page.reload();
    await page.waitFor(VISIBLE);
    clean();
  });

  // The headline rows span the list, the list spans the panel, and each date ends at the row's right
  // edge on the headline's first line. On a phone a long headline wraps beside its date.
  const NEWS_LAYOUT = `(() => {
    const list = document.getElementById('news-list'), body = document.getElementById('news-body');
    const pad = parseFloat(getComputedStyle(body).paddingLeft) + parseFloat(getComputedStyle(body).paddingRight);
    const rows = [...list.querySelectorAll('li')].map((li) => {
      const r = li.getBoundingClientRect(), a = li.querySelector('a').getBoundingClientRect(), t = li.querySelector('time').getBoundingClientRect();
      return { li: [r.left, r.right, r.width], a: [a.left, a.right, a.height], t: [t.left, t.right, t.top - a.top], border: getComputedStyle(li).borderTopWidth };
    });
    return { listWidth: list.getBoundingClientRect().width, bodyInner: body.clientWidth - pad, rows, scroll: document.documentElement.scrollWidth, inner: innerWidth };
  })()`;
  const checkNewsLayout = (l, name) => {
    assert.ok(Math.abs(l.listWidth - l.bodyInner) <= 1, `${name}: list ${l.listWidth} of ${l.bodyInner}`);
    l.rows.forEach((r, i) => {
      assert.ok(Math.abs(r.li[2] - l.listWidth) <= 1, `${name} row ${i} spans the list`);
      assert.ok(Math.abs(r.t[1] - r.li[1]) <= 1, `${name} row ${i}: the date ends at the right edge (${r.t[1]} vs ${r.li[1]})`);
      assert.ok(r.a[0] - r.li[0] <= 1 && r.a[1] < r.t[0], `${name} row ${i}: the headline is left of the date`);
      assert.ok(Math.abs(r.t[2]) <= 6, `${name} row ${i}: the date sits on the headline's first line`);
      assert.equal(r.border, i === 0 ? '0px' : '1px', `${name} row ${i} divider`);
    });
    assert.ok(l.scroll <= l.inner, `${name}: page is ${l.scroll}px wide`);
  };
  await test('news layout: headlines span the panel, each date at the far right, with dividers; a long headline wraps on a phone without sideways scrolling', async () => {
    await freshItems({ newsOpen: true });
    await page.waitFor("document.querySelectorAll('#news-list li').length === 6");
    const desk = await page.eval(NEWS_LAYOUT);
    checkNewsLayout(desk, '1280');
    assert.ok(desk.listWidth > 1000, `the list is ${desk.listWidth}px, not capped`);
    assert.ok(desk.rows.every((r) => r.a[2] < 24), 'one line each on a desktop');
    // A long headline, kept in the browser as if just read.
    const long = 'Diablo II: Resurrected Patch 3.3.1 Notes: Sorceress, Paladin, Necromancer and Warlock Changes, Rune Words, Terror Zones and an Unbreakablewordthatgoesonandonandonforever';
    await page.viewport(390, 844, true);
    await page.eval(`localStorage.setItem('d2looter:v1:news', JSON.stringify({ fetchedAt: Date.now(), items: [{ title: ${JSON.stringify(long)}, link: 'https://news.blizzard.com/en-us/article/1/x', date: '2026-10-28T17:00:00.000Z' },
      { title: 'Short', link: 'https://news.blizzard.com/en-us/article/2/y', date: '2026-10-01T17:00:00.000Z' }] }))`);
    await page.reload();
    await page.waitFor(VISIBLE);
    await page.waitFor("document.querySelectorAll('#news-list li').length === 2");
    const phone = await page.eval(NEWS_LAYOUT);
    checkNewsLayout(phone, '390');
    assert.ok(phone.rows[0].a[2] > 60, `the long headline wraps (${phone.rows[0].a[2]}px tall)`);
    assert.ok(phone.rows[0].a[1] <= phone.rows[0].t[0], 'and stays left of its date');
    await snap('phone-news-long');
    await page.eval("localStorage.removeItem('d2looter:v1:news')");
    await page.viewport(1280, 900);
    clean();
  });

  await test('phone width: no sideways scrolling on any view, with the news panel open', async () => {
    await page.viewport(390, 844, true);
    await freshItems({ newsOpen: true });
    for (const v of ['#items', '#item/u:Harlequin Crest', '#calc', '#farm/u:Harlequin Crest', '#sim', '#grail', '#mf', '#runes', '#accuracy']) {
      await go(v);
      if (v === '#items') await page.waitFor("document.querySelectorAll('#news-list li').length > 0");
      const w = await page.eval('document.documentElement.scrollWidth');
      assert.ok(w <= 390, `${v} is ${w}px wide`);
    }
    await snap('phone-calc');
    await go('#items');
    await snap('phone-items-news');
    await page.viewport(1280, 900);
    clean();
  });

  await test('served at the bare /d2looter (no slash, no redirect), the page adds the slash and loads every file inside the base', async () => {
    const bare = await serve({ mounts: [{ prefix: '/d2looter/', dir: ROOT }], slash: 'none' });
    try {
      const p3 = await chrome.newPage();
      await p3.goto(`${bare.origin}/d2looter#calc`);
      await p3.waitFor("location.pathname === '/d2looter/' && document.querySelector('.result-big .big')", 15000);
      assert.equal(await p3.eval('location.hash'), '#calc', 'the hash survives');
      assert.deepEqual(bare.outside(), [], 'requests outside /d2looter/');
      assert.ok(bare.requests.filter((r) => /\.(js|css|svg)$/.test(r.path)).length >= 10, 'assets came from the base');
      assert.deepEqual(p3.problems, []);
    } finally { await bare.close(); }
  });

  await test('opens straight from the file (file://), as launch.cmd does', async () => {
    const p2 = await chrome.newPage();
    await p2.goto(pathToFileURL(join(ROOT, 'index.html')).href + '#calc');
    await p2.waitFor("document.querySelector('.result-big .big')", 15000);
    // From a file nothing passes the news through; the panel says where headlines load and keeps the link to Blizzard's page.
    await p2.eval("location.hash = '#items'");
    await p2.waitFor("!document.getElementById('news').hidden");
    await p2.eval("document.getElementById('news').open = true");
    await p2.waitFor("document.getElementById('news-note').textContent === 'Headlines load at radmagelabs.com/d2looter/.'");
    assert.equal(await p2.eval("document.getElementById('news-list').hidden"), true);
    assert.equal(await p2.eval("document.querySelector('.news-all a').href"), 'https://news.blizzard.com/en-us/feed/diablo-2-resurrected');
    assert.ok(!p2.requests.some((u) => /news\.json/.test(u)), 'news.json is not requested from a file');
    assert.deepEqual(p2.problems, []);
  });
} finally {
  await chrome.close();
  await server.close();
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
