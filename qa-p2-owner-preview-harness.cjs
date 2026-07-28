#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const read = (file) => fs.readFileSync(file, 'utf8');
const html = read('owner-preview.html');
const source = read('owner-preview.js');
const universalEditor = read('universal-label-editor.js');
const server = read('scripts/serve-owner-preview.mjs');
const build = read('scripts/build-static-release.mjs');

assert.match(html, /owner-preview\.js/);
assert.match(html, /universal-label-canvas\.js/);
assert.match(html, /universal-label-editor\.js/);
assert.doesNotMatch(html, /firebase-(app|auth|firestore)-compat/);
assert.doesNotMatch(html, /firebase-service\.js/);
assert.doesNotMatch(html, /service-worker\.js/);
assert.doesNotMatch(source, /navigator\.serviceWorker/);
assert.doesNotMatch(source, /firebase\.initializeApp|click360Db|click360Auth/);
assert.match(source, /CLICK 360 P2 DEMO/);
assert.match(source, /1\.0\.5-p2-preview/);
assert.match(source, /CLICK360_P2_OWNER_PREVIEW:/);
assert.match(source, /workerAccessEnabled: true solo en preview/);
assert.match(source, /Restaurante avanzado/);
assert.match(source, /Logística y transporte/);
assert.match(source, /Lienzo Universal/);
assert.match(universalEditor, /Imprimir o guardar como PDF/);
assert.match(universalEditor, /Asistente avanzado/);
assert.match(source, /Recargar versión nueva/);
assert.match(build, /owner-preview\.html/);
assert.match(build, /owner-preview\.js/);
assert.match(build, /owner-preview\.css/);
assert.match(server, /0\.0\.0\.0/);
assert.match(server, /Cache-Control':'no-store/);
assert.match(server, /owner-preview\.html/);

console.log('P2 owner preview isolation harness: PASS');
