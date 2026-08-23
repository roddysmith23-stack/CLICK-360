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
assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'lifetime', lifetime: true }, startedAt).plan, 'pro');
assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'subscription', lifetime: false }, startedAt).allowed, false);
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: false, localPersisted: true, online: true }).allowed, false);
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, localPersisted: true, online: true }).mode, 'local_and_cloud');
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, indexedPersisted: true, online: true }).mode, 'local_and_cloud');
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, onlineOnlySafe: true, online: true }).mode, 'cloud_only');
// Commercial MVP: workerLimit now reflects workerSeatsMax (the paid-add-on
// ceiling), not workerSeatsIncluded (still 2, unchanged) -- Basic can now buy
// add-on seats up to 5 rather than being hard-capped at the 2 free seats.
assert.deepEqual(domain.planLimits('base'), { businesses: 1, workers: 5 });
assert.deepEqual(domain.planLimits('pro'), { businesses: 5, workers: 10 });
assert.deepEqual(domain.planLimits('business'), { businesses: 10, workers: 25 });
assert.equal(domain.planLimits('enterprise').workers, 9999, 'enterprise workerSeatsMax is null (unlimited) -> projected as a large ceiling for the legacy workerLimit gate');

// Commercial MVP: canonical plan catalog / entitlements / quota evaluation
assert.equal(domain.PLAN_CATALOG.base.name, 'Basic', 'internal code stays "base"; only the display name changes to Basic');
assert.equal(domain.PLAN_CATALOG.base.prices.month, 40, 'Basic keeps the pre-existing Base price -- no silent change for already-billed customers');
assert.equal(domain.PLAN_CATALOG.pro.prices.month, 59.99);
assert.equal(domain.PLAN_CATALOG.business.prices.month, 99.99);
assert.equal(domain.PLAN_CATALOG.business.prices.year, 999);
assert.equal(domain.PLAN_CATALOG.enterprise.prices.custom, true, 'Enterprise has no fixed price -- cotizacion');
assert.equal(domain.PLAN_CATALOG.founder_legacy.prices.historical, true, 'Founder legacy has no billing price');
assert.equal(domain.PLAN_CATALOG.founder_legacy.limits.productsActive, 2000, 'Founder quota derived from real data-scale measurement, well above SHARY\'s current usage');
assert.equal(domain.planEntitlements('unknown_code').code, 'base', 'unknown plan codes fall back to base, never throw');
assert.equal(domain.planEntitlements('BUSINESS').code, 'business', 'plan code lookup is case-insensitive');

assert.deepEqual(
  { level: domain.evaluateQuota(50, 150).level, blocked: domain.evaluateQuota(50, 150).blocked },
  { level: 'ok', blocked: false }
);
assert.equal(domain.evaluateQuota(105, 150).level, 'notice', '70% threshold');
assert.equal(domain.evaluateQuota(128, 150).level, 'warning', '85% threshold');
assert.equal(domain.evaluateQuota(143, 150).level, 'critical', '95% threshold');
assert.equal(domain.evaluateQuota(150, 150).level, 'blocked');
assert.equal(domain.evaluateQuota(150, 150).blocked, true, 'at 100% new-resource creation blocks');
assert.equal(domain.evaluateQuota(999999, 150).blocked, true, 'over quota still blocks (never silently allows past 100%)');
assert.equal(domain.evaluateQuota(50, null).level, 'unlimited', 'null limit (Enterprise workerSeatsMax) never blocks');
assert.equal(domain.evaluateQuota(50, null).blocked, false);
assert.equal(domain.evaluateQuota(50, 0).blocked, false, 'a limit of 0 is treated as unlimited, not "always blocked" -- 0 means "not configured"');

// founder_legacy must be a real, permanent, non-readonly access mode with its
// own plan code -- distinct from the internal-only 'founder' status, and
// must NEVER silently fall through to the deny-by-default branch.
const founderLegacyAccess = domain.evaluateEntitlement({ status: 'founder_legacy' }, startedAt);
assert.equal(founderLegacyAccess.allowed, true);
assert.equal(founderLegacyAccess.readOnly, false);
assert.equal(founderLegacyAccess.mode, 'founder_legacy');
assert.equal(founderLegacyAccess.plan, 'founder_legacy');
assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'business' }, startedAt).plan, 'business');
assert.equal(domain.evaluateEntitlement({ status: 'paid_business' }, startedAt).plan, 'business');
assert.equal(domain.evaluateEntitlement({ status: 'paid_enterprise' }, startedAt).plan, 'enterprise');

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

// ── Phase 3.4: Apartados WhatsApp reminder -- phone normalization/validation ──
// Root cause of "WhatsApp opens the contact but the prefilled message is
// gone": a cashier-typed 9-digit Ecuadorian mobile number with neither the
// leading 0 nor the country code (e.g. "987654321" instead of "0987654321")
// used to pass through normalizePhone() unchanged, producing an incomplete
// wa.me link that WhatsApp can't resolve to an exact contact.
assert.equal(domain.normalizePhone('0987654321'), '593987654321', 'leading-0 Ecuadorian mobile normalizes with country code');
assert.equal(domain.normalizePhone('987654321'), '593987654321', 'bare 9-digit mobile (no leading 0, no country code) must also get the country code prepended');
assert.equal(domain.normalizePhone('593987654321'), '593987654321', 'already-complete E.164 number is left unchanged');
assert.equal(domain.normalizePhone('00593987654321'), '593987654321', 'international 00 prefix is stripped');
assert.equal(domain.normalizePhone('098-765-4321'), '593987654321', 'punctuation/spaces are stripped before normalizing');
assert.equal(domain.normalizePhone(''), '', 'empty input stays empty, never a bare country code');
assert.equal(domain.normalizePhone('   '), '', 'whitespace-only input stays empty');

assert.equal(domain.isValidWhatsAppPhone('593987654321'), true, 'complete Ecuadorian E.164 mobile is valid');
assert.equal(domain.isValidWhatsAppPhone('987654321'), false, 'a 9-digit number without country code is NOT valid, even though it has digits');
assert.equal(domain.isValidWhatsAppPhone(''), false, 'empty is never valid');
assert.equal(domain.isValidWhatsAppPhone('5939876a4321'), false, 'non-digit characters are never valid');
assert.equal(domain.isValidWhatsAppPhone('593'), false, 'a bare country code alone is never valid');

const okLink = domain.buildWhatsAppReminderLink('987654321', 'Hola María, saldo $12.50');
assert.equal(okLink.valid, true, 'a fixable 9-digit number must build a valid link, not be rejected');
assert.equal(okLink.normalized, '593987654321');
assert.equal(okLink.url, 'https://wa.me/593987654321?text=Hola%20Mar%C3%ADa%2C%20saldo%20%2412.50', 'accented characters and $ must be correctly percent-encoded in the text param');
assert.equal(new URL(okLink.url).searchParams.get('text'), 'Hola María, saldo $12.50', 'decoding the built URL must round-trip to the exact original message');

const missingLink = domain.buildWhatsAppReminderLink('', 'test');
assert.equal(missingLink.valid, false);
assert.equal(missingLink.reason, 'phone_missing');
assert.equal(missingLink.url, undefined, 'an invalid link must never be opened -- no url is returned');

// A layaway/Apartado customer that was never part of a prior sale -- the
// function must not care about provenance, only about the phone digits
// actually present. Simulates the "customer born directly in Apartados" case.
const directApartadoLink = domain.buildWhatsAppReminderLink('0912345678', 'Hola Carlos, tu apartado #A1B2C3 vence el 2026-09-01.');
assert.equal(directApartadoLink.valid, true);
assert.equal(directApartadoLink.normalized, '593912345678');

console.log('PASS V16 domain: server-time entitlements, plans, IVA, apartados, dates, secure invitation tokens, and Apartados WhatsApp phone normalization/link building');
