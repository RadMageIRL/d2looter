// What a player can kill, for the drop calculator: bosses, superuniques and the monsters of each
// area. Bosses have fixed levels, so their area is only a label; their areas are not in the game
// tables (the game places them by script) and come from silospen/DropCalc HardcodedAreas.kt.
// Superunique areas come from d2data's superuniques.json (areaId) and are checked against the
// same Silospen list in tests/run.mjs.
(function (root) {
  'use strict';

  // [monster id, area key(s), group, name when the game's name is ambiguous]
  var BOSSES = [
    ['andariel', 'Act 1 - Catacombs 4', 'Act bosses'],
    ['duriel', "Act 2 - Duriel's Lair", 'Act bosses'],
    ['mephisto', 'Act 3 - Mephisto 3', 'Act bosses'],
    ['diablo', 'Act 4 - Diablo 1', 'Act bosses'],
    ['baalcrab', 'Act 5 - World Stone', 'Act bosses'],
    ['bloodraven', 'Act 1 - Graveyard', 'Bosses'],
    ['izual', 'Act 4 - Mesa 2', 'Bosses'],
    ['putriddefiler1', 'Act 5 - Temple 2', 'Bosses'],
    ['putriddefiler2', 'Act 5 - Baal Temple 1', 'Bosses'],
    ['putriddefiler3', 'Act 5 - Baal Temple 1', 'Bosses'],
    ['putriddefiler4', 'Act 5 - Baal Temple 3', 'Bosses'],
    ['putriddefiler5', 'Act 5 - Baal Temple 3', 'Bosses'],
    ['uberandariel', 'Act 5 - Pandemonium 1', 'Uber bosses'],
    ['uberduriel', 'Act 5 - Pandemonium 2', 'Uber bosses'],
    ['uberizual', 'Act 5 - Pandemonium 3', 'Uber bosses'],
    ['diabloclone', '', 'Uber bosses', 'Diablo Clone'],
  ];
  var PANDEMONIUM = /^Act 5 - Pandemonium/;
  // Superuniques d2data gives no area for, placed by silospen/DropCalc HardcodedAreas.kt. The
  // others without an area (Flamespike the Crawler, Winged Death and eight more) are not placed
  // anywhere by either source and are left out.
  // Stormtree is the one superunique the two sources place differently (d2data: Flayer Jungle,
  // Silospen: Lower Kurast); only Nightmare's level differs (50 or 52). Lower Kurast is used.
  var SUPERUNIQUE_AREAS = { 'The Summoner': 'Act 2 - Arcane', 'Ancient Kaa the Soulless': 'Act 2 - Tomb Tal 1', Stormtree: 'Act 3 - Kurast 1' };

  function create(data, eng) {
    var levelByKey = new Map(data.levels.map(function (l) { return [l.key, l]; }));
    var levelById = new Map(data.levels.map(function (l) { return [l.id, l]; }));

    function areaName(id) { var l = levelById.get(id); return l ? l.name : ''; }
    function superuniqueArea(su) {
      if (SUPERUNIQUE_AREAS[su.key]) return levelByKey.get(SUPERUNIQUE_AREAS[su.key]) || null;
      if (su.areaId !== undefined && levelById.has(su.areaId)) return levelById.get(su.areaId);
      return null;
    }

    // Fixed sources: bosses (and their first-kill quest variant) and superuniques.
    function fixed(d) {
      var out = [];
      BOSSES.forEach(function (b) {
        var m = data.monsters[b[0]];
        if (!m || !m.tc.reg || !m.tc.reg[d]) return;
        var lv = b[1] ? levelByKey.get(b[1]) : null;
        var base = { type: 'boss', cls: b[0], area: lv ? lv.id : null };
        out.push({ id: 'b:' + b[0], name: b[3] || m.name, group: b[2], area: lv ? lv.name : '', src: base, quest: false });
        // D2R gives some bosses their quest class on every kill; then there is nothing separate to show.
        if (m.questId && m.tc.quest && m.tc.quest[d] && m.tc.quest[d] !== m.tc.reg[d]) out.push({ id: 'q:' + b[0], name: m.name + ' (quest kill)', group: b[2], area: lv ? lv.name : '', src: base, quest: true });
      });
      data.superUniques.forEach(function (su) {
        var m = data.monsters[su.cls];
        if (!m || !su.tc[d]) return;
        var lv = superuniqueArea(su);
        if (!lv) return;
        if (d < 2 && PANDEMONIUM.test(lv.key)) return;
        var src = { type: 'superunique', su: su.key, cls: su.cls, area: lv.id };
        out.push({ id: 's:' + su.key, name: su.name, group: 'Superuniques', area: lv.name, src: src, quest: false });
        if (m.questId && m.tc.quest && m.tc.quest[d] && m.tc.quest[d] !== su.tc[d]) out.push({ id: 'sq:' + su.key, name: su.name + ' (quest kill)', group: 'Superuniques', area: lv.name, src: src, quest: true });
      });
      return out;
    }

    // Areas that have monsters on this difficulty (Normal uses mon/umon, NM and Hell use nmon).
    function areas(d) {
      return data.levels.filter(function (l) {
        if (!l.mlvl[d]) return false;
        if (d < 2 && PANDEMONIUM.test(l.key)) return false;
        return (d === 0 ? l.mon : l.nmon).length > 0;
      });
    }

    // Monster classes in an area for a type: 'regular' | 'champion' | 'unique' | 'minion'.
    function areaMonsters(areaId, d, type) {
      var l = levelById.get(areaId);
      if (!l) return [];
      var list = d === 0 ? (type === 'regular' ? l.mon : l.umon) : l.nmon;
      var seen = new Set();
      return list.filter(function (id) {
        if (seen.has(id)) return false;
        seen.add(id);
        var m = data.monsters[id];
        if (!m || m.boss || m.ally || m.npc) return false;
        var col = { regular: 'reg', minion: 'reg', champion: 'champ', unique: 'unique' }[type];
        return !!(m.tc[col] && m.tc[col][d]);
      }).map(function (id) { return { id: id, name: data.monsters[id].name }; });
    }

    return { fixed: fixed, areas: areas, areaMonsters: areaMonsters, areaName: areaName, superuniqueArea: superuniqueArea, BOSSES: BOSSES };
  }

  var api = { create: create, BOSSES: BOSSES };
  root.D2Sources = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
