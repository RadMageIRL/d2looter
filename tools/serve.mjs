// Local preview over http (the app also opens straight from index.html):
//
//   node tools/serve.mjs [--port 8023]     then visit http://127.0.0.1:8023/d2looter/
//
// Like radmagelabs.com, it passes /d2looter/news.json through to Blizzard's Diablo II: Resurrected
// news list, so the news panel shows the live headlines here too.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve } from './lib/static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8023;
const News = createRequire(import.meta.url)('../js/core/news.js');
const news = async () => {
  const res = await fetch(News.FEED, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  return { status: res.status, type: res.headers.get('content-type') || 'application/json', body: Buffer.from(await res.arrayBuffer()) };
};
const server = await serve({ port, mounts: [{ prefix: '/d2looter/', dir: ROOT }], routes: { '/d2looter/news.json': news } });
console.log(`D2Looter preview (Ctrl+C to stop): ${server.origin}/d2looter/`);
