import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
  'smart-print-core.js',
  'universal-label-canvas.js',
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

console.log(`CLICK 360 static release: ${files.length} allowlisted entries copied to dist/`);
