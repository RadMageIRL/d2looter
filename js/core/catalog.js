// The searchable item list for one profile: uniques, set items, runes, base items and runewords,
// with the facts the item view and the Grail need. Pure functions; no DOM.
(function (root) {
  'use strict';

  var CATEGORY_ORDER = ['weapon', 'armor', 'jewelry', 'charm', 'jewel', 'rune', 'misc'];
  var CATEGORY_NAMES = { weapon: 'Weapons', armor: 'Armor', jewelry: 'Rings & Amulets', charm: 'Charms', jewel: 'Jewels', rune: 'Runes', misc: 'Other' };

  function build(data, eng, props) {
    var types = new Map(data.itemTypes.map(function (t) { return [t.code, t]; }));
    var setNames = new Map(data.sets.map(function (s) { return [s.key, s.name]; }));
    var season = data.ladderSeason;

    function category(item) {
      if (!item) return 'misc';
      if (eng.itemIsType(item, 'rune')) return 'rune';
      if (eng.itemIsType(item, 'ring') || eng.itemIsType(item, 'amul')) return 'jewelry';
      if (eng.itemIsType(item, 'char')) return 'charm';
      if (eng.itemIsType(item, 'jewl')) return 'jewel';
      if (eng.itemIsType(item, 'weap')) return 'weapon';
      if (eng.itemIsType(item, 'armo')) return 'armor';
      return 'misc';
    }
    function tier(item) {
      if (!item || (item.kind !== 'weapon' && item.kind !== 'armor')) return '';
      if (item.code === item.ultra) return 'elite';
      if (item.code === item.uber) return 'exceptional';
      return 'normal';
    }
    function ladderText(w) {
      if (!w) return '';
      if (w === true) return 'Ladder only on Battle.net realms';
      if (D2Engine.ladderOnly(w, season)) return w[1] ? 'Ladder only in Season ' + (w[0] === w[1] ? w[0] : w[0] + '-' + w[1]) : 'Ladder only since Season ' + w[0];
      return 'Was ladder only in Season ' + (w[0] === w[1] || !w[1] ? w[0] : w[0] + '-' + w[1]);
    }
    function band(item) { return item ? Math.ceil(item.level / 3) * 3 : 0; }
    function typeName(item) { var t = item && types.get(item.type); return t ? t.name : ''; }

    // Rows a treasure class names directly (sunder charms, the Cow King's set...).
    var namedInTc = new Set();
    eng.tcs.forEach(function (t) { t.entries.forEach(function (e) { if (e.kind === 'unique' || e.kind === 'set') namedInTc.add(e.kind + ':' + e.key); }); });
    var out = [];
    data.uniques.forEach(function (u, i) {
      var base = eng.item(u.code);
      if (!base || base.quest) return;
      // Kept: rows that roll at random, and the first row of a name a treasure class names.
      var firstOfKey = u.id === u.key;
      if (!u.roll && !(u.named && firstOfKey && namedInTc.has('unique:' + u.key))) return;
      out.push({
        id: 'u:' + u.id, kind: 'unique', key: u.id, name: u.name, code: u.code,
        base: base, baseName: base.name, typeName: typeName(base), category: category(base), tier: tier(base),
        lvl: u.lvl, reqLevel: Math.max(u.reqLevel, base.reqLevel || 0), rarity: u.rarity,
        random: !!u.roll, ladder: u.ladder || null, ladderText: ladderText(u.ladder), cond: u.cond || '',
        props: u.props, band: band(base),
      });
    });
    data.setItems.forEach(function (s) {
      var base = eng.item(s.code);
      if (!base) return;
      out.push({
        id: 's:' + s.id, kind: 'set', key: s.id, name: s.name, code: s.code, set: s.set, setName: setNames.get(s.set) || s.set,
        base: base, baseName: base.name, typeName: typeName(base), category: category(base), tier: tier(base),
        lvl: s.lvl, reqLevel: Math.max(s.reqLevel, base.reqLevel || 0), rarity: s.rarity,
        random: !!s.roll, ladder: s.ladder || null, ladderText: ladderText(s.ladder),
        props: s.props, partial: s.partial, band: band(base),
      });
    });
    data.items.forEach(function (it) {
      if (it.quest || !it.spawnable) return;
      var cat = category(it);
      out.push({
        id: (cat === 'rune' ? 'r:' : 'b:') + it.code, kind: cat === 'rune' ? 'rune' : 'base', key: it.code, name: it.name, code: it.code,
        base: it, baseName: it.name, typeName: typeName(it), category: cat, tier: tier(it),
        lvl: it.level, reqLevel: it.reqLevel || 0, random: true, props: [], band: band(it),
      });
    });
    out.forEach(function (x) {
      x.lines = props && x.props.length ? props.describe(x.props).lines : [];
      x.search = [x.name, x.baseName, x.typeName, x.setName || '', x.code].join(' ').toLowerCase();
      x.searchProps = x.lines.join(' ').toLowerCase();
    });
    return out;
  }

  // Runes in rune order (El first) with their runewords.
  function runes(data, eng) {
    return data.items.filter(function (it) { return eng.itemIsType(it, 'rune') && /^r\d\d$/.test(it.code); })
      .sort(function (a, b) { return a.code < b.code ? -1 : 1; })
      .map(function (it, i) { return { order: i + 1, code: it.code, name: it.name.replace(/ Rune$/, ''), fullName: it.name, lvl: it.level, reqLevel: it.reqLevel }; });
  }

  function runewords(data, eng, props) {
    var names = new Map(runes(data, eng).map(function (r) { return [r.code, r.name]; }));
    var types = new Map(data.itemTypes.map(function (t) { return [t.code, t.name]; }));
    var season = data.ladderSeason;
    return data.runewords.map(function (rw) {
      var ladder = rw.ladder || null;
      var status = '';
      if (ladder === true) status = 'Ladder only on Battle.net realms';
      else if (ladder) status = D2Engine.ladderOnly(ladder, season) ? 'Ladder only (Season ' + ladder[0] + (ladder[1] ? '-' + ladder[1] : '+') + ')' : 'Ladder only in Season ' + ladder[0] + (ladder[1] && ladder[1] !== ladder[0] ? '-' + ladder[1] : '') + ', open to all since';
      return {
        key: rw.key, name: rw.name, label: rw.label || '',
        runes: rw.runes, runeNames: rw.runes.map(function (c) { return names.get(c) || c; }),
        sockets: rw.runes.length,
        types: rw.itypes.map(function (t) { return types.get(t) || t; }),
        excluded: rw.etypes.map(function (t) { return types.get(t) || t; }),
        ladder: ladder, ladderOnlyNow: ladder === true ? true : D2Engine.ladderOnly(ladder, season), status: status,
        lines: props ? props.describe(rw.props).lines : [],
        reqLevel: Math.max.apply(null, rw.runes.map(function (c) { var it = eng.item(c); return it ? it.reqLevel : 0; }).concat([0])),
      };
    });
  }

  // q: free text; kind: 'all' | 'unique' | 'set' | 'rune' | 'base'; category; tier; withProps
  function filter(list, f) {
    f = f || {};
    var words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(function (x) {
      if (f.kind && f.kind !== 'all' && x.kind !== f.kind) return false;
      if (f.category && f.category !== 'all' && x.category !== f.category) return false;
      if (f.tier && f.tier !== 'all' && x.tier !== f.tier) return false;
      if (!words.length) return true;
      var hay = f.withProps ? x.search + ' ' + x.searchProps : x.search;
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  // Grail entries: every unique and set item that exists in this ruleset.
  function grailList(list) {
    return list.filter(function (x) { return x.kind === 'unique' || x.kind === 'set'; })
      .map(function (x) { return { id: x.id, group: x.kind === 'set' ? 'set' : x.category, item: x }; });
  }

  var api = { build: build, runes: runes, runewords: runewords, filter: filter, grailList: grailList, CATEGORY_ORDER: CATEGORY_ORDER, CATEGORY_NAMES: CATEGORY_NAMES };
  root.D2Catalog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
