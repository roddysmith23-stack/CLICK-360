'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

// Release/cache coherence.
assert(app.includes("APP_ASSET_VERSION = 'commercial-1-0-5-r31'"), 'app must run r30');
assert(firebase.includes("APP_ASSET_VERSION = 'commercial-1-0-5-r31'"), 'firebase-service must run r30');
assert(sw.includes("CACHE = 'click360-commercial-1-0-5-r31'"), 'service worker must run r30');

// Multi-device sync: an empty phone must never erase populated cloud state.
assert(app.includes('window.click360GetLocalBusinessSyncStats = localBusinessSyncStats'), 'sync stats bridge missing');
assert(app.includes('if (localStats.meaningful === false)'), 'empty-local cloud recovery missing');
assert(app.includes("click360ResolveSyncConflict?.('refresh_cloud')"), 'empty-local refresh action missing');
assert(app.includes('Este dispositivo está vacío y no reemplazará los datos de la nube.'), 'safe empty-device UX missing');
assert(firebase.includes('blocked empty-local force write'), 'server client guard against empty overwrite missing');
assert(firebase.includes("action: 'refresh_cloud_empty_local'"), 'empty-local action classification missing');
assert(firebase.includes('preventedEmptyOverwrite: true'), 'empty overwrite audit signal missing');
assert(firebase.includes("pullRemoteOnce({ force: true, reload: false })"), 'keep-local readback verification missing');
assert(firebase.includes("reason: 'manual_keep_local_failed'"), 'failed keep-local must remain blocking');

// Worker invitations: keep the Firestore contract identifier, not the commercial UI version.
assert(/createdBy:\s*ownerId,\s*\n\s*appVersion:\s*'16\.2\.0'/.test(firebase), 'worker invitation must use V16.2 contract');
assert(!/createdBy:\s*ownerId,\s*\n\s*appVersion:\s*'1\.0\.5'/.test(firebase), 'worker invitation must not write commercial version into contract field');
assert(rules.includes('(request.resource.data.appVersion == "16.0.0" || request.resource.data.appVersion == "16.2.0")'), 'Rules must authorize V16.2 invitation contract');
assert(firebase.includes("db.collection('businesses').doc(ownerId).collection('invitations')"), 'tenant invitation path missing');
assert(firebase.includes("db.collection('businesses').doc(ownerId).collection('ownerInviteSecrets')"), 'owner invitation secret path missing');

// Reports/finance mobile stability and calculator PiP behavior.
assert(app.includes("state.reportsFrom = e.target.value; renderApp('reports');"), 'report From filter must not persist/sync transient UI state');
assert(app.includes("state.reportsTo = e.target.value; renderApp('reports');"), 'report To filter must not persist/sync transient UI state');
assert(!app.includes("state.reportsFrom = e.target.value; if(!save()) return; renderApp('reports');"), 'report From cloud-write regression');
assert(!app.includes("state.reportsTo = e.target.value; if(!save()) return; renderApp('reports');"), 'report To cloud-write regression');
assert(app.includes('class="formGrid financeEntryForm"'), 'finance mobile hook missing');
assert(app.includes("localStorage.getItem('calcWindowSize')"), 'calculator size restore missing');
assert(app.includes("localStorage.setItem('calcWindowSize'"), 'calculator size persistence missing');
assert(app.includes('pinchStart.w * scale'), 'calculator pinch width missing');
assert(app.includes('pinchStart.h * scale'), 'calculator pinch height missing');
assert(app.includes('window.innerWidth - calcSheet.offsetWidth - 8'), 'calculator horizontal bounds missing');
assert(app.includes('window.innerHeight - calcSheet.offsetHeight - 8'), 'calculator vertical bounds missing');
assert(css.includes('.reportRangeCard'), 'responsive reports range CSS missing');
assert(css.includes('input[type="date"]'), 'mobile date containment missing');

// Label print flow: simple by default, canonical engine, preserved template price format.
assert(app.includes('function openSimpleLabelModal('), 'simple label screen missing');
assert(app.includes("if (!options.editorOnly) return openSimpleLabelModal(product, initialTemplateId);"), 'simple label screen not default');
assert(app.includes("if (options.advancedOnly) return openAdvancedLabelModal(product, initialTemplateId, options);"), 'advanced wizard not explicit');
assert(app.includes("const sourcePriceFormat = sourceDocument?.priceFormat || 'full';"), 'print renderer loses price format');
assert(app.includes("const resolvedFallbackPriceFormat = priceFormat || resolvedTemplate?.priceFormat || 'full';"), 'fallback print loses price format');
assert(app.includes('if (prepared.plan?.count !== quantity)'), 'exact quantity verification missing');
assert(app.includes("startInput.value = String(columns >= 2 ? 2 : 1);"), 'second-column shortcut missing');
assert(app.includes('return await executeCanonicalLabelPrint(prepared, providerId);'), 'simple flow bypasses canonical engine');
assert(app.includes("const confirmedQuantity = Math.max(1, Number($('#quickLabelQuantity')?.value || 1));"), 'quick-print must capture quantity before closing confirm modal');
assert(app.includes("const confirmedStartSlot = Math.max(1, Number($('#quickLabelStartSlot')?.value || 1));"), 'quick-print must capture start slot before closing confirm modal');
assert(app.indexOf('const confirmedQuantity =') < app.indexOf('closeModal();\n        resolve({\n          confirmed:true,\n          quantity:confirmedQuantity'), 'quick-print confirm closes before capturing values');
assert(app.includes("const criticalErrors = (preflight.validation?.errors || []).filter"), 'nonblocking warning behavior regressed');
assert(css.includes('CLICK360_R30_SIMPLE_LABEL'), 'r30 simple-label responsive CSS missing');

console.log('CLICK360_R30_KNOWN_ISSUES_REGRESSION: PASS');
