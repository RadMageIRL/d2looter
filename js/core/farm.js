// Where to farm an item: every boss and superunique that can drop it (and, on request, every area
// monster), compared per kill, per run and, with the player's own run times, per hour. Every chance
// comes from the drop engine (js/core/engine.js); this file only combines them. Pure functions; no
// DOM.
//
// A run is a set of kills. One boss or superunique is one kill per run. Where several bosses and
// superuniques share an area (the Chaos Sanctuary, Travincal, the Throne of Destruction...), that
// area is also offered as one run that kills all of them. An area monster's kills per run are the
// player's own estimate, because how many of each monster spawn is not modeled. Kills are
// independent, as in the drop calculator, so a run's chance is 1 - (1 - p1)(1 - p2)...
(function (root) {
  'use strict';

  var Prob = root.D2Prob || (typeof require === 'function' ? require('./prob.js') : null);
  var MAX_SECONDS = 24 * 3600;

  // Runs that cross areas. The Baal run kills the five wave bosses in the Throne of Destruction,
  // then Baal in the Worldstone Chamber.
  var RUNS = [{ id: 'baal', name: 'Baal run', areas: ['Act 5 - Throne Room', 'Act 5 - World Stone'] }];

  // ---- run times ----
  // "1:30", "1:02:03", "90", "90s", "1.5m", "2m 30s", "1h". A bare number is seconds. Blank is null
  // (no run time); anything else that can't be read, or is not between 1 second and 24 hours, is NaN.
  function parseRunTime(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase();
    if (!s) return null;
    if (s.length > 24) return NaN;
    var sec = NaN, m;
    if ((m = s.match(/^(\d{1,4}):([0-5]\d)$/))) sec = Number(m[1]) * 60 + Number(m[2]);
    else if ((m = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/))) sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    else if (/^\d+(\.\d+)?$/.test(s)) sec = Number(s);
    else if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/)) && (m[1] || m[2] || m[3])) {
      sec = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    }
    return sec >= 1 && sec <= MAX_SECONDS ? sec : NaN;
  }

  // 90 -> "1:30", 3723 -> "1:02:03".
  function formatClock(seconds) {
    var t = Math.round(seconds);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }

  // A long time in the unit that reads best: "45 s", "12 min", "3.2 h", "4.5 days", "2.1 years".
  function formatDuration(seconds) {
    if (seconds === Infinity) return 'never';
    if (!(seconds >= 0)) return '-';
    function n(v, unit) { return (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toLocaleString('en-US')) + ' ' + unit; }
    if (seconds < 59.5) return Math.max(1, Math.round(seconds)) + ' s';
    if (seconds < 3600) return n(seconds / 60, 'min');
    if (seconds < 48 * 3600) return n(seconds / 3600, 'h');
    if (seconds < 365 * 86400) return n(seconds / 86400, 'days');
    return n(seconds / (365.25 * 86400), 'years');
  }

  // ---- the numbers for one run ----
  // Chance that a run drops at least one: kills is a list of [chance per kill, kills of it].
  function runChance(kills) {
    var logNone = 0;
    for (var i = 0; i < kills.length; i++) {
      var p = kills[i][0], k = kills[i][1];
      if (!(p >= 0 && p <= 1) || !(k >= 0)) return NaN;
      if (p > 0 && k > 0) logNone += k * Math.log1p(-p);
    }
    return logNone === 0 ? 0 : -Math.expm1(logNone);
  }

  // Runs: the average to the first drop, and the runs for a 50% and a 90% chance.
  function runStats(pRun) {
    return { expectedRuns: Prob.meanTries(pRun), runs50: Prob.triesFor(pRun, 0.5), runs90: Prob.triesFor(pRun, 0.9) };
  }

  // With a run time: the chance in an hour of runs, the average time to the first drop, and the
  // chance in the whole runs that fit in the farming time. Null without a usable run time.
  function timeStats(pRun, seconds, hours) {
    if (typeof seconds !== 'number' || !(seconds >= 1 && seconds <= MAX_SECONDS) || !(pRun >= 0 && pRun <= 1)) return null;
    var runsIn = hours > 0 ? Math.floor((hours * 3600) / seconds + 1e-9) : 0;
    return {
      perHour: Prob.atLeastOne(pRun, 3600 / seconds),
      expectedSeconds: pRun > 0 ? seconds / pRun : Infinity,
      runsIn: runsIn,
      chanceIn: Prob.atLeastOne(pRun, runsIn),
    };
  }

  // ---- the sources ----
  // opts: { players, party, mf, ladder }; diffs: the difficulties to look at.
  // Returns { rows, maxLevel }: one row per boss or superunique that can drop the target and one
  // per area run where two or more of its kills can, and the highest monster level looked at.
  function fixedRows(eng, sources, target, opts, diffs) {
    var rows = [], maxLevel = 0;
    diffs.forEach(function (d) {
      var all = sources.fixed(d).map(function (s) {
        var r = eng.dropChance(s.src, target, { difficulty: d, players: opts.players, party: opts.party, mf: opts.mf, quest: s.quest, ladder: opts.ladder });
        if (r && r.mlvl > maxLevel) maxLevel = r.mlvl;
        return { s: s, r: r, chance: r ? r.chance : 0 };
      });
      all.forEach(function (o) {
        if (!(o.chance > 0)) return;
        rows.push({
          key: o.s.id + '@' + d, kind: 'single', name: o.s.name, area: o.s.area, group: o.s.group, difficulty: d,
          source: o.s, chance: o.chance, mlvl: o.r.mlvl, kills: [{ name: o.s.name, chance: o.chance }],
          killsPerRun: 1, runChance: o.chance,
        });
      });
      // Quest kills are the same monster as the plain kill, so they never join an area run.
      var byArea = new Map();
      all.forEach(function (o) {
        if (o.s.quest || o.s.src.area == null) return;
        var lv = eng.level(o.s.src.area), key = lv ? lv.key : String(o.s.src.area);
        if (!byArea.has(key)) byArea.set(key, { name: o.s.area, members: [] });
        byArea.get(key).members.push(o);
      });
      function addRun(id, name, area, members) {
        var dropping = members.filter(function (o) { return o.chance > 0; });
        if (dropping.length < 2) return;
        rows.push({
          key: 'g:' + id + '@' + d, kind: 'group', name: name, area: area, difficulty: d,
          kills: members.map(function (o) { return { name: o.s.name, chance: o.chance }; }),
          chance: null, killsPerRun: members.length,
          runChance: runChance(dropping.map(function (o) { return [o.chance, 1]; })),
        });
      }
      byArea.forEach(function (g, key) { addRun(key, g.name, g.name, g.members); });
      RUNS.forEach(function (run) {
        var members = [];
        run.areas.forEach(function (k) { if (byArea.has(k)) members = members.concat(byArea.get(k).members); });
        var names = run.areas.map(function (k) { return byArea.has(k) ? byArea.get(k).name : null; }).filter(Boolean);
        if (names.length === run.areas.length) addRun(run.id, run.name, names.join(' and '), members);
      });
    });
    return { rows: rows, maxLevel: maxLevel };
  }

  // Area monsters, one job per (difficulty, area, monster, type); the app runs them in small batches.
  var AREA_TYPES = ['regular', 'champion', 'unique'];
  function areaJobs(sources, diffs) {
    var jobs = [];
    diffs.forEach(function (d) {
      sources.areas(d).forEach(function (a) {
        AREA_TYPES.forEach(function (type) {
          sources.areaMonsters(a.id, d, type).forEach(function (m) { jobs.push({ d: d, area: a, monster: m, type: type }); });
        });
      });
    });
    return jobs;
  }
  var TYPE_NAMES = { regular: 'regular', champion: 'champion', unique: 'unique' };
  function areaRow(eng, job, target, opts) {
    var src = { type: job.type, cls: job.monster.id, area: job.area.id };
    var r = eng.dropChance(src, target, { difficulty: job.d, players: opts.players, party: opts.party, mf: opts.mf, quest: false, ladder: opts.ladder });
    if (!r || !(r.chance > 0)) return null;
    return {
      key: 'm:' + job.area.key + ':' + job.monster.id + ':' + job.type + '@' + job.d, kind: 'area',
      name: job.monster.name + ' (' + TYPE_NAMES[job.type] + ')', area: job.area.name, difficulty: job.d,
      source: { name: job.monster.name + ' (' + TYPE_NAMES[job.type] + ')', area: job.area.name, src: src, quest: false, areaPick: true },
      chance: r.chance, mlvl: r.mlvl, kills: [{ name: job.monster.name, chance: r.chance }], killsPerRun: 1, runChance: r.chance,
    };
  }

  // ---- ranking ----
  // Area monster rows take the player's kills per run. Rows with a run time come first, by chance
  // per hour; the others follow by chance per run, because without a time nothing says which run is
  // faster. Ties go to the higher chance per kill, then the harder difficulty, then the name.
  // settings: { times: { key: seconds }, kills: { key: n }, hours }
  function rank(rows, settings) {
    var times = settings.times || {}, kills = settings.kills || {};
    var out = rows.map(function (row) {
      var k = row.kind === 'area' ? Math.max(1, Math.min(10000, Math.round(kills[row.key] || 1))) : row.killsPerRun;
      var pRun = row.kind === 'area' ? runChance([[row.chance, k]]) : row.runChance;
      var t = timeStats(pRun, times[row.key], settings.hours);
      var stats = runStats(pRun);
      return { row: row, killsPerRun: k, runChance: pRun, expectedRuns: stats.expectedRuns, runs50: stats.runs50, runs90: stats.runs90, seconds: t ? times[row.key] : null, time: t };
    });
    function tie(a, b) {
      return (b.row.chance || 0) - (a.row.chance || 0) || b.row.difficulty - a.row.difficulty || (a.row.name < b.row.name ? -1 : a.row.name > b.row.name ? 1 : 0) || (a.row.key < b.row.key ? -1 : 1);
    }
    var timed = out.filter(function (x) { return x.time; }).sort(function (a, b) { return b.time.perHour - a.time.perHour || b.runChance - a.runChance || tie(a, b); });
    var untimed = out.filter(function (x) { return !x.time; }).sort(function (a, b) { return b.runChance - a.runChance || tie(a, b); });
    return { timed: timed, untimed: untimed };
  }

  // Saved run times and kills, as they come back from storage: only sensible entries are kept.
  function cleanTimes(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).slice(0, 1000).forEach(function (k) {
      var v = raw[k];
      if (k.length <= 200 && typeof v === 'number' && v >= 1 && v <= MAX_SECONDS) out[k] = v;
    });
    return out;
  }
  function cleanKills(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).slice(0, 1000).forEach(function (k) {
      var v = raw[k];
      if (k.length <= 200 && typeof v === 'number' && v >= 1 && v <= 10000 && Math.round(v) === v) out[k] = v;
    });
    return out;
  }

  var api = {
    RUNS: RUNS, MAX_SECONDS: MAX_SECONDS,
    parseRunTime: parseRunTime, formatClock: formatClock, formatDuration: formatDuration,
    runChance: runChance, runStats: runStats, timeStats: timeStats,
    fixedRows: fixedRows, areaJobs: areaJobs, areaRow: areaRow, rank: rank,
    cleanTimes: cleanTimes, cleanKills: cleanKills,
  };
  root.D2Farm = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
