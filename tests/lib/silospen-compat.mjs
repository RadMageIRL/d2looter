// A test-only re-statement of how silospen/DropCalc (MIT) turns a treasure class into a chance
// per kill, so its published expected values can check this project's data handling, monster
// levels, treasure class upgrades and quality rolls digit for digit.
//
// It differs from the app's engine in one deliberate way: Silospen applies the picks of a path
// as 1 - (1 - p)^min(picks, 6), while the engine follows the six-item cap exactly (a seventh pick
// still happens when an earlier pick dropped nothing). The engine is checked separately.
// Source read: src/main/kotlin/com/silospen/dropcalc/treasureclasses/TreasureClassCalculator.kt,
// TreasureClassPathAccumulator.kt, items/ItemLibrary.kt at commit 73d31110.

// Silospen's NoDrop: exponent floor(1 + (players-1)/2 + (party-1)/2), rate^n / (1 - rate^n) * total,
// floored. It rounds through BigDecimal; for the player counts in its fixtures that matches doubles.
export function silospenNoDrop(total, noDrop, players, party) {
  if (!noDrop || noDrop < 1) return 0;
  if (players <= 1) return noDrop;
  const n = Math.floor(1 + (players - 1) / 2 + (party - 1) / 2);
  const rate = Math.pow(noDrop / (noDrop + total), n);
  return Math.floor((rate / (1 - rate)) * total);
}

// Returns the fork paths: a list of Map(outcomeKey -> { p, q:[u,s,r,m], picks }).
export function silospenPaths(eng, rootIdx, { players = 1, party = 1, leafKind = 'base' } = {}) {
  const forks = [new Map()];
  const tcs = eng.tcs;
  const merge = (a, b) => a.map((x, i) => Math.max(x, b[i]));
  function walk(node, num, den, parentPicks, pathP, q, accPicks) {
    const isTc = node.kind === 'tc';
    const tc = isTc ? tcs[node.idx] : null;
    const configured = isTc ? tc.picks : 1;
    const adjusted = configured < 0 ? accPicks : configured;
    const updatedAcc = parentPicks < 0 ? num * accPicks * adjusted : accPicks * adjusted;
    const selP = parentPicks < 0 ? 1 : (num / den) * pathP;
    if (parentPicks < 0 && forks[forks.length - 1].size) forks.push(new Map());
    const quality = isTc ? merge(q, tc.q) : q;
    const isLeaf = !isTc || (tc.auto && leafKind === 'atomic');
    if (isLeaf && !(isTc && leafKind === 'base')) {
      const key = isTc ? tc.name : node.kind === 'item' ? node.code : node.key;
      const acc = forks[forks.length - 1];
      const old = acc.get(key);
      acc.set(key, { p: selP + (old ? old.p : 0), q: old ? merge(old.q, quality) : quality, picks: updatedAcc, node });
      return;
    }
    const total = tc.entries.reduce((a, e) => a + e.prob, 0);
    if (!total) return;
    const denom = total + silospenNoDrop(total, tc.nodrop, players, party);
    for (const e of tc.entries) walk(e, e.prob, denom, configured, selP, quality, updatedAcc);
  }
  walk({ kind: 'tc', idx: rootIdx }, 1, 1, 1, 1, [0, 0, 0, 0], 1);
  return forks;
}

const applyPicks = (p, picks) => (picks === 1 ? p : 1 - Math.pow(1 - p, Math.min(picks, 6)));

// Final chance for one outcome key, with an extra factor per path (quality x rarity share).
export function silospenFinal(forks, key, factor = () => 1) {
  let none = 1, any = false;
  for (const f of forks) {
    const o = f.get(key);
    if (!o) continue;
    any = true;
    none *= 1 - applyPicks(o.p * factor(o.q), o.picks);
  }
  return any ? 1 - none : 0;
}

// Silospen's chance that a kill drops a given unique or set item at monster level mlvl. Like
// Silospen it counts a unique that is enabled OR marked ladder, so Azurewrath (ladder, but
// enabled 0 in 1.12a-1.14d) takes a share; the engine follows the spec (11.3: enabled = 1).
export function silospenItemChance(eng, rootIdx, target, mlvl, mf, opts = {}) {
  const forks = silospenPaths(eng, rootIdx, opts);
  const item = eng.item(target.code);
  const list = target.kind === 'unique' ? eng.data.uniques : eng.data.setItems;
  const eligible = list.filter((x) => x.code === target.code && x.lvl <= mlvl && (x.roll || x.ladder === true));
  const sum = eligible.reduce((a, x) => a + x.rarity, 0);
  const me = eligible.find((x) => (x.id || x.key) === (target.id || target.key));
  if (!me) return 0;
  return silospenFinal(forks, target.code, (q) => {
    const roll = eng.qualityRoll(item, mlvl, q, mf);
    return (target.kind === 'unique' ? roll.unique : roll.set) * (me.rarity / sum);
  });
}
