// A static server that imitates a host serving a folder under a base path, so base-path mistakes
// show up as requests outside the base or as 404s. Every request is recorded.
//
// mounts: [{ prefix: '/d2looter/', dir }]
// slash:  'redirect' answers "/d2looter" with a 301 to "/d2looter/" (as GitHub Pages does);
//         'none' serves the page at the bare path, the worst case.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

export function serve({ mounts, slash = 'redirect', port = 0 }) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    const send = (status, body, type = 'text/plain', headers = {}) => {
      requests.push({ path, status });
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    const mount = mounts.find((m) => path.startsWith(m.prefix) || path === m.prefix.slice(0, -1));
    if (!mount) return send(404, 'outside every base path');
    if (path === mount.prefix.slice(0, -1)) {
      if (slash === 'redirect') return send(301, '', 'text/plain', { location: mount.prefix + url.search });
      return send(200, readFileSync(join(mount.dir, 'index.html')), TYPES['.html']);
    }
    let rel = path.slice(mount.prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = resolve(mount.dir, rel);
    if (!file.startsWith(resolve(mount.dir) + sep)) return send(403, 'forbidden');
    if (existsSync(file) && statSync(file).isFile()) return send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
    const nf = mount.notFound && join(mount.dir, mount.notFound);
    if (nf && existsSync(nf)) return send(404, readFileSync(nf), TYPES['.html']);
    return send(404, 'not found');
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    const { port } = server.address();
    ok({
      origin: `http://127.0.0.1:${port}`,
      requests,
      outside: () => requests.filter((r) => !mounts.some((m) => r.path.startsWith(m.prefix) || r.path === m.prefix.slice(0, -1))),
      close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
    });
  }));
}
