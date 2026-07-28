import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const invokedName = basename(process.argv[1] || '');
const invokedAsWrapper = invokedName === 'admin-tool-wrapper.mjs';
const tool = invokedAsWrapper
  ? String(process.argv[2] || '')
  : invokedName.replace(/\.mjs$/, '');
const allowed = new Set([
  'admin-access-v16',
  'audit-firestore-legacy',
  'migrate-legacy-v9-to-v10',
  'normalize-approved-owner-access'
]);

if (!allowed.has(tool)) {
  throw new Error(`Unknown administrative tool: ${tool || '(missing)'}`);
}

const entry = join(root, 'tools', 'admin', 'scripts', `${tool}.mjs`);
if (!existsSync(entry)) {
  throw new Error(`Administrative package is not installed. Run: npm ci --prefix tools/admin`);
}

const args = invokedAsWrapper ? process.argv.slice(3) : process.argv.slice(2);
const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit' });
child.once('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));
