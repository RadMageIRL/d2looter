// Local preview over http (the app also opens straight from index.html):
//
//   node tools/serve.mjs [--port 8023]     then visit http://127.0.0.1:8023/d2looter/
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8023;
const server = await serve({ port, mounts: [{ prefix: '/d2looter/', dir: ROOT }] });
console.log(`D2Looter preview (Ctrl+C to stop): ${server.origin}/d2looter/`);
