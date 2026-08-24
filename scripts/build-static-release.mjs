import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const files = [
  'index.html',
  'repair.html',
  'terms.html',
  'privacy.html',
  'styles.css',
  'runtime-guard.js',
  'app.js',
  'firebase-config.js',
  'p0-tenant-guard.js',
  'worker-data-boundary.js',
  'v16-domain.js',
  'v16-storage.js',
  'access-flow.js',
  'firebase-service.js',
  'printing-service.js',
  'smart-print-core.js',
  'p2-web-safe-flags.js',
  'p2-restaurant-domain.js',
  'p2-logistics-domain.js',
  'universal-label-canvas.js',
  'universal-label-editor.js',
  'service-worker.js',
  'manifest.webmanifest',
  'release-manifest.json',
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

let shortSha = process.env.CLICK360_BUILD_SHA || '';
if (!shortSha) {
  try {
    shortSha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    shortSha = 'unknown';
  }
}

const appPath = join(output, 'app.js');
const appSource = await readFile(appPath, 'utf8');
await writeFile(appPath, appSource.replace(
  "const APP_BUILD_SHA = '__CLICK360_BUILD_SHA__';",
  `const APP_BUILD_SHA = '${shortSha}';`
));

// r37.1 (P0-A safe update): release-manifest.json (a real, tracked source
// file -- see build note below) is stamped with the real buildSha and a
// fresh generatedAt so repair.html's {cache:'no-store'} reachability probe
// also proves it isn't looking at a stale copy served from somewhere odd.
const manifestPath = join(output, 'release-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.buildSha = shortSha;
manifest.generatedAt = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`CLICK 360 static release: ${files.length} allowlisted entries copied to dist/, release-manifest.json stamped (version=${manifest.version})`);
