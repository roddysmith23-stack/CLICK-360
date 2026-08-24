/**
 * r37 (#93, commercial priority): the CEO Admin panel must show each
 * customer's legal status AND device health (version/release, last sync,
 * hydration, online/offline, pending ops, reliability, local/remote
 * revision, last runtime error, pending cash close) with green/yellow/red
 * that has REAL, documented meaning -- and CEO Admin must be able to see
 * all of this WITHOUT ever hand-editing Firestore.
 *
 * Also formally closes the "clean but localHash != remoteHash" case: the
 * panel must present the hashes as auxiliary diagnostic fields only, never
 * as the thing that decides clean/dirty (that's syncStatus itself, per
 * qa-r37-reliability-hash-labels-harness.cjs) -- so a legitimate mismatch
 * on an otherwise-healthy record is never shown as a contradiction.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

// ── Write side: a best-effort, diagnostic-only beacon the customer's OWN
// device publishes about itself. ──
assert(firebase.includes('window.click360PublishCustomerHealth = function'), 'a health-beacon publish function must be exposed');
const publishBlock = firebase.slice(firebase.indexOf('window.click360PublishCustomerHealth = function'), firebase.indexOf('window.click360PublishCustomerHealth = function') + 500);
assert(publishBlock.includes(".catch(() => {})"), 'a failed health-beacon write must never surface an error to the customer -- this is diagnostic-only and best-effort');
assert(publishBlock.includes('merge: true'), 'the beacon must merge, never overwrite unrelated fields written by a concurrent tab/device');

const snapshotBlock = app.slice(app.indexOf('function publishCustomerHealthSnapshot('), app.indexOf('function publishCustomerHealthSnapshot(') + 1400);
assert(snapshotBlock.includes('appVersion:'), 'the snapshot must report the app version/release');
assert(snapshotBlock.includes('tenantDataHydrated:'), 'the snapshot must report hydration state');
assert(snapshotBlock.includes('isOnline:'), 'the snapshot must report online/offline');
assert(snapshotBlock.includes('pendingOperations:'), 'the snapshot must report pending/in-flight operations (criticalActionGate.size())');
assert(snapshotBlock.includes('syncStatus:') && snapshotBlock.includes('localHash:') && snapshotBlock.includes('remoteHash:'), 'the snapshot must report reliability (sync status) and local/remote revision hashes');
assert(snapshotBlock.includes('lastRuntimeError:'), 'the snapshot must report the last runtime error, if any');
assert(/now - lastHealthPublishAtMs < HEALTH_PUBLISH_MIN_INTERVAL_MS\) return/.test(app), 'the beacon must be throttled -- never fired on every single render/navigation');

// ── Read side: CEO Admin fetches the beacon AND computes pending-cash-close
// server-side, all without hand-editing Firestore. ──
const searchBlock = firebase.slice(firebase.indexOf('window.click360CeoAdminSearchCustomer = async function'), firebase.indexOf('function assertCeoAdmin'));
assert(searchBlock.includes("db.collection('customerHealth').doc(uid).get()"), 'click360CeoAdminSearchCustomer must fetch the customer health beacon');
assert(searchBlock.includes('pendingCashClose'), 'click360CeoAdminSearchCustomer must compute whether a cash session was left open from a PRIOR day');
assert(/session\?\.status === 'open' && session\?\.date && session\.date < todayKey/.test(searchBlock), 'pending-cash-close must specifically mean a PRIOR day left open -- a session opened earlier today is normal, not a problem');

// ── Render side: green/yellow/red with documented, real meaning; legal
// status and pending cash close both visible; hashes shown as diagnostic
// only, never as the clean/dirty decision itself. ──
assert(app.includes('function ceoAdminHealthLevel(result)'), 'a documented health-level classifier must exist');
const levelBlock = app.slice(app.indexOf('function ceoAdminHealthLevel(result)'), app.indexOf('function ceoAdminHealthSectionHtml'));
assert(levelBlock.includes("lastRuntimeError) return { level: 'red'"), 'a recent runtime error must be classified red');
assert(levelBlock.includes("real_conflict") && /return \{ level: 'red'/.test(levelBlock.slice(levelBlock.indexOf('real_conflict'))), 'a real sync conflict must be classified red');
assert(levelBlock.includes('24 * 60 * 60 * 1000'), 'a device with no signal in over 24h must be classified red (likely unused or stuck)');
assert(levelBlock.includes("isOnline === false) return { level: 'yellow'"), 'offline-at-last-report alone must be yellow, not red -- a closed shop overnight is normal, not an emergency');

const sectionBlock = app.slice(app.indexOf('function ceoAdminHealthSectionHtml'), app.indexOf('function ceoAdminResultHtml'));
assert(sectionBlock.includes('pendingCashClose'), 'the health section must surface the pending-cash-close warning');
assert(sectionBlock.includes('Último reporte'), 'the health section must show last-sync/last-report time');
assert(sectionBlock.includes('Datos hidratados'), 'the health section must show hydration state');
assert(sectionBlock.includes('Operaciones pendientes'), 'the health section must show pending operations');
assert(sectionBlock.includes('Aceptación legal'), 'the health section must show legal acceptance status (version/date), closing the loop with the legal grace-consent model built earlier in r37');
assert(sectionBlock.includes('Hash local / remoto'), 'the health section must show the local/remote hash pair');
assert(/solo diagnóstico.*no.*comparación de hashes/.test(sectionBlock.replace(/\s+/g, ' ')), 'the panel must explicitly document that the hashes are diagnostic-only and that syncStatus (not the hash comparison) is the real clean/dirty decision -- the formal closure of the "clean but localHash!=remoteHash" case with no misleading semantics left');

// ── firestore.rules: customerHealth is field-allowlisted, size-bounded,
// write-own-only, CEO-Admin-readable -- never an arbitrary-data write path. ──
const rulesBlock = rules.slice(rules.indexOf('match /customerHealth/'), rules.indexOf('match /customerHealth/') + 900);
assert(rulesBlock.length > 200, 'firestore.rules must define the customerHealth collection');
assert(rulesBlock.includes('request.auth.uid == uid'), 'a customer may only ever write their OWN health beacon, never another tenant\'s');
assert(rulesBlock.includes('isPlatformAdmin()'), 'CEO Admin must be able to read every customer\'s health beacon');
assert(rulesBlock.includes('hasOnly(['), 'the health beacon write must be field-allowlisted, never an arbitrary-data write path');
assert(rulesBlock.includes('allow delete: if false;'), 'health beacon records must never be deletable (audit trail)');

console.log('PASS r37 CEO Admin customer-health harness: a throttled, best-effort, field-allowlisted health beacon lets CEO Admin see real customer device health (version, last sync, hydration, online/offline, pending ops, reliability, local/remote hash, last runtime error), legal acceptance, and prior-day-unclosed cash sessions -- all without hand-editing Firestore, with documented green/yellow/red semantics, and with the hash pair explicitly presented as diagnostic-only (never the clean/dirty decision itself), formally closing the "clean but localHash!=remoteHash" case.');
