'use strict';

const { createReadStream, statSync } = require('node:fs');
const { createServer } = require('node:http');
const { extname, normalize, resolve } = require('node:path');

const root = resolve(process.cwd());
const port = Number(process.argv[2] || 4196);
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

createServer((request, response) => {
  const pathname = decodeURIComponent(String(request.url || '/').split('?')[0]);
  const relative = normalize(pathname === '/' ? '/qa/fixtures/p2-cloud-multiuser.html' : pathname).replace(/^([/\\])+/, '');
  const target = resolve(root, relative);
  if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const stat = statSync(target);
    if (!stat.isFile()) throw new Error('not_file');
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': types[extname(target)] || 'application/octet-stream' });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log('P2 cloud static QA server listening on ' + port));
