import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const port = Number(process.env.CLICK360_OWNER_PREVIEW_PORT || process.argv[2] || 4173);
const mimeTypes = Object.freeze({
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp', '.woff2':'font/woff2'
});

if (!existsSync(join(root, 'owner-preview.html'))) {
  console.error('No existe dist/owner-preview.html. Ejecuta npm run build:static antes de iniciar el preview.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('El puerto debe estar entre 1024 y 65535.');
  process.exit(1);
}

function localAddresses() {
  return Object.values(networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => item.address);
}

const server = createServer(async (request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://preview.local').pathname);
  const relative = requestPath === '/' ? 'owner-preview.html' : requestPath.replace(/^\/+/, '');
  const target = resolve(root, normalize(relative));
  if (!target.startsWith(`${root}/`) && target !== root) {
    response.writeHead(403, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    response.end('Forbidden');
    return;
  }
  try {
    const details = await stat(target);
    if (!details.isFile()) throw new Error('not_file');
    response.writeHead(200, {
      'Content-Type':mimeTypes[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer'
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    response.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  const addresses = localAddresses();
  console.log('CLICK 360 P2 OWNER PREVIEW is local-only. No Firebase, Functions, or Service Worker are started.');
  console.log(`Desktop: http://127.0.0.1:${port}/owner-preview.html`);
  addresses.forEach((address) => console.log(`Phone on the same Wi-Fi: http://${address}:${port}/owner-preview.html`));
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
