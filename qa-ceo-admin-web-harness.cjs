/**
 * r36: CEO Admin Web -- structural regression gate.
 *
 * The real security boundary is firestore.rules' isPlatformAdmin(), already
 * covered adversarially by qa-ceo-admin-web-rules-emulator.cjs. This harness
 * locks in everything a live-rules test can't see: that the browser-side
 * admin identity constant matches the CLI's AUTHORIZED_ADMIN_EMAILS exactly
 * (a silent drift here would either lock the real admin out or -- worse --
 * show the panel's nav entry to the wrong person, even though the rules
 * would still deny them), that the write path actually goes through the
 * canonical activationFields() rather than a second hand-rolled shape, and
 * that every write is backed up + audited before/around the commit.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const service = fs.readFileSync('firebase-service.js', 'utf8');
const adminCore = fs.readFileSync('scripts/lib/click360-v16-admin-core.mjs', 'utf8');

// ── The browser admin identity must match the CLI's exactly -- no drift ──
const serviceAdminEmailMatch = service.match(/CEO_ADMIN_EMAIL\s*=\s*'([^']+)'/);
assert(serviceAdminEmailMatch, 'firebase-service.js must define CEO_ADMIN_EMAIL');
assert(adminCore.includes(`'${serviceAdminEmailMatch[1]}'`), 'the browser CEO Admin identity must match AUTHORIZED_ADMIN_EMAILS in click360-v16-admin-core.mjs exactly');
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert(rules.includes(`'${serviceAdminEmailMatch[1]}'`), 'firestore.rules isPlatformAdmin() must gate on the exact same email as the browser/CLI');

// ── Browser API surface exists and is wired ──
['click360IsPlatformAdmin', 'click360CeoAdminSearchCustomer', 'click360CeoAdminPreviewActivation', 'click360CeoAdminApplyActivation', 'click360CeoAdminSuspend', 'click360CeoAdminToggleWorkers']
  .forEach((name) => assert(service.includes(`window.${name}`), `firebase-service.js must define window.${name}`));
assert(app.includes('function ceoAdminView()') && app.includes('function bindCeoAdmin()'), 'app.js must define the CEO Admin view and bind functions');
assert(/ceoAdmin:\s*ceoAdminView/.test(app), 'ceoAdmin route must be wired into the views table');
assert(/if\(r==='ceoAdmin'\) bindCeoAdmin\(\);/.test(app), 'ceoAdmin route must call bindCeoAdmin() on render');

// ── Nav entry is gated by the same admin check (defense in depth, not the real gate -- the rules are) ──
assert(/window\.click360IsPlatformAdmin\?\.\(\)\s*\?[\s\S]{0,120}data-more="ceoAdmin"/.test(app), 'the CEO Admin nav entry must only render when click360IsPlatformAdmin() is true');

// ── Write path uses the single canonical activationFields(), not a second shape ──
assert(service.includes('window.CLICK360_V16_DOMAIN.activationFields({'), 'CEO Admin Web must call the canonical v16-domain.js activationFields(), not re-derive the plan/limits shape');
assert(!/PLAN_LIMITS\s*=/.test(service), 'firebase-service.js must not maintain its own duplicate plan-limits table');

// ── Every write is backed up and audited (mirrors the CLI pipeline) ──
// Extract each function's own body by slicing between its definition and the
// next window.click360... definition, rather than a regex window -- this
// file is large enough that "adminBackups"/"runTransaction"/"adminAuditLogs"
// each appear many times across unrelated functions, so a bounded regex
// window risks matching the wrong occurrence.
function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start !== -1, `${startMarker} must exist in firebase-service.js`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  assert(end === -1 ? false : true, `${endMarker} must exist after ${startMarker}`);
  return source.slice(start, end === -1 ? undefined : end);
}
const applyActivationBody = functionBody(service, 'window.click360CeoAdminApplyActivation', 'window.click360CeoAdminSuspend');
assert(applyActivationBody.includes('adminBackups') && applyActivationBody.includes('runTransaction') && applyActivationBody.includes('adminAuditLogs'),
  'click360CeoAdminApplyActivation must write a backup before, and an audit log entry within, its transaction');
assert(applyActivationBody.indexOf('adminBackups') < applyActivationBody.indexOf('runTransaction'), 'the backup must be written before the transaction starts');
assert(applyActivationBody.includes('if (Number(beforeData.revision || 0) !== Number(expectedRevision))'), 'the activation write must reject a stale preview (revision changed since the preview was shown)');
assert(applyActivationBody.includes('const afterSnap = await ref.get();') && applyActivationBody.includes('if (afterData.revision !== proposed.revision'), 'the activation write must re-read and verify the result after committing, not just trust the transaction succeeded');

const suspendBody = functionBody(service, 'window.click360CeoAdminSuspend', 'window.click360CeoAdminToggleWorkers');
assert(suspendBody.includes('adminBackups') && suspendBody.includes('runTransaction') && suspendBody.includes('adminAuditLogs'),
  'click360CeoAdminSuspend must also follow the backup -> transaction -> audit pattern');

console.log('PASS CEO Admin Web: identity consistency (browser/CLI/rules), API wiring, canonical activationFields() reuse, backup+audit pattern');
