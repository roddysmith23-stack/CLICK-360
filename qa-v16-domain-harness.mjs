import assert from 'node:assert/strict';

await import('./v16-domain.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
assert(domain, 'V16 domain module must load');

const day = 24 * 60 * 60 * 1000;
const startedAt = 1_800_000_000_000;
const activeTrial = domain.evaluateEntitlement({ status: 'trial', plan: 'normal', trialStartedAt: startedAt, trialDays: 7 }, startedAt + 6 * day);
const expiredTrial = domain.evaluateEntitlement({ status: 'trial', plan: 'normal', trialStartedAt: startedAt, trialDays: 7 }, startedAt + 7 * day);
assert.equal(activeTrial.mode, 'trial_active');
assert.equal(activeTrial.readOnly, false);
assert.equal(expiredTrial.mode, 'trial_expired');
assert.equal(expiredTrial.readOnly, true);
assert.equal(domain.timestampMs(startedAt / 1000), startedAt, 'numeric epoch seconds normalize to milliseconds');
assert.equal(domain.timestampMs(startedAt), startedAt, 'numeric epoch milliseconds remain unchanged');
assert.equal(domain.timestampMs(startedAt * 1000), startedAt, 'numeric epoch microseconds normalize to milliseconds');
assert.equal(domain.timestampMs({ seconds: startedAt / 1000, nanoseconds: 500_000_000 }), startedAt + 500);
const canonicalSevenDays = domain.evaluateEntitlement({ status: 'trial', trialStartedAt: startedAt / 1000, trialDays: 30, trialEndsAt: startedAt + 30 * day }, startedAt + 6 * day);
assert.equal(canonicalSevenDays.trialEndsAtMs, startedAt + 7 * day, 'trial duration cannot be extended by client fields');
const remaining = domain.trialRemaining({ serverNowMs: startedAt, validatedAtClientMs: startedAt, trialEndsAtMs: startedAt + day + 3 * 60 * 60 * 1000 }, startedAt + 60 * 60 * 1000);
assert.deepEqual({ days: remaining.days, hours: remaining.hours }, { days: 1, hours: 2 });
const sixDaysLater = startedAt + 6 * day;
const reanchored = domain.reanchorTrustedClock({ serverNowMs: startedAt, validatedAtClientMs: startedAt }, startedAt, sixDaysLater);
assert.equal(reanchored.serverNowMs, sixDaysLater, 'an access snapshot cannot move the trusted server clock backwards');
assert.equal(domain.trialRemaining({ ...reanchored, trialEndsAtMs: startedAt + 7 * day }, sixDaysLater).totalMs, day, 'an account listener cannot restart the trial countdown');
const operationGate = domain.createOperationGate();
const firstOperation = operationGate.begin('uid-a:tenant-a:sale', { sales: 1 });
const duplicateOperation = operationGate.begin('uid-a:tenant-a:sale', { sales: 2 });
assert.equal(firstOperation.acquired, true);
assert.equal(duplicateOperation.acquired, false);
assert.deepEqual(duplicateOperation.snapshot, { sales: 1 }, 'a duplicate recovers the first in-flight snapshot');
assert.equal(operationGate.end('uid-a:tenant-a:sale', Symbol('wrong')), false);
assert.equal(operationGate.end('uid-a:tenant-a:sale', firstOperation.token), true);
assert.equal(operationGate.begin('uid-a:tenant-a:sale', { sales: 2 }).acquired, true, 'the action can run again after confirmation');
const saleGate = domain.createOperationGate();
let saleState = { stock: 2, sales: [], movements: [] };
const attemptSale = () => {
  const previous = structuredClone(saleState);
  saleState.stock -= 1;
  saleState.sales.push('sale');
  saleState.movements.push('movement');
  const lock = saleGate.begin('uid-a:tenant-a:sale_created', structuredClone(saleState));
  if (!lock.acquired) saleState = structuredClone(lock.snapshot || previous);
  return lock;
};
const saleOne = attemptSale();
const saleTwo = attemptSale();
assert.equal(saleTwo.acquired, false);
assert.deepEqual(saleState, { stock: 1, sales: ['sale'], movements: ['movement'] }, 'a double charge records exactly one sale, movement and stock decrement');
saleGate.end('uid-a:tenant-a:sale_created', saleOne.token);
assert.equal(domain.offlineRecoveryDecision({ pendingRemoteSync: true, baseRevision: 7, remoteRevision: 7, localHash: 'local', remoteHash: 'remote' }).action, 'push_local');
assert.equal(domain.offlineRecoveryDecision({ pendingRemoteSync: true, baseRevision: 7, remoteRevision: 8, localHash: 'local', remoteHash: 'remote' }).action, 'conflict');
assert.equal(domain.offlineRecoveryDecision({ pendingRemoteSync: true, baseRevision: 7, remoteRevision: 8, localHash: 'same', remoteHash: 'same' }).action, 'already_synced');
assert.equal(domain.offlineRecoveryDecision({ pendingRemoteSync: false, baseRevision: 7, remoteRevision: 8 }).action, 'apply_remote');
assert.equal(domain.evaluateEntitlement({ status: 'founder', plan: 'founder' }, startedAt).readOnly, false);
assert.equal(domain.evaluateEntitlement({ status: 'paid_pro', plan: 'pro' }, startedAt).plan, 'pro');
assert.deepEqual(domain.planLimits('base'), { businesses: 1, workers: 2 });
assert.deepEqual(domain.planLimits('pro'), { businesses: 5, workers: 10 });

const included = domain.calculateCart([{ id: 'a', qty: 1, price: 112, taxMode: 'included' }], 0, { enabled: true, rate: 12, priceMode: 'included' });
assert.equal(included.subtotal, 100);
assert.equal(included.tax, 12);
assert.equal(included.total, 112);
const excluded = domain.calculateCart([{ id: 'a', qty: 1, price: 100, taxMode: 'excluded' }], 0, { enabled: true, rate: 12, priceMode: 'excluded' });
assert.equal(excluded.subtotal, 100);
assert.equal(excluded.tax, 12);
assert.equal(excluded.total, 112);
const disabledTax = domain.calculateCart([{ id: 'a', qty: 1, price: 100, taxMode: 'excluded' }], 0, { enabled: false, rate: 15, priceMode: 'excluded' });
assert.equal(disabledTax.tax, 0, 'an explicitly disabled tax never re-enables from its saved rate');
assert.equal(disabledTax.total, 100);
const discountedExcluded = domain.calculateCart([{ id: 'a', qty: 1, price: 100, taxMode: 'excluded' }], 10, { enabled: true, rate: 12, priceMode: 'excluded' });
assert.equal(discountedExcluded.displaySubtotal, 100, 'receipt subtotal remains the pre-discount tax base');
assert.equal(domain.roundMoney(discountedExcluded.displaySubtotal - discountedExcluded.discount + discountedExcluded.tax), discountedExcluded.total, 'receipt subtotal, discount and tax reconcile to total');
const mixed = domain.calculateCart([
  { id: 'a', qty: 2, price: 10, taxMode: 'excluded' },
  { id: 'b', qty: 1, price: 5, taxMode: 'exempt' }
], 5, { enabled: true, rate: 15, priceMode: 'excluded' });
assert.equal(mixed.lines.reduce((sum, line) => domain.roundMoney(sum + line.total), 0), mixed.total);
assert.equal(mixed.discount, 5);
assert.equal(domain.taxLegend({ taxMode: 'exempt' }, { enabled: true, rate: 15, showLabel: true }), 'Exento de IVA');

assert.equal(domain.layawayStatus({ total: 100, paid: 25 }, startedAt), 'partially_paid');
assert.equal(domain.layawayStatus({ total: 100, paid: 100 }, startedAt), 'paid');
assert.equal(domain.layawayStatus({ total: 100, paid: 0, dueAt: startedAt - 1 }, startedAt), 'expired');
assert.match(domain.formatBusinessDate('2026-07-13T12:00:00-05:00', 'es-EC', 'America/Guayaquil', false), /2026/);

const token = domain.randomToken();
assert.equal(token.length, 64);
assert.equal((await domain.sha256(token)).length, 64);
console.log('PASS V16 domain: server-time entitlements, plans, IVA, apartados, dates, and secure invitation tokens');
