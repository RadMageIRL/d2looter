// Turns one profile's raw tables into the compact model the app loads (js/data/<profile>.js).
// The game tables changed column names between 1.14d and D2R; every rename is handled here so the
// engine sees one shape. Only facts the app uses are kept, and every string key the app shows is
// resolved against the profile's own string table.

const DIFFS = ['', '(N)', '(H)'];
const int = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) | 0);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Strings carry color codes (each a 3-character sequence starting with U+00FF and c) and
// grammatical-gender tags ([ms], [fs]); the app shows plain text.
export function cleanString(s) {
  return str(s)
    .replace(/ÿc./g, '')
    .replace(/^\[[a-z]{1,3}\]/i, '')
    .replace(/\r/g, '')
    .trim();
}

function stringLookup(raw) {
  const map = new Map();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') map.set(k, cleanString(v));
  const lower = new Map();
  for (const [k, v] of map) if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), v);
  const used = {};
  const get = (key) => {
    const k = str(key);
    if (!k) return '';
    const v = map.has(k) ? map.get(k) : lower.get(k.toLowerCase());
    return v === undefined ? '' : v;
  };
  // `keep` records a string the app needs at runtime (property descriptions).
  const keep = (key) => { const v = get(key); if (v) used[str(key)] = v; return v; };
  return { get, keep, used };
}

function props(row, count, prefix = { p: 'prop', par: 'par', min: 'min', max: 'max' }) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const p = str(row[prefix.p + i]);
    if (!p) continue;
    const par = row[prefix.par + i];
    out.push([p, par === undefined ? '' : par, int(row[prefix.min + i]), int(row[prefix.max + i])]);
  }
  return out;
}

// D2R marks rows that are ladder-only for a span of seasons; 1.14d marks realm ladder-only rows
// with a plain flag. Either way the app needs "is this row ladder-only in season S".
function ladderWindow(row) {
  const first = int(row.firstLadderSeason), last = int(row.lastLadderSeason);
  if (!first && !last) return null;
  return [first, last];
}

export function buildModel(id, meta, t) {
  const S = stringLookup(t.strings);
  const isD2R = id.startsWith('d2r');
  const model = {
    id,
    label: meta.label,
    game: isD2R ? 'd2r' : 'lod',
    ladderSeason: meta.ladderSeason ?? null,
    experimental: !!meta.experimental,
  };

  // ---- item types (file order matters: it numbers the automatic treasure classes) ----
  model.itemTypes = t.itemtypes.filter((r) => str(r.Code)).map((r) => ({
    code: str(r.Code),
    name: str(r.ItemType),
    equiv: [str(r.Equiv1), str(r.Equiv2)].filter(Boolean),
    rarity: int(r.Rarity),
    cls: str(r.Class),
    normal: int(r.Normal),
    magic: int(r.Magic),
    rare: int(r.Rare),
    throwable: int(r.Throwable),
    tc: int(r.TreasureClass),
    body: int(r.Body),
    maxSock: [int(r.MaxSockets1 ?? r.MaxSock1), int(r.MaxSockets2 ?? r.MaxSock25), int(r.MaxSockets3 ?? r.MaxSock40)],
    sockLvl: [int(r.MaxSocketsLevelThreshold1 ?? 25) || 25, int(r.MaxSocketsLevelThreshold2 ?? 40) || 40],
  }));

  // ---- base items: weapons, then armor, then misc (the combined order the game uses) ----
  model.items = [];
  for (const [kind, rows] of [['weapon', t.weapons], ['armor', t.armor], ['misc', t.misc]]) {
    for (const r of rows) {
      const code = str(r.code);
      if (!code || str(r.name) === 'Expansion') continue;
      const it = {
        code,
        name: S.get(r.namestr) || str(r.name),
        kind,
        type: str(r.type),
        type2: str(r.type2),
        level: int(r.level),
        reqLevel: int(r.levelreq),
        version: int(r.version),
        spawnable: int(r.spawnable),
        quest: int(r.quest),
        uniqueOnly: int(r.unique),
        norm: str(r.normcode),
        uber: str(r.ubercode),
        ultra: str(r.ultracode),
      };
      if (r.reqstr) it.reqStr = int(r.reqstr);
      if (r.reqdex) it.reqDex = int(r.reqdex);
      if (kind === 'weapon') {
        if (r.mindam || r.maxdam) it.dmg = [int(r.mindam), int(r.maxdam)];
        if (r['2handmindam'] || r['2handmaxdam']) it.dmg2 = [int(r['2handmindam']), int(r['2handmaxdam'])];
        if (r.minmisdam || r.maxmisdam) it.dmgThrow = [int(r.minmisdam), int(r.maxmisdam)];
        if (r.speed) it.speed = int(r.speed);
      }
      if (kind === 'armor') {
        it.ac = [int(r.minac), int(r.maxac)];
        if (r.block) it.block = int(r.block);
        if (r.mindam || r.maxdam) it.dmg = [int(r.mindam), int(r.maxdam)];
      }
      if (r.durability && !r.nodurability) it.dur = int(r.durability);
      if (r.gemsockets) it.sockets = int(r.gemsockets);
      if (r.stackable) it.stack = int(r.maxstack);
      model.items.push(it);
    }
  }
  const itemCodes = new Set(model.items.map((i) => i.code));

  // ---- uniques ----
  // 1.14d: `enabled` decides whether a row can be rolled. D2R renamed it `spawnable` and added
  // `disabled`; rows with spawnable 0 (sunder charms) still drop when a treasure class names them.
  model.uniques = [];
  for (const r of t.uniqueitems) {
    const code = str(r.code);
    if (!code || !itemCodes.has(code)) continue;
    const u = {
      key: str(r.index),
      name: S.get(r.index) || str(r.index),
      code,
      lvl: int(r.lvl),
      reqLevel: int(r['lvl req']),
      rarity: int(r.rarity),
      version: int(r.version),
      roll: isD2R ? int(r.spawnable) === 1 && !int(r.disabled) : int(r.enabled) === 1,
      named: isD2R ? !int(r.disabled) : int(r.enabled) === 1,
      props: props(r, 12),
    };
    if (int(r.nolimit)) u.nolimit = 1;
    const lw = ladderWindow(r);
    if (lw) u.ladder = lw;
    if (!isD2R && int(r.ladder)) u.ladder = true;
    if (r.DropConditionCalc) u.cond = str(r.DropConditionCalc);
    model.uniques.push(u);
  }
  // A name can head several rows (eight Rainbow Facets; a disabled classic Azurewrath beside the
  // LoD one). `id` tells rows apart: the first keeps its name, later ones get "#2", "#3" in file order.
  const seenKeys = new Map();
  for (const u of model.uniques) {
    const n = (seenKeys.get(u.key) || 0) + 1;
    seenKeys.set(u.key, n);
    u.id = n === 1 ? u.key : `${u.key}#${n}`;
  }

  // ---- set items and sets ----
  model.setItems = [];
  for (const r of t.setitems) {
    const code = str(r.item);
    if (!code || !itemCodes.has(code)) continue;
    const s = {
      key: str(r.index),
      name: S.get(r.index) || str(r.index),
      set: str(r.set),
      code,
      lvl: int(r.lvl),
      reqLevel: int(r['lvl req']),
      rarity: int(r.rarity),
      version: int(r.version ?? (int(r.expansion) ? 100 : 0)),
      roll: isD2R ? r.spawnable === undefined || int(r.spawnable) === 1 : true,
      props: props(r, 9),
      partial: [],
    };
    for (let i = 1; i <= 5; i++) {
      for (const ab of ['a', 'b']) {
        const p = str(r[`aprop${i}${ab}`]);
        if (p) s.partial.push([p, r[`apar${i}${ab}`] ?? '', int(r[`amin${i}${ab}`]), int(r[`amax${i}${ab}`]), i + 1]);
      }
    }
    const lw = ladderWindow(r);
    if (lw) s.ladder = lw;
    model.setItems.push(s);
  }
  const seenSet = new Map();
  for (const s of model.setItems) {
    const n = (seenSet.get(s.key) || 0) + 1;
    seenSet.set(s.key, n);
    s.id = n === 1 ? s.key : `${s.key}#${n}`;
  }
  model.sets = t.sets.filter((r) => str(r.index)).map((r) => {
    const set = { key: str(r.index), name: S.get(r.name || r.index) || str(r.index), partial: [], full: [] };
    for (let i = 2; i <= 5; i++) {
      for (const ab of ['a', 'b']) {
        const p = str(r[`PCode${i}${ab}`]);
        if (p) set.partial.push([p, r[`PParam${i}${ab}`] ?? '', int(r[`PMin${i}${ab}`]), int(r[`PMax${i}${ab}`]), i]);
      }
    }
    for (let i = 1; i <= 8; i++) {
      const p = str(r[`FCode${i}`]);
      if (p) set.full.push([p, r[`FParam${i}`] ?? '', int(r[`FMin${i}`]), int(r[`FMax${i}`])]);
    }
    return set;
  });

  // ---- item ratios ----
  model.ratios = t.itemratio.map((r) => ({
    version: int(r.Version),
    uber: int(r.Uber),
    cls: int(r['Class Specific']),
    unique: [int(r.Unique), int(r.UniqueDivisor), int(r.UniqueMin)],
    set: [int(r.Set), int(r.SetDivisor), int(r.SetMin)],
    rare: [int(r.Rare), int(r.RareDivisor), int(r.RareMin)],
    magic: [int(r.Magic), int(r.MagicDivisor), int(r.MagicMin)],
    hi: [int(r.HiQuality), int(r.HiQualityDivisor)],
    normal: [int(r.Normal), int(r.NormalDivisor)],
  }));

  // ---- treasure classes, in file order, stopping at the first empty name ----
  model.tcs = [];
  for (const r of t.treasureclassex) {
    const name = str(r['Treasure Class']);
    if (!name) break;
    const entries = [];
    for (let i = 1; i <= 10; i++) {
      const item = str(r['Item' + i]);
      if (!item) break; // the first empty Item cell ends the list
      entries.push([item, int(r['Prob' + i])]);
    }
    const tc = {
      name,
      group: int(r.group),
      level: int(r.level),
      picks: int(r.Picks),
      q: [int(r.Unique), int(r.Set), int(r.Rare), int(r.Magic)],
      nodrop: int(r.NoDrop),
      entries,
    };
    if (r.ConditionCalc) tc.cond = str(r.ConditionCalc);
    const lw = ladderWindow(r);
    if (lw) tc.ladder = lw;
    model.tcs.push(tc);
  }

  // ---- monsters ----
  const tcCols = isD2R
    ? { reg: 'TreasureClass', champ: 'TreasureClassChamp', unique: 'TreasureClassUnique', quest: 'TreasureClassQuest' }
    : { reg: 'TreasureClass1', champ: 'TreasureClass2', unique: 'TreasureClass3', quest: 'TreasureClass4' };
  const colFor = (base, d) => (d === 0 ? base : `${base}${DIFFS[d]}`);
  model.monsters = {};
  for (const r of t.monstats) {
    const mid = str(r.Id);
    if (!mid || !int(r.enabled) || !int(r.killable)) continue;
    const tc = {};
    for (const [k, col] of Object.entries(tcCols)) {
      const v = [0, 1, 2].map((d) => str(r[colFor(col, d)]));
      if (v.some(Boolean)) tc[k] = v;
    }
    if (!Object.keys(tc).length) continue;
    const m = {
      name: S.get(r.NameStr) || mid,
      level: [int(r.Level), int(r['Level(N)']), int(r['Level(H)'])],
      tc,
    };
    if (int(r.boss)) m.boss = 1;
    if (int(r.noRatio ?? r.NoRatio)) m.noRatio = 1;
    if (int(r.TCQuestId)) { m.questId = int(r.TCQuestId); m.questCp = int(r.TCQuestCP); }
    if (int(r.Align)) m.ally = 1;
    if (int(r.npc)) m.npc = 1;
    model.monsters[mid] = m;
  }

  // ---- superuniques ----
  model.superUniques = t.superuniques.filter((r) => str(r.Superunique) && str(r.Class)).map((r) => {
    const su = {
      key: str(r.Superunique),
      name: S.get(r.Name) || str(r.Name),
      cls: str(r.Class),
      tc: [str(r.TC), str(r['TC(N)']), str(r['TC(H)'])],
    };
    if (r.areaId !== undefined) su.areaId = int(r.areaId);
    return su;
  });

  // ---- areas ----
  model.levels = t.levels.filter((r) => str(r.Name) && int(r.Id) > 0).map((r) => {
    const lv = {
      id: int(r.Id),
      key: str(r.Name),
      name: S.get(r.LevelName) || str(r.LevelName) || str(r.Name),
      act: int(r.Act),
      mlvl: isD2R
        ? [int(r.MonLvlEx), int(r['MonLvlEx(N)']), int(r['MonLvlEx(H)'])]
        : [int(r.MonLvl1Ex), int(r.MonLvl2Ex), int(r.MonLvl3Ex)],
      mon: [],
      nmon: [],
      umon: [],
    };
    for (let i = 1; i <= 25; i++) {
      for (const k of ['mon', 'nmon', 'umon']) { const v = str(r[k + i]); if (v) lv[k].push(v); }
    }
    return lv;
  });

  // ---- runewords ----
  model.runewords = t.runes.filter((r) => int(r.complete) === 1).map((r) => {
    const rw = {
      key: str(r.Name),
      name: S.get(r.Name) || str(r['*Rune Name'] || r['Rune Name']),
      runes: [1, 2, 3, 4, 5, 6].map((i) => str(r['Rune' + i])).filter(Boolean),
      itypes: [1, 2, 3, 4, 5, 6].map((i) => str(r['itype' + i])).filter(Boolean),
      etypes: [1, 2, 3].map((i) => str(r['etype' + i])).filter(Boolean),
      props: props(r, 7, { p: 'T1Code', par: 'T1Param', min: 'T1Min', max: 'T1Max' }),
    };
    if (isD2R) {
      const lw = ladderWindow(r);
      if (lw) rw.ladder = lw;
      // The table's own row label, kept because the string table D2R ships is shared by both rulesets.
      rw.label = str(r['*Rune Name']);
    } else if (int(r.server)) {
      rw.ladder = true;
    }
    return rw;
  });

  // ---- property and stat descriptions (for showing item properties) ----
  model.properties = {};
  for (const r of t.properties) {
    const code = str(r.code);
    if (!code) continue;
    const parts = [];
    for (let i = 1; i <= 7; i++) {
      const f = int(r['func' + i]);
      if (!f) continue;
      parts.push([f, str(r['stat' + i]), int(r['set' + i]), int(r['val' + i])]);
    }
    model.properties[code] = parts;
  }
  // D2R property groups: one property code that rolls one (or more) of a list.
  model.propertyGroups = {};
  for (const r of t.propertygroups || []) {
    const code = str(r.code);
    if (!code) continue;
    const opts = [];
    for (let i = 1; i <= 8; i++) {
      const p = str(r['Prop' + i]);
      if (!p) continue;
      opts.push([p, r['ParMin' + i] ?? '', int(r['ModMin' + i]), int(r['ModMax' + i]), int(r['Chance' + i])]);
    }
    model.propertyGroups[code] = { pick: int(r.PickMode), options: opts };
  }
  model.stats = {};
  for (const r of t.itemstatcost) {
    const stat = str(r.Stat);
    if (!stat) continue;
    const s = { id: int(r.ID ?? r['*ID']) };
    if (r.descfunc) s.func = int(r.descfunc);
    if (r.descval !== undefined) s.val = int(r.descval);
    if (r.descpriority) s.prio = int(r.descpriority);
    if (r.descstrpos) s.pos = S.keep(r.descstrpos);
    if (r.descstrneg) s.neg = S.keep(r.descstrneg);
    if (r.descstr2) s.str2 = S.keep(r.descstr2);
    if (r.dgrp) {
      s.dgrp = int(r.dgrp);
      if (r.dgrpfunc) s.dgrpFunc = int(r.dgrpfunc);
      if (r.dgrpval !== undefined) s.dgrpVal = int(r.dgrpval);
      if (r.dgrpstrpos) s.dgrpPos = S.keep(r.dgrpstrpos);
      if (r.dgrpstrneg) s.dgrpNeg = S.keep(r.dgrpstrneg);
      if (r.dgrpstr2) s.dgrpStr2 = S.keep(r.dgrpstr2);
    }
    if (r.op) { s.op = int(r.op); s.opParam = int(r['op param']); s.opBase = str(r['op base']); }
    model.stats[stat] = s;
  }
  // ---- skills and classes, for skill-based properties ----
  const descByKey = new Map(t.skilldesc.map((r) => [str(r.skilldesc), r]));
  model.skills = [];
  for (const r of t.skills) {
    const id = int(r.Id ?? r['*Id'] ?? r.lineNumber);
    const d = descByKey.get(str(r.skilldesc));
    model.skills[id] = { key: str(r.skill), name: (d && S.get(d['str name'])) || str(r.skill), cls: str(r.charclass) };
  }
  for (let i = 0; i < model.skills.length; i++) if (!model.skills[i]) model.skills[i] = null;
  model.classes = t.charstats.filter((r) => str(r.class) && str(r.class) !== 'Expansion').map((r) => ({
    name: str(r.class),
    allSkills: S.keep(r.StrAllSkills),
    tabs: [S.keep(r.StrSkillTab1), S.keep(r.StrSkillTab2), S.keep(r.StrSkillTab3)],
    only: S.keep(r.StrClassOnly),
  }));

  // Strings for lines the game composes from two stats (damage ranges, sockets).
  for (const k of ['strModFireDamageRange', 'strModFireDamage', 'strModColdDamageRange', 'strModColdDamage',
    'strModLightningDamageRange', 'strModLightningDamage', 'strModPoisonDamage', 'strModPoisonDamageRange',
    'strModMagicDamageRange', 'strModMagicDamage', 'strModMinDamageRange', 'strModMinDamage', 'strModEnhancedDamage',
    'Socketable', 'ModStre9s', 'ModStre9u', 'strethereal']) S.keep(k);

  model.strings = S.used;
  return model;
}
