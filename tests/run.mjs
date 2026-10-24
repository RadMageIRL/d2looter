// Unit and verification tests. Run with `node tests/run.mjs` after `node tools/fetch-data.mjs`
// (which downloads the pinned tables and oracle files into tools/.cache and checks their hashes).
// No other dependencies and no network.
//
// Expected values come from outside this code wherever one exists:
//  - blizzhackers/d2data item-drop-spec.md worked examples (NoDrop, Magic Find, quality rolls);
//  - silospen/DropCalc's own expected results (its test fixtures), recomputed here with its
//    published method on its own copy of the tables (tests/lib/silospen-compat.mjs);
//  - blizzhackers/d2data's C++ drop solver output (precalctc), which models the six-item cap;
//  - a second, independent copy of the tables (Silospen's .txt files) for the data itself.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { silospenItemChance, silospenNoDrop, silospenPaths, silospenFinal } from './lib/silospen-compat.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const E = require('../js/core/engine.js');
const Prob = require('../js/core/prob.js');
const Grail = require('../js/core/grail.js');
const Store = require('../js/core/store.js');
const Props = require('../js/core/props.js');
const Catalog = require('../js/core/catalog.js');
const Sources = require('../js/core/sources.js');
const PROFILES = ['lod-114d', 'd2r-base', 'd2r-rotw'];
const DATA = Object.fromEntries(PROFILES.map((id) => [id, require(`../js/data/${id}.js`)]));
const ENG = Object.fromEntries(PROFILES.map((id) => [id, E.create(DATA[id])]));
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8'));

let cacheMissing = false;
let tools;
try {
  tools = {
    source: await import('../tools/lib/source.mjs'),
    model: await import('../tools/lib/model.mjs'),
    verify: await import('../tools/verify-data.mjs'),
    build: await import('../tools/build-data.mjs'),
  };
  await tools.source.oracleFile('d2data', tools.source.loadSources().oracles.d2data.files[0], { offline: true });
} catch (e) {
  cacheMissing = String(e.message);
}

let passed = 0, failed = 0;
const counts = {}; // values compared against each oracle, printed at the end
const pending = [];
const fail = (name, e) => { failed++; console.error(`FAIL ${name}\n  ${String(e && e.stack ? e.message : e).split('\n').join('\n  ')}`); };
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => { passed++; }, (e) => fail(name, e)));
    else passed++;
  } catch (e) { fail(name, e); }
}
// Tests that need the pinned cache. A missing cache is a failure, never a silent skip.
function cached(name, fn) {
  if (cacheMissing) { fail(name, new Error(`pinned tables are not cached: run node tools/fetch-data.mjs (${cacheMissing})`)); return; }
  test(name, fn);
}
const close = (a, b, rel, msg) => {
  const d = Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  assert.ok(d <= rel, `${msg || ''} got ${a} expected ${b} (relative difference ${d.toExponential(2)} > ${rel})`);
};

// ---------------------------------------------------------------------------------------------
// Probability over runs
// ---------------------------------------------------------------------------------------------
test('at least one in n tries is 1 - (1 - p)^n', () => {
  assert.equal(Prob.atLeastOne(0.5, 2), 0.75);
  assert.equal(Prob.none(0.5, 2), 0.25);
  close(Prob.atLeastOne(0.1, 10), 1 - Math.pow(0.9, 10), 1e-15);
  assert.equal(Prob.atLeastOne(0.3, 0), 0);
  assert.equal(Prob.atLeastOne(1, 1), 1);
  assert.equal(Prob.atLeastOne(0, 1e9), 0);
});
test('tiny chances keep full precision (no 1 - (1 - p) cancellation)', () => {
  close(Prob.atLeastOne(1e-12, 1), 1e-12, 1e-12);
  // Binomial series: np - C(n,2)p^2 + C(n,3)p^3 (the next term is below 1e-25 here).
  const n = 1000, p = 1e-9;
  close(Prob.atLeastOne(p, n), n * p - (n * (n - 1) / 2) * p * p + (n * (n - 1) * (n - 2) / 6) * p * p * p, 1e-12);
  assert.ok(Prob.atLeastOne(1e-12, 1) > 0, 'a one-in-a-trillion chance is not rounded to zero');
});
test('expected drops in n runs is n * p', () => {
  assert.equal(Prob.expected(0.25, 8), 2);
  assert.ok(Number.isNaN(Prob.expected(2, 1)));
});
test('tries for a confidence is the smallest n that reaches it', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const p = Math.pow(10, -1 - rnd() * 7);
    for (const c of [0.5, 0.75, 0.9, 0.99]) {
      const n = Prob.triesFor(p, c);
      assert.ok(Prob.atLeastOne(p, n) >= c, `p ${p} c ${c} n ${n} is enough`);
      assert.ok(n === 1 || Prob.atLeastOne(p, n - 1) < c, `p ${p} c ${c}: ${n - 1} is not enough`);
    }
  }
  assert.equal(Prob.triesFor(0.5, 0.75), 2);
  assert.equal(Prob.triesFor(1, 0.99), 1);
  assert.equal(Prob.triesFor(0, 0.5), Infinity);
});
test('a 1 in 17,178 chance needs 11,907 tries for 50%', () => {
  // ln(0.5) / ln(1 - 1/17178) = 11906.4, so 11,907 is the first whole number of tries past 50%.
  assert.equal(Prob.triesFor(1 / 17178, 0.5), 11907);
  assert.equal(Prob.meanTries(1 / 17178), 17178);
});
test('odds text in every accepted form', () => {
  assert.equal(Prob.parseOdds('1:1500'), 1 / 1500);
  assert.equal(Prob.parseOdds('1/1500'), 1 / 1500);
  assert.equal(Prob.parseOdds('1 in 1,500'), 1 / 1500);
  assert.equal(Prob.parseOdds('0.05%'), 0.0005);
  assert.equal(Prob.parseOdds('0.0005'), 0.0005);
  assert.equal(Prob.parseOdds('2e-6'), 2e-6);
  for (const bad of ['', 'abc', '2', '150%', '3:2', '1:0', '-0.1']) assert.ok(Number.isNaN(Prob.parseOdds(bad)), `rejects ${JSON.stringify(bad)}`);
});
test('odds and percent formatting', () => {
  assert.equal(Prob.oneIn(1 / 17178), '1 in 17,178');
  assert.equal(Prob.oneIn(0.5), '1 in 2');
  assert.equal(Prob.oneIn(0), 'never');
  assert.equal(Prob.percent(0.25), '25%');
  assert.equal(Prob.percent(0.000058213), '0.0058%');
});

// ---------------------------------------------------------------------------------------------
// Drop rules: worked examples from item-drop-spec.md
// ---------------------------------------------------------------------------------------------
test('NoDrop example: N 100, T 60, n 4 gives N\' 10 (spec 8.4)', () => {
  assert.equal(E.adjustedNoDrop(100, 60, 4), 10);
  assert.equal(E.adjustedNoDrop(100, 60, 1), 100);
  assert.equal(E.adjustedNoDrop(0, 60, 8), 0);
});
test('single player /players X: n is 1, 1, 2, 2, 3, 3, 4, 4', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((x) => E.playerFactor(x, 1)), [1, 1, 2, 2, 3, 3, 4, 4]);
});
test('party members in the area count fully, other players half (spec 8.4)', () => {
  assert.equal(E.playerFactor(8, 8), 8);
  assert.equal(E.playerFactor(8, 1), 4);
  assert.equal(E.playerFactor(8, 4), 6);
  assert.equal(E.playerFactor(3, 2), 2);
  assert.equal(E.playerFactor(2, 9), 2, 'party is capped by players');
});
test('NoDrop matches Silospen\'s formula whenever more than one player counts', () => {
  // With n = 1 the game leaves NoDrop alone (spec 8.4). Silospen still runs its formula for
  // /players 2, which rounds 1500 down to 1499 for T 1000; that case is checked as a difference.
  for (const [T, N] of [[60, 100], [49, 19], [1000, 1500], [37, 15]]) {
    for (let P = 1; P <= 8; P++) for (let p = 1; p <= P; p++) {
      const n = E.playerFactor(P, p);
      if (n === 1) { assert.equal(E.adjustedNoDrop(N, T, n), N); continue; }
      assert.equal(E.adjustedNoDrop(N, T, n), silospenNoDrop(T, N, P, p), `T ${T} N ${N} P ${P} p ${p}`);
    }
  }
  assert.equal(silospenNoDrop(1000, 1500, 2, 1), 1499);
});
test('Magic Find diminishing returns: 250 unique, 500 set, 600 rare, none for magic', () => {
  assert.equal(E.effectiveMF(300, 250), 136); // 75000 / 550 = 136.4
  assert.equal(E.effectiveMF(300, 500), 187);
  assert.equal(E.effectiveMF(300, 600), 200);
  assert.equal(E.effectiveMF(300, 0), 300);
  assert.equal(E.effectiveMF(10, 250), 10, 'MF 10 or less has no diminishing returns');
  assert.equal(E.effectiveMF(11, 250), 10);
  assert.equal(E.effectiveMF(-50, 250), -50);
});
test('quality example 2: Unique 400/1/6400, ilvl 85, qlvl 50, MF 300 is 128/19796', () => {
  close(E.tierChance([400, 1, 6400], 35, 300, 250, 0), 128 / 19796, 1e-15);
  close(E.tierChance([400, 1, 6400], 35, 0, 250, 0), 128 / 46720, 1e-15);
});
test('quality example 1: a unique modifier of 983 on 6400 leaves 257', () => {
  // base 50 -> chance 6400 (the minimum), minus 6400 * 983 / 1024 = 6143
  close(E.tierChance([50, 1, 6400], 0, 0, 250, 983), 128 / 257, 1e-15);
  assert.equal(E.tierChance([50, 1, 6400], 0, 0, 250, 1024), 1, 'a modifier of 1024 makes it certain');
});

// ---------------------------------------------------------------------------------------------
// Engine on a small made-up ruleset (each rule in isolation)
// ---------------------------------------------------------------------------------------------
function toyData(tcs, extra = {}) {
  return {
    id: 'toy', ladderSeason: 5,
    itemTypes: [
      { code: 'misc', name: 'Misc', equiv: [], rarity: 1, cls: '', normal: 0, magic: 0, rare: 0, throwable: 0, tc: 0 },
      { code: 'gem', name: 'Gem', equiv: ['misc'], rarity: 1, cls: '', normal: 1, magic: 0, rare: 0, throwable: 0, tc: 0 },
      { code: 'weap', name: 'Weapon', equiv: [], rarity: 3, cls: '', normal: 0, magic: 0, rare: 1, throwable: 0, tc: 1 },
      { code: 'ring', name: 'Ring', equiv: ['misc'], rarity: 1, cls: '', normal: 0, magic: 1, rare: 1, throwable: 0, tc: 0 },
    ],
    items: [
      { code: 'swd', name: 'Sword', kind: 'weapon', type: 'weap', level: 5, version: 0, spawnable: 1, norm: 'swd', uber: 'xsw', ultra: 'ysw' },
      { code: 'axe', name: 'Axe', kind: 'weapon', type: 'weap', level: 6, version: 0, spawnable: 1, norm: 'axe', uber: '', ultra: '' },
      { code: 'gem', name: 'Gem', kind: 'misc', type: 'gem', level: 1, version: 0, spawnable: 1 },
      { code: 'rin', name: 'Ring', kind: 'misc', type: 'ring', level: 1, version: 0, spawnable: 1 },
      { code: 'gld', name: 'Gold', kind: 'misc', type: 'misc', level: 1, version: 0, spawnable: 1 },
    ],
    uniques: extra.uniques || [],
    setItems: extra.setItems || [],
    sets: [],
    ratios: [{ version: 1, uber: 0, cls: 0, unique: [400, 1, 6400], set: [160, 2, 5600], rare: [100, 2, 3200], magic: [34, 3, 192], hi: [12, 8], normal: [2, 2] }],
    tcs,
    monsters: extra.monsters || {},
    superUniques: [],
    levels: extra.levels || [],
  };
}
const tc = (name, picks, nodrop, entries, more = {}) => ({ name, group: 0, level: 0, picks, q: [0, 0, 0, 0], nodrop, entries, ...more });
const gem = { kind: 'base', code: 'gem' };

test('a pick picks one entry by weight, NoDrop included', () => {
  const eng = E.create(toyData([tc('T', 1, 2, [['gem', 1], ['gld', 1]])]));
  close(eng.tcChance('T', gem).chance, 1 / 4, 1e-15);
});
test('picks are independent: 3 picks of 1/4 give 1 - (3/4)^3', () => {
  const eng = E.create(toyData([tc('T', 3, 2, [['gem', 1], ['gld', 1]])]));
  close(eng.tcChance('T', gem).chance, 1 - Math.pow(0.75, 3), 1e-15);
  close(eng.tcChance('T', gem).expected, 3 / 4, 1e-15);
});
test('six items at most: a seventh pick only happens after a NoDrop', () => {
  const eng = E.create(toyData([tc('Seven', 7, 0, [['gem', 1]]), tc('SevenNd', 7, 1, [['gld', 1]])]));
  const r = eng.tcChance('Seven', gem);
  assert.deepEqual(r.itemCount.map((x) => Math.round(x * 1e12) / 1e12), [0, 0, 0, 0, 0, 0, 1]);
  close(r.expected, 6, 1e-15);
  // With NoDrop 1 of 2, P(6 items) is the chance of at least 6 drops in 7 picks.
  const n = eng.tcChance('SevenNd', { kind: 'base', code: 'gld' });
  close(n.itemCount[6], 7 / 128 + 1 / 128, 1e-12);
});
test('the cap counts items from nested classes too', () => {
  const eng = E.create(toyData([tc('Gold5', 5, 0, [['gld', 1]]), tc('T', 2, 0, [['Gold5', 1], ['gem', 1]])]));
  // first pick Gold5 (5 items) then gem -> 6; gem first then Gold5 -> 6 as well: the gem always drops
  // when it is picked, and the cap only cuts gold.
  const r = eng.tcChance('T', gem);
  close(r.chance, 1 - 0.25, 1e-15);
});
test('negative picks run the entries in order, each weight times, ignoring NoDrop', () => {
  const eng = E.create(toyData([tc('Seq', -3, 100, [['gld', 2], ['gem', 1], ['rin', 5]])]));
  const r = eng.tcChance('Seq', gem);
  assert.equal(r.chance, 1);
  assert.equal(eng.tcChance('Seq', { kind: 'base', code: 'rin' }).chance, 0, 'stops after three picks');
});
test('an empty nested class still spends the pick (acts like NoDrop)', () => {
  const eng = E.create(toyData([tc('Empty', 1, 0, []), tc('T', 1, 0, [['Empty', 1], ['gem', 1]])]));
  close(eng.tcChance('T', gem).chance, 0.5, 1e-15);
});
test('a forward reference is not a class (spec A.1)', () => {
  const eng = E.create(toyData([tc('T', 1, 0, [['Later', 1], ['gem', 1]]), tc('Later', 1, 0, [['gem', 1]])]));
  close(eng.tcChance('T', gem).chance, 1, 1e-15, 'Later is not resolved, so only gem remains');
  assert.deepEqual(eng.tcByName('T').unresolved, ['Later']);
});
test('automatic classes hold items with L - 3 < qlvl <= L, weighted by the type\'s rarity', () => {
  const eng = E.create(toyData([]));
  const w6 = eng.tcByName('weap6');
  assert.deepEqual(w6.entries.map((e) => [e.code, e.prob]), [['swd', 3], ['axe', 3]]);
  assert.equal(eng.tcByName('weap3').entries.length, 0);
});
test('quality modifiers take the larger value down the nesting', () => {
  const uniques = [{ key: 'U1', code: 'swd', lvl: 1, rarity: 1, roll: true, named: true, props: [] }];
  const eng = E.create(toyData([tc('Inner', 1, 0, [['swd', 1]]), tc('Outer', 1, 0, [['Inner', 1]], { q: [1024, 0, 0, 0] })], { uniques }));
  assert.equal(eng.tcChance('Outer', { kind: 'unique', key: 'U1', code: 'swd' }, { ilvl: 10 }).chance, 1);
  assert.ok(eng.tcChance('Inner', { kind: 'unique', key: 'U1', code: 'swd' }, { ilvl: 10 }).chance < 0.05);
});
test('a unique is chosen by rarity among the ones with lvl <= ilvl', () => {
  const uniques = [
    { key: 'A', code: 'swd', lvl: 1, rarity: 3, roll: true, named: true, props: [] },
    { key: 'B', code: 'swd', lvl: 1, rarity: 1, roll: true, named: true, props: [] },
    { key: 'C', code: 'swd', lvl: 50, rarity: 1, roll: true, named: true, props: [] },
  ];
  const eng = E.create(toyData([tc('T', 1, 0, [['swd', 1]], { q: [1024, 0, 0, 0] })], { uniques }));
  close(eng.tcChance('T', { kind: 'unique', key: 'A', code: 'swd' }, { ilvl: 10 }).chance, 0.75, 1e-15);
  close(eng.tcChance('T', { kind: 'unique', key: 'B', code: 'swd' }, { ilvl: 10 }).chance, 0.25, 1e-15);
  assert.equal(eng.tcChance('T', { kind: 'unique', key: 'C', code: 'swd' }, { ilvl: 10 }).chance, 0, 'too high a level');
  close(eng.tcChance('T', { kind: 'unique', key: 'C', code: 'swd' }, { ilvl: 60 }).chance, 0.2, 1e-15);
  close(eng.tcChance('T', { kind: 'unique', key: 'C', code: 'swd' }, { ilvl: 50 }).chance, 0.2, 1e-15, 'lvl equal to ilvl qualifies');
  assert.equal(eng.tcChance('T', { kind: 'unique', key: 'C', code: 'swd' }, { ilvl: 49 }).chance, 0);
});
test('a set item needs the unique roll to fail first', () => {
  const setItems = [{ key: 'S', code: 'swd', set: 'X', lvl: 1, rarity: 1, roll: true, props: [], partial: [] }];
  const eng = E.create(toyData([tc('T', 1, 0, [['swd', 1]])], { setItems }));
  const item = eng.item('swd');
  const q = eng.qualityRoll(item, 30, [0, 0, 0, 0], 0);
  close(eng.tcChance('T', { kind: 'set', key: 'S', code: 'swd' }, { ilvl: 30 }).chance, (1 - q.unique) * E.tierChance([160, 2, 5600], 25, 0, 500, 0), 1e-15);
});
test('with Magic Find, the set roll uses factor 500 and the rare roll 600', () => {
  const setItems = [{ key: 'S', code: 'swd', set: 'X', lvl: 1, rarity: 1, roll: true, props: [], partial: [] }];
  const eng = E.create(toyData([tc('T', 1, 0, [['swd', 1]])], { setItems }));
  const item = eng.item('swd');
  // ilvl 10, qlvl 5: delta 5, so no roll is held at its minimum. MF 300 gives effective 136 for
  // unique, 187 for set and 200 for rare (spec 9.2): chance numbers 12800 * base / (100 + that).
  const pu = 128 / Math.trunc((12800 * (400 - 5)) / 236);
  const ps = 128 / Math.trunc((12800 * (160 - 2)) / 287);
  const pr = 128 / Math.trunc((12800 * (100 - 2)) / 300);
  const q = eng.qualityRoll(item, 10, [0, 0, 0, 0], 300);
  close(q.unique, pu, 1e-15);
  close(q.set, (1 - pu) * ps, 1e-15);
  close(q.rare, (1 - pu) * (1 - ps) * pr, 1e-15);
  close(eng.tcChance('T', { kind: 'set', key: 'S', code: 'swd' }, { ilvl: 10, mf: 300 }).chance, (1 - pu) * ps, 1e-15);
});
test('a negative level gap divides toward zero (spec 0: -7 / 2 = -3)', () => {
  // Set ratio 160/2: ilvl 3 below qlvl gives base 160 - trunc(-3 / 2) = 161, not 162.
  assert.equal(E.tierChance([160, 2, 5600], -3, 0, 500, 0), 128 / 20608);
  assert.equal(E.tierChance([160, 2, 5600], -4, 0, 500, 0), 128 / 20736);
});
test('high Magic Find stops at the ratio minimum (SetMin 5600, RareMin 3200)', () => {
  // delta 100, MF 1000: set 12800 * 110 / 433 = 3251 and rare 12800 * 50 / 475 = 1347 are both
  // below their minimums, so the chances are 128/5600 and 128/3200.
  assert.equal(E.tierChance([160, 2, 5600], 100, 1000, 500, 0), 128 / 5600);
  assert.equal(E.tierChance([100, 2, 3200], 100, 1000, 600, 0), 128 / 3200);
  const eng = E.create(toyData([]));
  const q = eng.qualityRoll(eng.item('swd'), 105, [0, 0, 0, 0], 1000);
  const pu = E.tierChance([400, 1, 6400], 100, 1000, 250, 0);
  close(q.set, (1 - pu) * (128 / 5600), 1e-15);
  close(q.rare, (1 - pu) * (1 - 128 / 5600) * (128 / 3200), 1e-15);
});
test('a normal-only type never rolls unique or set', () => {
  const eng = E.create(toyData([]));
  assert.deepEqual(eng.qualityRoll(eng.item('gem'), 50, [1024, 1024, 0, 0], 0).unique, 0);
});
test('ladder windows: a row is ladder only from its first to its last season', () => {
  assert.equal(E.ladderOnly([15, 15], 15), true);
  assert.equal(E.ladderOnly([2, 2], 15), false);
  assert.equal(E.ladderOnly([3, 0], 15), true, 'no last season means still ladder only');
  assert.equal(E.ladderOnly(null, 15), false);
  assert.equal(E.ladderOnly(true, null), true);
});
test('a ladder-only unique only drops in ladder games', () => {
  const uniques = [{ key: 'L', code: 'swd', lvl: 1, rarity: 1, roll: true, named: true, props: [], ladder: [5, 5] }];
  const eng = E.create(toyData([tc('T', 1, 0, [['swd', 1]], { q: [1024, 0, 0, 0] })], { uniques }));
  assert.equal(eng.tcChance('T', { kind: 'unique', key: 'L', code: 'swd' }, { ilvl: 10, ladder: false }).chance, 0);
  assert.equal(eng.tcChance('T', { kind: 'unique', key: 'L', code: 'swd' }, { ilvl: 10, ladder: true }).chance, 1);
});
test('a class switched off by a condition gives its weight back to the parent', () => {
  const eng = E.create(toyData([tc('Hell', 1, 0, [['gld', 1]], { cond: "cond('Difficulty', hell)" }), tc('T', 1, 0, [['Hell', 3], ['gem', 1]])]));
  assert.equal(eng.tcChance('T', gem, { difficulty: 0 }).chance, 1);
  close(eng.tcChance('T', gem, { difficulty: 2 }).chance, 0.25, 1e-15);
});
test('TC upgrade walks forward through the same group while level <= mlvl (spec 7.2)', () => {
  const monsters = { m: { name: 'M', level: [5, 40, 70], tc: { reg: ['A', 'A', 'A'], champ: ['A', 'A', 'A'] } }, b: { name: 'B', level: [5, 40, 70], tc: { reg: ['A', 'A', 'A'] }, boss: 1 } };
  const levels = [{ id: 1, key: 'L', name: 'L', act: 0, mlvl: [1, 40, 69], mon: ['m'], nmon: ['m'], umon: [] }];
  const eng = E.create(toyData([tc('A', 1, 0, [['gem', 1]], { group: 9, level: 10 }), tc('B', 1, 0, [['gem', 1]], { group: 9, level: 70 }), tc('C', 1, 0, [['gem', 1]], { group: 9, level: 71 })], { monsters, levels }));
  assert.equal(eng.tcs[eng.sourceTc({ type: 'regular', cls: 'm', area: 1 }, 2).idx].name, 'A', 'level 69 does not reach 70');
  assert.equal(eng.tcs[eng.sourceTc({ type: 'minion', cls: 'm', area: 1 }, 2).idx].name, 'C', 'a minion is 72: both 70 and 71 qualify');
  assert.equal(eng.tcs[eng.sourceTc({ type: 'champion', cls: 'm', area: 1 }, 2).idx].name, 'C', 'a champion is 71: the walk goes on while level <= 71');
  assert.equal(eng.tcs[eng.sourceTc({ type: 'regular', cls: 'm', area: 1 }, 0).idx].name, 'A', 'no upgrade in Normal');
  assert.equal(eng.tcs[eng.sourceTc({ type: 'boss', cls: 'b' }, 2).idx].name, 'A', 'no upgrade for bosses');
});
test('monster level: area level outside Normal, +2 champion, +3 unique and minion (spec 6.2)', () => {
  const monsters = { m: { name: 'M', level: [5, 40, 70], tc: { reg: ['A', 'A', 'A'] } }, b: { name: 'B', level: [5, 40, 77], tc: { reg: ['A', 'A', 'A'] }, boss: 1 } };
  const levels = [{ id: 1, key: 'L', name: 'L', act: 0, mlvl: [1, 41, 66], mon: ['m'], nmon: ['m'], umon: [] }];
  const eng = E.create(toyData([tc('A', 1, 0, [['gem', 1]])], { monsters, levels }));
  assert.equal(eng.monsterLevel({ type: 'regular', cls: 'm', area: 1 }, 0), 5);
  assert.equal(eng.monsterLevel({ type: 'regular', cls: 'm', area: 1 }, 2), 66);
  assert.equal(eng.monsterLevel({ type: 'champion', cls: 'm', area: 1 }, 2), 68);
  assert.equal(eng.monsterLevel({ type: 'unique', cls: 'm', area: 1 }, 1), 44);
  assert.equal(eng.monsterLevel({ type: 'minion', cls: 'm', area: 1 }, 2), 69);
  assert.equal(eng.monsterLevel({ type: 'boss', cls: 'b' }, 2), 77);
});

// ---------------------------------------------------------------------------------------------
// Engine on the real tables
// ---------------------------------------------------------------------------------------------
test('superunique levels: area level + 3 in Hell, class level + 3 in Normal, boss classes use their own level', () => {
  const S = Sources.create(DATA['lod-114d'], ENG['lod-114d']);
  const lvl = (id, d) => ENG['lod-114d'].monsterLevel(S.fixed(d).find((x) => x.id === id).src, d);
  assert.equal(lvl('s:Pindleskin', 2), 86, 'Nihlathak\'s Temple 83 + 3');
  assert.equal(lvl('s:Pindleskin', 0), 45, 'class level 42 + 3');
  assert.equal(lvl('s:The Countess', 2), 82, 'Tower Cellar Level 5 79 + 3');
  assert.equal(lvl('s:Radament', 2), 86, 'boss-flagged class: Level(H) 83 + 3 (unverified; Silospen gives no bonus)');
});
test('every condition string in the D2R tables is one the engine knows', () => {
  for (const id of PROFILES) {
    const d = DATA[id];
    for (const t of d.tcs) if (t.cond) assert.ok(E.knownCondition(t.cond), `${id} TC ${t.name}: ${t.cond}`);
    for (const u of d.uniques) if (u.cond) assert.ok(E.knownCondition(u.cond), `${id} unique ${u.key}: ${u.cond}`);
  }
});
test('every treasure class entry resolves to an item, class, unique or set item', () => {
  for (const id of PROFILES) {
    const bad = ENG[id].tcs.filter((t) => t.unresolved).map((t) => `${t.name}: ${t.unresolved}`);
    assert.deepEqual(bad, [], id);
  }
});
test('Stone of Jordan from Hell Baal: 7 picks, level 99, and above Silospen\'s six-pick reading', () => {
  const eng = ENG['lod-114d'];
  const soj = { kind: 'unique', key: 'The Stone of Jordan', code: 'rin' };
  const r = eng.dropChance({ type: 'boss', cls: 'baalcrab' }, soj, { difficulty: 2 });
  assert.equal(r.tc, 'Baal (H)');
  assert.equal(r.mlvl, 99);
  assert.equal(r.picks, 7);
  assert.ok(r.chance <= r.expected, 'a chance of at least one never exceeds the expected count');
  // Silospen applies 7 picks as 6; the engine lets the seventh pick happen after a NoDrop.
  const six = silospenItemChance(eng, eng.tcIndex('Baal (H)'), soj, 99, 0);
  assert.ok(r.chance > six && r.chance < six * 1.25, `${r.chance} vs ${six}`);
});
test('the quest kill uses the quest treasure class', () => {
  const eng = ENG['lod-114d'];
  const r = eng.dropChance({ type: 'boss', cls: 'andariel' }, { kind: 'base', code: 'rin' }, { difficulty: 2, quest: true });
  assert.equal(r.tc, 'Andarielq (H)');
  assert.ok(r.chance > eng.dropChance({ type: 'boss', cls: 'andariel' }, { kind: 'base', code: 'rin' }, { difficulty: 2 }).chance);
});
test('more Magic Find never lowers a unique chance and raises it with diminishing returns', () => {
  const eng = ENG['d2r-base'];
  const shako = { kind: 'unique', key: 'Harlequin Crest', code: 'uap' };
  const at = (mf) => eng.dropChance({ type: 'boss', cls: 'mephisto' }, shako, { difficulty: 2, mf }).chance;
  const xs = [0, 100, 200, 300, 500, 1000].map(at);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `MF step ${i}`);
  assert.ok(xs[5] / xs[0] < 1 + 1000 * 250 / 1250 / 100, 'below the undiminished factor');
});
test('runes ignore Magic Find; Hell Countess drops Ist but never Ber', () => {
  const eng = ENG['lod-114d'];
  const countess = Sources.create(DATA['lod-114d'], eng).fixed(2).find((s) => s.id === 's:The Countess');
  assert.ok(countess, 'the Countess is a source');
  const ist = (mf) => eng.dropChance(countess.src, { kind: 'base', code: 'r24' }, { difficulty: 2, mf }).chance;
  assert.ok(ist(0) > 0);
  assert.equal(ist(0), ist(1000));
  assert.equal(eng.dropChance(countess.src, { kind: 'base', code: 'r30' }, { difficulty: 2 }).chance, 0);
});
test('Hell Countess: her item class runs first, then up to three rune picks, and the six-item limit cuts rune picks', () => {
  const eng = ENG['d2r-base'];
  const top = eng.tcByName('Countess (H)');
  assert.equal(top.picks, -2, 'two fixed picks: items, then runes');
  assert.deepEqual(top.entries.map((e) => eng.tcs[e.idx].name), ['Countess Item (H)', 'Countess Rune (H)']);
  assert.equal(eng.tcByName('Countess Rune (H)').picks, 3);
  const ist = { kind: 'base', code: 'r24' };
  const whole = eng.tcChance('Countess (H)', ist, { difficulty: 2 }).chance;
  const runesAlone = eng.tcChance('Countess Rune (H)', ist, { difficulty: 2 }).chance;
  const itemsAlone = eng.tcChance('Countess Item (H)', ist, { difficulty: 2 }).chance;
  // Without the limit the two parts would be independent: 1 - (1 - a)(1 - b). Her five item picks
  // fill five slots about 19% of the time (one rune pick left) and four about 38% (two left), which
  // costs about 18% of her Ist chance. d2data's solver agrees (Countess (H) in the oracle test).
  const noLimit = 1 - (1 - runesAlone) * (1 - itemsAlone);
  const count = eng.tcChance('Countess Item (H)', ist, { difficulty: 2 }).itemCount;
  close(count[5], 0.1943, 2e-3, 'five items from her item class');
  assert.ok(whole / noLimit > 0.8 && whole / noLimit < 0.85, `ratio ${whole / noLimit}`);
});
test('Hell Duriel: five picks of a class that itself picks seven fill all six item slots 99.6% of the time', () => {
  const eng = ENG['d2r-base'];
  const top = eng.tcByName('Duriel (H)');
  assert.equal(top.picks, 5);
  assert.deepEqual(top.entries.map((e) => (e.kind === 'tc' ? eng.tcs[e.idx].name : e.code) + ':' + e.prob), ['tsc:1', 'Duriel (H) - Base:2']);
  assert.equal(eng.tcByName('Duriel (H) - Base').picks, 7);
  const count = eng.tcChance('Duriel (H)', { kind: 'base', code: 'rin' }, { difficulty: 2 }).itemCount;
  close(count[6], 0.99579, 1e-4);
  // Silospen multiplies the picks (5 x 7, capped at 6) and lets NoDrop use up a pick, so its Duriel
  // chances are about half the six-item-limit answer (which d2data's solver confirms for Duriel (H)).
  const soj = { kind: 'unique', key: 'The Stone of Jordan', code: 'rin' };
  const mine = ENG['lod-114d'].dropChance({ type: 'boss', cls: 'duriel' }, soj, { difficulty: 2 });
  const theirs = silospenItemChance(ENG['lod-114d'], ENG['lod-114d'].tcIndex('Duriel (H)'), soj, mine.mlvl, 0);
  assert.ok(mine.chance / theirs > 1.8 && mine.chance / theirs < 2.1, `ratio ${mine.chance / theirs}`);
});
test('1.14d realm ladder-only uniques: they drop in single player and on ladder, not on a non-ladder realm', () => {
  const eng = ENG['lod-114d'];
  const u = DATA['lod-114d'].uniques.find((x) => x.ladder === true && x.roll && x.code);
  assert.ok(u, 'a ladder-only unique exists');
  const t = { kind: 'unique', id: u.id, code: u.code };
  const src = { type: 'boss', cls: 'baalcrab' };
  assert.ok(eng.dropChance(src, t, { difficulty: 2, ladder: true }).chance > 0, `${u.name} in single player or ladder`);
  assert.equal(eng.dropChance(src, t, { difficulty: 2, ladder: false }).chance, 0, `${u.name} on a non-ladder realm`);
});
test('more players lower NoDrop and raise the chance; party members in the area count fully', () => {
  const eng = ENG['d2r-base'];
  const t = { kind: 'base', code: 'r24' };
  const src = { type: 'regular', cls: 'baalminion1', area: 131 }; // Throne of Destruction, NoDrop 100 classes
  const at = (players, party) => eng.dropChance(src, t, { difficulty: 2, players, party: party || 1 }).chance;
  assert.ok(at(1) > 0, 'Ist can drop there');
  assert.equal(at(2), at(1), '/players 2 is the same as 1');
  assert.ok(at(1) < at(3) && at(3) < at(5) && at(5) < at(7));
  assert.equal(at(4), at(3));
  assert.ok(at(8, 8) > at(8, 1), 'a full party in the area beats eight players apart');
});
test('Reign of the Warlock: changed Season 15 uniques drop only in ladder games', () => {
  const eng = ENG['d2r-rotw'];
  const bl = DATA['d2r-rotw'].uniques.find((u) => u.key === 'Bloodletter');
  assert.deepEqual(bl.ladder, [15, 15]);
  const t = { kind: 'unique', key: 'Bloodletter', code: bl.code };
  const src = { type: 'boss', cls: 'baalcrab' };
  assert.equal(eng.dropChance(src, t, { difficulty: 2, ladder: false }).chance, 0);
  assert.ok(eng.dropChance(src, t, { difficulty: 2, ladder: true }).chance > 0);
  assert.ok(ENG['d2r-base'].dropChance(src, { kind: 'unique', key: 'Bloodletter', code: bl.code }, { difficulty: 2, ladder: false }).chance > 0, 'not ladder only in the LoD ruleset');
});
test('Cow King\'s Leathers only drop from Hell Bovines', () => {
  const eng = ENG['lod-114d'];
  const s = DATA['lod-114d'].setItems.find((x) => x.set === "Cow King's Leathers");
  const t = { kind: 'set', key: s.key, code: s.code };
  const cows = eng.dropChance({ type: 'regular', cls: 'hellbovine', area: 39 }, t, { difficulty: 2 });
  assert.ok(cows.chance > 0);
  assert.equal(eng.dropChance({ type: 'boss', cls: 'baalcrab' }, t, { difficulty: 2 }).chance, 0);
});

// ---------------------------------------------------------------------------------------------
// Oracle 1: Silospen DropCalc's expected results, with its method, on its own tables
// ---------------------------------------------------------------------------------------------
const silospenModels = {};
async function silospenEngine(folder) {
  // Silospen puts throwing potions in the weapon classes (see engine.js create()).
  if (!silospenModels[folder]) silospenModels[folder] = E.create(await tools.verify.modelFromSilospen(folder, { offline: true }), { throwingPotionsInAllClasses: true });
  return silospenModels[folder];
}
const AREAS = fixture('silospen-areas.json');
const DIFF = { N: 0, NM: 1, H: 2 };
function parseSilospenName(path) {
  const parts = path.split('/').pop().replace(/\.tsv$/, '').replace('$', ':').split('_');
  const version = parts.find((p) => /^D2R V1 0$/.test(p)) ? 'd2r-1.0' : 'v1.12a';
  return { parts, version };
}
function areaIdByName(eng, name) {
  const l = eng.data.levels.find((x) => x.name === name);
  assert.ok(l, `area ${name}`);
  return l.id;
}
// Silospen levels superuniques at area level + 3 outside Normal, even when their class is a boss.
function silospenSource(eng, label, type, d) {
  const m = label.match(/^(.*) - ([^ ]+) \((N|NM|H)\)$/);
  assert.ok(m, `monster label ${label}`);
  const [, name, cls] = m;
  const quest = /\(q\)$/.test(name);
  if (type === 'SUPERUNIQUE') {
    const su = eng.data.superUniques.find((s) => s.cls === cls && (s.key === name || s.name === name || s.key.replace(/ /g, '') === name.replace(/ /g, '')));
    assert.ok(su, `superunique ${name}`);
    const area = eng.data.levels.find((l) => l.key === AREAS.superuniques[su.key]);
    const mlvl = (d === 0 ? eng.monster(cls).level[0] : area.mlvl[d]) + 3;
    return { src: { type: 'superunique', su: su.key, cls, area: area.id }, mlvl, quest };
  }
  return { src: { type: 'boss', cls }, mlvl: null, quest };
}
// Silospen upgrades every source's class outside Normal, bosses included (the spec, 7.1, never
// upgrades a boss-flagged monster; the Defilers are the bosses whose class has a group).
function silospenTcIdx(eng, src, d, quest, mlvl) {
  const info = eng.sourceTc(src, d, quest);
  if (d === 0) return info.idx;
  if (mlvl == null) mlvl = eng.monsterLevel(src, d);
  let idx = eng.tcIndex(info.base);
  const t = eng.tcs;
  if (t[idx].group) while (idx + 1 < t.length && t[idx + 1].group === t[idx].group && t[idx + 1].level <= mlvl) idx++;
  return idx;
}

// Silospen's D2R 1.0 table gives Andariel only her quest classes, so its D2R item expectations
// cannot be reproduced from the table alone; the 1.12a ones are used.
cached('Silospen item tests: Stone of Jordan from every Hell boss (1.12a tables)', async () => {
  const src = tools.source.loadSources().oracles.silospen.files.filter((f) => /itemTests\/The Stone of Jordan_BOSS_HELL_1_1_UNIQUE_0\.tsv$/.test(f));
  assert.equal(src.length, 1);
  for (const path of src) {
    const { version } = parseSilospenName(path);
    const eng = await silospenEngine(version);
    const rows = (await tools.source.oracleFile('silospen', path, { offline: true })).trim().split('\n').map((l) => l.split('\t'));
    for (const [label, , p] of rows) {
      const { src: s, quest } = silospenSource(eng, label, 'BOSS', 2);
      const mlvl = eng.monsterLevel(s, 2);
      const mine = silospenItemChance(eng, silospenTcIdx(eng, s, 2, quest, mlvl), { kind: 'unique', key: 'The Stone of Jordan', code: 'rin' }, mlvl, 0);
      close(mine, Number(p), 5e-5, `${version} ${label}`); // the fixture prints 11 decimal places
      counts['Silospen Stone of Jordan, bosses'] = (counts['Silospen Stone of Jordan, bosses'] || 0) + 1;
    }
  }
});
cached('Silospen item tests: Stone of Jordan from every regular Hell monster in every area, Alma Negra from superuniques', async () => {
  const eng = await silospenEngine('v1.12a');
  const cases = [
    ['The Stone of Jordan_REGULAR_HELL_1_1_UNIQUE_0.tsv', 'REGULAR', { kind: 'unique', key: 'The Stone of Jordan', code: 'rin' }],
    ['Alma Negra_SUPERUNIQUE_HELL_1_1_UNIQUE_0.tsv', 'SUPERUNIQUE', null],
  ];
  let n = 0;
  for (const [file, type, fixedTarget] of cases) {
    const path = tools.source.loadSources().oracles.silospen.files.find((f) => f.endsWith('itemTests/' + file));
    assert.ok(path, file);
    const target = fixedTarget || (() => { const u = eng.data.uniques.find((x) => x.key === 'Alma Negra'); return { kind: 'unique', key: u.key, code: u.code }; })();
    const rows = (await tools.source.oracleFile('silospen', path, { offline: true })).trim().split('\n').map((l) => l.split('\t'));
    for (const [label, areaName, p] of rows) {
      let s, mlvl;
      if (type === 'SUPERUNIQUE') ({ src: s, mlvl } = silospenSource(eng, label, type, 2));
      else {
        const cls = label.match(/ - ([^ ]+) \(H\)$/)[1];
        const area = eng.data.levels.find((l) => l.name === areaName && l.nmon.includes(cls));
        assert.ok(area, `${areaName} with ${cls}`);
        s = { type: 'regular', cls, area: area.id };
        // Silospen uses the area level for every regular, even a boss-flagged one (the Defilers);
        // the spec (6.2) gives boss-flagged monsters their own level. The app lists Defilers only
        // as bosses, so this only matters for reproducing Silospen's numbers.
        mlvl = area.mlvl[2];
      }
      const mine = silospenItemChance(eng, silospenTcIdx(eng, s, 2, false, mlvl), target, mlvl, 0);
      close(mine, Number(p), 5e-4, `${file} ${label} ${areaName}`); // 11 decimals: tiny values keep 3-4 digits
      n++;
    }
  }
  counts['Silospen item chances, regular monsters and superuniques'] = n;
  assert.ok(n > 300, `${n} rows`);
});
cached('Silospen TC tests: every atomic outcome of bosses and superuniques, 1 to 8 players', async () => {
  const files = tools.source.loadSources().oracles.silospen.files.filter((f) => /tcTests\//.test(f) && /_(BOSS|SUPERUNIQUE)_/.test(f));
  assert.ok(files.length >= 50, `${files.length} files`);
  let rowsChecked = 0;
  for (const path of files) {
    const { parts, version } = parseSilospenName(path);
    const [who, type, diffName, players, party] = parts;
    const d = { NORMAL: 0, NIGHTMARE: 1, HELL: 2 }[diffName];
    const eng = await silospenEngine(version);
    let s, mlvl = null;
    if (type === 'SUPERUNIQUE') {
      const r = silospenSource(eng, `${who} - ${eng.data.superUniques.find((x) => x.key === who || x.key.replace(/ /g, '') === who.replace(/ /g, '')).cls} (H)`, type, d);
      s = r.src; mlvl = r.mlvl;
    } else s = { type: 'boss', cls: who.replace(/q$/, '') };
    const quest = type === 'BOSS' && /q$/.test(who) && !eng.monster(who);
    const idx = silospenTcIdx(eng, s, d, quest, mlvl);
    if (version === 'd2r-1.0' && quest) continue; // see the item test above
    const forks = silospenPaths(eng, idx, { players: +players, party: +party, leafKind: 'atomic' });
    const rows = (await tools.source.oracleFile('silospen', path, { offline: true })).trim().split('\n').map((l) => l.split('\t'));
    for (const [k, , p] of rows) {
      close(silospenFinal(forks, k), Number(p), 1e-12, `${path.split('/').pop()} ${k}`);
      rowsChecked++;
    }
  }
  counts['Silospen TC outcomes (exact to 1e-12)'] = rowsChecked;
  assert.ok(rowsChecked > 4000, `${rowsChecked} rows`);
});
cached('Silospen monster tests: every unique from Andariel and Baal at MF 0 and 500', async () => {
  const files = tools.source.loadSources().oracles.silospen.files.filter((f) => /monsterTests\/(andariel|baalcrab)_BOSS_[A-Z]+_1_1_UNIQUE_(0|500)\.tsv$/.test(f));
  assert.ok(files.length >= 3);
  let n = 0;
  for (const path of files) {
    const { parts, version } = parseSilospenName(path);
    const [cls, , diffName, , , , mf] = parts;
    const d = { NORMAL: 0, NIGHTMARE: 1, HELL: 2 }[diffName];
    const eng = await silospenEngine(version);
    const s = { type: 'boss', cls };
    const mlvl = eng.monsterLevel(s, d);
    const idx = silospenTcIdx(eng, s, d, false, mlvl);
    const rows = (await tools.source.oracleFile('silospen', path, { offline: true })).trim().split('\n').map((l) => l.split('\t'));
    let unmatched = 0;
    for (const [name, , p] of rows) {
      const norm = (x) => x.replace(/['\s-]/g, '').toLowerCase();
      // Some names have two rows (a disabled classic Azurewrath and the LoD one); prefer the one that drops.
      const pool = [...eng.data.uniques.filter((x) => x.roll || x.ladder === true), ...eng.data.uniques];
      const u = pool.find((x) => x.key === name || x.name === name) || pool.find((x) => norm(x.key) === norm(name));
      if (!u) { unmatched++; continue; } // a display name that is not the row key in the table
      close(silospenItemChance(eng, idx, { kind: 'unique', id: u.id, code: u.code }, mlvl, Number(mf)), Number(p), 1e-9, `${path.split('/').pop()} ${name}`);
      n++;
    }
    assert.ok(unmatched <= 6, `${path}: ${unmatched} names not matched`);
  }
  counts['Silospen unique chances, Andariel and Baal (1e-9)'] = n;
  assert.ok(n > 200, `${n} rows`);
});

// ---------------------------------------------------------------------------------------------
// Oracle 2: d2data's drop solver (models the six-item cap), on the shipped D2R tables
// ---------------------------------------------------------------------------------------------
cached('d2data drop solver: expected count of every item from 10 treasure classes, player factor 1-8', async () => {
  const files = tools.source.loadSources().oracles.d2data.files;
  let n = 0;
  for (const path of files) {
    const id = path.startsWith('json/base/') ? 'd2r-base' : 'd2r-rotw';
    const tcName = path.split('/').pop().replace(/\.json$/, '');
    const eng = ENG[id];
    const pre = JSON.parse(await tools.source.oracleFile('d2data', path, { offline: true }));
    for (const slot of [0, 1, 2, 3, 5, 7]) {
      const exp = new Map();
      for (const [code, v] of pre[2][0][slot]) exp.set(code, (exp.get(code) || 0) + v);
      for (const [code, v] of exp) {
        if (!eng.item(code)) continue;
        const r = eng.tcChance(tcName, { kind: 'base', code }, { n: slot + 1, difficulty: 2 });
        close(r.expected, v, 6e-6, `${id} ${tcName} n=${slot + 1} ${code}`); // the solver prints 6 significant digits
        n++;
      }
    }
  }
  counts['d2data solver expected counts (6 digits)'] = n;
  assert.ok(n > 25000, `${n} values`);
});

// ---------------------------------------------------------------------------------------------
// The tables themselves
// ---------------------------------------------------------------------------------------------
cached('1.14d tables match Silospen\'s independent copy in every drop-relevant field', async () => {
  const diffs = tools.verify.compareModels(await tools.verify.modelFromD2data('lod-114d', { offline: true }), await tools.verify.modelFromSilospen('lod-114d', { offline: true }));
  assert.deepEqual(diffs, []);
});
cached('D2R 3.3 Reign of the Warlock differs from Silospen\'s 3.2 copy only where patch 3.3 changed it', async () => {
  const diffs = tools.verify.compareModels(await tools.verify.modelFromD2data('d2r-rotw', { offline: true }), await tools.verify.modelFromSilospen('d2r-rotw', { offline: true }));
  // Patch 3.3 notes (Blizzard News, Ladder Season 15): changed uniques are Ladder only; The
  // Battlebranch item level 34 -> 30; Latent Sunder Charm minimum level 69 -> 75; Herald tier 3+
  // quality raised; Worldstone Shard and Ancient Statue rates lowered.
  const unique = diffs.filter((x) => x.startsWith('unique '));
  const allowedUnique = /^unique (Gravenspine|The Battlebranch|Bane Ash|Pluckeye|Piercerib|Blinkbats Form|The Ward|Manald Heal|Bloodletter)\.ladder|^unique The Battlebranch\.lvl: 30 vs 34|^unique (Pre)?Crafted .*\.lvl: 75 vs 69|^unique Gheed's Fortune\.rarity/;
  assert.deepEqual(unique.filter((x) => !allowedUnique.test(x)), []);
  const other = diffs.filter((x) => !x.startsWith('unique ') && !x.startsWith('tc '));
  assert.deepEqual(other, []);
  const tcNames = new Set(diffs.filter((x) => x.startsWith('tc ')).map((x) => x.replace(/^tc (only in d2data: )?/, '').replace(/\.(nodrop|entries|q|picks): .*$/, '')));
  const allowedTc = /Worldstone Shard|Citem|Uitem|Herald|Desecrated|^(Andarielq|Duriel|Durielq|Mephisto|Mephistoq|Diablo|Diabloq|Baal|Baalq|Andariel)( \(H\))?( - Base)?|Item \(H\)/;
  assert.deepEqual([...tcNames].filter((n) => !allowedTc.test(n)), []);
});
cached('automatic item classes match d2data\'s, except 1.14d throwing potions (spec A.2 excludes them)', async () => {
  for (const id of PROFILES) {
    const atomic = (await tools.source.profileTables(id, { offline: true })).atomic;
    const eng = ENG[id];
    const extra = [];
    for (const [name, theirs] of Object.entries(atomic)) {
      const t = eng.tcs.find((x) => x.auto && x.name === name);
      assert.ok(t, `${id} ${name}`);
      const mine = new Map(t.entries.map((e) => [e.code, e.prob]));
      for (const k of Object.keys(theirs)) if (!mine.has(k)) extra.push(k);
      const kept = Object.keys(theirs).filter((k) => mine.has(k));
      const tm = kept.reduce((a, k) => a + mine.get(k), 0), tt = kept.reduce((a, k) => a + theirs[k], 0);
      for (const k of kept) close(mine.get(k) / tm, theirs[k] / tt, 1e-12, `${id} ${name} ${k}`);
      for (const k of mine.keys()) assert.ok(k in theirs, `${id} ${name} has ${k} that d2data does not`);
    }
    if (id === 'lod-114d') assert.ok(extra.length && extra.every((c) => eng.item(c).type === 'tpot'), `1.14d extras: ${extra}`);
    else assert.deepEqual(extra, [], id);
  }
});
test('superunique areas agree with Silospen\'s list, and every listed one is a source', () => {
  for (const id of PROFILES) {
    const d = DATA[id], S = Sources.create(d, ENG[id]);
    let n = 0;
    for (const su of d.superUniques) {
      const theirs = AREAS.superuniques[su.key];
      const lv = S.superuniqueArea(su);
      if (!theirs) { assert.equal(lv === null || su.areaId !== undefined, true, `${id} ${su.key}`); continue; }
      assert.ok(lv, `${id} ${su.key} has an area`);
      assert.equal(lv.key, theirs, `${id} ${su.key}`);
      n++;
    }
    assert.ok(n >= 50, `${id}: ${n}`);
  }
});
test('boss areas used by the calculator are the ones Silospen lists', () => {
  for (const [cls, key] of Sources.BOSSES) {
    if (!AREAS.bosses[cls]) continue;
    assert.ok(AREAS.bosses[cls].includes(key), `${cls}: ${key}`);
  }
});
cached('js/data is built from the pinned tables (rebuild with node tools/build-data.mjs)', async () => {
  const models = await tools.build.buildAll({ offline: true });
  for (const [id, m] of Object.entries(models)) {
    assert.equal(readFileSync(join(ROOT, 'js', 'data', `${id}.js`), 'utf8'), tools.build.render(m), id);
  }
});
cached('every unique, set item and runeword carries exactly the properties of its source row', async () => {
  for (const id of PROFILES) {
    const raw = await tools.source.profileTables(id, { offline: true });
    const d = DATA[id];
    const rows = (list, n, cols) => list.map((r) => {
      const out = [];
      for (let i = 1; i <= n; i++) { const p = r[cols[0] + i]; if (p) out.push([String(p).trim(), r[cols[1] + i] ?? '', Number(r[cols[2] + i] || 0), Number(r[cols[3] + i] || 0)]); }
      return out;
    });
    const uRaw = raw.uniqueitems.filter((r) => r.code && d.items.some((it) => it.code === String(r.code).trim()));
    assert.equal(d.uniques.length, uRaw.length, `${id} unique rows`);
    assert.deepEqual(d.uniques.map((u) => u.props), rows(uRaw, 12, ['prop', 'par', 'min', 'max']), `${id} unique properties`);
    const sRaw = raw.setitems.filter((r) => r.item && d.items.some((it) => it.code === String(r.item).trim()));
    assert.equal(d.setItems.length, sRaw.length, `${id} set item rows`);
    assert.deepEqual(d.setItems.map((s) => s.props), rows(sRaw, 9, ['prop', 'par', 'min', 'max']), `${id} set item properties`);
    const rRaw = raw.runes.filter((r) => Number(r.complete) === 1);
    assert.equal(d.runewords.length, rRaw.length, `${id} runewords`);
    assert.deepEqual(d.runewords.map((r) => r.props), rows(rRaw, 7, ['T1Code', 'T1Param', 'T1Min', 'T1Max']), `${id} runeword properties`);
    assert.deepEqual(d.runewords.map((r) => r.runes.join('')), rRaw.map((r) => [1, 2, 3, 4, 5, 6].map((i) => r['Rune' + i] || '').join('')), `${id} runeword runes`);
  }
});
test('bosses and areas by difficulty: Uber bosses and Pandemonium only in Hell', () => {
  for (const id of PROFILES) {
    const S = Sources.create(DATA[id], ENG[id]);
    // Lilith, Uber Duriel and Uber Izual have Hell classes only; Diablo Clone has one per difficulty.
    const ubers = (d) => S.fixed(d).filter((s) => s.group === 'Uber bosses' && s.src.cls !== 'diabloclone').length;
    assert.equal(ubers(0), 0, id);
    assert.equal(ubers(1), 0, id);
    assert.equal(ubers(2), 3, id);
    for (const d of [0, 1]) assert.ok(!S.areas(d).some((a) => /Pandemonium/.test(a.key)), `${id} ${d}`);
    for (const d of [0, 1, 2]) {
      assert.ok(S.fixed(d).length > 40, `${id} ${d} fixed sources`);
      assert.ok(S.areas(d).length > 80, `${id} ${d} areas`);
      for (const a of S.areas(d)) for (const t of ['regular', 'champion', 'unique', 'minion']) for (const m of S.areaMonsters(a.id, d, t)) assert.ok(!DATA[id].monsters[m.id].boss, `${id} ${m.id} boss in area list`);
    }
  }
});
test('D2R gives Andariel her quest class on every kill, so there is no separate quest row', () => {
  for (const id of ['d2r-base', 'd2r-rotw']) {
    const m = DATA[id].monsters.andariel;
    assert.deepEqual(m.tc.reg, m.tc.quest, id);
    const f = Sources.create(DATA[id], ENG[id]).fixed(2);
    assert.ok(f.some((s) => s.id === 'b:andariel') && !f.some((s) => s.id === 'q:andariel'), id);
  }
  const f114 = Sources.create(DATA['lod-114d'], ENG['lod-114d']).fixed(2);
  assert.ok(f114.some((s) => s.id === 'q:andariel'), '1.14d keeps both');
});
test('every profile has the ladder season it is documented with', () => {
  assert.equal(DATA['lod-114d'].ladderSeason, null);
  assert.equal(DATA['d2r-base'].ladderSeason, 15);
  assert.equal(DATA['d2r-rotw'].ladderSeason, 15);
  assert.equal(DATA['d2r-rotw'].experimental, true);
});

// ---------------------------------------------------------------------------------------------
// Item text
// ---------------------------------------------------------------------------------------------
test('every unique, set item, set and runeword renders without placeholders or raw codes', () => {
  const bad = /undefined|NaN|%[+]?[dis]|null|\(\)|\[object|@LEVEL@/;
  for (const id of PROFILES) {
    const d = DATA[id], R = Props.create(d);
    const all = [...d.uniques.map((u) => [u.name, u.props]), ...d.setItems.map((s) => [s.name, s.props.concat(s.partial.map((x) => x.slice(0, 4)))]), ...d.runewords.map((r) => [r.name, r.props]), ...d.sets.map((s) => [s.name, s.partial.map((x) => x.slice(0, 4)).concat(s.full)])];
    const unknown = new Set();
    for (const [name, props] of all) {
      const r = R.describe(props);
      r.unknown.forEach((u) => unknown.add(u));
      if (props.length) assert.ok(r.lines.length, `${id} ${name} has no lines`);
      for (const l of r.lines) assert.ok(!bad.test(l) && !/^\d+ [A-Z]/.test(l), `${id} ${name}: ${l}`);
    }
    // Gelid-Affix5 is named by a RotW unique but missing from the 3.3 property group table.
    assert.deepEqual([...unknown], id === 'd2r-rotw' ? ['Gelid-Affix5'] : [], id);
  }
});
test('known tooltips: Stone of Jordan, Harlequin Crest, Enigma, Hellfire Torch', () => {
  const R = Props.create(DATA['lod-114d']);
  const u = (k) => R.describe(DATA['lod-114d'].uniques.find((x) => x.key === k).props).lines;
  assert.deepEqual(u('The Stone of Jordan'), ['+1 to All Skills', 'Adds 1-12 lightning damage', '+20 to Mana', 'Increase Maximum Mana 25%']);
  assert.ok(u('Harlequin Crest').includes('+1.5 per character level (1-148) to Life'));
  assert.ok(u('Harlequin Crest').includes('+2 to all Attributes'));
  assert.ok(u('Hellfire Torch').includes('Level 30 Hydra (10/10 Charges)'));
  const rw = DATA['d2r-base'].runewords.find((r) => r.name === 'Enigma');
  const lines = Props.create(DATA['d2r-base']).describe(rw.props).lines;
  for (const l of ['+2 to All Skills', '+45% Faster Run/Walk', '+1 to Teleport']) assert.ok(lines.includes(l), l);
});
test('printf subset', () => {
  assert.equal(Props.sprintf('%d%% Chance to cast level %d %s', [5, 18, 'Chain Lightning']), '5% Chance to cast level 18 Chain Lightning');
  assert.equal(Props.sprintf('%+d to Life', [{ min: 3, max: 3, text: '3' }]), '+3 to Life');
  assert.equal(Props.sprintf('%+d to Life', [{ min: -3, max: -3, text: '-3' }]), '-3 to Life');
});

// ---------------------------------------------------------------------------------------------
// Catalog, search and version restrictions
// ---------------------------------------------------------------------------------------------
const CAT = Object.fromEntries(PROFILES.map((id) => [id, Catalog.build(DATA[id], ENG[id], Props.create(DATA[id]))]));
test('search finds items by name, base and property text', () => {
  const c = CAT['lod-114d'];
  assert.deepEqual(Catalog.filter(c, { q: 'jordan' }).map((x) => x.name), ['The Stone of Jordan']);
  assert.ok(Catalog.filter(c, { q: 'shako' }).some((x) => x.name === 'Harlequin Crest'));
  assert.ok(Catalog.filter(c, { q: 'teleport', withProps: true, kind: 'unique' }).some((x) => x.name === 'The Oculus'));
  assert.equal(Catalog.filter(c, { q: 'teleport', kind: 'unique' }).length, 0, 'property text only when asked');
});
test('filters: kind, category and tier', () => {
  const c = CAT['d2r-base'];
  const runes = Catalog.filter(c, { kind: 'rune' });
  assert.equal(runes.length, 33);
  assert.ok(Catalog.filter(c, { kind: 'unique', category: 'jewelry' }).every((x) => /Ring|Amulet/.test(x.typeName)));
  assert.ok(Catalog.filter(c, { kind: 'unique', tier: 'elite', category: 'armor' }).some((x) => x.name === 'Tyrael\'s Might'));
  assert.ok(Catalog.filter(c, { kind: 'set' }).every((x) => x.kind === 'set' && x.setName));
});
test('items that only exist in Reign of the Warlock are not in the other rulesets', () => {
  const rotw = new Set(CAT['d2r-rotw'].filter((x) => x.kind === 'unique').map((x) => x.key));
  const base = new Set(CAT['d2r-base'].filter((x) => x.kind === 'unique').map((x) => x.key));
  const onlyRotw = [...rotw].filter((k) => !base.has(k));
  assert.ok(onlyRotw.length >= 5, onlyRotw.join(', '));
  assert.ok(!CAT['lod-114d'].some((x) => x.key === onlyRotw[0]));
  assert.ok(DATA['d2r-rotw'].runewords.some((r) => r.name === 'Authority') && !DATA['d2r-base'].runewords.some((r) => r.name === 'Authority'));
});
test('catalog and Grail ids are unique within each ruleset', () => {
  for (const id of PROFILES) {
    const seen = new Map();
    for (const x of CAT[id]) {
      assert.ok(!seen.has(x.id), `${id}: ${x.id} twice (${x.name} / ${seen.get(x.id)})`);
      seen.set(x.id, x.name);
    }
  }
});
test('runeword ladder status follows the season window', () => {
  const rw = (id, n) => Catalog.runewords(DATA[id], ENG[id]).find((r) => r.name === n);
  assert.equal(rw('lod-114d', 'Spirit').ladderOnlyNow, true, '1.14d realm ladder only');
  assert.equal(rw('lod-114d', 'Enigma').ladderOnlyNow, false, 'Enigma was never ladder only');
  assert.equal(rw('d2r-base', 'Spirit').ladderOnlyNow, false);
  assert.equal(rw('d2r-base', 'Plague').ladderOnlyNow, false, 'ladder only in Seasons 1-2');
  assert.equal(rw('d2r-base', 'Bulwark').ladderOnlyNow, true, 'still ladder only in the LoD ruleset');
  assert.equal(rw('d2r-rotw', 'Bulwark').ladderOnlyNow, false, 'the 3.3 table ends its window at Season 14');
  assert.equal(rw('d2r-base', 'Enigma').sockets, 3);
});
test('runes are in rune order with their levels', () => {
  const r = Catalog.runes(DATA['lod-114d'], ENG['lod-114d']);
  assert.equal(r.length, 33);
  assert.deepEqual([r[0].name, r[29].name, r[32].name], ['El', 'Ber', 'Zod']);
  assert.deepEqual([r[0].reqLevel, r[29].reqLevel, r[32].reqLevel], [11, 63, 69]);
});

// ---------------------------------------------------------------------------------------------
// Holy Grail and storage
// ---------------------------------------------------------------------------------------------
test('grail: mark, export, import round trip', () => {
  let s = Grail.empty();
  s = Grail.setFound(s, 'u:The Stone of Jordan', true, '2026-10-23');
  s = Grail.setFound(s, 's:Tal Rasha\'s Guardianship', true, '');
  const back = Grail.importText(Grail.exportText(s));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.found, s.found);
  assert.deepEqual(back.problems, []);
  s = Grail.setFound(s, 'u:The Stone of Jordan', false);
  assert.equal(Grail.isFound(s, 'u:The Stone of Jordan'), false);
});
test('grail: bad files are refused and bad entries dropped with a reason', () => {
  assert.equal(Grail.importText('not json').ok, false);
  assert.equal(Grail.importText('{"found":{}}').ok, false, 'needs the format marker');
  const r = Grail.importText(JSON.stringify({ format: 'd2looter-grail', version: 1, found: { 'u:Ok': '2026-01-02', 'x:bad': '', 'u:BadDate': 'yesterday', 'u:Flag': true } }));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.state.found).sort(), ['u:Flag', 'u:Ok']);
  assert.equal(r.problems.length, 2);
  assert.ok(Grail.check(null).problems.length);
  assert.ok(Grail.check({ format: 'd2looter-grail', version: 99, found: {} }).problems.some((p) => /newer/.test(p)));
});
test('grail: an import is refused as a whole when the file is not a usable backup', () => {
  const bad = (o) => Grail.importText(typeof o === 'string' ? o : JSON.stringify(o));
  for (const [o, why] of [
    [{ format: 'd2looter-grail', version: 1 }, /no list of found items/],
    [{ format: 'd2looter-grail', version: 1, found: [] }, /no list of found items/],
    [{ format: 'd2looter-grail', found: {} }, /no supported format version/],
    [{ format: 'd2looter-grail', version: '1', found: {} }, /no supported format version/],
    [{ format: 'd2looter-grail', version: 2, found: { 'u:A': '' } }, /newer version/],
    [[1, 2, 3], /not a D2Looter grail backup/],
    ['null', /not a D2Looter grail backup/],
    ['x'.repeat(5 * 1024 * 1024 + 1), /larger than 5 MB/],
  ]) {
    const r = bad(o);
    assert.equal(r.ok, false, JSON.stringify(o).slice(0, 60));
    assert.match(r.error, why);
  }
});
test('grail: large saves import, unknown fields are reported, odd keys are dropped', () => {
  const found = {};
  for (let i = 0; i < 20000; i++) found['u:Item ' + i] = i % 2 ? '2026-01-01' : '';
  const t0 = Date.now();
  const r = Grail.importText(JSON.stringify({ format: 'd2looter-grail', version: 1, found, notes: 'x', extra: 1 }));
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.state.found).length, 20000);
  assert.ok(Date.now() - t0 < 2000, 'fast enough');
  assert.ok(r.problems.some((p) => /unknown fields: notes, extra/.test(p)));
  const tooMany = {};
  for (let i = 0; i < 50001; i++) tooMany['u:' + i] = '';
  assert.match(Grail.importText(JSON.stringify({ format: 'd2looter-grail', version: 1, found: tooMany })).error, /more than 50,000/);
  // Duplicate keys in the JSON text: JSON.parse keeps the last; the entry is still one item.
  const dup = Grail.importText('{"format":"d2looter-grail","version":1,"found":{"u:A":"2026-01-01","u:A":"2026-02-02"}}');
  assert.deepEqual(dup.state.found, { 'u:A': '2026-02-02' });
  // Keys and dates that try to be something else are skipped, not stored.
  const odd = Grail.importText('{"format":"d2looter-grail","version":1,"found":{"__proto__":"","constructor":"","u:<img src=x onerror=alert(1)>":"<script>","u:Fine":""}}');
  assert.deepEqual(Object.keys(odd.state.found), ['u:Fine']);
  assert.equal(Object.getPrototypeOf(odd.state.found), Object.prototype);
});
test('grail: merge keeps every find and the earliest date', () => {
  const a = { format: 'd2looter-grail', version: 1, found: { 'u:A': '2026-05-01', 'u:B': '' } };
  const b = { format: 'd2looter-grail', version: 1, found: { 'u:A': '2026-03-01', 'u:B': '2026-04-01', 'u:C': '' } };
  assert.deepEqual(Grail.merge(a, b).found, { 'u:A': '2026-03-01', 'u:B': '2026-04-01', 'u:C': '' });
});
test('grail: completion per group', () => {
  const list = Catalog.grailList(CAT['lod-114d']);
  const s = Grail.setFound(Grail.empty(), list[0].id, true);
  const p = Grail.progress(s, list);
  assert.equal(p.found, 1);
  assert.equal(p.total, list.length);
  assert.equal(Object.values(p.groups).reduce((a, g) => a + g.total, 0), list.length);
});
test('storage: missing, broken and unavailable storage never throw, and a broken value is kept', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  assert.equal(Store.readRaw('grail').status, 'missing');
  assert.equal(Store.write('grail', { a: 1 }), true);
  assert.deepEqual(Store.read('grail', null), { a: 1 });
  mem.set(Store.PREFIX + 'grail', '{broken');
  const r = Store.readRaw('grail');
  assert.equal(r.status, 'broken');
  assert.equal(mem.get(Store.PREFIX + 'grail.broken'), '{broken', 'the unreadable text is kept');
  globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
  assert.equal(Store.read('grail', 'fallback'), 'fallback');
  assert.equal(Store.write('grail', {}), false);
  delete globalThis.localStorage;
});

// ---------------------------------------------------------------------------------------------
// House rules on everything committed
// ---------------------------------------------------------------------------------------------
test('index.html: the Content-Security-Policy hash matches the inline script, and there is no other inline script', async () => {
  const { createHash } = await import('node:crypto');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  const hash = 'sha256-' + createHash('sha256').update(inline[0]).digest('base64');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(csp.includes(`'${hash}'`), `${hash} not in the policy`);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(!/https?:/.test(csp), 'no outside sources allowed');
  assert.ok(!/ on[a-z]+="/i.test(html), 'no inline event handlers');
});
test('no em dashes in the project files', () => {
  const skip = new Set(['.git', 'tools/.cache', 'node_modules']);
  const hits = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name), rel = relative(ROOT, p).replace(/\\/g, '/');
      if (skip.has(rel)) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!['.js', '.mjs', '.html', '.css', '.md', '.json', '.cmd', '.txt'].includes(extname(p)) && name !== 'LICENSE' && name !== 'NOTICE') continue;
      if (readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014))) hits.push(rel);
    }
  })(ROOT);
  assert.deepEqual(hits, []);
});

await Promise.all(pending);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v.toLocaleString('en-US')} compared`);
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
