import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const files = [
  'index.html',
  'styles.css',
  'runtime-guard.js',
  'app.js',
  'firebase-config.js',
  'p0-tenant-guard.js',
  'v16-domain.js',
  'v16-storage.js',
  'access-flow.js',
  'firebase-service.js',
  'printing-service.js',
  'service-worker.js',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'assets',
  'vendor'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of files) {
  await cp(join(root, entry), join(output, entry), { recursive: true });
}

console.log(`CLICK 360 static release: ${files.length} allowlisted entries copied to dist/`);
