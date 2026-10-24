// Holy Grail state: which unique and set items have been found. Pure functions over plain
// objects; js/store.js does the saving. The saved shape is versioned so a later release can
// migrate it, and anything that does not validate is reported instead of being trusted.
//
//   { format: 'd2looter-grail', version: 1, found: { 'u:<key>': 'YYYY-MM-DD', 's:<key>': ... } }
(function (root) {
  'use strict';
  var FORMAT = 'd2looter-grail';
  var VERSION = 1;
  var KEY_RE = /^[us]:.{1,80}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function empty() { return { format: FORMAT, version: VERSION, found: {} }; }

  function idFor(kind, key) { return (kind === 'set' ? 's:' : 'u:') + key; }

  // Validate anything that claims to be grail state. Returns { state, problems } where state is
  // always usable: bad entries are dropped and each one is described in problems.
  function check(value) {
    var problems = [];
    var out = empty();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { state: out, problems: ['not a grail object'] };
    }
    if (value.format !== FORMAT) problems.push('missing or wrong "format" (expected ' + FORMAT + ')');
    if (value.version !== VERSION) {
      if (typeof value.version === 'number' && value.version > VERSION) problems.push('made by a newer version (' + value.version + ')');
      else problems.push('missing or unknown "version"');
    }
    var found = value.found;
    if (!found || typeof found !== 'object' || Array.isArray(found)) {
      problems.push('missing "found" list');
      return { state: out, problems: problems };
    }
    Object.keys(found).forEach(function (k) {
      var v = found[k];
      if (!KEY_RE.test(k)) { problems.push('ignored entry with a bad id: ' + JSON.stringify(k).slice(0, 40)); return; }
      if (v === true) v = '';
      if (typeof v !== 'string' || (v && !DATE_RE.test(v))) { problems.push('ignored entry with a bad date: ' + k); return; }
      out.found[k] = v;
    });
    return { state: out, problems: problems };
  }

  function isFound(state, id) { return Object.prototype.hasOwnProperty.call(state.found, id); }

  function setFound(state, id, on, date) {
    var next = { format: FORMAT, version: VERSION, found: Object.assign({}, state.found) };
    if (on) next.found[id] = date || '';
    else delete next.found[id];
    return next;
  }

  // Import: either replace, or merge (an item found in either copy stays found; the earlier
  // date wins because the grail records when it was first found).
  function merge(a, b) {
    var out = { format: FORMAT, version: VERSION, found: Object.assign({}, a.found) };
    Object.keys(b.found).forEach(function (k) {
      var da = out.found[k], db = b.found[k];
      if (da === undefined) out.found[k] = db;
      else if (db && (!da || db < da)) out.found[k] = db;
    });
    return out;
  }

  function exportText(state) {
    var sorted = {};
    Object.keys(state.found).sort().forEach(function (k) { sorted[k] = state.found[k]; });
    return JSON.stringify({ format: FORMAT, version: VERSION, exported: new Date().toISOString().slice(0, 10), found: sorted }, null, 2);
  }

  // Importing is stricter than reading the browser's own save: a file that is not a backup, comes
  // from a newer format, or has no "found" list is refused as a whole, so "Replace" can never turn
  // it into an empty Grail. Single bad entries are skipped and reported. JSON.parse is the only
  // thing that reads the file; nothing in it is ever run or inserted as HTML.
  var MAX_TEXT = 5 * 1024 * 1024, MAX_ENTRIES = 50000;
  function importText(text) {
    var s = String(text);
    if (s.length > MAX_TEXT) return { ok: false, error: 'This file is larger than 5 MB, far bigger than any Grail backup.' };
    var parsed;
    try { parsed = JSON.parse(s); } catch (e) { return { ok: false, error: 'This file is not valid JSON.' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.format !== FORMAT) return { ok: false, error: 'This is not a D2Looter grail backup.' };
    if (typeof parsed.version === 'number' && parsed.version > VERSION) return { ok: false, error: 'This backup was made by a newer version of D2Looter (format ' + parsed.version + '). Update D2Looter to import it.' };
    if (parsed.version !== VERSION) return { ok: false, error: 'This backup has no supported format version.' };
    if (!parsed.found || typeof parsed.found !== 'object' || Array.isArray(parsed.found)) return { ok: false, error: 'This backup has no list of found items.' };
    if (Object.keys(parsed.found).length > MAX_ENTRIES) return { ok: false, error: 'This backup lists more than ' + MAX_ENTRIES.toLocaleString('en-US') + ' items, which no Grail has.' };
    var c = check(parsed);
    var extra = Object.keys(parsed).filter(function (k) { return ['format', 'version', 'exported', 'found'].indexOf(k) < 0; });
    if (extra.length) c.problems.push('ignored unknown fields: ' + extra.slice(0, 5).join(', '));
    return { ok: true, state: c.state, problems: c.problems };
  }

  // Completion over a list of grail items ({ id, group }) for one ruleset.
  function progress(state, list) {
    var total = list.length, found = 0, groups = {};
    list.forEach(function (it) {
      var g = groups[it.group] || (groups[it.group] = { total: 0, found: 0 });
      g.total++;
      if (isFound(state, it.id)) { found++; g.found++; }
    });
    return { total: total, found: found, groups: groups };
  }

  var api = { FORMAT: FORMAT, VERSION: VERSION, empty: empty, idFor: idFor, check: check, isFound: isFound, setFound: setFound, merge: merge, exportText: exportText, importText: importText, progress: progress };
  root.D2Grail = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
