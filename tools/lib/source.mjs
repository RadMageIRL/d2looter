// Pinned game tables: download once into tools/.cache, check every file's SHA-256 against
// tools/sources.json, and hand back parsed rows. Nothing here runs in the browser.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCES_PATH = join(ROOT, 'tools', 'sources.json');
export const CACHE = join(ROOT, 'tools', '.cache');

export const loadSources = () => JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const rawUrl = (repo, commit, path) =>
  `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;

// Returns the file's bytes. Downloads when it is not cached yet. With `record`, a missing hash is
// written into `hashes`; otherwise a missing or different hash is an error.
export async function pinned(repo, commit, path, hashes, key, { record = false, offline = false } = {}) {
  const file = join(CACHE, repo.replace('/', '__'), commit, path);
  let buf;
  if (existsSync(file)) {
    buf = readFileSync(file);
  } else {
    if (offline) throw new Error(`${path} is not cached and --offline was given`);
    const res = await fetch(rawUrl(repo, commit, path));
    if (!res.ok) throw new Error(`${repo}@${commit.slice(0, 10)} ${path}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
  }
  const got = sha256(buf);
  if (!hashes[key]) {
    if (!record) throw new Error(`${path}: no SHA-256 pinned in tools/sources.json (run tools/fetch-data.mjs --record)`);
    hashes[key] = got;
  } else if (hashes[key] !== got) {
    throw new Error(`${path}: SHA-256 ${got} does not match the pinned ${hashes[key]}`);
  }
  return buf;
}

// Every d2data table for a profile, as { name: rows[] } in the game's file order.
export async function profileTables(id, opts = {}) {
  const src = loadSources();
  const p = src.profiles[id];
  if (!p) throw new Error(`unknown profile ${id}`);
  const out = {};
  for (const [name, path] of Object.entries(p.files)) {
    const buf = await pinned(src.d2data.repo, p.commit, path, p.sha256, name, opts);
    const json = JSON.parse(buf.toString('utf8'));
    out[name] = name === 'strings' || name === 'atomic' ? json : jsonRows(json);
  }
  return out;
}

// d2data stores a table as an object keyed by its first column; lineNumber is the row's position
// in the .txt file. Sorting by it restores the order the game reads.
export function jsonRows(json) {
  const rows = Array.isArray(json) ? json.slice() : Object.values(json);
  if (rows.every((r) => typeof r.lineNumber === 'number')) rows.sort((a, b) => a.lineNumber - b.lineNumber);
  return rows;
}

// A raw .txt table (tab separated, header row). Empty cells are left out, as d2data does.
export function txtRows(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const head = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split('\t');
    const row = { lineNumber: rows.length };
    head.forEach((h, j) => {
      const v = (cells[j] ?? '').trim();
      if (v === '') return;
      row[h] = /^-?\d+$/.test(v) ? Number(v) : v;
    });
    rows.push(row);
  }
  return rows;
}

// Silospen's copy of the .txt tables for one version folder, used only by the verifiers.
export async function silospenTables(folderKey, opts = {}) {
  const src = loadSources();
  const dir = src.silospenFiles[folderKey];
  const out = {};
  for (const t of src.silospenFiles.tables) {
    const buf = await pinned(src.silospen.repo, src.silospen.commit, `${dir}/${t}.txt`, src.silospenFiles.sha256, `${folderKey}/${t}`, opts);
    out[t] = txtRows(buf.toString('latin1'));
  }
  return out;
}

// One pinned oracle file (tools/sources.json "oracles"), as text.
export async function oracleFile(name, path, opts = {}) {
  const src = loadSources();
  const o = src.oracles[name];
  if (!o || !o.files.includes(path)) throw new Error(`${path} is not a pinned ${name} oracle file`);
  const repo = name === 'd2data' ? src.d2data.repo : src.silospen.repo;
  return (await pinned(repo, o.commit, path, o.sha256, path, opts)).toString('utf8');
}

export function saveSources(src) {
  writeFileSync(SOURCES_PATH, JSON.stringify(src, null, 2) + '\n');
}
