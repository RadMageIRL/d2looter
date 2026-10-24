// Mutation check: change one rule of the engine at a time, in a temporary copy of the project, and
// confirm the test suite notices. A mutant that survives means no test pins that rule.
//
//   node tests/mutations.mjs            (several minutes: the full suite runs once per mutant)
//
// It never edits the working tree. The unmutated copy must pass first, or nothing is trusted.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
  ['js/core/engine.js', 'var MF_FACTOR = { unique: 250, set: 500, rare: 600, magic: 0 };', 'var MF_FACTOR = { unique: 240, set: 500, rare: 600, magic: 0 };', 'unique MF factor 250'],
  ['js/core/engine.js', 'var MF_FACTOR = { unique: 250, set: 500, rare: 600, magic: 0 };', 'var MF_FACTOR = { unique: 250, set: 480, rare: 600, magic: 0 };', 'set MF factor 500'],
  ['js/core/engine.js', 'var MF_FACTOR = { unique: 250, set: 500, rare: 600, magic: 0 };', 'var MF_FACTOR = { unique: 250, set: 500, rare: 580, magic: 0 };', 'rare MF factor 600'],
  ['js/core/engine.js', 'return mf > 10 ?', 'return mf >= 10 ?', 'MF 10 or less: no diminishing returns'],
  ['js/core/engine.js', 'if (chance < ratio[2]) chance = ratio[2];', '', 'the ratio minimum'],
  ['js/core/engine.js', 'chance = chance - Math.trunc((chance * mod) / 1024);', 'chance = chance - Math.trunc((chance * mod) / 1000);', 'quality modifier in 1024ths'],
  ['js/core/engine.js', 'var base = ratio[0] - Math.trunc(delta / ratio[1]);', 'var base = ratio[0] - Math.floor(delta / ratio[1]);', 'divisor truncates toward zero'],
  ['js/core/engine.js', "M[12 * N + 12] = 1; M[13 * N + 13] = 1; // the cap: nothing more happens after six items", 'M[12 * N + 12] = 1; M[13 * N + 13] = 1; M[10 * N + 12] = 0; M[10 * N + 10] = 1; e[10] = 0; M[10 * N + 13] = 0; M[11 * N + 13] = 0; M[11 * N + 11] = 1; e[11] = 0;', 'six-item cap becomes five'],
  ['js/core/engine.js', 'return p + Math.trunc((P - p) / 2);', 'return p + Math.ceil((P - p) / 2);', 'other players count half, rounded down'],
  ['js/core/engine.js', 'if (n <= 1 || noDrop === 0) return noDrop;', 'if (n < 1 || noDrop === 0) return noDrop;', 'no NoDrop change for one player'],
  ['js/core/engine.js', 'for (var i = 1; i < n; i++) pi *= rho;', 'for (var i = 1; i <= n; i++) pi *= rho;', 'NoDrop exponent n'],
  ['js/core/engine.js', "var bonus = { boss: 0, regular: 0, champion: 2, unique: 3, minion: 3, superunique: 3 }[src.type];", "var bonus = { boss: 0, regular: 0, champion: 3, unique: 3, minion: 3, superunique: 3 }[src.type];", 'champion +2'],
  ['js/core/engine.js', "var bonus = { boss: 0, regular: 0, champion: 2, unique: 3, minion: 3, superunique: 3 }[src.type];", "var bonus = { boss: 0, regular: 0, champion: 2, unique: 3, minion: 3, superunique: 2 }[src.type];", 'superunique +3'],
  ['js/core/engine.js', 'tcs[idx + 1].level <= mlvl) idx++;', 'tcs[idx + 1].level < mlvl) idx++;', 'TC upgrade at level equal to mlvl'],
  ['js/core/engine.js', 'if (d >= 1 && !cls.boss && !cls.noRatio && tcs[idx].group) {', 'if (d >= 0 && !cls.boss && !cls.noRatio && tcs[idx].group) {', 'no TC upgrade in Normal'],
  ['js/core/engine.js', 'if (d >= 1 && !cls.boss && !cls.noRatio && tcs[idx].group) {', 'if (d >= 1 && !cls.noRatio && tcs[idx].group) {', 'no TC upgrade for bosses'],
  ['js/core/engine.js', "if (t.code !== 'tpot' && itemIsType(it, 'tpot') && !options.throwingPotionsInAllClasses) return;", '', 'throwing potions left out of weapon classes'],
  ['js/core/engine.js', 'var uw = function (u) { return Math.max(u.rarity, 1); };', 'var uw = function (u) { return u.rarity + 1; };', 'unique rarity weight'],
  ['js/core/engine.js', 'if (!u.roll || u.lvl > ilvl) return false;', 'if (!u.roll || u.lvl >= ilvl) return false;', 'unique lvl <= ilvl'],
  ['js/core/engine.js', 'return season >= window[0] && (window[1] === 0 || season <= window[1]);', 'return season >= window[0] && (window[1] === 0 || season < window[1]);', 'ladder window includes its last season'],
  ['js/core/prob.js', 'return -Math.expm1(n * Math.log1p(-p));', 'return 1 - Math.pow(1 - p, n);', 'precise at-least-one'],
];

function run(dir) {
  try { execFileSync(process.execPath, ['tests/run.mjs'], { cwd: dir, stdio: 'pipe', timeout: 600000 }); return true; } catch (e) { return false; }
}

const tmp = mkdtempSync(join(tmpdir(), 'd2looter-mut-'));
const copy = join(tmp, 'repo');
cpSync(ROOT, copy, { recursive: true, filter: (p) => !p.includes(`${join(ROOT, '.git')}`) });
let survivors = 0;
try {
  if (!run(copy)) { console.error('BASELINE FAILS: fix the suite before trusting mutants'); process.exit(1); }
  console.log('baseline passes');
  for (const [file, from, to, label] of MUTANTS) {
    const path = join(copy, file);
    const original = readFileSync(path, 'utf8');
    if (!original.includes(from)) { console.log(`MISS  ${label}: text not found`); survivors++; continue; }
    writeFileSync(path, original.replace(from, to));
    const passed = run(copy);
    writeFileSync(path, original);
    console.log(`${passed ? 'LIVES' : 'dies '} ${label}`);
    if (passed) survivors++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${survivors} survivor(s)`);
