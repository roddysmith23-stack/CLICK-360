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
