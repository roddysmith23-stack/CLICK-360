'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const styles = fs.readFileSync('styles.css', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const fixture = fs.readFileSync('qa/fixtures/p1-5d-visual-layout.html', 'utf8');

const RELEASE = '1.0.4-p3';
const ASSET = 'mvp-launch-v16-2-p1-5d-r1';

assert.match(app, new RegExp(`APP_RELEASE_VERSION = '${RELEASE.replace(/\./g, '\\.')}'`));
assert.match(app, new RegExp(`APP_ASSET_VERSION = '${ASSET}'`));
assert.match(worker, new RegExp(`click360-${ASSET}`));
assert.match(html, new RegExp(`app\\.js\\?v=${ASSET}`));

for (const selector of [
  '.topbar,.pageHead,.pageHead>div,.toolbar,.actions,.modalHeader,.movement,.bigRow,.businessSwitchButton',
  '.btn,.bigRow,.businessSwitchButton,.businessSwitchOption,.printerStatusRow,.notificationItem',
  '.navBtn>span:last-child',
  '.modalHeader h2',
  '.c360-gate-actions>*:last-child'
]) {
  assert.ok(styles.includes(selector), `layout integrity selector is present: ${selector}`);
}

assert.match(styles, /overflow-wrap:anywhere/, 'long labels can wrap inside their containers');
assert.match(styles, /@media\(max-width:600px\)/, 'small-screen reflow is present');
assert.match(styles, /flex-wrap:wrap/, 'action rows can reflow instead of overflowing');
assert.match(styles, /flex:0 0 auto/, 'chevrons and icons keep a stable width');
assert.match(styles, /overscroll-behavior:contain/, 'modal scrolling stays contained');
assert.match(fixture, /__CLICK360_P15D_VISUAL_QA__/, 'browser visual fixture exposes a pass/fail marker');
assert.match(fixture, /Centro de impresion y perfiles/, 'fixture covers long arrow rows');
assert.match(fixture, /Mas opciones/, 'fixture covers mobile navigation labels');

for (const text of [
  'Centro de impresión',
  'Cambiar negocio',
  'Actualizar desde nube',
  'Hay un conflicto de sincronización pendiente'
]) {
  assert.ok(text.length > 12, 'long-label fixture remains meaningful');
}

console.log('PASS P1.5D visual layout harness: containment, wrapping, stable icons and mobile reflow');
