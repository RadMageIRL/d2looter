// Cross-check the shipped tables against a second, independent copy: Silospen's .txt files.
// Both copies go through the same normalizer, then every drop-relevant field is compared.
//
//   node tools/verify-data.mjs           print the differences
//
// lod-114d is expected to match exactly. d2r-rotw is compared with Silospen's patch 3.2 copy, so
// the only differences allowed are the ones patch 3.3 made (EXPECTED_ROTW_DIFFS in tests/run.mjs).
import { buildModel } from './lib/model.mjs';
import { profileTables, silospenTables } from './lib/source.mjs';

const STUB = { sets: [], runes: [], properties: [], itemstatcost: [], strings: {}, skills: [], skilldesc: [], charstats: [] };

// Silospen ships its strings as .tbl files; the matching d2data string table gives the same
// display names (only used to match the names in Silospen's expected results).
export async function modelFromSilospen(folder, opts = {}) {
  const t = await silospenTables(folder, opts);
  const strings = (await profileTables(folder.startsWith('d2r') ? 'd2r-base' : 'lod-114d', opts)).strings;
  return buildModel(folder, { label: folder }, { ...t, ...STUB, strings });
}

export async function modelFromD2data(id, opts = {}) {
  const t = await profileTables(id, opts);
  return buildModel(id, { label: id }, t);
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diffTable(label, a, b, keyOf, fields) {
  const out = [];
  const ia = new Map(a.map((r) => [keyOf(r), r]));
  const ib = new Map(b.map((r) => [keyOf(r), r]));
  for (const [k, ra] of ia) {
    const rb = ib.get(k);
    if (!rb) { out.push(`${label} only in d2data: ${k}`); continue; }
    for (const f of fields) if (!same(ra[f], rb[f])) out.push(`${label} ${k}.${f}: ${JSON.stringify(ra[f])} vs ${JSON.stringify(rb[f])}`);
  }
  for (const k of ib.keys()) if (!ia.has(k)) out.push(`${label} only in Silospen: ${k}`);
  return out;
}

export function compareModels(a, b) {
  const mon = (m) => Object.entries(m.monsters).map(([id, x]) => ({ id, ...pick(x, ['level', 'tc', 'boss', 'noRatio', 'questId']) }));
  return [
    ...diffTable('itemtype', a.itemTypes, b.itemTypes, (r) => r.code, ['equiv', 'rarity', 'cls', 'normal', 'magic', 'rare', 'tc']),
    ...diffTable('item', a.items, b.items, (r) => r.code, ['kind', 'type', 'type2', 'level', 'version', 'spawnable', 'quest', 'uniqueOnly', 'norm', 'uber', 'ultra']),
    ...diffTable('unique', a.uniques, b.uniques, (r) => r.key, ['code', 'lvl', 'rarity', 'roll', 'ladder']),
    ...diffTable('setitem', a.setItems, b.setItems, (r) => r.key, ['code', 'lvl', 'rarity', 'set']),
    ...diffTable('ratio', a.ratios, b.ratios, (r) => `${r.version}/${r.uber}/${r.cls}`, ['unique', 'set', 'rare', 'magic', 'hi', 'normal']),
    ...diffTable('tc', a.tcs, b.tcs, (r) => r.name, ['group', 'level', 'picks', 'q', 'nodrop', 'entries', 'cond']),
    ...diffTable('monster', mon(a), mon(b), (r) => r.id, ['level', 'tc', 'boss', 'noRatio', 'questId']),
    ...diffTable('superunique', a.superUniques, b.superUniques, (r) => r.key, ['cls', 'tc']),
    ...diffTable('area', a.levels, b.levels, (r) => String(r.id), ['key', 'mlvl', 'mon', 'nmon', 'umon']),
  ];
}

if (process.argv[1] && process.argv[1].endsWith('verify-data.mjs')) {
  for (const [id, folder] of [['lod-114d', 'lod-114d'], ['d2r-rotw', 'd2r-rotw']]) {
    const diffs = compareModels(await modelFromD2data(id), await modelFromSilospen(folder));
    console.log(`${id} (d2data) vs Silospen ${folder}: ${diffs.length} differences`);
    diffs.forEach((d) => console.log('  ' + d));
  }
}
