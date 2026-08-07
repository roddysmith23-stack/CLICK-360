'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js','utf8');
const css = fs.readFileSync('styles.css','utf8');
const firebase = fs.readFileSync('firebase-service.js','utf8');
const runtime = fs.readFileSync('runtime-guard.js','utf8');
const sw = fs.readFileSync('service-worker.js','utf8');

assert(app.includes("if (result?.refreshed === true)"), 'empty-device success message requires a real remote refresh');
assert(!app.includes("if (result?.ok) {\n\t\t            closeModal(false);\n\t\t            renderApp(route);\n\t\t            toast('✅ Tus datos se actualizaron desde la nube.'"), 'old optimistic empty-device success condition removed');
assert(app.includes('Este dispositivo está vacío y no reemplazará los datos de la nube.'), 'empty-device safe fallback remains visible');
assert(firebase.includes('preventedEmptyOverwrite: true'), 'empty local overwrite remains blocked in firebase layer');
assert(firebase.includes("appVersion: '16.2.0'"), 'worker invitation contract remains compatible with Firestore rules');
assert(css.includes('CLICK 360 label stability: footer participates in mobile modal layout'), 'label footer mobile stability override present');
assert(css.includes('position:relative!important;'), 'mobile label footer is not fixed over wizard content');

for (const [name,text] of [['app',app],['firebase',firebase],['runtime',runtime],['service-worker',sw],['styles',css]]) {
  assert(!text.includes('commercial-1-0-5-r20'), `${name} must not contain stale r20 runtime assets`);
  assert(!text.includes('commercial-1-0-5-r28'), `${name} must not contain stale r28 runtime assets`);
}
assert(app.includes("commercial-1-0-5-r30"));
assert(firebase.includes("commercial-1-0-5-r30"));
assert(runtime.includes("commercial-1-0-5-r30"));
assert(sw.includes("commercial-1-0-5-r30"));

console.log('CLICK360_STABILITY_CANDIDATE_FINAL: PASS');
