// Item property text, built from the profile's own Properties, ItemStatCost and string tables
// the way the game builds its tooltips (descfunc / descval / descstr), so a unique shows the
// same lines it shows in game. Value ranges are written as (min-max).
//
// 1.14d strings are plain ("Mana stolen per hit") and the description function places the value;
// D2R strings carry their own placeholders ("%d%% Mana stolen per hit"), which are filled in.
(function (root) {
  'use strict';

  function hasFormat(s) { return /%[+]?[dis]/.test(s); }

  // printf subset: %d %i %s %+d %%
  function sprintf(tpl, args) {
    var i = 0;
    return String(tpl).replace(/%(\+?)([dis%])/g, function (m, plus, k) {
      if (k === '%') return '%';
      var a = args[i++];
      if (a === undefined) return '';
      if (plus && k !== 's') return signed(a);
      return String(a.text !== undefined ? a.text : a);
    });
  }

  // A value or range for display. `v` is { min, max } or a number.
  function V(min, max, scale) {
    var f = scale || function (x) { return x; };
    var a = f(min), b = f(max === undefined ? min : max);
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return { min: lo, max: hi, text: lo === hi ? num(lo) : '(' + num(lo) + '-' + num(hi) + ')' };
  }
  function num(x) { return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000); }
  function signed(v) {
    var t = v.text !== undefined ? v.text : String(v);
    var neg = (v.min !== undefined ? v.min : Number(v)) < 0;
    return neg || t.charAt(0) === '-' ? t : '+' + t;
  }
  function negate(v) { return V(-v.max, -v.min); }
  // "-(3-5)" for a value the game shows as a reduction.
  function minus(v) { return v.min < 0 ? signed(v) : '-' + v.text; }

  function create(data) {
    var props = data.properties, stats = data.stats, strings = data.strings || {};
    var skillByKey = new Map();
    (data.skills || []).forEach(function (s, i) { if (s) skillByKey.set(s.key.toLowerCase(), i); });
    var classByCode = { ama: 0, sor: 1, nec: 2, pal: 3, bar: 4, dru: 5, ass: 6, war: 7 };

    function skill(par) {
      if (par === '' || par === undefined) return null;
      var id = typeof par === 'number' || /^\d+$/.test(String(par)) ? Number(par) : skillByKey.get(String(par).toLowerCase());
      return id === undefined ? null : data.skills[id] || null;
    }
    function skillName(par) { var s = skill(par); return s ? s.name : String(par); }
    function classOnly(cls) {
      var i = classByCode[cls];
      var c = i === undefined ? null : data.classes[i];
      return c && c.only ? ' ' + c.only : '';
    }

    // The game's description functions (ItemStatCost descfunc).
    function statLine(st, v, param, extra) {
      var s = stats[st];
      if (!s || !s.func) return null;
      var neg = v.min < 0 && v.max <= 0;
      var str = (neg ? s.neg : s.pos) || s.pos || '';
      var str2 = s.str2 || '';
      var dv = s.val || 0; // an empty descval is 0: the string alone
      var f = s.func;
      if (extra && extra.perLevel) v = { min: v.min, max: v.max, text: extra.perLevel };
      if (hasFormat(str) && f !== 13 && f !== 14 && f !== 15 && f !== 16 && f !== 24 && f !== 27 && f !== 28) {
        var args = [f === 20 || f === 21 ? { min: -v.max, max: -v.min, text: minus(v) } : f === 5 || f === 10 ? V(v.min, v.max, function (x) { return Math.floor(x * 100 / 128); }) : v];
        return join(sprintf(str, args), str2 && f >= 6 && f <= 10 && !(extra && extra.perLevel) ? str2 : '');
      }
      var place = function (val) { return dv === 2 ? join(str, val) : dv === 0 ? str : join(val, str); };
      switch (f) {
        case 1: return place(signed(v));
        case 2: return place(v.text + '%');
        case 3: return place(v.text);
        case 4: return place(signed(v) + '%');
        case 5: return place(V(v.min, v.max, function (x) { return Math.floor(x * 100 / 128); }).text + '%');
        case 6: return join(place(signed(v)), extra && extra.perLevel ? '' : str2);
        case 7: return join(place(v.text + '%'), extra && extra.perLevel ? '' : str2);
        case 8: return join(place(signed(v) + '%'), extra && extra.perLevel ? '' : str2);
        case 9: return join(place(v.text), str2);
        case 10: return join(place(V(v.min, v.max, function (x) { return Math.floor(x * 100 / 128); }).text + '%'), str2);
        case 11: return 'Repairs 1 durability in ' + V(v.min, v.max, function (x) { return x ? Math.round(100 / x) : 0; }).text + ' seconds';
        case 12: return v.max > 1 ? place(signed(v)) : str;
        case 13: {
          var c = data.classes[param | 0];
          var t = c ? c.allSkills : str;
          return hasFormat(t) ? sprintf(t, [v]) : join(signed(v), t);
        }
        case 14: {
          var cls = (param | 0) >> 3, tab = (param | 0) & 7;
          var cc = data.classes[cls];
          var tt = cc && cc.tabs[tab] ? cc.tabs[tab] : str;
          var line = hasFormat(tt) ? sprintf(tt, [v]) : join(signed(v), tt);
          return cc && cc.only ? join(line, cc.only) : line;
        }
        case 15: {
          // A level of 0 makes the game derive the skill level from the item level.
          if (extra.level.max === 0) return sprintf(str, [extra.chance, { text: "@LEVEL@" }, skillName(extra.skill)]).replace(/ ?level @LEVEL@/i, "") + " (skill level set by item level)";
          return sprintf(str, [extra.chance, extra.level, skillName(extra.skill)]);
        }
        case 16: return sprintf(str, [v, skillName(param)]);
        case 19: return sprintf(str, [v]);
        case 20: return place(minus(v) + '%');
        case 21: return place(minus(v));
        case 22: case 23: return join(place(v.text + '%'), String(param));
        case 24: {
          var sk = skillName(extra.skill);
          var charges = extra.charges;
          return hasFormat(str) && /%s/.test(str) ? sprintf(str, [extra.level, sk, charges, charges]) : 'Level ' + extra.level.text + ' ' + sk + ' ' + sprintf(str, [charges, charges]);
        }
        case 27: {
          var s27 = skill(param);
          return signed(v) + ' to ' + (s27 ? s27.name : String(param)) + (s27 ? classOnly(s27.cls) : '');
        }
        case 28: return signed(v) + ' to ' + skillName(param);
        default: return place(v.text);
      }
    }

    var PAIRS = [
      ['mindamage', 'maxdamage', 'strModMinDamageRange', 'strModMinDamage'],
      ['firemindam', 'firemaxdam', 'strModFireDamageRange', 'strModFireDamage'],
      ['lightmindam', 'lightmaxdam', 'strModLightningDamageRange', 'strModLightningDamage'],
      ['coldmindam', 'coldmaxdam', 'strModColdDamageRange', 'strModColdDamage'],
      ['magicmindam', 'magicmaxdam', 'strModMagicDamageRange', 'strModMagicDamage'],
    ];

    // props: [[code, par, min, max]]. Returns [{ text, prio }] in the game's order (high first).
    var propsLower = {};
    Object.keys(props).forEach(function (k) { if (!propsLower[k.toLowerCase()]) propsLower[k.toLowerCase()] = props[k]; });
    var propGroups = data.propertyGroups || {};

    function describe(list) {
      var entries = []; // { stat, v, param, extra, prio }
      var lines = [];
      var unknown = [];
      list.forEach(function (p) {
        var code = p[0], par = p[1], min = p[2], max = p[3];
        if (String(code).charAt(0) === '*') return; // commented out in the table; the game skips it
        var group = propGroups[code] || propGroups[String(code).toLowerCase()];
        if (group) {
          var opts = group.options.map(function (o) { return describe([o.slice(0, 4)]).lines.join(', '); }).filter(Boolean);
          lines.push({ text: 'One random property of: ' + opts.join(' / '), prio: 0, group: true });
          return;
        }
        var def = props[code] || propsLower[String(code).toLowerCase()];
        if (!def) { unknown.push(code); return; }
        var last = null;
        def.forEach(function (part) {
          var func = part[0], st = part[1], val = part[3];
          var v;
          switch (func) {
            case 1: case 2: case 8: case 13: v = V(min, max); break;
            case 3: v = last; break;
            case 5: entries.push({ special: 'dmg-min', v: V(min, max), prio: 127 }); return;
            case 6: entries.push({ special: 'dmg-max', v: V(min, max), prio: 126 }); return;
            case 7: entries.push({ special: 'dmg%', v: V(min, max), prio: 129 }); return;
            // skilltab: the table gives tab 0-20 (class * 3 + tab); the stat stores class << 3 | tab.
            case 10: entries.push({ stat: st, v: V(min, max), param: ((Number(par) / 3 | 0) << 3) | (Number(par) % 3) }); return;
            case 11: entries.push({ stat: st, v: V(max, max), extra: { chance: V(min, min), level: V(max, max), skill: par } }); return;
            // skill-rand: +par levels to one random skill with an id from min to max.
            case 12: {
              var first = data.skills[min];
              var cls = first ? first.cls : '';
              var ci = classByCode[cls];
              var cname = ci !== undefined && data.classes[ci] ? data.classes[ci].name : '';
              lines.push({ text: signed(V(Number(par), Number(par))) + ' to a random ' + (cname ? cname + ' ' : '') + 'skill', prio: 81 });
              return;
            }
            case 14: { var n = par !== '' && par !== undefined ? V(Number(par), Number(par)) : V(min, max); lines.push({ text: fmtString('Socketable', 'Socketed (%d)', [n]), prio: 1 }); return; }
            case 15: v = V(min, min); break;
            case 16: v = V(max, max); break;
            case 17: {
              var s = stats[st] || {};
              var scale = s.opParam ? Math.pow(2, s.opParam) : 1;
              if (s.op && s.opBase === 'level') {
                var per = Number(par) / scale;
                v = V(Math.floor(per), Math.floor(per * 99));
                entries.push({ stat: st, v: v, param: par, extra: { perLevel: num(per) + ' per character level (' + v.min + '-' + v.max + ')' } });
                last = v;
                return;
              }
              v = V(Number(par), Number(par));
              break;
            }
            case 19: entries.push({ stat: st, v: V(max, max), extra: { level: V(max, max), charges: V(min, min), skill: par } }); return;
            case 20: lines.push({ text: strings.ModStre9s || 'Indestructible', prio: 0 }); return;
            case 21: entries.push({ stat: st, v: V(min, max), param: val }); last = V(min, max); return;
            case 22: entries.push({ stat: st, v: V(min, max), param: par }); return;
            case 23: lines.push({ text: strings.strethereal || 'Ethereal (Cannot be Repaired)', prio: 0 }); return;
            case 24: return; // states and hidden counters show nothing
            case 36: lines.push({ text: signed(V(val, val)) + ' to Random Character Class Skill Levels', prio: 150 }); return;
            default: v = V(min, max);
          }
          last = v;
          if (st) entries.push({ stat: st, v: v, param: par });
        });
      });

      // Combine damage pairs the way the game does ("Adds 10-20 fire damage").
      var byStat = new Map();
      entries.forEach(function (e, i) { if (e.stat && !byStat.has(e.stat)) byStat.set(e.stat, i); });
      var used = new Set();
      PAIRS.forEach(function (pair) {
        var a = byStat.get(pair[0]), b = byStat.get(pair[1]);
        if (a === undefined || b === undefined) return;
        var ea = entries[a], eb = entries[b];
        used.add(a); used.add(b);
        var prio = (stats[pair[0]] || {}).prio || 100;
        if (ea.v.text === eb.v.text) lines.push({ text: fmtString(pair[3], '+%d damage', [ea.v]), prio: prio });
        else lines.push({ text: fmtString(pair[2], 'Adds %d-%d damage', [ea.v, eb.v]), prio: prio });
      });
      // Poison: bitrate over frames.
      var pmin = byStat.get('poisonmindam'), pmax = byStat.get('poisonmaxdam'), plen = byStat.get('poisonlength');
      if (pmin !== undefined && pmax !== undefined && plen !== undefined) {
        var len = entries[plen].v.max;
        var tot = function (x) { return Math.round((x * len) / 256); };
        var lo = V(entries[pmin].v.min, entries[pmin].v.max, tot), hi = V(entries[pmax].v.min, entries[pmax].v.max, tot);
        var secs = V(Math.round(len / 25), Math.round(len / 25));
        lines.push({ text: lo.text === hi.text ? fmtString('strModPoisonDamage', '+%d poison damage over %d seconds', [lo, secs]) : fmtString('strModPoisonDamageRange', 'Adds %d-%d poison damage over %d seconds', [lo, hi, secs]), prio: 92 });
        used.add(pmin); used.add(pmax); used.add(plen);
      }
      // dmg-min / dmg-max properties (weapon base damage).
      var smin = entries.findIndex(function (e) { return e.special === 'dmg-min'; });
      var smax = entries.findIndex(function (e) { return e.special === 'dmg-max'; });
      if (smin >= 0 && smax >= 0) {
        lines.push({ text: fmtString('strModMinDamageRange', 'Adds %d-%d damage', [entries[smin].v, entries[smax].v]), prio: 127 });
        used.add(smin); used.add(smax);
      }
      // Description groups ("All Resistances +20") when every member has the same value.
      var groups = new Map();
      entries.forEach(function (e, i) {
        if (used.has(i) || !e.stat) return;
        var s = stats[e.stat];
        if (s && s.dgrp) { if (!groups.has(s.dgrp)) groups.set(s.dgrp, []); groups.get(s.dgrp).push(i); }
      });
      groups.forEach(function (idxs, g) {
        var members = Object.keys(stats).filter(function (k) { return stats[k].dgrp === g; });
        var vals = idxs.map(function (i) { return entries[i].v.text; });
        var present = new Set(idxs.map(function (i) { return entries[i].stat; }));
        if (members.length < 2 || !members.every(function (m) { return present.has(m); }) || new Set(vals).size !== 1) return;
        var s0 = stats[entries[idxs[0]].stat];
        var str = s0.dgrpPos || '';
        var v = entries[idxs[0]].v;
        var text = hasFormat(str) ? sprintf(str, [v]) : s0.dgrpFunc === 19 ? sprintf(str, [v]) : s0.dgrpVal === 2 ? join(str, signed(v)) : join(signed(v), str);
        lines.push({ text: text, prio: s0.prio || 0 });
        idxs.forEach(function (i) { used.add(i); });
      });

      entries.forEach(function (e, i) {
        if (used.has(i)) return;
        if (e.special === 'dmg%') { lines.push({ text: fmtString('strModEnhancedDamage', '%+d%% Enhanced Damage', [e.v], true), prio: e.prio }); return; }
        if (e.special === 'dmg-min') { lines.push({ text: signed(e.v) + ' to Minimum Damage', prio: e.prio }); return; }
        if (e.special === 'dmg-max') { lines.push({ text: signed(e.v) + ' to Maximum Damage', prio: e.prio }); return; }
        var t = statLine(e.stat, e.v, e.param, e.extra);
        if (t) lines.push({ text: t, prio: (stats[e.stat] || {}).prio || 0 });
      });
      lines.sort(function (a, b) { return b.prio - a.prio; });
      return { lines: lines.map(function (l) { return l.text.replace(/\s+/g, ' ').trim(); }), unknown: unknown };
    }

    // A string from the table, or the given fallback. `percentFirst` handles 1.14d's plain
    // "Enhanced damage" (shown as "+X% Enhanced damage").
    function fmtString(key, fallback, args, percentFirst) {
      var s = strings[key];
      if (s && hasFormat(s)) return sprintf(s, args);
      if (s && percentFirst) return signed(args[0]) + '% ' + s;
      if (s && key === 'Socketable') return s + ' (' + args[0].text + ')';
      return sprintf(fallback, args);
    }

    return { describe: describe, skillName: skillName };
  }

  function join(a, b) { return [a, b].filter(Boolean).join(' '); }

  var api = { create: create, sprintf: sprintf };
  root.D2Props = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
