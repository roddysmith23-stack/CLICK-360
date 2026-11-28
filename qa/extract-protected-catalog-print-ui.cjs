'use strict';

// Extracts the protected cloud-catalog entry point from app.js for a synthetic
// browser fixture. The function itself is executed verbatim; only its data
// loader, access confirmation and final print handoff are synthetic.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const marker = 'window.click360ShowProtectedCatalog = async function(';
const start = app.indexOf(marker);
if (start < 0) throw new Error(`Could not find ${marker}`);
const argsOpen = start + marker.length - 1;
let parenDepth = 0;
let argsClose = -1;
for (let i = argsOpen; i < app.length; i += 1) {
  if (app[i] === '(') parenDepth += 1;
  else if (app[i] === ')') {
    parenDepth -= 1;
    if (parenDepth === 0) { argsClose = i; break; }
  }
}
if (argsClose < 0) throw new Error('Unbalanced protected catalog function parameters');
const open = app.indexOf('{', argsClose);
if (open < 0) throw new Error('Could not find protected catalog function body');

// Braces inside this function's template/string literals are balanced; skip
// ordinary strings and comments so only JavaScript block/object braces count.
let depth = 0;
let end = -1;
for (let i = open; i < app.length; i += 1) {
  const ch = app[i];
  const next = app[i + 1];
  if (ch === '"' || ch === "'") {
    const quote = ch;
    i += 1;
    for (; i < app.length; i += 1) {
      if (app[i] === '\\') { i += 1; continue; }
      if (app[i] === quote) break;
    }
    continue;
  }
  if (ch === '`') {
    i += 1;
    for (; i < app.length; i += 1) {
      if (app[i] === '\\') { i += 1; continue; }
      if (app[i] === '`') break;
    }
    continue;
  }
  if (ch === '/' && next === '/') {
    i += 2;
    while (i < app.length && app[i] !== '\n') i += 1;
    continue;
  }
  if (ch === '/' && next === '*') {
    i += 2;
    while (i < app.length && !(app[i] === '*' && app[i + 1] === '/')) i += 1;
    i += 1;
    continue;
  }
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end < 0) throw new Error('Unbalanced protected catalog function');
const assignmentStart = app.lastIndexOf('\n', start) + 1;
const functionSource = app.slice(assignmentStart, end);

const outDir = path.join(__dirname, 'fixtures', 'generated');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'protected-catalog-print-ui.bundle.js');
fs.writeFileSync(outPath, [
  '// AUTO-GENERATED from app.js by extract-protected-catalog-print-ui.cjs.',
  'async function executeCanonicalLabelPrint(prepared, providerId, assertCurrent) {',
  '  window.__CLICK360_CATALOG_PRINT_HANDOFF__ = { prepared, providerId };',
  '  return { result:{ status:"handed_off" } };',
  '}',
  functionSource,
  ''
].join('\n'));
console.log(`Wrote ${outPath}`);
