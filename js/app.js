// D2Looter UI. Plain DOM, no framework; all calculation lives in js/core/*.js.
(function () {
  'use strict';

  var Store = window.D2Store, Prob = window.D2Prob, Engine = window.D2Engine, Props = window.D2Props;
  var Catalog = window.D2Catalog, Sources = window.D2Sources, Grail = window.D2Grail;
  var PROFILES = window.D2LOOTER_PROFILES;
  var DIFFS = ['Normal', 'Nightmare', 'Hell'];
  var THEMES = ['system', 'light', 'dark', 'unique'];
  var THEME_NAMES = { system: 'System', light: 'Light', dark: 'Dark', unique: 'Unique' };
  var PAGE = 60;
  // Matches the ?v= on every asset in index.html (tests/run.mjs checks), so a release reaches
  // browsers and hosts that cache files for a while.
  var VERSION = '0.1.0';

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmtInt(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-'; }
  function qClass(x) { return x.kind === 'unique' ? 'q-unique' : x.kind === 'set' ? 'q-set' : x.kind === 'rune' ? 'q-rune' : 'q-base'; }
  function kindLabel(x) { return { unique: 'Unique', set: 'Set item', rune: 'Rune', base: 'Base item' }[x.kind]; }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function option(value, label, selected) { return h('option', { value: value, selected: selected }, label); }
  function triesText(n) { return n === Infinity ? 'never' : fmtInt(n); }

  // ---------------------------------------------------------------------------------------------
  // settings
  // ---------------------------------------------------------------------------------------------
  var DEFAULTS = {
    profile: 'd2r-base',
    theme: 'system',
    items: { q: '', kind: 'all', category: 'all', tier: 'all', withProps: false },
    calc: { item: 'u:The Stone of Jordan', mode: 'fixed', fixed: 'b:baalcrab', area: 0, monster: '', type: 'regular', difficulty: 2, mf: 0, players: 1, party: 1, ladder: false, realm: 'open', runs: 100 },
    sim: { odds: '1:1500', runs: 1000 },
    grail: { q: '', show: 'all', category: 'all' },
    mf: { mf: 300, item: 'b:uap', ilvl: 85 },
    runes: { q: '', sockets: 'all', makeable: false, hideLadder: false },
  };
  function loadSettings() {
    var raw = Store.read('settings', {});
    var s = JSON.parse(JSON.stringify(DEFAULTS));
    if (raw && typeof raw === 'object') {
      Object.keys(s).forEach(function (k) {
        if (raw[k] === undefined) return;
        if (typeof s[k] === 'object') { if (raw[k] && typeof raw[k] === 'object') Object.keys(s[k]).forEach(function (j) { if (typeof raw[k][j] === typeof s[k][j]) s[k][j] = raw[k][j]; }); }
        else if (typeof raw[k] === typeof s[k]) s[k] = raw[k];
      });
    }
    if (!PROFILES.some(function (p) { return p.id === s.profile; })) s.profile = DEFAULTS.profile;
    if (THEMES.indexOf(s.theme) < 0) s.theme = 'system';
    s.calc.players = clamp(s.calc.players, 1, 8); s.calc.party = clamp(s.calc.party, 1, s.calc.players);
    s.calc.difficulty = clamp(s.calc.difficulty, 0, 2);
    return s;
  }
  function clamp(v, lo, hi) { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo; }
  var settings = loadSettings();
  var saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { Store.write('settings', settings); }, 150); }

  // ---------------------------------------------------------------------------------------------
  // grail and owned runes
  // ---------------------------------------------------------------------------------------------
  var grailStatus = '';
  var grail = (function () {
    var r = Store.readRaw('grail');
    if (r.status === 'broken') { grailStatus = 'Your saved Grail could not be read, so it was set aside (kept in storage as d2looter:v1:grail.broken) and a new one started. Import a backup to restore it.'; return Grail.empty(); }
    if (r.status === 'unavailable') { grailStatus = 'This browser is not letting the page save data (private window or blocked site data). Changes last until the tab closes; use Export to keep them.'; return Grail.empty(); }
    if (r.status === 'missing') return Grail.empty();
    var c = Grail.check(r.value);
    if (c.problems.length) grailStatus = 'Some saved Grail entries were not valid and were skipped: ' + c.problems.slice(0, 3).join('; ') + '.';
    return c.state;
  })();
  function saveGrail() { if (!Store.write('grail', grail)) toast('Not saved: this browser blocks storage. Export to keep your Grail.'); }
  var owned = (function () {
    var o = Store.read('runes', {});
    var out = {};
    if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { if (/^r\d\d$/.test(k)) out[k] = clamp(o[k], 0, 999); });
    return out;
  })();
  function saveOwned() { Store.write('runes', owned); }

  // ---------------------------------------------------------------------------------------------
  // profile loading
  // ---------------------------------------------------------------------------------------------
  var P = null; // the loaded profile: { meta, data, eng, props, catalog, byId, sources, runes, runewords }
  function profileMeta(id) { return PROFILES.filter(function (p) { return p.id === id; })[0]; }
  function loadProfile(id, done) {
    var meta = profileMeta(id);
    var go = function () {
      var data = window.D2LOOTER_DATA[id];
      var eng = Engine.create(data);
      var props = Props.create(data);
      var catalog = Catalog.build(data, eng, props);
      var byId = new Map(catalog.map(function (x) { return [x.id, x]; }));
      P = { id: id, meta: meta, data: data, eng: eng, props: props, catalog: catalog, byId: byId, sources: Sources.create(data, eng), runes: Catalog.runes(data, eng), runewords: Catalog.runewords(data, eng, props), cache: new Map() };
      done();
    };
    if (window.D2LOOTER_DATA && window.D2LOOTER_DATA[id]) return go();
    var s = document.createElement('script');
    s.src = meta.file + '?v=' + VERSION;
    s.onload = go;
    s.onerror = function () { clear($('main')).appendChild(h('p', { class: 'unavailable' }, 'Could not load ' + meta.file + '.')); };
    document.body.appendChild(s);
  }

  function renderProfileSelect() {
    var sel = clear($('profile'));
    PROFILES.forEach(function (p) { sel.appendChild(option(p.id, p.label + (p.experimental ? ' (experimental)' : ''), p.id === settings.profile)); });
    sel.onchange = function () {
      settings.profile = sel.value; save();
      loadProfile(settings.profile, function () { route(); });
    };
  }
  function profileNote() {
    var box = clear($('profile-note'));
    if (P.meta.experimental) {
      box.appendChild(h('div', { class: 'banner warn' }, h('strong', null, 'Experimental ruleset. '),
        'Reign of the Warlock drop tables are read from the 3.3 game data and run through the same rules as the Lord of Destruction ruleset. ',
        'Desecrated (Terror) zones, Heralds and Sunder Charm drops are not calculated yet. ', h('a', { href: '#accuracy' }, 'What is verified')));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // theme
  // ---------------------------------------------------------------------------------------------
  function applyTheme() {
    var t = settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    var b = $('theme');
    b.textContent = 'Theme: ' + THEME_NAMES[t];
    b.setAttribute('aria-label', 'Color theme: ' + THEME_NAMES[t] + '. Activate to switch to the next theme.');
  }
  $('theme').addEventListener('click', function () {
    settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
    save(); applyTheme();
  });

  // ---------------------------------------------------------------------------------------------
  // routing
  // ---------------------------------------------------------------------------------------------
  function route() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    var view = hash.split('/')[0] || 'items';
    var arg = hash.indexOf('/') >= 0 ? hash.slice(hash.indexOf('/') + 1) : '';
    var views = { items: renderItems, item: renderItem, calc: renderCalc, sim: renderSim, grail: renderGrail, mf: renderMF, runes: renderRunes, accuracy: renderAccuracy };
    if (!views[view]) view = 'items';
    document.querySelectorAll('main > section').forEach(function (s) { s.hidden = s.dataset.view !== view; });
    document.querySelectorAll('.tabs a').forEach(function (a) {
      var on = a.dataset.view === view || (view === 'item' && a.dataset.view === 'items');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    profileNote();
    views[view]($('view-' + view), arg);
  }
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });

  // ---------------------------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------------------------
  var itemsShown = PAGE;
  function renderItems(root) {
    var f = settings.items;
    clear(root);
    root.appendChild(h('div', { class: 'view-head' },
      h('div', null, h('h2', null, 'Item search'), h('p', { class: 'muted' }, P.catalog.length.toLocaleString('en-US') + ' items in ' + P.meta.label + '. Select one for its properties and where it drops.'))));
    var q = h('input', { class: 'input search', type: 'search', placeholder: 'Search names, bases, types', value: f.q, 'aria-label': 'Search items', id: 'item-q' });
    var kinds = [['all', 'All'], ['unique', 'Uniques'], ['set', 'Sets'], ['rune', 'Runes'], ['base', 'Bases']];
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Item kind' }, kinds.map(function (k) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.kind === k[0]), onclick: function () { f.kind = k[0]; itemsShown = PAGE; save(); renderItems(root); } }, k[1]);
    }));
    var cat = h('select', { class: 'select', 'aria-label': 'Category', onchange: function () { f.category = cat.value; itemsShown = PAGE; save(); list(); } },
      option('all', 'All categories', f.category === 'all'), Catalog.CATEGORY_ORDER.map(function (c) { return option(c, Catalog.CATEGORY_NAMES[c], f.category === c); }));
    var tier = h('select', { class: 'select', 'aria-label': 'Tier', onchange: function () { f.tier = tier.value; itemsShown = PAGE; save(); list(); } },
      [['all', 'Any tier'], ['normal', 'Normal'], ['exceptional', 'Exceptional'], ['elite', 'Elite']].map(function (t) { return option(t[0], t[1], f.tier === t[0]); }));
    var wp = h('input', { type: 'checkbox', checked: f.withProps, onchange: function () { f.withProps = wp.checked; save(); list(); } });
    root.appendChild(h('div', { class: 'toolbar' }, q, chips, cat, tier, h('label', { class: 'check' }, wp, 'Search property text')));
    var out = h('div');
    root.appendChild(out);
    q.addEventListener('input', function () { f.q = q.value; itemsShown = PAGE; save(); list(); });
    function list() {
      clear(out);
      var res = Catalog.filter(P.catalog, f);
      out.appendChild(h('p', { class: 'muted small' }, res.length.toLocaleString('en-US') + ' found'));
      var cards = h('div', { class: 'cards' });
      res.slice(0, itemsShown).forEach(function (x) {
        var found = (x.kind === 'unique' || x.kind === 'set') && Grail.isFound(grail, x.id);
        cards.appendChild(h('a', { class: 'card', href: '#item/' + encodeURIComponent(x.id) },
          h('span', { class: 'name ' + qClass(x) }, x.name, x.ladder && Engine.ladderOnly(x.ladder, P.data.ladderSeason) ? h('span', { class: 'tag ladder' }, 'ladder') : null, found ? h('span', { class: 'tag found' }, 'found') : null),
          h('span', { class: 'meta' }, x.kind === 'unique' || x.kind === 'set' ? x.baseName + ' · ' + x.typeName : x.typeName + (x.tier ? ' · ' + x.tier : '')),
          h('span', { class: 'meta' }, (x.setName ? x.setName + ' · ' : '') + 'Required level ' + x.reqLevel + ' · Item level ' + x.lvl)));
      });
      out.appendChild(cards);
      if (res.length > itemsShown) out.appendChild(h('div', { class: 'more' }, h('button', { type: 'button', class: 'button', onclick: function () { itemsShown += PAGE * 2; list(); } }, 'Show more (' + (res.length - itemsShown).toLocaleString('en-US') + ' left)')));
      if (!res.length) out.appendChild(h('p', null, 'Nothing matches. Try fewer words, another category, or "Search property text".'));
    }
    list();
  }

  // ---------------------------------------------------------------------------------------------
  // One item
  // ---------------------------------------------------------------------------------------------
  function renderItem(root, id) {
    clear(root);
    var x = P.byId.get(id);
    if (!x) {
      root.appendChild(h('p', null, 'That item is not in ' + P.meta.label + '. ', h('a', { href: '#items' }, 'Back to the search')));
      return;
    }
    root.appendChild(h('p', null, h('a', { href: '#items' }, 'Back to the search')));
    var base = x.base;
    var tt = h('div', { class: 'tooltip' },
      h('div', { class: 'tt-name ' + qClass(x) }, x.name),
      x.kind === 'unique' || x.kind === 'set' ? h('div', { class: 'tt-base' }, x.baseName) : null);
    if (base.ac) tt.appendChild(h('div', { class: 'tt-req' }, 'Defense: ' + base.ac[0] + (base.ac[1] !== base.ac[0] ? '-' + base.ac[1] : '') + ' (base)'));
    if (base.dmg) tt.appendChild(h('div', { class: 'tt-req' }, (base.dmg2 ? 'One-hand damage: ' : 'Damage: ') + base.dmg[0] + ' to ' + base.dmg[1] + ' (base)'));
    if (base.dmg2) tt.appendChild(h('div', { class: 'tt-req' }, 'Two-hand damage: ' + base.dmg2[0] + ' to ' + base.dmg2[1] + ' (base)'));
    if (base.dmgThrow) tt.appendChild(h('div', { class: 'tt-req' }, 'Throw damage: ' + base.dmgThrow[0] + ' to ' + base.dmgThrow[1] + ' (base)'));
    if (base.dur) tt.appendChild(h('div', { class: 'tt-req' }, 'Durability: ' + base.dur));
    if (base.reqStr) tt.appendChild(h('div', { class: 'tt-req' }, 'Required Strength: ' + base.reqStr));
    if (base.reqDex) tt.appendChild(h('div', { class: 'tt-req' }, 'Required Dexterity: ' + base.reqDex));
    if (x.reqLevel) tt.appendChild(h('div', { class: 'tt-req' }, 'Required Level: ' + x.reqLevel));
    x.lines.forEach(function (l) { tt.appendChild(h('div', { class: 'tt-line' }, l)); });
    if (x.kind === 'set') {
      var partial = x.partial && x.partial.length ? P.props.describe(x.partial.map(function (p) { return p.slice(0, 4); })).lines : [];
      partial.forEach(function (l, i) { tt.appendChild(h('div', { class: 'tt-set' }, l + ' (' + x.partial[i][4] + ' items)')); });
      tt.appendChild(h('div', { class: 'tt-name q-unique', style: 'font-size:15px;margin-top:8px' }, x.setName));
      var members = P.catalog.filter(function (y) { return y.kind === 'set' && y.set === x.set; });
      members.forEach(function (m) { tt.appendChild(h('div', { class: 'tt-set' }, m.name)); });
    }
    if (x.ladderText) tt.appendChild(h('div', { class: 'tt-note' }, x.ladderText));
    if (!x.random && (x.kind === 'unique' || x.kind === 'set')) tt.appendChild(h('div', { class: 'tt-note' }, 'Never rolled at random: it only drops where a treasure class names it.'));
    if (x.cond) tt.appendChild(h('div', { class: 'tt-note' }, 'Drop condition in the game data: ' + x.cond));

    var facts = h('dl', { class: 'facts' });
    function fact(k, v) { facts.appendChild(h('dt', null, k)); facts.appendChild(h('dd', null, v)); }
    fact('Kind', kindLabel(x));
    fact('Type', x.typeName + (x.tier ? ' (' + x.tier + ')' : ''));
    if (x.kind === 'unique' || x.kind === 'set') {
      fact('Item level needed', 'The monster level must be at least ' + x.lvl + ' (the item row\'s level).');
      fact('Base quality level', String(base.level));
      var same = P.catalog.filter(function (y) { return y.kind === x.kind && y.code === x.code && y.random; });
      if (x.random && same.length > 1) fact('Shares its base with', same.filter(function (y) { return y.id !== x.id; }).map(function (y) { return y.name + ' (level ' + y.lvl + ', weight ' + Math.max(y.rarity, 1) + ')'; }).join(', ') + '. This one has weight ' + Math.max(x.rarity, 1) + '.');
    } else {
      fact('Quality level', String(base.level));
    }
    var autos = P.eng.tcs.filter(function (t) { return t.auto && t.entries.some(function (e) { return e.code === x.code; }); }).map(function (t) { return t.name; });
    if (autos.length) fact('Treasure class', 'The base is in ' + autos.join(', ') + ' (classes of ' + 'items with quality level ' + (x.band - 2) + '-' + x.band + ').');
    if (x.kind === 'rune') {
      var rws = P.runewords.filter(function (r) { return r.runes.indexOf(x.code) >= 0; });
      fact('Used in', rws.length ? rws.map(function (r) { return r.name; }).join(', ') : 'no runewords');
    }

    var side = h('div', null, h('div', { class: 'panel' }, h('h3', null, 'Facts'), facts));
    if (x.kind === 'unique' || x.kind === 'set') {
      var cb = h('input', { type: 'checkbox', checked: Grail.isFound(grail, x.id), onchange: function () { grail = Grail.setFound(grail, x.id, cb.checked, cb.checked ? new Date().toISOString().slice(0, 10) : ''); saveGrail(); } });
      side.appendChild(h('div', { class: 'panel' }, h('label', { class: 'check' }, cb, ' Found (Holy Grail)')));
    }
    side.appendChild(sourcesPanel(x));
    root.appendChild(h('div', { class: 'detail' }, tt, side));
  }

  // Best fixed sources for an item at the calculator's settings.
  function sourcesPanel(x) {
    var c = settings.calc;
    var panel = h('div', { class: 'panel' });
    var d = c.difficulty;
    var diffSel = h('select', { class: 'select', 'aria-label': 'Difficulty', onchange: function () { c.difficulty = Number(diffSel.value); save(); var p = sourcesPanel(x); panel.replaceWith(p); } }, DIFFS.map(function (n, i) { return option(i, n, i === d); }));
    panel.appendChild(h('div', { class: 'view-head' }, h('h3', { style: 'margin:0' }, 'Where it drops'), diffSel));
    panel.appendChild(h('p', { class: 'muted small' }, 'Chance per kill with your calculator settings: MF ' + c.mf + ', ' + c.players + ' player' + (c.players > 1 ? 's' : '') + ', party ' + c.party + ', ' + gameModeText() + '.'));
    var target = targetFor(x);
    var rows = P.sources.fixed(d).map(function (s) {
      var r = P.eng.dropChance(s.src, target, calcOpts(s.quest));
      return { s: s, r: r };
    }).filter(function (o) { return o.r && o.r.chance > 0; }).sort(function (a, b) { return b.r.chance - a.r.chance; });
    if (!rows.length) {
      var note = namedOnlyNote(x);
      panel.appendChild(h('p', null, note || 'No boss or superunique drops it on ' + DIFFS[d] + ' with these settings.'));
    }
    else panel.appendChild(sourceTable(rows.slice(0, 12), x));
    var areaOut = h('div');
    var btn = h('button', { type: 'button', class: 'button', onclick: function () { rankAreas(x, d, areaOut, btn); } }, 'Rank every area monster on ' + DIFFS[d]);
    panel.appendChild(h('div', { class: 'toolbar', style: 'margin-top:12px' }, btn));
    panel.appendChild(areaOut);
    return panel;
  }
  function sourceTable(rows, x) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', null, 'Monster'), h('th', null, 'Area'), h('th', { class: 'num' }, 'Level'), h('th', { class: 'num' }, 'Chance per kill'), h('th', { class: 'num' }, 'Kills for 50%'))),
      h('tbody', null, rows.map(function (o) {
        return h('tr', null,
          h('td', null, h('button', { type: 'button', class: 'link', onclick: function () { openInCalc(x, o.s); } }, o.s.name)),
          h('td', null, o.s.area || ''),
          h('td', { class: 'num' }, String(o.r.mlvl)),
          h('td', { class: 'num' }, Prob.oneIn(o.r.chance)),
          h('td', { class: 'num' }, triesText(Prob.triesFor(o.r.chance, 0.5))));
      }))));
  }
  function rankAreas(x, d, out, btn) {
    btn.disabled = true;
    var jobs = [];
    P.sources.areas(d).forEach(function (a) {
      ['regular', 'champion', 'unique'].forEach(function (type) {
        P.sources.areaMonsters(a.id, d, type).forEach(function (m) { jobs.push({ a: a, m: m, type: type }); });
      });
    });
    var target = targetFor(x), results = [], i = 0;
    clear(out).appendChild(h('p', { class: 'muted small' }, 'Working: 0 of ' + jobs.length));
    (function step() {
      var end = Math.min(jobs.length, i + 120);
      for (; i < end; i++) {
        var j = jobs[i];
        var r = P.eng.dropChance({ type: j.type, cls: j.m.id, area: j.a.id }, target, calcOpts(false));
        if (r && r.chance > 0) results.push({ s: { name: j.m.name + ' (' + j.type + ')', area: j.a.name, src: { type: j.type, cls: j.m.id, area: j.a.id }, quest: false, areaPick: true }, r: r });
      }
      if (i < jobs.length) { out.firstChild.textContent = 'Working: ' + i + ' of ' + jobs.length; setTimeout(step, 0); return; }
      results.sort(function (a, b) { return b.r.chance - a.r.chance; });
      clear(out);
      out.appendChild(h('p', { class: 'muted small' }, jobs.length.toLocaleString('en-US') + ' area monsters checked; ' + results.length.toLocaleString('en-US') + ' can drop it. Champions and uniques spawn less often than regular monsters, so a higher chance per kill is not a higher chance per run.'));
      if (results.length) out.appendChild(sourceTable(results.slice(0, 15), x));
      btn.disabled = false;
    })();
  }
  // For an item that is never rolled at random: where the game data names it, and whether those
  // places are ones D2Looter does not calculate yet (Desecrated zones, Heralds, Uber Ancients).
  function namedOnlyNote(x) {
    if (x.random || (x.kind !== 'unique' && x.kind !== 'set')) return null;
    var key = x.key.replace(/#\d+$/, '');
    var named = P.eng.namedBy(x.kind, key);
    if (!named.length) return 'It is never rolled at random, and no treasure class in this version names it.';
    var tops = P.eng.topClasses(named);
    var unsupported = tops.filter(function (t) { return /Desecrated|Herald|Uber (Talic|Madawc|Korlic)/.test(t); });
    var where = tops.slice(0, 3).join(', ') + (tops.length > 3 ? ' and ' + (tops.length - 3) + ' more' : '');
    return 'It is never rolled at random: only ' + named.join(', ') + ' names it, reached from ' + where + '. ' +
      (unsupported.length === tops.length ? 'Those are Desecrated (Terror) zone, Herald or Uber Ancient drops, which v0.1 does not calculate.' : 'Some of those are not monsters D2Looter lists yet.');
  }
  function targetFor(x) {
    if (x.kind === 'unique') return { kind: 'unique', id: x.key, code: x.code };
    if (x.kind === 'set') return { kind: 'set', id: x.key, code: x.code };
    return { kind: 'base', code: x.code };
  }
  function openInCalc(x, s) {
    var c = settings.calc;
    c.item = x.id;
    if (s.areaPick) { c.mode = 'area'; c.area = s.src.area; c.monster = s.src.cls; c.type = s.src.type; }
    else { c.mode = 'fixed'; c.fixed = s.id; }
    save();
    location.hash = '#calc';
  }

  // ---------------------------------------------------------------------------------------------
  // Drop calculator
  // ---------------------------------------------------------------------------------------------
  function gameModeText() {
    if (P.data.game === 'lod') return { open: 'single player or open Battle.net', realm: 'realm non-ladder', ladder: 'realm ladder' }[settings.calc.realm];
    return settings.calc.ladder ? 'ladder' : 'non-ladder';
  }
  // 1.14d ladder-only rows can drop outside realms and on realm ladder; D2R uses the ladder switch.
  function ladderAllowed() {
    if (P.data.game === 'lod') return settings.calc.realm !== 'realm';
    return settings.calc.ladder;
  }
  function calcOpts(quest) {
    var c = settings.calc;
    return { difficulty: c.difficulty, players: c.players, party: c.party, mf: c.mf, quest: !!quest, ladder: ladderAllowed() };
  }

  // A small search box with a result list (combobox) over the catalog.
  function itemPicker(currentId, onPick, filterFn) {
    var cur = P.byId.get(currentId);
    var wrap = h('div', { class: 'field wide', style: 'position:relative' });
    var listId = 'pick-' + Math.random().toString(36).slice(2);
    var input = h('input', { class: 'input', type: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list', placeholder: 'Type an item name: Shako, Ber, Tal Rasha...', value: cur ? labelFor(cur) : '' });
    var lb = h('div', { id: listId, role: 'listbox', class: 'panel', style: 'position:absolute;z-index:5;top:100%;left:0;right:0;max-height:320px;overflow:auto;padding:4px;margin-top:4px', hidden: true });
    var matches = [], active = 0;
    function labelFor(x) { return x.name + (x.kind === 'unique' || x.kind === 'set' ? ' (' + x.baseName + ')' : '') + (dupCount(x) > 1 ? ' #' + dupIndex(x) : ''); }
    function show() {
      var q = input.value.toLowerCase().trim();
      var words = q.split(/\s+/).filter(Boolean);
      matches = P.catalog.filter(function (x) { return (!filterFn || filterFn(x)) && words.every(function (w) { return x.search.indexOf(w) >= 0; }); });
      matches.sort(function (a, b) { var ka = a.kind === 'base' ? 1 : 0, kb = b.kind === 'base' ? 1 : 0; return ka - kb || (a.name.toLowerCase().indexOf(q) === 0 ? -1 : 0) - (b.name.toLowerCase().indexOf(q) === 0 ? -1 : 0); });
      matches = matches.slice(0, 14);
      clear(lb);
      matches.forEach(function (x, i) {
        lb.appendChild(h('div', { role: 'option', id: listId + '-' + i, 'aria-selected': String(i === active), class: qClass(x), style: 'padding:6px 8px;cursor:pointer;border-radius:6px;' + (i === active ? 'background:var(--panel-2)' : ''), onmousedown: function (ev) { ev.preventDefault(); pick(x); } },
          labelFor(x), h('span', { class: 'muted small' }, '  ' + kindLabel(x))));
      });
      lb.hidden = !matches.length;
      input.setAttribute('aria-expanded', String(!lb.hidden));
      if (matches.length) input.setAttribute('aria-activedescendant', listId + '-' + active); else input.removeAttribute('aria-activedescendant');
    }
    function pick(x) { input.value = labelFor(x); lb.hidden = true; input.setAttribute('aria-expanded', 'false'); onPick(x); }
    input.addEventListener('input', function () { active = 0; show(); });
    input.addEventListener('focus', function () { input.select(); });
    // Clicking back into the box after a pick selects the old name, so typing replaces it.
    input.addEventListener('click', function () { if (lb.hidden) input.select(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (lb.hidden) show(); else { active = Math.min(matches.length - 1, active + 1); show(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); show(); }
      else if (e.key === 'Enter') { if (!lb.hidden && matches[active]) { e.preventDefault(); pick(matches[active]); } }
      else if (e.key === 'Escape' && !lb.hidden) { e.preventDefault(); lb.hidden = true; input.setAttribute('aria-expanded', 'false'); } // a search box would also clear itself
    });
    input.addEventListener('blur', function () { setTimeout(function () { lb.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 120); });
    wrap.appendChild(h('label', null, 'Item'));
    wrap.appendChild(input);
    wrap.appendChild(lb);
    return wrap;
  }
  function dupCount(x) { return P.catalog.filter(function (y) { return y.kind === x.kind && y.name === x.name; }).length; }
  function dupIndex(x) { var list = P.catalog.filter(function (y) { return y.kind === x.kind && y.name === x.name; }); return list.indexOf(x) + 1; }

  function renderCalc(root) {
    var c = settings.calc;
    clear(root);
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Drop calculator'),
      h('p', { class: 'muted' }, 'The chance that one kill drops the item, from the game\'s own treasure classes for ' + P.meta.label + '.'))));
    var form = h('div', { class: 'form' });
    var panel = h('div', { class: 'panel' }, form);
    root.appendChild(panel);
    var result = h('div');
    root.appendChild(result);

    form.appendChild(itemPicker(c.item, function (x) { c.item = x.id; save(); compute(); }));

    var mode = h('select', { class: 'select', onchange: function () { c.mode = mode.value; save(); renderCalc(root); } }, option('fixed', 'Boss or superunique', c.mode === 'fixed'), option('area', 'Monster in an area', c.mode === 'area'));
    form.appendChild(field('Source', mode));
    var diff = h('select', { class: 'select', onchange: function () { c.difficulty = Number(diff.value); save(); renderCalc(root); } }, DIFFS.map(function (n, i) { return option(i, n, i === c.difficulty); }));
    form.appendChild(field('Difficulty', diff));

    if (c.mode === 'fixed') {
      var fixed = P.sources.fixed(c.difficulty);
      if (!fixed.some(function (s) { return s.id === c.fixed; })) c.fixed = fixed.length ? fixed[0].id : '';
      var groups = {};
      fixed.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
      var fsel = h('select', { class: 'select', onchange: function () { c.fixed = fsel.value; save(); compute(); } },
        Object.keys(groups).map(function (g) { return h('optgroup', { label: g }, groups[g].map(function (s) { return option(s.id, s.name + (s.area ? ' (' + s.area + ')' : ''), s.id === c.fixed); })); }));
      form.appendChild(field('Monster', fsel, true));
    } else {
      var areas = P.sources.areas(c.difficulty);
      if (!areas.some(function (a) { return a.id === c.area; })) c.area = areas.length ? areas[0].id : 0;
      var asel = h('select', { class: 'select', onchange: function () { c.area = Number(asel.value); save(); renderCalc(root); } },
        [0, 1, 2, 3, 4].map(function (act) {
          var list = areas.filter(function (a) { return a.act === act; });
          return list.length ? h('optgroup', { label: 'Act ' + (act + 1) }, list.map(function (a) { return option(a.id, a.name + ' (level ' + a.mlvl[c.difficulty] + ')', a.id === c.area); })) : null;
        }));
      form.appendChild(field('Area', asel));
      var tsel = h('select', { class: 'select', onchange: function () { c.type = tsel.value; save(); renderCalc(root); } },
        [['regular', 'Regular'], ['champion', 'Champion'], ['unique', 'Unique (random boss)'], ['minion', 'Minion of a unique']].map(function (t) { return option(t[0], t[1], c.type === t[0]); }));
      form.appendChild(field('Monster type', tsel));
      var mons = P.sources.areaMonsters(c.area, c.difficulty, c.type);
      if (!mons.some(function (m) { return m.id === c.monster; })) c.monster = mons.length ? mons[0].id : '';
      var msel = h('select', { class: 'select', onchange: function () { c.monster = msel.value; save(); compute(); } }, mons.map(function (m) { return option(m.id, m.name + ' (' + m.id + ')', m.id === c.monster); }));
      form.appendChild(field('Monster', msel));
    }

    var mf = h('input', { class: 'input num', type: 'number', min: -100, max: 9999, step: 1, value: c.mf, oninput: function () { c.mf = clamp(mf.value, -100, 9999); save(); compute(); } });
    form.appendChild(field('Magic Find %', mf));
    var pl = h('select', { class: 'select', onchange: function () { c.players = Number(pl.value); c.party = Math.min(c.party, c.players); save(); renderCalc(root); } }, [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return option(n, String(n), n === c.players); }));
    form.appendChild(field('Players in the game (or /players)', pl));
    var pa = h('select', { class: 'select', onchange: function () { c.party = Number(pa.value); save(); compute(); } }, range(1, c.players).map(function (n) { return option(n, n === 1 ? '1 (just you)' : String(n), n === c.party); }));
    form.appendChild(field('Party members in your area, you included', pa));
    if (P.data.game === 'lod') {
      var rs = h('select', { class: 'select', onchange: function () { c.realm = rs.value; save(); compute(); } },
        [['open', 'Single player or open Battle.net'], ['realm', 'Battle.net realm, non-ladder'], ['ladder', 'Battle.net realm, ladder']].map(function (o) { return option(o[0], o[1], c.realm === o[0]); }));
      form.appendChild(field('Game', rs));
    } else {
      var ld = h('select', { class: 'select', onchange: function () { c.ladder = ld.value === '1'; save(); compute(); } }, option('0', 'Non-ladder', !c.ladder), option('1', 'Ladder (Season ' + P.data.ladderSeason + ')', c.ladder));
      form.appendChild(field('Game', ld));
    }
    var runs = h('input', { class: 'input num', type: 'number', min: 1, max: 1e7, step: 1, value: c.runs, oninput: function () { c.runs = clamp(runs.value, 1, 1e7); save(); compute(); } });
    form.appendChild(field('Kills', runs));

    function compute() {
      clear(result);
      var x = P.byId.get(c.item);
      if (!x) { result.appendChild(h('div', { class: 'panel' }, h('p', null, 'Pick an item to see its chance.'))); return; }
      var s;
      if (c.mode === 'fixed') s = P.sources.fixed(c.difficulty).filter(function (f) { return f.id === c.fixed; })[0];
      else if (c.monster) s = { name: P.data.monsters[c.monster].name, area: P.sources.areaName(c.area), src: { type: c.type, cls: c.monster, area: c.area }, quest: false };
      if (!s) { result.appendChild(h('div', { class: 'panel' }, h('p', null, 'Pick a monster.'))); return; }
      var r = P.eng.dropChance(s.src, targetFor(x), calcOpts(s.quest));
      var box = h('div', { class: 'panel' });
      result.appendChild(box);
      box.appendChild(h('h3', null, h('span', { class: qClass(x) }, x.name), ' from ', s.name, s.area ? ' in ' + s.area : '', ' (' + DIFFS[c.difficulty] + ')'));
      if (!r) { box.appendChild(h('p', { class: 'unavailable' }, 'Unavailable: this monster has no treasure class on ' + DIFFS[c.difficulty] + ' in the data.')); return; }
      if (r.chance === 0) {
        box.appendChild(h('p', { class: 'unavailable' }, 'It cannot drop from this monster with these settings.'));
        box.appendChild(h('ul', { class: 'why' }, whyNot(x, r).map(function (t) { return h('li', null, t); })));
        box.appendChild(explain(x, r, s));
        return;
      }
      box.appendChild(h('div', { class: 'result-big' }, h('span', { class: 'big' }, Prob.oneIn(r.chance)), h('span', { class: 'sub' }, Prob.percent(r.chance, 4) + ' per kill')));
      var stats = h('div', { class: 'stats' });
      function st(k, v) { stats.appendChild(h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))); }
      st('Average kills to the first', fmtInt(Prob.meanTries(r.chance)));
      st('Kills for 50%', triesText(Prob.triesFor(r.chance, 0.5)));
      st('Kills for 75%', triesText(Prob.triesFor(r.chance, 0.75)));
      st('Kills for 90%', triesText(Prob.triesFor(r.chance, 0.9)));
      st('Kills for 99%', triesText(Prob.triesFor(r.chance, 0.99)));
      st('At least one in ' + fmtInt(c.runs) + ' kills', Prob.percent(Prob.atLeastOne(r.chance, c.runs), 2));
      st('Expected drops in ' + fmtInt(c.runs) + ' kills', (r.expected * c.runs).toPrecision(3));
      box.appendChild(stats);
      box.appendChild(explain(x, r, s));
    }
    compute();
  }
  function field(label, control, wide) { return h('div', { class: 'field' + (wide ? ' wide' : '') }, h('label', null, label), control); }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }

  function whyNot(x, r) {
    var out = [];
    if ((x.kind === 'unique' || x.kind === 'set') && r.ilvl < x.lvl) out.push('The monster level (' + r.ilvl + ') is below the item\'s level (' + x.lvl + '), so this ' + (x.kind === 'set' ? 'set item' : 'unique') + ' is never chosen.');
    if (x.ladder && Engine.ladderOnly(x.ladder, P.data.ladderSeason) && !ladderAllowed()) out.push(x.ladderText + ', and the game is set to ' + gameModeText() + '.');
    if (!P.eng.reach(r.tc).has(x.code)) out.push('The base item ' + x.baseName + ' is not in this monster\'s treasure class (' + r.tc + ').');
    if (x.cond) out.push('The game data only allows it when: ' + x.cond + '.');
    if (!x.random && (x.kind === 'unique' || x.kind === 'set')) out.push(namedOnlyNote(x) || 'It is never rolled at random; only a treasure class that names it drops it.');
    if (!out.length) out.push('None of its paths through the treasure class reach it with these settings.');
    return out;
  }
  function explain(x, r, s) {
    var lines = [
      'Monster level ' + r.mlvl + ', so items drop at item level ' + r.ilvl + '.',
      'Treasure class: ' + r.tc + (r.upgraded ? ' (upgraded from ' + r.baseTc + ' because of the monster level)' : '') + ', ' + (r.picks < 0 ? Math.abs(r.picks) + ' fixed picks' : r.picks + ' pick' + (r.picks === 1 ? '' : 's')) + '.',
      r.picks > 0 ? 'NoDrop ' + r.noDrop + (r.noDropAdjusted !== r.noDrop ? ', lowered to ' + r.noDropAdjusted + ' for a player factor of ' + r.playerFactor : '') + '.' : 'Fixed picks ignore NoDrop.',
    ];
    if (x.kind === 'unique' || x.kind === 'set') {
      var item = P.eng.item(x.code);
      var q = P.eng.qualityRoll(item, r.ilvl, P.eng.tcByName(r.tc).q, settings.calc.mf);
      var cands = x.kind === 'unique' ? P.eng.uniqueCandidates(x.code, r.ilvl, { difficulty: settings.calc.difficulty, ladder: ladderAllowed() }) : P.eng.setCandidates(x.code, r.ilvl, { difficulty: settings.calc.difficulty, ladder: ladderAllowed(), cowKing: s.src.cls === 'hellbovine' });
      lines.push('When a ' + item.name + ' drops from the top class, it is ' + (x.kind === 'unique' ? 'unique' : 'a set item') + ' ' + Prob.percent(x.kind === 'unique' ? q.unique : q.set, 3) + ' of the time (nested classes can raise this), and then this one ' + (cands.length ? 'of ' + cands.length + ' possible' : '') + '.');
    }
    lines.push('Magic Find does not change whether the base item drops; it only changes its quality.');
    return h('details', { class: 'why' }, h('summary', null, 'How this was worked out'), h('ul', null, lines.map(function (t) { return h('li', null, t); })));
  }

  // ---------------------------------------------------------------------------------------------
  // Odds simulator
  // ---------------------------------------------------------------------------------------------
  function renderSim(root) {
    var s = settings.sim;
    clear(root);
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Odds over many runs'),
      h('p', { class: 'muted' }, 'Enter any chance and a number of runs. These are illustrative numbers for whatever odds you type, not game data.'))));
    var odds = h('input', { class: 'input', value: s.odds, placeholder: '1:1500, 0.05%, 0.0005', 'aria-describedby': 'odds-help', oninput: function () { s.odds = odds.value; save(); calc(); } });
    var runs = h('input', { class: 'input num', type: 'number', min: 1, max: 1e8, step: 1, value: s.runs, oninput: function () { s.runs = clamp(runs.value, 1, 1e8); save(); calc(); } });
    root.appendChild(h('div', { class: 'panel' }, h('div', { class: 'form' }, field('Chance per run', odds), field('Runs', runs)),
      h('p', { id: 'odds-help', class: 'muted small' }, 'Accepts 1:1500, 1/1500, 1 in 1500, 0.05% or 0.0005. Each run is independent with the same chance.')));
    var out = h('div', { class: 'panel' });
    root.appendChild(out);
    function calc() {
      clear(out);
      var p = Prob.parseOdds(s.odds);
      if (!(p > 0) || p > 1) { out.appendChild(h('p', { class: 'unavailable' }, 'Enter a chance between 0 and 1, for example 1:1500 or 0.05%.')); return; }
      var n = s.runs;
      out.appendChild(h('div', { class: 'result-big' }, h('span', { class: 'big' }, Prob.percent(Prob.atLeastOne(p, n), 2)), h('span', { class: 'sub' }, 'chance of at least one in ' + fmtInt(n) + ' runs')));
      var stats = h('div', { class: 'stats' });
      function st(k, v) { stats.appendChild(h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))); }
      st('Chance per run', Prob.percent(p, 4) + ' (' + Prob.oneIn(p) + ')');
      st('No drop in ' + fmtInt(n) + ' runs', Prob.percent(Prob.none(p, n), 2));
      st('Expected drops', Prob.expected(p, n).toPrecision(4));
      st('Runs for 50%', triesText(Prob.triesFor(p, 0.5)));
      st('Runs for 75%', triesText(Prob.triesFor(p, 0.75)));
      st('Runs for 90%', triesText(Prob.triesFor(p, 0.9)));
      st('Runs for 99%', triesText(Prob.triesFor(p, 0.99)));
      out.appendChild(stats);
      out.appendChild(curve(p, n));
    }
    calc();
  }
  // P(at least one) against runs, up to the 99% point (or the entered runs if larger).
  function curve(p, n) {
    var max = Math.max(n, Math.min(Prob.triesFor(p, 0.99), 1e9));
    var W = 640, H = 220, L = 44, B = 30, T = 10, R = 12;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Chance of at least one drop rising from 0 to ' + Prob.percent(Prob.atLeastOne(p, max), 0) + ' over ' + fmtInt(max) + ' runs');
    function s(tag, a) { var e = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); svg.appendChild(e); return e; }
    var x = function (v) { return L + (v / max) * (W - L - R); };
    var y = function (v) { return T + (1 - v) * (H - T - B); };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gridline' });
      s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }).textContent = (v * 100) + '%';
    });
    [0, 0.5, 1].forEach(function (f) { s('text', { x: x(max * f), y: H - 10, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }).textContent = fmtInt(max * f); });
    var d = '';
    for (var i = 0; i <= 120; i++) { var v = (max * i) / 120; d += (i ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(Prob.atLeastOne(p, v)).toFixed(1); }
    s('path', { d: d, class: 'line l-main' });
    s('circle', { cx: x(n), cy: y(Prob.atLeastOne(p, n)), r: 4.5, class: 'marker' });
    return svg;
  }

  // ---------------------------------------------------------------------------------------------
  // Holy Grail
  // ---------------------------------------------------------------------------------------------
  function renderGrail(root) {
    var g = settings.grail;
    clear(root);
    var list = Catalog.grailList(P.catalog);
    var prog = Grail.progress(grail, list);
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Holy Grail'),
      h('p', { class: 'muted' }, 'Every unique and set item in ' + P.meta.label + '. Progress is saved in this browser only; export a backup now and then.'))));
    if (grailStatus) root.appendChild(h('div', { class: 'banner warn' }, h('strong', null, 'Storage: '), grailStatus));
    var pct = prog.total ? prog.found / prog.total : 0;
    var summary = h('div', { class: 'panel' },
      h('div', { class: 'result-big' }, h('span', { class: 'big' }, (pct * 100).toFixed(1) + '%'), h('span', { class: 'sub' }, prog.found + ' of ' + prog.total + ' found')),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': prog.total, 'aria-valuenow': prog.found, 'aria-label': 'Grail completion' }, h('span', { style: 'width:' + (pct * 100).toFixed(2) + '%' })));
    var groups = h('div', { class: 'groups', style: 'margin-top:12px' });
    Object.keys(prog.groups).sort(function (a, b) { return groupOrder(a) - groupOrder(b); }).forEach(function (k) {
      var gp = prog.groups[k];
      groups.appendChild(h('div', { class: 'group' }, h('div', { class: 'row' }, h('span', null, groupName(k)), h('span', { class: 'muted' }, gp.found + ' / ' + gp.total)),
        h('div', { class: 'progress' }, h('span', { style: 'width:' + (gp.total ? gp.found / gp.total * 100 : 0).toFixed(2) + '%' }))));
    });
    summary.appendChild(groups);
    var fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: function () { importGrail(fileIn.files[0], root); } });
    summary.appendChild(h('div', { class: 'toolbar', style: 'margin:14px 0 0' },
      h('button', { type: 'button', class: 'button', onclick: exportGrail }, 'Export backup'),
      h('button', { type: 'button', class: 'button', onclick: function () { fileIn.click(); } }, 'Import backup'), fileIn,
      h('button', { type: 'button', class: 'button', onclick: function () {
        choose('Clear every found mark?', 'Your current Grail is kept so you can restore it, but exporting a backup first is safer.', [['clear', 'Clear all'], ['cancel', 'Cancel']], function (c) {
          if (c !== 'clear') return;
          keepPrevious(); grail = Grail.empty(); saveGrail(); renderGrail(root);
        });
      } }, 'Clear all'),
      previousGrail() ? h('button', { type: 'button', class: 'button', onclick: function () {
        var prev = previousGrail();
        choose('Restore the previous Grail?', 'This brings back the ' + Object.keys(prev.found).length + ' marks from before the last Replace or Clear all, and keeps the current ones as the new previous Grail.', [['restore', 'Restore'], ['cancel', 'Cancel']], function (c) {
          if (c !== 'restore') return;
          keepPrevious(); grail = prev; saveGrail(); renderGrail(root); toast('Restored.');
        });
      } }, 'Restore previous') : null));
    root.appendChild(summary);

    var q = h('input', { class: 'input search', type: 'search', placeholder: 'Search the Grail', value: g.q, 'aria-label': 'Search the Grail', oninput: function () { g.q = q.value; save(); draw(); } });
    var show = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, [['all', 'All'], ['missing', 'Missing'], ['found', 'Found']].map(function (o) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(g.show === o[0]), onclick: function () { g.show = o[0]; save(); renderGrail(root); } }, o[1]);
    }));
    var cat = h('select', { class: 'select', 'aria-label': 'Category', onchange: function () { g.category = cat.value; save(); draw(); } },
      option('all', 'All categories', g.category === 'all'), Object.keys(prog.groups).sort(function (a, b) { return groupOrder(a) - groupOrder(b); }).map(function (k) { return option(k, groupName(k), g.category === k); }));
    root.appendChild(h('div', { class: 'toolbar' }, q, show, cat));
    var out = h('div');
    root.appendChild(out);
    function draw() {
      clear(out);
      var words = g.q.toLowerCase().split(/\s+/).filter(Boolean);
      var items = list.filter(function (e) {
        var f = Grail.isFound(grail, e.id);
        if (g.show === 'missing' && f) return false;
        if (g.show === 'found' && !f) return false;
        if (g.category !== 'all' && e.group !== g.category) return false;
        return words.every(function (w) { return e.item.search.indexOf(w) >= 0; });
      });
      var byGroup = {};
      items.forEach(function (e) { (byGroup[e.group] = byGroup[e.group] || []).push(e); });
      Object.keys(byGroup).sort(function (a, b) { return groupOrder(a) - groupOrder(b); }).forEach(function (k) {
        out.appendChild(h('h3', null, groupName(k) + ' (' + byGroup[k].length + ')'));
        var cl = h('div', { class: 'checklist' });
        byGroup[k].forEach(function (e) {
          var x = e.item;
          var cb = h('input', { type: 'checkbox', checked: Grail.isFound(grail, e.id), onchange: function () {
            grail = Grail.setFound(grail, e.id, cb.checked, cb.checked ? new Date().toISOString().slice(0, 10) : '');
            saveGrail();
            var p2 = Grail.progress(grail, list);
            summary.querySelector('.big').textContent = (p2.total ? p2.found / p2.total * 100 : 0).toFixed(1) + '%';
            summary.querySelector('.sub').textContent = p2.found + ' of ' + p2.total + ' found';
          } });
          var dup = dupCount(x) > 1 ? ' #' + dupIndex(x) : '';
          cl.appendChild(h('label', null, cb, h('span', null, h('span', { class: qClass(x) }, x.name + dup), h('span', { class: 'meta' }, (x.setName ? x.setName + ' · ' : '') + x.baseName + (dup && x.lines[0] ? ' · ' + x.lines[0] : '')))));
        });
        out.appendChild(cl);
      });
      if (!items.length) out.appendChild(h('p', null, g.show === 'missing' ? 'Nothing missing here.' : 'Nothing matches.'));
    }
    draw();
  }
  function groupOrder(k) { var i = ['weapon', 'armor', 'jewelry', 'charm', 'jewel', 'misc', 'set'].indexOf(k); return i < 0 ? 99 : i; }
  function groupName(k) { return k === 'set' ? 'Set items' : 'Unique ' + (Catalog.CATEGORY_NAMES[k] || k).toLowerCase(); }
  function exportGrail() {
    var blob = new Blob([Grail.exportText(grail)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'd2looter-grail-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function importGrail(file, root) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('That file is larger than 5 MB, far bigger than any Grail backup.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var r = Grail.importText(reader.result);
      if (!r.ok) { toast(r.error); return; }
      var n = Object.keys(r.state.found).length;
      var have = Object.keys(grail.found).length;
      choose('Import ' + n + ' found item' + (n === 1 ? '' : 's') + '?',
        'Merge adds them to the ' + have + ' you have marked and unmarks nothing. Replace makes your Grail exactly the backup; the current one is kept so you can restore it.' + (r.problems.length ? ' Skipped: ' + r.problems.slice(0, 3).join('; ') + '.' : ''),
        [['merge', 'Merge'], ['replace', 'Replace'], ['cancel', 'Cancel']],
        function (choice) {
          if (choice !== 'merge' && choice !== 'replace') return;
          if (choice === 'replace') keepPrevious();
          grail = choice === 'merge' ? Grail.merge(grail, r.state) : r.state;
          saveGrail();
          toast((choice === 'merge' ? 'Merged ' : 'Replaced with ') + n + ' entries.');
          renderGrail(root);
        });
    };
    reader.readAsText(file);
  }
  // Before Replace or Clear all, the current Grail is kept under d2looter:v1:grail.previous.
  function keepPrevious() { Store.write('grail.previous', grail); }
  function previousGrail() {
    var r = Store.readRaw('grail.previous');
    if (r.status !== 'ok') return null;
    var c = Grail.check(r.value);
    return Object.keys(c.state.found).length ? c.state : null;
  }
  // A small in-page dialog; the browser's confirm() has only OK and Cancel.
  function choose(title, text, buttons, done) {
    var dlg = h('dialog', { class: 'panel', 'aria-labelledby': 'dlg-title', style: 'max-width:460px;color:var(--text)' },
      h('h3', { id: 'dlg-title', style: 'margin-top:0' }, title), h('p', null, text),
      h('div', { class: 'toolbar', style: 'margin:0;justify-content:flex-end' }, buttons.map(function (b, i) {
        return h('button', { type: 'button', class: 'button' + (i === 0 ? ' primary' : ''), onclick: function () { dlg.close(b[0]); } }, b[1]);
      })));
    dlg.addEventListener('close', function () { var v = dlg.returnValue || 'cancel'; dlg.remove(); done(v); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------------------------------------------------------------------------------------------
  // Magic Find
  // ---------------------------------------------------------------------------------------------
  function renderMF(root) {
    var m = settings.mf;
    clear(root);
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Magic Find'),
      h('p', { class: 'muted' }, 'Magic Find has diminishing returns for unique, set and rare items, and none for magic items. It never changes whether an item drops, only its quality, so it does nothing for runes, gems or gold.'))));
    var mf = h('input', { class: 'input num', type: 'number', min: 0, max: 5000, value: m.mf, oninput: function () { m.mf = clamp(mf.value, 0, 5000); slider.value = Math.min(m.mf, 1500); save(); draw(); } });
    var slider = h('input', { type: 'range', min: 0, max: 1500, step: 5, value: Math.min(m.mf, 1500), 'aria-label': 'Magic Find', style: 'width:min(420px,100%)', oninput: function () { m.mf = Number(slider.value); mf.value = m.mf; save(); draw(); } });
    root.appendChild(h('div', { class: 'panel' }, h('div', { class: 'toolbar', style: 'margin:0' }, field('Magic Find %', mf), slider)));
    var table = h('div', { class: 'panel' });
    var chartBox = h('div', { class: 'panel' });
    var quality = h('div', { class: 'panel' });
    root.appendChild(h('div', { class: 'grid2' }, table, chartBox));
    root.appendChild(quality);
    function draw() {
      var v = m.mf;
      clear(table).appendChild(h('h3', null, 'Effective Magic Find at ' + v + '%'));
      table.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, h('th', null, 'Quality'), h('th', { class: 'num' }, 'Effective MF'), h('th', { class: 'num' }, 'Roll multiplier'), h('th', null, 'Formula'))),
        h('tbody', null, [['Unique', 250, 'q-unique'], ['Set', 500, 'q-set'], ['Rare', 600, 'q-magic'], ['Magic', 0, 'q-magic']].map(function (r) {
          var e = Engine.effectiveMF(v, r[1]);
          return h('tr', null, h('td', { class: r[0] === 'Rare' ? '' : r[2] }, r[0]), h('td', { class: 'num' }, e + '%'), h('td', { class: 'num' }, 'x' + ((100 + e) / 100).toFixed(2)),
            h('td', { class: 'small muted' }, r[1] ? 'MF x ' + r[1] + ' / (MF + ' + r[1] + '), rounded down' : 'MF, no diminishing returns'));
        })))));
      table.appendChild(h('p', { class: 'small muted' }, 'Up to 10% MF counts in full. The multiplier divides the roll\'s chance number, which then cannot go below the item ratio\'s minimum (6400 for uniques), so very high MF on high-level items gains less than the multiplier.'));
      clear(chartBox).appendChild(h('h3', null, 'Diminishing returns'));
      chartBox.appendChild(mfChart(v));
      chartBox.appendChild(h('div', { class: 'legend' }, [['Unique', 'var(--q-unique)'], ['Set', 'var(--q-set)'], ['Rare', 'var(--q-rare)'], ['Magic', 'var(--q-magic)']].map(function (l) { return h('span', null, h('i', { style: 'background:' + l[1] }), l[0]); })));
      drawQuality();
    }
    function drawQuality() {
      clear(quality).appendChild(h('h3', null, 'Quality when a base item drops'));
      quality.appendChild(h('p', { class: 'muted small' }, 'For a plain monster (no treasure class quality bonus): the chance each roll succeeds first, before the unique or set lookup.'));
      var form = h('div', { class: 'form' });
      form.appendChild(itemPicker(m.item, function (x) { m.item = x.id; save(); drawQuality(); }, function (x) { return x.kind === 'base' && (x.category === 'weapon' || x.category === 'armor' || x.category === 'jewelry'); }));
      var il = h('input', { class: 'input num', type: 'number', min: 1, max: 110, value: m.ilvl, oninput: function () { m.ilvl = clamp(il.value, 1, 110); save(); res(); } });
      form.appendChild(field('Monster level (item level)', il));
      quality.appendChild(form);
      var out = h('div');
      quality.appendChild(out);
      function res() {
        clear(out);
        var x = P.byId.get(m.item);
        if (!x || x.kind !== 'base') { out.appendChild(h('p', null, 'Pick a weapon, armor, ring or amulet base.')); return; }
        var rows = [0, m.mf].map(function (v) { return [v, P.eng.qualityRoll(x.base, m.ilvl, [0, 0, 0, 0], v)]; });
        out.appendChild(h('div', { class: 'table-wrap', style: 'margin-top:10px' }, h('table', { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, x.name + ' at item level ' + m.ilvl), h('th', { class: 'num' }, 'Unique'), h('th', { class: 'num' }, 'Set'), h('th', { class: 'num' }, 'Rare'), h('th', { class: 'num' }, 'Magic'))),
          h('tbody', null, rows.map(function (r) {
            return h('tr', null, h('td', null, r[0] + '% MF'), ['unique', 'set', 'rare', 'magic'].map(function (k) { return h('td', { class: 'num' }, Prob.percent(r[1][k], 3)); }));
          })))));
        var u = P.eng.uniqueCandidates(x.code, m.ilvl, { difficulty: 2, ladder: true });
        out.appendChild(h('p', { class: 'small muted' }, u.length ? 'A unique ' + x.name + ' at this level is one of: ' + u.map(function (z) { return z.name; }).join(', ') + '.' : 'No unique ' + x.name + ' can roll at this item level; a successful unique roll becomes a rare with triple durability.'));
      }
      res();
    }
    draw();
  }
  function mfChart(cur) {
    var W = 520, H = 240, L = 46, B = 30, T = 10, R = 12, MAX = 1500, YMAX = 1500;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Effective Magic Find for unique, set and rare items levels off while magic rises in a straight line');
    function s(tag, a) { var e = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); svg.appendChild(e); return e; }
    var x = function (v) { return L + (v / MAX) * (W - L - R); };
    var y = function (v) { return T + (1 - Math.min(v, YMAX) / YMAX) * (H - T - B); };
    [0, 250, 500, 750, 1000, 1250, 1500].forEach(function (v) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gridline' });
      s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }).textContent = v;
      s('text', { x: x(v), y: H - 10, 'text-anchor': 'middle' }).textContent = v;
    });
    [[250, 'l-unique'], [500, 'l-set'], [600, 'l-rare'], [0, 'l-magic']].forEach(function (c) {
      var d = '';
      for (var v = 0; v <= MAX; v += 15) d += (v ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(Engine.effectiveMF(v, c[0])).toFixed(1);
      s('path', { d: d, class: 'line ' + c[1] });
    });
    s('line', { x1: x(Math.min(cur, MAX)), x2: x(Math.min(cur, MAX)), y1: T, y2: H - B, class: 'axis' });
    return svg;
  }

  // ---------------------------------------------------------------------------------------------
  // Runes and runewords
  // ---------------------------------------------------------------------------------------------
  function renderRunes(root) {
    var f = settings.runes;
    clear(root);
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Runes and runewords'),
      h('p', { class: 'muted' }, P.runes.length + ' runes and ' + P.runewords.length + ' runewords in ' + P.meta.label + '. Enter how many of each rune you own to see what you can make.'))));
    var runeTable = h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Rune'), h('th', { class: 'num' }, 'Required level'), h('th', { class: 'num' }, 'Rune level'), h('th', null, 'Owned'))),
      h('tbody', null, P.runes.map(function (r) {
        var inp = h('input', { class: 'input num', type: 'number', min: 0, max: 999, value: owned[r.code] || 0, 'aria-label': r.name + ' owned', style: 'width:5em;min-height:30px;padding:3px 6px', oninput: function () { owned[r.code] = clamp(inp.value, 0, 999); saveOwned(); drawWords(); } });
        return h('tr', null, h('td', { class: 'num' }, String(r.order)), h('td', null, h('a', { href: '#item/' + encodeURIComponent('r:' + r.code), class: 'q-rune' }, r.name)), h('td', { class: 'num' }, r.reqLevel ? String(r.reqLevel) : 'none'), h('td', { class: 'num' }, String(r.lvl)), h('td', null, inp));
      })));
    var words = h('div');
    root.appendChild(h('div', { class: 'detail' }, h('div', { class: 'table-wrap' }, runeTable), words));
    function drawWords() {
      clear(words);
      var q = h('input', { class: 'input search', type: 'search', placeholder: 'Search runewords, runes, bases or properties', value: f.q, 'aria-label': 'Search runewords', oninput: function () { f.q = q.value; save(); list(); } });
      var so = h('select', { class: 'select', 'aria-label': 'Sockets', onchange: function () { f.sockets = so.value; save(); list(); } }, option('all', 'Any sockets', f.sockets === 'all'), [2, 3, 4, 5, 6].map(function (n) { return option(String(n), n + ' sockets', f.sockets === String(n)); }));
      var mk = h('input', { type: 'checkbox', checked: f.makeable, onchange: function () { f.makeable = mk.checked; save(); list(); } });
      var hl = h('input', { type: 'checkbox', checked: f.hideLadder, onchange: function () { f.hideLadder = hl.checked; save(); list(); } });
      words.appendChild(h('div', { class: 'toolbar' }, q, so, h('label', { class: 'check' }, mk, 'Only ones I can make'), h('label', { class: 'check' }, hl, 'Hide ladder-only')));
      var out = h('div');
      words.appendChild(out);
      function list() {
        clear(out);
        var qs = f.q.toLowerCase().split(/\s+/).filter(Boolean);
        var res = P.runewords.filter(function (r) {
          if (f.sockets !== 'all' && r.sockets !== Number(f.sockets)) return false;
          if (f.hideLadder && r.ladderOnlyNow) return false;
          if (f.makeable && !canMake(r)) return false;
          var hay = (r.name + ' ' + r.runeNames.join(' ') + ' ' + r.types.join(' ') + ' ' + r.lines.join(' ')).toLowerCase();
          return qs.every(function (w) { return hay.indexOf(w) >= 0; });
        }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        out.appendChild(h('p', { class: 'muted small' }, res.length + ' runeword' + (res.length === 1 ? '' : 's')));
        if (!res.length) out.appendChild(h('p', null, f.makeable ? 'None can be made with the runes entered on the left. Add the runes you own, or untick "Only ones I can make".' : 'No runeword matches. Try fewer words or a different socket count.'));
        res.forEach(function (r) {
          out.appendChild(h('details', { class: 'panel', style: 'padding:10px 14px;margin-bottom:8px' },
            h('summary', { style: 'cursor:pointer' }, h('strong', { class: 'q-unique', style: 'font-family:var(--head-font);font-size:16px' }, r.name), ' ',
              h('span', { class: 'q-rune' }, r.runeNames.join(' + ')), h('span', { class: 'muted small' }, '  ' + r.sockets + ' sockets · ' + r.types.join(', ') + ' · level ' + r.reqLevel),
              r.ladderOnlyNow ? h('span', { class: 'tag ladder' }, 'ladder only') : null, canMake(r) ? h('span', { class: 'tag found' }, 'you can make it') : null),
            h('div', { class: 'small', style: 'margin-top:8px' },
              r.label && r.label !== r.name ? h('p', { class: 'muted' }, 'Table label: ' + r.label) : null,
              r.excluded.length ? h('p', { class: 'muted' }, 'Not on: ' + r.excluded.join(', ')) : null,
              r.status ? h('p', { class: 'muted' }, r.status + '.') : null,
              ladderNote(r),
              h('ul', null, r.lines.map(function (l) { return h('li', null, l); })))));
        });
      }
      list();
    }
    drawWords();
  }
  function canMake(r) {
    var need = {};
    r.runes.forEach(function (c) { need[c] = (need[c] || 0) + 1; });
    return Object.keys(need).every(function (c) { return (owned[c] || 0) >= need[c]; });
  }
  // Patch 3.3 notes name eight runewords whose reworked versions stay ladder only in Reign of the
  // Warlock, while the 3.3 table ends their ladder window at Season 14. Both are shown.
  var ROTW_33_LADDER = ['Mania', 'Hysteria', 'Metamorphosis', 'Ground', 'Temper', 'Hearth', 'Cure', 'Bulwark'];
  function ladderNote(r) {
    if (P.id !== 'd2r-rotw' || ROTW_33_LADDER.indexOf(r.name) < 0) return null;
    return h('p', { class: 'unavailable', style: 'font-weight:500' }, 'Conflicting sources: the patch 3.3 notes say this runeword\'s changed version is ladder only, but the 3.3 table ends its ladder window at Season 14. Check in game.');
  }

  // ---------------------------------------------------------------------------------------------
  // Accuracy
  // ---------------------------------------------------------------------------------------------
  function renderAccuracy(root) {
    clear(root);
    var m = P.meta;
    function sec(title, items) { return h('div', { class: 'panel' }, h('h3', null, title), h('ul', null, items.map(function (t) { return h('li', null, t); }))); }
    root.appendChild(h('div', { class: 'view-head' }, h('div', null, h('h2', null, 'Accuracy and sources'), h('p', { class: 'muted' }, 'What the numbers are built from, how they were checked, and what is not modeled yet.'))));
    root.appendChild(h('div', { class: 'panel' }, h('h3', null, 'Game versions'), h('dl', { class: 'facts' }, PROFILES.map(function (p) {
      return [h('dt', null, p.label), h('dd', null, (p.experimental ? 'Experimental. ' : '') + 'Tables from blizzhackers/d2data at ' + p.commit.slice(0, 10) + ' (' + p.counts.uniques + ' unique rows, ' + p.counts.setItems + ' set items, ' + p.counts.runewords + ' runewords, ' + p.counts.tcs + ' treasure classes).' + (p.ladderSeason ? ' Ladder Season ' + p.ladderSeason + '.' : ''))];
    }))));
    root.appendChild(sec('How drop chances are worked out', [
      'Each kill is resolved from the monster\'s treasure class down to single items, following the 1.14d drop rules written up in d2data\'s item-drop-spec.md: monster level, the treasure class upgrade in Nightmare and Hell, NoDrop scaled by player count and party, picks, the six-item limit, and the unique, set, rare and magic rolls with Magic Find.',
      'The six-item limit is followed exactly: a boss with seven picks only makes its seventh pick after an earlier pick dropped nothing. Some calculators treat seven picks as six, which gives lower numbers for bosses.',
      'Chances are per kill, for one kill in a fresh game. "Kills for 50%" and the run math treat kills as independent.',
    ]));
    root.appendChild(sec('How it was checked', [
      h('span', null, h('strong', null, 'The data. '), 'The 1.14d tables match a second, independent copy (Silospen DropCalc\'s .txt files) in every drop-relevant field. The 3.3 Reign of the Warlock tables differ from Silospen\'s 3.2 copy only where patch 3.3 changed them (The Battlebranch item level 34 to 30, Sunder Charm level 69 to 75, Herald quality, Worldstone Shard and Ancient Statue rates, the changed uniques becoming ladder only). Every unique, set item and runeword shows exactly the properties of its source row.'),
      h('span', null, h('strong', null, 'The rules. '), 'The worked examples in the drop write-up (NoDrop, Magic Find, quality rolls) are tests, and every rule the engine applies is changed one at a time in a mutation check to prove a test catches it.'),
      h('span', null, h('strong', null, 'Agreement with other calculators. '), 'Silospen DropCalc\'s own expected results are reproduced with its method on its tables: about 9,600 values (every treasure class outcome of 50+ boss and superunique cases at 1 to 8 players, every unique from Andariel and Baal, the Stone of Jordan from every Hell boss and every regular Hell monster). d2data\'s C++ drop solver, which follows the six-item limit as D2Looter does, agrees to its printed 6 significant digits on about 75,000 expected item counts (thirteen treasure classes including Duriel\'s and the Countess\'s, player factors 1 to 8, both D2R rulesets).'),
      h('span', null, h('strong', null, 'Not checked against the game. '), 'None of these numbers has been compared with drops counted in the game. The calculators agree with each other and with the written-up rules; that is not the same as a measurement.'),
    ]));
    root.appendChild(sec('Where sources disagree (and what D2Looter does)', [
      'Throwing potions: Silospen and d2data\'s 2021 1.14d tables put them in the weapon treasure classes; the drop write-up and d2data\'s current tables leave them out. D2Looter leaves them out, which makes low-level weapon bases up to about 14% more likely.',
      'Disabled uniques: Silospen lets Azurewrath (marked ladder, but not enabled in 1.14d) drop; D2Looter follows the table and the write-up, so it never drops in 1.14d and does not dilute Lightsabre.',
      'Defilers: Silospen upgrades their treasure class by level and, where they appear among an area\'s monsters, gives them the area\'s level. The write-up says boss-flagged monsters never upgrade and keep their own level, and D2Looter follows it.',
      'Seven-pick bosses: Silospen applies seven picks as six independent ones; D2Looter makes the seventh pick when an earlier pick dropped nothing, as the six-item limit works, so its boss chances are higher: 14 to 19% for Andariel, Mephisto, Diablo and Baal in Hell. Duriel is the big one: his class makes five picks of a class that itself makes seven, and nearly every kill fills all six item slots, so D2Looter\'s Duriel chances are about twice Silospen\'s. d2data\'s solver agrees with D2Looter on Duriel.',
      'NoDrop at /players 2: the game leaves NoDrop unchanged (two players count as one); Silospen still applies its formula, which can round one lower.',
      'Griswold, Radament, The Summoner and Nihlathak are superuniques with boss-flagged classes. D2Looter gives them the superunique +3 levels; Silospen does not. Unverified.',
      'Stormtree: d2data places him in the Flayer Jungle, Silospen in Lower Kurast (used here). Only Nightmare\'s level differs.',
    ]));
    root.appendChild(sec('Not modeled yet', [
      'Desecrated (Terror) zones and the Sunder Charms they drop, in both D2R rulesets; Heralds, Uber Ancients and Worldstone Shards in Reign of the Warlock.',
      'Classic (non-expansion) games: different monster levels, no treasure class upgrade, quality options on entries.',
      'Scripted drops outside treasure classes: quest items, Hellfire Torch, Annihilus (Diablo Clone), the Cow King\'s potions.',
      'The once-per-game unique rule (a unique already generated in the game cannot drop again), Find Item, and items that cannot find floor space.',
      'Berserk champions (+3 levels, not +2) and monsters raised or summoned during play.',
      'D2R rules are assumed to be the 1.14d rules run on D2R\'s tables. Reign of the Warlock\'s conditional treasure classes follow d2data\'s reading: a class switched off by its condition gives its weight back to its parent.',
    ]));
    root.appendChild(sec('Sources', [
      h('span', null, 'Game tables and the drop write-up: ', h('a', { href: 'https://github.com/blizzhackers/d2data' }, 'blizzhackers/d2data'), '. Its MIT license covers its own conversion and write-up, not the game data.'),
      h('span', null, 'Cross-check tables, expected results and boss and superunique areas: ', h('a', { href: 'https://github.com/silospen/DropCalc' }, 'silospen/DropCalc'), ' (MIT for its code). Its tables are used only to check, not shipped.'),
      h('span', null, 'Patch 3.3 and Ladder Season 15: Blizzard News, "Diablo II: Resurrected Ladder Season 15 Now Live".'),
      'Diablo II and Diablo II: Resurrected are trademarks of Blizzard Entertainment. Item names, text and drop numbers come from Blizzard\'s games and remain Blizzard\'s; D2Looter uses them, with credit, in a free fan tool and claims no license to them. D2Looter is not affiliated with or endorsed by Blizzard.',
    ]));
    void m;
  }

  // ---------------------------------------------------------------------------------------------
  // start
  // ---------------------------------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      var q = document.getElementById('item-q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  });
  applyTheme();
  renderProfileSelect();
  loadProfile(settings.profile, function () { route(); });
})();
