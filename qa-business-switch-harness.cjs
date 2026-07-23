/**
 * qa-business-switch-harness.cjs
 * P1 FIX: Business Switch readOnly Stale State — Test Harness
 * Version candidate: 1.0.4-p1
 *
 * Pruebas con datos 100% ficticios/anónimos.
 * No contiene UIDs reales, correos, nombres ni datos de Firebase.
 */

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;

function normalizePlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  if (['normal', 'base', 'paid_base'].includes(plan)) return 'base';
  if (['pro', 'paid_pro', 'pro_lifetime'].includes(plan)) return 'pro';
  if (['founder', 'founder_unlimited'].includes(plan)) return 'founder';
  if (plan === 'lifetime') return 'lifetime';
  return 'base';
}
function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100_000_000_000) return Math.round(n * 1000);
  if (n > 100_000_000_000_000) return Math.round(n / 1000);
  return Math.round(n);
}
function timestampMs(value) {
  if (Number.isFinite(Number(value?.seconds))) return normalizeEpochMs(Number(value.seconds) * 1000);
  if (Number.isFinite(Number(value))) return normalizeEpochMs(value);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function evaluateEntitlement(data = {}, serverNowMs = 0) {
  const rawStatus = String(data.status || '').toLowerCase();
  const rawPlanCode = String(data.planCode || '').trim().toLowerCase();
  const plan = normalizePlan(data.planCode || data.plan);
  const serverNow = timestampMs(serverNowMs || data.lastSeenAt || 0);
  const trialStartedAtMs = timestampMs(data.trialStartedAt);
  const trialEndsAtMs = trialStartedAtMs ? trialStartedAtMs + TRIAL_DAYS * DAY_MS : 0;
  const expiresAtMs = timestampMs(data.expiresAt);
  if (rawStatus === 'active' && rawPlanCode === 'pro_lifetime'
    && !(data.lifetime === true && String(data.billingStatus || '').toLowerCase() === 'lifetime')) {
    return { allowed: false, readOnly: true, mode: 'pending_activation', plan: 'pro', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
  }
  const lifetime = data.lifetime === true || rawStatus === 'lifetime' || plan === 'lifetime';
  if (['founder'].includes(rawStatus) || plan === 'founder') {
    return { allowed: true, readOnly: false, mode: 'founder', plan: 'founder', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs: 0 };
  }
  if (lifetime) {
    return { allowed: true, readOnly: false, mode: 'lifetime', plan: plan === 'pro' ? 'pro' : 'base', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs: 0 };
  }
  if (['trial', 'trial_active'].includes(rawStatus)) {
    const readOnly = !serverNow || !trialEndsAtMs || serverNow >= trialEndsAtMs;
    return { allowed: true, readOnly, mode: readOnly ? 'trial_expired' : 'trial_active', plan: 'base', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs: 0 };
  }
  if (['expired', 'trial_expired'].includes(rawStatus)) {
    return { allowed: true, readOnly: true, mode: 'trial_expired', plan: 'base', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
  }
  if (['active', 'paid_base', 'paid_pro'].includes(rawStatus)) {
    const paidPlan = rawStatus === 'paid_pro' ? 'pro' : rawStatus === 'paid_base' ? 'base' : plan;
    const readOnly = !!expiresAtMs && !!serverNow && serverNow >= expiresAtMs;
    return { allowed: true, readOnly, mode: readOnly ? 'subscription_expired' : `paid_${paidPlan}`, plan: paidPlan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
  }
  if (rawStatus === 'member') return { allowed: true, readOnly: false, mode: 'member', plan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
  return { allowed: false, readOnly: true, mode: rawStatus || 'pending_activation', plan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
}

// Copia de resolveReadOnly() del P1 fix — debe mantenerse en sync con app.js
function resolveReadOnly(accessState, switchGuardActive = false) {
  if (switchGuardActive) return false;
  if (!accessState || typeof accessState !== 'object') return false;
  const mode = String(accessState.mode || '').toLowerCase();
  const status = String(accessState.status || '').toLowerCase();
  const plan = String(accessState.plan || '').toLowerCase();
  const planCode = String(accessState.planCode || '').toLowerCase();
  const billingStatus = String(accessState.billingStatus || '').toLowerCase();
  const platformRole = String(accessState.platformRole || '').toLowerCase();
  const customerTier = String(accessState.customerTier || '').toLowerCase();
  if (['suspended', 'blocked', 'disabled'].includes(status) || ['blocked', 'suspended'].includes(mode)) return true;
  if (platformRole === 'platform_founder' || customerTier === 'platform_founder') return false;
  if (plan === 'founder_unlimited' || planCode === 'founder_unlimited') return false;
  if (mode === 'founder' || mode === 'lifetime') return false;
  if (accessState.lifetime === true && billingStatus === 'lifetime') return false;
  if (planCode === 'pro_lifetime' && billingStatus === 'lifetime' && accessState.lifetime === true) return false;
  if (mode === 'member') return false;
  if (mode === 'paid_base' || mode === 'paid_pro') return accessState.readOnly === true;
  if (mode === 'trial_active') return false;
  return accessState.readOnly === true;
}
function writeGateStatus(externalGate, accessState) {
  if (externalGate?.allowed === false) {
    if (externalGate.reason === 'read_only' && !resolveReadOnly(accessState, false)) {
      return { allowed: true, reason: 'effective_access_allows' };
    }
    return externalGate;
  }
  return { allowed: true, reason: 'ok' };
}

// ─── Datos anónimos ───────────────────────────────────────────────────────────
const FOUNDER_UID = 'FOUNDER_UID_ANON';
const CUSTOMER_UID_A = 'CUSTOMER_UID_A_ANON';
const BUSINESS_A_ID = 'biz_BUSINESS_A_anon';
const BUSINESS_B_ID = 'biz_BUSINESS_B_anon';
const NOW_MS = Date.now();
const PAST_TRIAL_START = NOW_MS - 20 * DAY_MS;
const RECENT_TRIAL_START = NOW_MS - 2 * DAY_MS;

// ─── Framework ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const errors = [];
function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { const m = `  ✗ ${label}${detail ? ' — ' + detail : ''}`; console.error(m); errors.push(m); failed++; }
}
function section(title) { console.log('\n── ' + title); }

// ─── TEST A: Founder dos negocios ─────────────────────────────────────────────
section('A. Founder con BUSINESS_A y BUSINESS_B: switch sin readOnly');
const founderState = evaluateEntitlement({ uid: FOUNDER_UID, status: 'founder', plan: 'founder', planCode: 'founder_unlimited', businessId: FOUNDER_UID }, NOW_MS);
assert('A1: Founder readOnly=false', founderState.readOnly === false, JSON.stringify(founderState));
assert('A2: Founder mode=founder', founderState.mode === 'founder');
assert('A3: resolveReadOnly(founder) en negocio A → false', resolveReadOnly(founderState, false) === false);
assert('A4: resolveReadOnly(founder) en negocio B → false', resolveReadOnly(founderState, false) === false);
const staleFounder = { ...founderState, readOnly: true, clockVerificationRequired: true };
assert('A5: Stale readOnly=true en founder → resolveReadOnly=false', resolveReadOnly(staleFounder, false) === false);
assert('A6: Durante GUARD=true → resolveReadOnly=false', resolveReadOnly(staleFounder, true) === false);

// ─── TEST B: Lifetime ignora trialDays ───────────────────────────────────────
section('B. Founder/lifetime: lifetime=true ignora trialDays/trialStartedAt');
const lifetimeState = evaluateEntitlement({ uid: FOUNDER_UID, status: 'active', plan: 'base', planCode: 'base', lifetime: true, billingStatus: 'lifetime', trialStartedAt: PAST_TRIAL_START, businessId: FOUNDER_UID }, NOW_MS);
assert('B1: lifetime=true + trial viejo → readOnly=false', lifetimeState.readOnly === false, JSON.stringify(lifetimeState));
assert('B2: lifetime=true → mode=lifetime', lifetimeState.mode === 'lifetime');
assert('B3: resolveReadOnly(lifetime) → false', resolveReadOnly(lifetimeState, false) === false);
const staleLifetime = { ...lifetimeState, readOnly: true };
assert('B4: Stale readOnly=true en lifetime → resolveReadOnly=false', resolveReadOnly(staleLifetime, false) === false);

// ─── TEST C: PRO Lifetime ────────────────────────────────────────────────────
section('C. Cliente PRO Lifetime: pro_lifetime + billing=lifetime → readOnly=false');
const proLifetimeState = evaluateEntitlement({ uid: CUSTOMER_UID_A, status: 'active', plan: 'pro', planCode: 'pro_lifetime', lifetime: true, billingStatus: 'lifetime', businessId: CUSTOMER_UID_A }, NOW_MS);
assert('C1: pro_lifetime con campos correctos → allowed=true', proLifetimeState.allowed === true, JSON.stringify(proLifetimeState));
assert('C2: pro_lifetime con campos correctos → readOnly=false', proLifetimeState.readOnly === false);
assert('C3: pro_lifetime → mode=lifetime', proLifetimeState.mode === 'lifetime');
const proLifetimeIncomplete = evaluateEntitlement({ uid: CUSTOMER_UID_A, status: 'active', plan: 'pro', planCode: 'pro_lifetime', lifetime: false, businessId: CUSTOMER_UID_A }, NOW_MS);
assert('C4: pro_lifetime sin lifetime=true → pending_activation (esperado)', proLifetimeIncomplete.mode === 'pending_activation');

// ─── TEST D: Trial expirado vs activo ─────────────────────────────────────────
section('D. Trial real expirado: readOnly=true (correcto)');
const expiredTrial = evaluateEntitlement({ uid: CUSTOMER_UID_A, status: 'trial', plan: 'base', planCode: 'base', trialStartedAt: PAST_TRIAL_START, businessId: CUSTOMER_UID_A }, NOW_MS);
assert('D1: Trial expirado → readOnly=true', expiredTrial.readOnly === true, JSON.stringify(expiredTrial));
assert('D2: Trial expirado → mode=trial_expired', expiredTrial.mode === 'trial_expired');
assert('D3: resolveReadOnly(expiredTrial) → true (correcto, no es bug)', resolveReadOnly(expiredTrial, false) === true);
const activeTrial = evaluateEntitlement({ uid: CUSTOMER_UID_A, status: 'trial_active', plan: 'base', planCode: 'base', trialStartedAt: RECENT_TRIAL_START, businessId: CUSTOMER_UID_A }, NOW_MS);
assert('D4: Trial activo (2 días) → readOnly=false', activeTrial.readOnly === false, JSON.stringify(activeTrial));
assert('D5: resolveReadOnly(activeTrial) → false', resolveReadOnly(activeTrial, false) === false);

// ─── TEST E: Doble-tap ────────────────────────────────────────────────────────
section('E. Doble-tap: BUSINESS_SWITCH_GUARD bloquea segundo tap');
let guard = false, switchCount = 0, activeId = BUSINESS_A_ID;
function simulateSelect(nextId, curr) {
  if (guard) return 'blocked';
  if (curr === nextId) return 'same';
  guard = true; switchCount++; activeId = nextId; guard = false;
  return 'switched';
}
assert('E1: Primer tap BUSINESS_B → switched', simulateSelect(BUSINESS_B_ID, BUSINESS_A_ID) === 'switched');
assert('E2: activeId=BUSINESS_B', activeId === BUSINESS_B_ID);
guard = true;
assert('E3: Segundo tap con GUARD → blocked', simulateSelect(BUSINESS_A_ID, BUSINESS_B_ID) === 'blocked');
assert('E4: activeId no cambió', activeId === BUSINESS_B_ID);
guard = false;
assert('E5: switchCount=1 (solo un switch efectivo)', switchCount === 1, `got=${switchCount}`);

// ─── TEST F: Cambio rápido A→B→A ─────────────────────────────────────────────
section('F. Cambio rápido A→B→A: termina en el negocio correcto');
let guardF = false, switchCF = 0, activeF = BUSINESS_A_ID;
function fastSelect(nextId) {
  if (guardF) return 'blocked';
  if (activeF === nextId) return 'same';
  guardF = true; switchCF++; activeF = nextId; guardF = false;
  return 'ok';
}
fastSelect(BUSINESS_B_ID);
const lastR = fastSelect(BUSINESS_A_ID);
assert('F1: A→B→A termina en BUSINESS_A', activeF === BUSINESS_A_ID, `activeId=${activeF}`);
assert('F2: Último switch = ok', lastR === 'ok');
assert('F3: Guard liberado', guardF === false);
assert('F4: switchCount=2', switchCF === 2, `got=${switchCF}`);

// ─── TEST G: Precedencia resolveReadOnly ─────────────────────────────────────
section('G. Precedencia: founder > lifetime > paid > trial_active > trial_expired');
[
  { mode: 'founder',              readOnly: true,  expected: false },
  { mode: 'lifetime',             readOnly: true,  expected: false },
  { mode: 'member',               readOnly: true,  expected: false },
  { mode: 'paid_base', plan: 'founder_unlimited', readOnly: true, expected: false },
  { mode: 'trial_active', platformRole: 'platform_founder', readOnly: true, expected: false },
  { mode: 'paid_pro', lifetime: true, billingStatus: 'lifetime', readOnly: true, expected: false },
  { mode: 'paid_pro', planCode: 'pro_lifetime', lifetime: true, billingStatus: 'lifetime', readOnly: true, expected: false },
  { mode: 'paid_pro', status: 'suspended', readOnly: false, expected: true },
  { mode: 'paid_base',            readOnly: false, expected: false },
  { mode: 'paid_base',            readOnly: true,  expected: true  },
  { mode: 'paid_pro',             readOnly: false, expected: false },
  { mode: 'paid_pro',             readOnly: true,  expected: true  },
  { mode: 'trial_active',         readOnly: false, expected: false },
  { mode: 'trial_active',         readOnly: true,  expected: false },
  { mode: 'trial_expired',        readOnly: true,  expected: true  },
  { mode: 'subscription_expired', readOnly: true,  expected: true  },
].forEach(({ mode, readOnly, expected, status, plan, planCode, lifetime, billingStatus, platformRole }) => {
  const r = resolveReadOnly({ mode, readOnly, status, plan, planCode, lifetime, billingStatus, platformRole }, false);
  assert(`G: ${mode} readOnly=${readOnly} → ${expected}`, r === expected, `got=${r}`);
  // Durante switch siempre false
  const rg = resolveReadOnly({ mode, readOnly: true }, true);
  assert(`G-GUARD: ${mode} durante switch → false`, rg === false);
});

// ─── TEST H: write gate único ────────────────────────────────────────────────
section('H. Write gate: stale readOnly no bloquea cuentas activas, errores reales si bloquean');
assert('H1: Firebase gate read_only stale + founder → allowed', writeGateStatus({ allowed: false, reason: 'read_only' }, staleFounder).allowed === true);
assert('H2: Firebase gate read_only stale + PRO Lifetime → allowed', writeGateStatus({ allowed: false, reason: 'read_only' }, { ...proLifetimeState, readOnly: true, lifetime: true, billingStatus: 'lifetime', planCode: 'pro_lifetime' }).allowed === true);
assert('H3: Trial vencido con read_only → bloqueado', writeGateStatus({ allowed: false, reason: 'read_only' }, expiredTrial).allowed === false);
assert('H4: Sincronización pendiente conserva razón específica', writeGateStatus({ allowed: false, reason: 'pending_remote_sync' }, founderState).reason === 'pending_remote_sync');

// ─── Resultado ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log('CLICK 360 V16.2 P1 — Business Switch Harness');
console.log('Versión candidata: 1.0.4-p1');
console.log('─'.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.error('\nFailed tests:');
  errors.forEach(e => console.error(e));
  console.log('\nVeredicto: NOT_READY');
  process.exit(1);
} else {
  console.log('\nVeredicto: READY_FOR_BUSINESS_SWITCH_SMOKE ✓');
  process.exit(0);
}
