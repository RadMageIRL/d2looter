// The drop engine. Pure functions over one profile's data (js/data/<profile>.js); no DOM.
// Every rule here follows blizzhackers/d2data item-drop-spec.md ("Diablo II (1.14d): monster item
// drops"); section numbers in comments refer to it. D2R profiles reuse the same rules with their
// own tables, which is an assumption listed on the Accuracy page.
//
// Probabilities are exact for the modeled rules: a kill is resolved as a Markov chain over
// (items created so far 0..6, target seen yet), so the six-item cap is honored instead of
// approximated. Each treasure class becomes an operator (14 x 14 transition matrix plus a vector
// of expected target drops) and nested classes compose.
(function (root) {
  'use strict';

  var N = 14; // 7 counts x 2 (target seen or not)
  var DIFF_NAMES = ['Normal', 'Nightmare', 'Hell'];

  // ---- operator algebra ----
  function opIdentity() {
    var M = new Float64Array(N * N);
    for (var s = 0; s < N; s++) M[s * N + s] = 1;
    return { M: M, e: new Float64Array(N) };
  }
  var IDENTITY = opIdentity();

  // One item is created; h is the chance that it is the target.
  function opLeaf(h) {
    var M = new Float64Array(N * N), e = new Float64Array(N);
    for (var c = 0; c < 6; c++) {
      var s0 = c * 2, s1 = c * 2 + 1, n0 = (c + 1) * 2, n1 = (c + 1) * 2 + 1;
      M[s0 * N + n0] = 1 - h; M[s0 * N + n1] = h; e[s0] = h;
      M[s1 * N + n1] = 1; e[s1] = h;
    }
    M[12 * N + 12] = 1; M[13 * N + 13] = 1; // the cap: nothing more happens after six items
    return { M: M, e: e };
  }

  // A then B, for row-vector states (p' = p A B).
  function compose(A, B) {
    var M = new Float64Array(N * N), e = new Float64Array(N);
    for (var i = 0; i < N; i++) {
      var ei = A.e[i];
      for (var k = 0; k < N; k++) {
        var a = A.M[i * N + k];
        if (a === 0) continue;
        ei += a * B.e[k];
        for (var j = 0; j < N; j++) M[i * N + j] += a * B.M[k * N + j];
      }
      e[i] = ei;
    }
    return { M: M, e: e };
  }

  function power(op, k) {
    var out = IDENTITY;
    for (var i = 0; i < k; i++) out = i === 0 ? op : compose(out, op);
    return out;
  }

  // Weighted mixture: sum of w_i * op_i (weights already divided by the total).
  function mix(parts) {
    var M = new Float64Array(N * N), e = new Float64Array(N);
    for (var p = 0; p < parts.length; p++) {
      var w = parts[p][0], op = parts[p][1];
      if (w === 0) continue;
      for (var i = 0; i < N * N; i++) M[i] += w * op.M[i];
      for (var j = 0; j < N; j++) e[j] += w * op.e[j];
    }
    return { M: M, e: e };
  }

  // ---- 8.4: NoDrop scaled by player count, in double precision, in the game's order ----
  function playerFactor(players, party) {
    var P = Math.max(1, Math.min(8, players | 0));
    var p = Math.max(1, Math.min(P, party | 0));
    return p + Math.trunc((P - p) / 2);
  }

  function adjustedNoDrop(noDrop, total, n) {
    if (n <= 1 || noDrop === 0) return noDrop;
    var rho = noDrop / (noDrop + total);
    var pi = rho;
    for (var i = 1; i < n; i++) pi *= rho;
    var q = 1 - pi;
    if (q === 0) return 0;
    return Math.trunc(((1 - q) * total) / q);
  }

  // ---- 9.2: Magic Find with diminishing returns ----
  function effectiveMF(mf, factor) {
    if (factor === 0) return mf; // magic: no diminishing returns
    return mf > 10 ? Math.trunc((mf * factor) / (mf + factor)) : mf;
  }
  var MF_FACTOR = { unique: 250, set: 500, rare: 600, magic: 0 };

  // ---- 9.3: chance of one quality tier ----
  function tierChance(ratio, delta, mf, factor, mod) {
    var base = ratio[0] - Math.trunc(delta / ratio[1]);
    var E = 100 + effectiveMF(mf, factor);
    var chance = Math.trunc((12800 * base) / E);
    if (chance < ratio[2]) chance = ratio[2];
    chance = chance - Math.trunc((chance * mod) / 1024);
    if (chance < 1) return 1;
    return Math.min(1, 128 / chance);
  }

  // Conditions in D2R treasure classes and uniques. Only the strings that occur in the pinned
  // tables are known; an unknown string is a build error (tests/run.mjs checks every table).
  var CONDITIONS = {
    "(stat('heraldtier'.accr) >4)": function (c) { return c.herald > 4; },
    "(stat('heraldtier'.accr) >=4)": function (c) { return c.herald >= 4; },
    "(stat('heraldtier'.accr)>1) * (stat('heraldtier'.accr) < 4)": function (c) { return c.herald > 1 && c.herald < 4; },
    "(stat('heraldtier'.accr)>2)*(stat('heraldtier'.accr) <5)": function (c) { return c.herald > 2 && c.herald < 5; },
    "cond('Difficulty', hell)*(cond('Desecrated')==0)": function (c) { return c.difficulty === 2 && !c.desecrated; },
    "cond('Difficulty', hell)*cond('Desecrated')": function (c) { return c.difficulty === 2 && c.desecrated; },
    "cond('Difficulty', hell)": function (c) { return c.difficulty === 2; },
    "cond('Difficulty', nightmare)": function (c) { return c.difficulty === 1; },
    "cond('Difficulty', normal)": function (c) { return c.difficulty === 0; },
    "cond('MonsterTestElite', herald)*(stat('heraldtier'.accr) >3)": function (c) { return c.herald > 3; },
    "cond('MonsterTestElite', herald)": function (c) { return c.herald > 0; },
    "cond('Desecrated')": function (c) { return !!c.desecrated; },
    "cond('Desecrated')==0": function (c) { return !c.desecrated; },
  };
  function normCond(s) { return String(s).replace(/^"|"$/g, '').trim(); }
  function knownCondition(s) { return Object.prototype.hasOwnProperty.call(CONDITIONS, normCond(s)); }
  function testCondition(s, ctx) {
    var f = CONDITIONS[normCond(s)];
    if (!f) throw new Error('unknown condition: ' + s);
    return f(ctx);
  }

  // D2R ladder windows: [first, last] seasons a row is ladder-only (last 0 = still is).
  // 1.14d marks realm ladder-only rows with `true`.
  function ladderOnly(window, season) {
    if (!window) return false;
    if (window === true) return true;
    if (season == null) return false;
    return season >= window[0] && (window[1] === 0 || season <= window[1]);
  }

  // options.throwingPotionsInAllClasses reproduces the older reading (Silospen DropCalc, d2data's
  // 2021 tables) that puts throwing potions in the weapon classes. It exists for the tests that
  // compare against Silospen; the app always follows the spec (A.2), which leaves them out.
  function create(data, options) {
    options = options || {};
    var types = new Map(), items = new Map(), uniquesByKey = new Map(), setByKey = new Map();
    data.itemTypes.forEach(function (t) { types.set(t.code, t); });
    data.items.forEach(function (it) { items.set(it.code, it); });
    data.uniques.forEach(function (u) { if (!uniquesByKey.has(u.key)) uniquesByKey.set(u.key, u); });
    data.setItems.forEach(function (s) { if (!setByKey.has(s.key)) setByKey.set(s.key, s); });
    var uniquesByCode = groupBy(data.uniques, 'code'), setsByCode = groupBy(data.setItems, 'code');
    var levelsById = new Map();
    data.levels.forEach(function (l) { levelsById.set(l.id, l); });

    // "Is of type X" through Equiv1/Equiv2.
    var ancestry = new Map();
    function typeAncestors(code) {
      if (ancestry.has(code)) return ancestry.get(code);
      var out = new Set(), stack = [code];
      while (stack.length) {
        var c = stack.pop();
        if (!c || out.has(c)) continue;
        out.add(c);
        var t = types.get(c);
        if (t) t.equiv.forEach(function (x) { stack.push(x); });
      }
      ancestry.set(code, out);
      return out;
    }
    function itemIsType(item, code) {
      return typeAncestors(item.type).has(code) || (item.type2 ? typeAncestors(item.type2).has(code) : false);
    }

    // ---- Appendix A: the treasure class table ----
    var tcs = [{ name: '', picks: 1, nodrop: 0, q: [0, 0, 0, 0], group: 0, level: 0, entries: [], empty: true }];
    data.itemTypes.forEach(function (t) {
      if (!t.tc) return;
      for (var L = 3; L <= 96; L += 3) {
        var entries = [];
        data.items.forEach(function (it) {
          if (!it.spawnable || it.quest) return;
          if (it.level <= L - 3 || it.level > L) return;
          if (!itemIsType(it, t.code)) return;
          if (t.code !== 'tpot' && itemIsType(it, 'tpot') && !options.throwingPotionsInAllClasses) return;
          var own = types.get(it.type);
          entries.push({ kind: 'item', code: it.code, prob: Math.max(1, own ? own.rarity : 1) });
        });
        tcs.push({ name: t.code + L, picks: 1, nodrop: 0, q: [0, 0, 0, 0], group: 0, level: 0, auto: true, entries: entries });
      }
    });
    var autoCount = tcs.length - 1;
    var byName = new Map();
    tcs.forEach(function (tc, i) { if (i && !byName.has(tc.name.toLowerCase())) byName.set(tc.name.toLowerCase(), i); });
    var firstRow = tcs.length;
    data.tcs.forEach(function (row) {
      var idx = tcs.length;
      var lower = row.name.toLowerCase();
      if (!byName.has(lower)) byName.set(lower, idx);
      tcs.push({ name: row.name, picks: row.picks, nodrop: row.nodrop, q: row.q, group: row.group, level: row.level, cond: row.cond, ladder: row.ladder, raw: row.entries, entries: null });
    });
    // A.3: item code, then an earlier class, then a unique name, then a set item name.
    for (var i = firstRow; i < tcs.length; i++) {
      var tc = tcs[i];
      tc.entries = [];
      tc.raw.forEach(function (pair) {
        var token = String(pair[0]).replace(/^"|"$/g, '').split(',')[0];
        var prob = pair[1] < 1 ? 0 : pair[1];
        var e = null;
        if (token.length <= 4 && items.has(token)) e = { kind: 'item', code: token };
        else {
          var ref = byName.get(token.toLowerCase());
          if (ref !== undefined && ref <= i) e = { kind: 'tc', idx: ref };
          else if (uniquesByKey.has(token) && data.uniques[0].key !== token) e = { kind: 'unique', key: token, code: uniquesByKey.get(token).code };
          else if (setByKey.has(token)) e = { kind: 'set', key: token, code: setByKey.get(token).code };
        }
        if (e && prob > 0) { e.prob = prob; tc.entries.push(e); }
        else if (!e) tc.unresolved = (tc.unresolved || []).concat(token);
      });
    }

    function tcIndex(name) { var i = byName.get(String(name || '').toLowerCase()); return i === undefined ? 0 : i; }

    // ---- reachability, for pruning subtrees that cannot produce the target ----
    var reachMemo = new Map();
    function reach(idx) {
      if (reachMemo.has(idx)) return reachMemo.get(idx);
      var out = new Set();
      reachMemo.set(idx, out);
      tcs[idx].entries.forEach(function (e) {
        if (e.kind === 'tc') reach(e.idx).forEach(function (c) { out.add(c); });
        else out.add(e.code);
      });
      return out;
    }

    // ---- 9.1: which ItemRatio row ----
    var ratioMemo = new Map();
    function ratioRow(item) {
      if (ratioMemo.has(item.code)) return ratioMemo.get(item.code);
      var ty = types.get(item.type);
      var cls = ty && ty.cls ? 1 : 0;
      var uber = (item.kind === 'weapon' || item.kind === 'armor') && (item.code === item.uber || item.code === item.ultra) && !item.quest && item.type !== 'tpot' ? 1 : 0;
      var best = null;
      data.ratios.forEach(function (r) {
        if (r.cls !== cls || r.uber !== uber || r.version > 100) return;
        if (!best || r.version >= best.version) best = r;
      });
      ratioMemo.set(item.code, best);
      return best;
    }

    // The quality roll for one item at item level ilvl: chance of each outcome, before fallbacks.
    // Returns { unique, set, rare, magic } as the chance that roll is the first to succeed.
    function qualityRoll(item, ilvl, mods, mf) {
      var ty = types.get(item.type) || {};
      if (ty.normal) return { unique: 0, set: 0, rare: 0, magic: 0, forced: 'normal' };
      if (item.uniqueOnly) return { unique: 1, set: 0, rare: 0, magic: 0, forced: 'unique' };
      if (ty.magic && item.quest) return { unique: 1, set: 0, rare: 0, magic: 0, forced: 'unique' };
      if (mf <= -100) return { unique: 0, set: 0, rare: 0, magic: 0 };
      var row = ratioRow(item);
      var delta = ilvl - item.level;
      var pu = tierChance(row.unique, delta, mf, MF_FACTOR.unique, mods[0]);
      var ps = tierChance(row.set, delta, mf, MF_FACTOR.set, mods[1]);
      var pr = ty.rare ? tierChance(row.rare, delta, mf, MF_FACTOR.rare, mods[2]) : 0;
      var left = (1 - pu) * (1 - ps) * (1 - pr);
      var pm = ty.magic ? 1 : tierChance(row.magic, delta, mf, MF_FACTOR.magic, mods[3]);
      return { unique: pu, set: (1 - pu) * ps, rare: (1 - pu) * (1 - ps) * pr, magic: left * pm };
    }

    // ---- 11.3 / 11.4: which unique or set item a successful roll becomes ----
    function uniqueCandidates(code, ilvl, ctx) {
      return (uniquesByCode.get(code) || []).filter(function (u) {
        if (!u.roll || u.lvl > ilvl) return false;
        if (!ctx.ladder && ladderOnly(u.ladder, data.ladderSeason)) return false;
        if (u.cond && !testCondition(u.cond, ctx)) return false;
        return true;
      });
    }
    function setCandidates(code, ilvl, ctx) {
      return (setsByCode.get(code) || []).filter(function (s) {
        if (!s.roll || s.lvl > ilvl) return false;
        if (!ctx.ladder && ladderOnly(s.ladder, data.ladderSeason)) return false;
        if (s.set === "Cow King's Leathers" && !ctx.cowKing) return false;
        return true;
      });
    }
    // Rows are told apart by id (see tools/lib/model.mjs); a target may give id or key.
    function share(list, id, weight) {
      var total = 0, mine = 0;
      list.forEach(function (x) { var w = weight(x); total += w; if ((x.id || x.key) === id) mine = w; });
      return total ? mine / total : 0;
    }
    var uw = function (u) { return Math.max(u.rarity, 1); };
    var sw = function (s) { return s.rarity || 1; };

    // Chance that one item entry turns into the target.
    function hitChance(entry, mods, run) {
      var t = run.target;
      var tid = t.id || t.key;
      if (entry.code !== t.code) return 0;
      var item = items.get(entry.code);
      if (t.kind === 'base') return 1;
      if (t.kind === 'unique') {
        if (entry.kind === 'unique') {
          var named = uniquesByKey.get(entry.key);
          var namedOk = named.named && named.lvl <= run.ilvl && !(!run.ctx.ladder && ladderOnly(named.ladder, data.ladderSeason)) && !(named.cond && !testCondition(named.cond, run.ctx));
          if (namedOk) return (named.id || named.key) === tid ? 1 : 0;
          return share(uniqueCandidates(entry.code, run.ilvl, run.ctx), tid, uw);
        }
        if (entry.kind === 'set') return 0;
        var q = qualityRoll(item, run.ilvl, mods, run.mf);
        if (!q.unique) return 0;
        var cands = uniqueCandidates(entry.code, run.ilvl, run.ctx);
        return q.unique * share(cands, tid, uw);
      }
      if (t.kind === 'set') {
        if (entry.kind === 'set') {
          var s = setByKey.get(entry.key);
          var sOk = s.lvl <= run.ilvl && !(!run.ctx.ladder && ladderOnly(s.ladder, data.ladderSeason));
          if (sOk) return (s.id || s.key) === tid ? 1 : 0;
          return share(setCandidates(entry.code, run.ilvl, run.ctx), tid, sw);
        }
        if (entry.kind === 'unique') return 0;
        var q2 = qualityRoll(item, run.ilvl, mods, run.mf);
        if (!q2.set) return 0;
        return q2.set * share(setCandidates(entry.code, run.ilvl, run.ctx), tid, sw);
      }
      return 0;
    }

    // Is this class switched off by a D2R condition or a ladder window in this game?
    function disabled(tc, ctx) {
      if (tc.cond && !testCondition(tc.cond, ctx)) return true;
      if (tc.ladder && !ctx.ladder && ladderOnly(tc.ladder, data.ladderSeason)) return true;
      return false;
    }

    // The live entries of a class. A switched-off nested class gives back its weight, which is how
    // d2data's drop solver treats D2R conditions (an assumption, not confirmed in the game).
    function liveEntries(idx, ctx) {
      var tc = tcs[idx];
      if (disabled(tc, ctx)) return [];
      return tc.entries.filter(function (e) { return !(e.kind === 'tc' && disabled(tcs[e.idx], ctx)); });
    }

    // ---- 8.3 / 8.5: the operator of one class, fully resolved with all its picks ----
    function tcOp(idx, mods, run) {
      var tc = tcs[idx];
      var key = idx + '|' + mods.join(',');
      var targeted = run.target && reach(idx).has(run.target.code);
      var memo = targeted ? run.memo : run.countMemo;
      var mkey = targeted ? key : idx;
      if (memo.has(mkey)) return memo.get(mkey);
      var entries = liveEntries(idx, run.ctx);
      var total = 0;
      entries.forEach(function (e) { total += e.prob; });
      var op;
      if (total <= 0) {
        op = IDENTITY;
      } else {
        var childOps = entries.map(function (e) {
          if (e.kind === 'tc') {
            var child = tcs[e.idx];
            var cm = [Math.max(mods[0], child.q[0]), Math.max(mods[1], child.q[1]), Math.max(mods[2], child.q[2]), Math.max(mods[3], child.q[3])];
            return tcOp(e.idx, targeted ? cm : mods, run);
          }
          return opLeaf(targeted && run.target ? hitChance(e, mods, run) : 0);
        });
        if (tc.picks < 0) {
          // Sequential: the k-th pick takes position k on the weight line; NoDrop is ignored.
          var seq = [], want = -tc.picks;
          for (var i = 0; i < entries.length && seq.length < want; i++) {
            for (var w = 0; w < entries[i].prob && seq.length < want; w++) seq.push(childOps[i]);
          }
          op = seq.reduce(function (acc, x) { return acc ? compose(acc, x) : x; }, null) || IDENTITY;
        } else {
          var nd = tc.nodrop;
          nd = adjustedNoDrop(nd, total, run.n);
          if (nd < 0) nd = 0;
          var denom = total + nd;
          var parts = entries.map(function (e, j) { return [e.prob / denom, childOps[j]]; });
          if (nd > 0) parts.push([nd / denom, IDENTITY]);
          op = power(mix(parts), Math.max(1, tc.picks));
        }
      }
      memo.set(mkey, op);
      return op;
    }

    // ---- sources: what the player kills ----
    function monster(id) { return data.monsters[id] || null; }
    function superUnique(key) {
      for (var i = 0; i < data.superUniques.length; i++) if (data.superUniques[i].key === key) return data.superUniques[i];
      return null;
    }

    // 6.2: the monster's level, for an expansion game.
    function monsterLevel(src, d) {
      var cls = monster(src.cls);
      if (!cls) return null;
      var base;
      if (d === 0) base = cls.level[0];
      else if (cls.boss || cls.noRatio) base = cls.level[d];
      else {
        var area = levelsById.get(src.area);
        if (!area) return null;
        base = area.mlvl[d];
      }
      var bonus = { boss: 0, regular: 0, champion: 2, unique: 3, minion: 3, superunique: 3 }[src.type];
      return base + (bonus || 0);
    }

    // 5.1 / 5.2 / 7: the class the monster drops from, after the level upgrade.
    function sourceTc(src, d, quest) {
      var cls = monster(src.cls);
      if (!cls) return null;
      var name = '';
      if (quest && cls.questId && cls.tc.quest && cls.tc.quest[d]) name = cls.tc.quest[d];
      else if (src.type === 'superunique') {
        var su = superUnique(src.su);
        name = (su && su.tc[d]) || (cls.tc.unique ? cls.tc.unique[d] : '');
      } else {
        var col = { boss: 'reg', regular: 'reg', minion: 'reg', champion: 'champ', unique: 'unique' }[src.type];
        name = cls.tc[col] ? cls.tc[col][d] : '';
      }
      if (!name) return { base: '', idx: 0, upgraded: false };
      var idx = tcIndex(name);
      var start = idx;
      var mlvl = monsterLevel(src, d);
      if (d >= 1 && !cls.boss && !cls.noRatio && tcs[idx].group) {
        while (idx + 1 < tcs.length && tcs[idx + 1].group === tcs[idx].group && tcs[idx + 1].level <= mlvl) idx++;
      }
      return { base: tcs[start].name, idx: idx, upgraded: idx !== start };
    }

    // The main question: chance that one kill of `src` drops at least one `target`.
    //   target: { kind: 'unique'|'set'|'base', key?, code }
    //   opts:   { difficulty, players, party, mf, quest, ladder }
    function dropChance(src, target, opts) {
      var d = opts.difficulty | 0;
      var tcInfo = sourceTc(src, d, !!opts.quest);
      var mlvl = monsterLevel(src, d);
      if (!tcInfo || mlvl == null) return null;
      var run = makeRun(target, opts, Math.max(mlvl, 1), src);
      var tc = tcs[tcInfo.idx];
      var op = tcInfo.idx ? tcOp(tcInfo.idx, tc.q.slice(), run) : IDENTITY;
      var p = 0;
      for (var c = 0; c <= 6; c++) p += op.M[0 * N + c * 2 + 1];
      return {
        chance: p,
        expected: op.e[0],
        mlvl: mlvl,
        ilvl: Math.max(mlvl, 1),
        tc: tc.name,
        baseTc: tcInfo.base,
        upgraded: tcInfo.upgraded,
        playerFactor: run.n,
        noDrop: tc.nodrop,
        noDropAdjusted: tc.picks > 0 ? adjustedNoDrop(tc.nodrop, liveEntries(tcInfo.idx, run.ctx).reduce(function (a, e) { return a + e.prob; }, 0), run.n) : 0,
        picks: tc.picks,
      };
    }

    // The same question starting from a named class at a given item level (no monster).
    function tcChance(name, target, opts) {
      opts = opts || {};
      var idx = tcIndex(name);
      var run = makeRun(target, opts, Math.max(opts.ilvl | 0, 1), null);
      if (opts.n) run.n = opts.n;
      var op = idx ? tcOp(idx, tcs[idx].q.slice(), run) : IDENTITY;
      var p = 0;
      for (var c = 0; c <= 6; c++) p += op.M[c * 2 + 1];
      var dist = [];
      for (var k = 0; k <= 6; k++) dist.push(op.M[k * 2] + op.M[k * 2 + 1]);
      return { chance: p, expected: op.e[0], itemCount: dist };
    }

    function makeRun(target, opts, ilvl, src) {
      return {
        target: target,
        ilvl: ilvl,
        mf: opts.mf | 0,
        n: playerFactor(opts.players || 1, opts.party || 1),
        ctx: { difficulty: opts.difficulty | 0, desecrated: false, herald: 0, ladder: !!opts.ladder, cowKing: src && src.cls === 'hellbovine' },
        memo: new Map(),
        countMemo: new Map(),
      };
    }

    // Chance per pick of each atomic outcome of a class with no quality applied (used by tests
    // against reference calculators and by the item view's "treasure class" line).
    function tcDistribution(name, opts) {
      opts = opts || {};
      var idx = tcIndex(name);
      var n = playerFactor(opts.players || 1, opts.party || 1);
      var ctx = { difficulty: opts.difficulty | 0, desecrated: false, herald: 0, ladder: !!opts.ladder };
      var out = new Map();
      (function walk(i, weight) {
        var tc = tcs[i];
        var entries = liveEntries(i, ctx);
        var total = 0;
        entries.forEach(function (e) { total += e.prob; });
        if (!total) return;
        var nd = tc.picks > 0 ? Math.max(0, adjustedNoDrop(tc.nodrop, total, n)) : 0;
        entries.forEach(function (e) {
          var w = weight * e.prob / (total + nd);
          if (e.kind === 'tc' && !tcs[e.idx].auto) walk(e.idx, w);
          else {
            var k = e.kind === 'tc' ? tcs[e.idx].name : (e.kind === 'item' ? e.code : e.key);
            out.set(k, (out.get(k) || 0) + w);
          }
        });
      })(idx, 1);
      return out;
    }

    // Where an item is named directly: the classes that list it, and the top-level classes (those
    // no other class lists) they are reached from. Used to explain items that never roll at random.
    var parentsMemo = null;
    function namedBy(kind, key) {
      var out = [];
      tcs.forEach(function (t) { if (t.entries.some(function (e) { return e.kind === kind && e.key === key; })) out.push(t.name); });
      return out;
    }
    function topClasses(names) {
      if (!parentsMemo) {
        parentsMemo = new Map();
        tcs.forEach(function (t, i) { t.entries.forEach(function (e) { if (e.kind === 'tc') { if (!parentsMemo.has(e.idx)) parentsMemo.set(e.idx, []); parentsMemo.get(e.idx).push(i); } }); });
      }
      var seen = new Set(), tops = [];
      var stack = names.map(tcIndex);
      while (stack.length) {
        var i = stack.pop();
        if (seen.has(i)) continue;
        seen.add(i);
        var ps = parentsMemo.get(i) || [];
        if (!ps.length) tops.push(tcs[i].name);
        ps.forEach(function (p) { stack.push(p); });
      }
      return tops;
    }

    function groupBy(list, key) {
      var m = new Map();
      list.forEach(function (x) { var k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      return m;
    }

    return {
      data: data,
      tcs: tcs,
      autoCount: autoCount,
      tcIndex: tcIndex,
      tcByName: function (name) { return tcs[tcIndex(name)]; },
      itemIsType: itemIsType,
      typeAncestors: typeAncestors,
      item: function (code) { return items.get(code) || null; },
      type: function (code) { return types.get(code) || null; },
      ratioRow: ratioRow,
      qualityRoll: qualityRoll,
      uniqueCandidates: uniqueCandidates,
      setCandidates: setCandidates,
      monster: monster,
      superUnique: superUnique,
      level: function (id) { return levelsById.get(id) || null; },
      monsterLevel: monsterLevel,
      sourceTc: sourceTc,
      dropChance: dropChance,
      tcChance: tcChance,
      tcDistribution: tcDistribution,
      reach: function (name) { return reach(tcIndex(name)); },
      namedBy: namedBy,
      topClasses: topClasses,
    };
  }

  var api = {
    create: create,
    playerFactor: playerFactor,
    adjustedNoDrop: adjustedNoDrop,
    effectiveMF: effectiveMF,
    tierChance: tierChance,
    ladderOnly: ladderOnly,
    knownCondition: knownCondition,
    MF_FACTOR: MF_FACTOR,
    DIFF_NAMES: DIFF_NAMES,
    _ops: { opLeaf: opLeaf, compose: compose, mix: mix, power: power, IDENTITY: IDENTITY },
  };
  root.D2Engine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
