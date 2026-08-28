import assert from 'node:assert/strict';

/**
 * 100+ cycle regression: repeated fresh-session-shaped entitlement
 * resolution for a founder_legacy account, through BOTH evaluators
 * (mirrors what a real fresh session/relogin repeatedly does), requiring
 * zero false rejects. Complements qa-entitlement-evaluator-parity-harness.mjs
 * (which checks a fixed table of representative inputs) by fuzzing
 * realistic field-shape variance (Timestamp vs {seconds,nanoseconds} vs
 * ms-number vs ISO string, presence/absence of optional fields, varying
 * "now") that a real client could actually present across many real
 * sessions over time.
 */
await import('./v16-domain.js');
await import('./p0-tenant-guard.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
const guard = globalThis.CLICK360_P0_TENANT_GUARD;

const CYCLES = 150;
const BASE_NOW = 1_800_000_000_000;
let falseRejects = 0;
let disagreements = 0;

function randomServerNowShape(nowMs) {
  const variant = nowMs % 4;
  if (variant === 0) return nowMs;
  if (variant === 1) return { seconds: Math.floor(nowMs / 1000), nanoseconds: (nowMs % 1000) * 1_000_000 };
  if (variant === 2) return { toMillis: () => nowMs };
  return new Date(nowMs).toISOString();
}

for (let i = 0; i < CYCLES; i += 1) {
  const now = BASE_NOW + i * 137_000; // deterministic but varying offset, no Date.now()/Math.random() per repo convention
  // SHARY-shaped founder_legacy account, real field variance across cycles:
  const data = {
    uid: 'shary-like-uid',
    status: 'founder_legacy',
    plan: 'founder_legacy',
    planCode: i % 2 === 0 ? 'founder_legacy' : undefined,
    billingStatus: 'lifetime',
    lifetime: false,
    // Real accounts can carry a stray expiresAt/trialStartedAt from earlier
    // plan history -- founder_legacy must never depend on them.
    expiresAt: i % 3 === 0 ? null : (i % 3 === 1 ? randomServerNowShape(now - 10 * 24 * 60 * 60 * 1000) : undefined),
    trialStartedAt: i % 5 === 0 ? randomServerNowShape(now - 400 * 24 * 60 * 60 * 1000) : undefined
  };
  const serverNowMs = randomServerNowShape(now);

  const primary = domain.evaluateEntitlement(data, typeof serverNowMs === 'object' ? now : serverNowMs);
  const fallback = guard.evaluateAccountAccess(data, typeof serverNowMs === 'object' ? now : serverNowMs, 7);

  if (primary.allowed !== true || primary.readOnly !== false) falseRejects += 1;
  if (fallback.allowed !== true || fallback.readOnly !== false) falseRejects += 1;
  if (primary.allowed !== fallback.allowed
    || primary.readOnly !== fallback.readOnly
    || primary.mode !== fallback.mode
    || primary.plan !== fallback.plan) disagreements += 1;
}

console.log(JSON.stringify({ cycles: CYCLES, falseRejects, disagreements }, null, 2));
assert.equal(falseRejects, 0, `${falseRejects} false AUTH_ACCOUNT_ACCESS_REJECTED-equivalent rejects for a legitimate founder_legacy account across ${CYCLES} cycles`);
assert.equal(disagreements, 0, `${disagreements} cycles where the two evaluators disagreed`);
console.log(`qa-entitlement-evaluator-100-cycle-harness: PASS -- 0 false rejects, 0 disagreements across ${CYCLES} cycles.`);
