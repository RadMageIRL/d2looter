// Download every pinned table into tools/.cache and check it.
//
//   node tools/fetch-data.mjs            check (download what is missing)
//   node tools/fetch-data.mjs --record   also pin hashes that are not pinned yet
import { loadSources, pinned, saveSources } from './lib/source.mjs';

const record = process.argv.includes('--record');
const src = loadSources();
let count = 0;
for (const [id, p] of Object.entries(src.profiles)) {
  for (const [name, path] of Object.entries(p.files)) {
    await pinned(src.d2data.repo, p.commit, path, p.sha256, name, { record });
    count++;
  }
  console.log(`${id}: ${Object.keys(p.files).length} files ok (${src.d2data.repo}@${p.commit.slice(0, 10)})`);
}
for (const [key, dir] of Object.entries(src.silospenFiles)) {
  if (key === 'tables' || key === 'sha256') continue;
  for (const t of src.silospenFiles.tables) {
    await pinned(src.silospen.repo, src.silospen.commit, `${dir}/${t}.txt`, src.silospenFiles.sha256, `${key}/${t}`, { record });
    count++;
  }
  console.log(`silospen ${key}: ${src.silospenFiles.tables.length} files ok`);
}
for (const [name, o] of Object.entries(src.oracles || {})) {
  if (name === 'about') continue;
  const repo = name === 'd2data' ? src.d2data.repo : src.silospen.repo;
  for (const path of o.files) {
    await pinned(repo, o.commit, path, o.sha256, path, { record });
    count++;
  }
  console.log(`oracle ${name}: ${o.files.length} files ok`);
}
if (record) saveSources(src);
console.log(`${count} files${record ? ', hashes recorded' : ''}`);
