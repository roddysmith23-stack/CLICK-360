import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  'safe-update.js',
  'app.js',
  'firebase-config.js',
  'p0-tenant-guard.js',
  'worker-data-boundary.js',
  'v16-domain.js',
  'tenant-quota-overrides.js',
  'v16-storage.js',
  'access-flow.js',
  'firebase-service.js',
  'printing-service.js',
  'smart-print-core.js',
  'p2-web-safe-flags.js',
  'p2-restaurant-domain.js',
  'p2-logistics-domain.js',
  'cash-session-reconciliation.js',
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
const swPath = join(output, 'service-worker.js');
await writeFile(swPath, (await readFile(swPath, 'utf8')).replace('__CLICK360_SW_BUILD_SHA__', shortSha));
// Catch a first upgrade boot served partly by an older network-first worker.
for (const entry of ['app.js', 'firebase-service.js', 'tenant-quota-overrides.js', 'v16-storage.js']) {
  const file = join(output, entry);
  const stamp = `globalThis.CLICK360_RELEASE_ASSETS ||= {}; globalThis.CLICK360_RELEASE_ASSETS[${JSON.stringify(entry)}] = ${JSON.stringify(shortSha)};\n`;
  await writeFile(file, stamp + await readFile(file, 'utf8'));
}

// r37.1 (P0-A safe update): release-manifest.json (a real, tracked source
// file -- see build note below) is stamped with the real buildSha. Use an
// explicit CI build time or the immutable commit time so identical source
// produces byte-for-byte identical artifacts.
const manifestPath = join(output, 'release-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.buildSha = shortSha;
let generatedAt = process.env.CLICK360_BUILD_TIME || '';
if (!generatedAt) {
  try {
    generatedAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    generatedAt = new Date(0).toISOString();
  }
}
manifest.generatedAt = new Date(generatedAt).toISOString();
manifest.assetHashes = {};
const swSource = await readFile(swPath, 'utf8');
const precache = swSource.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
for (const [, asset] of precache.matchAll(/'\.\/([^']*)'/g)) {
  const entry = asset || 'index.html';
  manifest.assetHashes[entry] = createHash('sha256').update(await readFile(join(output, entry))).digest('hex');
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`CLICK 360 static release: ${files.length} allowlisted entries copied to dist/, release-manifest.json stamped (version=${manifest.version})`);
