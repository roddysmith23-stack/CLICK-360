const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
require('./v16-domain.js');
const domain = globalThis.CLICK360_V16_DOMAIN;

assert.equal(domain.layawayStatus({ status:'ready_for_pickup', total:50, paid:50, balance:0 }), 'ready_for_pickup');
assert.deepEqual(domain.layawayPaymentDecision({ total:100, paid:40, balance:60 }, 20, 'Tarjeta'), {
  allowed:true, reason:'ok', balance:60, amount:20, method:'Tarjeta', nextBalance:40
});
assert.equal(domain.layawayPaymentDecision({ total:100, paid:40, balance:60 }, 80, 'Efectivo').reason, 'amount_exceeds_balance');
assert.equal(domain.layawayPaymentDecision({ status:'picked_up', total:100, paid:100, balance:0 }, 1, 'Efectivo').allowed, false);
assert.equal(domain.layawayTransitionDecision({ status:'paid', total:100, paid:100, balance:0 }, 'ready_for_pickup').allowed, true);
assert.equal(domain.layawayTransitionDecision({ status:'ready_for_pickup', total:100, paid:100, balance:0 }, 'picked_up').allowed, true);
assert.equal(domain.layawayTransitionDecision({ status:'partially_paid', total:100, paid:50, balance:50 }, 'picked_up').reason, 'balance_pending');
assert.equal(domain.linkedMovementClosureDecision([{ id:'m1', date:'2026-08-16' }], (date) => date === '2026-08-16').allowed, false);
assert.equal(domain.operationAlreadyApplied({ operationLedger:[{ operationId:'pay:1' }] }, 'pay:1'), true);
assert.equal(domain.operationAlreadyApplied({ movements:[{ operationId:'pay:2' }] }, 'pay:2'), true);
assert.equal(domain.cashAmountForPayment(25, 'Efectivo'), 25);
assert.equal(domain.cashAmountForPayment(25, 'Tarjeta'), 0);

assert.match(app, /data-quick-print=/, 'inventory exposes quick print per product');
assert.match(app, /function prepareLabelPrintJob\(/, 'quick print prepares a canonical job');
assert.match(app, /function executeCanonicalLabelPrint\(/, 'quick print has one canonical execution path');
assert.match(app, /const confirmedQuantity = Math\.max\(1, Number\(\$\('#quickLabelQuantity'\)[\s\S]*closeModal\(\)/, 'quick print reads inputs before closing the modal');
assert.match(app, /id="quickLabelConfirm"/, 'quick print confirm dialog has a single action-aware button');
assert.match(app, /isPdf \? `\$\{icon\('file-down'\)\} Guardar PDF` : `\$\{icon\('printer'\)\} Imprimir`/, 'PDF remains distinct from device printing');
assert.match(app, /function receiptFlowSegments\(/, 'fixed paper receipts use semantic pagination');
assert.match(app, /data-receipt-page=/, 'fixed paper receipts expose physical pages');
assert.doesNotMatch(app, /height:\$\{paper\.receiptHeightMm\}mm;overflow:hidden;\` : ''\}/, 'continuous receipts are not silently clipped');
assert.match(app, /operationLedger/, 'financial retries have a durable operation ledger');
assert.match(app, /addAudit\(product \? 'product_updated' : 'product_created'/, 'product creates and updates are audited');
assert.match(app, /addAudit\('product_deleted'/, 'product deletes are audited');
assert.match(app, /addAudit\('worker_invited'/, 'worker invitations are audited after cloud creation');
assert.match(app, /addAudit\('receipt_issued'/, 'successful receipt handoffs are audited');
assert.match(app, /id="activityAction"/, 'activity can be filtered by action');
assert.match(app, /function collectedInRange\(/, 'reports attribute collections by payment date');
assert.match(app, /WORKER_TENANT_ACCESS_ENABLED = window\.CLICK360_WORKER_DATA_BOUNDARY\?\.enabledForProject/, 'worker operations are gated to the modular staging boundary');
assert.match(firebase, /STATE_DOC = null;[\s\S]*MODULAR_GATEWAY = gateway;[\s\S]*MODULAR_MODE = true;/, 'workers never receive the monolithic state document');
assert.match(firebase, /const FIRESTORE_SCHEMA_VERSION = '16\.2\.0'/, 'Rules-gated writes use the Firestore contract version');
assert.match(firebase, /collection\('auditEvents'\)/, 'client emits separate audit events');
assert.match(rules, /match \/businesses\/\{businessId\}\/auditEvents\/\{eventId\}/, 'audit event path is explicit');
assert.match(rules, /allow update, delete: if false;/, 'audit events are append-only');
assert.match(styles, /Final mobile override:[\s\S]*grid-template-rows:auto auto minmax\(0,1fr\) auto!important[\s\S]*overflow:auto!important[\s\S]*#smartPrintNext\{grid-column:1\/-1!important/, 'mobile label wizard reserves a scroll track above a fully visible footer');

console.log('CLICK 360 Stability Operations contracts PASS');
