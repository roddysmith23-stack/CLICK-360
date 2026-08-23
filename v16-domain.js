(function (root) {
  'use strict';

  const APP_VERSION = '16.2';
  const TERMS_VERSION = '2026-07-14';
  const TRIAL_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Commercial catalog, r36 pricing reset (2026-08-23) -- this is the
  // explicit, owner-approved commercial decision for NEW customers, superseding
  // the r35 catalog (which had reused stale pre-existing base/pro prices).
  // Quota numbers (products/storageBytes) are derived from a live measurement
  // of production tenants against Firestore's 1 MiB document limit: a legacy
  // (non-modular) tenant with zero images is safe to ~800 products in a
  // single state/main document; with embedded images that collapses to
  // ~100-150 products, which is why storageBytes is tracked as an
  // INDEPENDENT quota from productsActive rather than folded into it.
  const PLAN_CATALOG = Object.freeze({
    // Internal code stays 'base' (unchanged since 2026-07-13, deeply threaded
    // through normalizePlan()/evaluateEntitlement()/firestore.rules literal
    // comparisons) -- only the customer-facing display name changes to
    // "Basic". Renaming the code itself would risk breaking every existing
    // `plan === 'base'` check across app.js/firebase-service.js/rules for a
    // release that must not touch already-billed real customers.
    // Commercial reset 2026-08-23 (r36): this is the approved offer for NEW
    // customers going forward. quarter/semester/lifetime prices were
    // deliberately removed from here -- they are no longer part of the
    // current commercial offer and must never be shown as primary options.
    // Historical accounts that were already sold on those periods are NOT
    // converted or affected: their stored accountAccess.activationPeriod and
    // expiresAt keep working exactly as before (see expiryTimestamp() in
    // admin-access-v16.mjs, which computes off the period name alone, not
    // off this price table), and admin-access-v16.mjs still accepts
    // quarter/semester/lifetime as administrative/historical-compatibility
    // values -- they are just no longer offered here as a sellable price.
    base: Object.freeze({
      name: 'Basic',
      prices: Object.freeze({ month: 39.99, year: 399 }),
      limits: Object.freeze({ businesses: 1, workerSeatsIncluded: 2, workerSeatsMax: 5, productsActive: 150, storageBytes: 3 * 1024 * 1024 }),
      features: Object.freeze(['Inventario', 'Ventas', 'Caja', 'Apartados', 'WhatsApp', 'Etiquetas QR', 'Reportes', 'Clientes', 'Sincronizacion'])
    }),
    pro: Object.freeze({
      name: 'Pro',
      prices: Object.freeze({ month: 59.99, year: 599 }),
      limits: Object.freeze({ businesses: 5, workerSeatsIncluded: 2, workerSeatsMax: 10, productsActive: 500, storageBytes: 8 * 1024 * 1024 }),
      features: Object.freeze(['Todo Basic', 'CRM ampliado', 'Cobranzas', 'Recordatorios avanzados', 'Apartados avanzados', 'Proveedores', 'Exportaciones'])
    }),
    business: Object.freeze({
      name: 'Business',
      prices: Object.freeze({ month: 99.99, year: 999 }),
      limits: Object.freeze({ businesses: 10, workerSeatsIncluded: 2, workerSeatsMax: 25, productsActive: 800, storageBytes: 15 * 1024 * 1024 }),
      features: Object.freeze(['Todo Pro', 'Multi-sucursal de cuentas (hasta 10 negocios)', 'Hasta 25 asientos de Workers', 'Soporte prioritario'])
    }),
    enterprise: Object.freeze({
      name: 'Enterprise',
      prices: Object.freeze({ custom: true }),
      limits: Object.freeze({ businesses: 25, workerSeatsIncluded: 2, workerSeatsMax: null, productsActive: 2000, storageBytes: 30 * 1024 * 1024 }),
      features: Object.freeze(['Todo Business', 'Cuotas negociadas', 'Arquitectura modular recomendada para catalogo grande', 'Cotizacion personalizada']),
      quote: true
    }),
    founder_legacy: Object.freeze({
      name: 'Founder',
      // NOT SOLD to new customers (r36 explicit decision) -- exists only to
      // carry the real, generous, technically-grounded quotas of customers
      // who already hold a historical For Life/Founder license (grant path:
      // scripts/onboard-new-customer.mjs --plan founder_legacy, gated by
      // documented evidence, never self-serve). No self-serve price: no
      // monthly billing for functions already granted. See normalizePlan()
      // and evaluateEntitlement() -- status 'founder' (distinct, internal/
      // platform) already bypasses billing separately.
      prices: Object.freeze({ historical: true }),
      limits: Object.freeze({ businesses: 10, workerSeatsIncluded: 2, workerSeatsMax: 25, productsActive: 2000, storageBytes: 20 * 1024 * 1024 }),
      features: Object.freeze(['Todo Business', 'Licencia funcional historica permanente', 'Sin mensualidad por funciones ya adquiridas', 'Cuotas de infraestructura amplias con margen de crecimiento']),
      historical: true,
      notSoldToNewCustomers: true
    })
  });

  // 70/85/95% => informational/warning/critical notice; 100% => block only
  // NEW-resource creation (never selling, charging, reading, or exporting
  // existing data). See evaluateQuota().
  const QUOTA_THRESHOLDS = Object.freeze({ notice: 0.70, warning: 0.85, critical: 0.95 });

  function planEntitlements(planCode) {
    const normalized = String(planCode || '').trim().toLowerCase();
    const entry = PLAN_CATALOG[normalized] || PLAN_CATALOG.base;
    return { code: Object.prototype.hasOwnProperty.call(PLAN_CATALOG, normalized) ? normalized : 'base', ...entry, limits: { ...entry.limits } };
  }

  // used/limit -> { ratio, percent, level, blocked }. limit of null/0/undefined
  // means "unlimited" (Enterprise workerSeatsMax) -- never blocks.
  function evaluateQuota(used, limit) {
    const usedNumber = Math.max(0, Number(used) || 0);
    const limitNumber = Number(limit);
    if (!Number.isFinite(limitNumber) || limitNumber <= 0) {
      return { used: usedNumber, limit: null, ratio: 0, percent: 0, level: 'unlimited', blocked: false };
    }
    const ratio = usedNumber / limitNumber;
    const percent = Math.min(999, Math.round(ratio * 100));
    let level = 'ok';
    if (ratio >= 1) level = 'blocked';
    else if (ratio >= QUOTA_THRESHOLDS.critical) level = 'critical';
    else if (ratio >= QUOTA_THRESHOLDS.warning) level = 'warning';
    else if (ratio >= QUOTA_THRESHOLDS.notice) level = 'notice';
    return { used: usedNumber, limit: limitNumber, ratio, percent, level, blocked: ratio >= 1 };
  }

  function roundMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
  }

  function normalizePlan(value) {
    const plan = String(value || '').trim().toLowerCase();
    if (['normal', 'base', 'basic', 'paid_base'].includes(plan)) return 'base';
    if (['pro', 'paid_pro', 'pro_lifetime'].includes(plan)) return 'pro';
    if (['business', 'paid_business'].includes(plan)) return 'business';
    if (['enterprise', 'paid_enterprise'].includes(plan)) return 'enterprise';
    // Distinct from the generic 'founder' status (platform/internal access,
    // evaluateEntitlement() below) -- founder_legacy is a real commercial
    // tier for historical customers (SHARY, Lia) with its own quotas, not
    // internal/unlimited access. Kept separate so PLAN_CATALOG.founder_legacy
    // is reachable via normalizePlan() for entitlement/quota lookups.
    if (['founder_legacy'].includes(plan)) return 'founder_legacy';
    if (['founder', 'founder_unlimited'].includes(plan)) return 'founder';
    if (plan === 'lifetime') return 'lifetime';
    return 'base';
  }

  function normalizeEpochMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    if (number < 100_000_000_000) return Math.round(number * 1000);
    if (number > 100_000_000_000_000) return Math.round(number / 1000);
    return Math.round(number);
  }

  function timestampMs(value) {
    if (typeof value?.toMillis === 'function') return normalizeEpochMs(value.toMillis());
    if (Number.isFinite(Number(value?.seconds))) {
      const nanoseconds = Number(value?.nanoseconds || 0);
      return normalizeEpochMs(Number(value.seconds) * 1000 + nanoseconds / 1_000_000);
    }
    if (Number.isFinite(Number(value))) return normalizeEpochMs(value);
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function evaluateEntitlement(data = {}, serverNowMs = 0) {
    const rawStatus = String(data.status || '').toLowerCase();
    const rawPlanCode = String(data.planCode || '').trim().toLowerCase();
    const plan = normalizePlan(data.planCode || data.plan);
    const serverNow = timestampMs(serverNowMs || data.lastSeenAt || data.serverNow);
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
    // Real commercial tier for historical customers (SHARY, Lia): permanent,
    // never expires, no billing -- but NOT the internal/unlimited 'founder'
    // mode above. Generous, technically-bounded quotas via
    // PLAN_CATALOG.founder_legacy, not unlimited infrastructure.
    if (['founder_legacy'].includes(rawStatus) || plan === 'founder_legacy') {
      return { allowed: true, readOnly: false, mode: 'founder_legacy', plan: 'founder_legacy', serverNowMs: serverNow, trialEndsAtMs, expiresAtMs: 0 };
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
    if (['active', 'paid_base', 'paid_pro', 'paid_business', 'paid_enterprise'].includes(rawStatus)) {
      const statusPlanMap = { paid_base: 'base', paid_pro: 'pro', paid_business: 'business', paid_enterprise: 'enterprise' };
      const paidPlan = statusPlanMap[rawStatus] || plan;
      const readOnly = !!expiresAtMs && !!serverNow && serverNow >= expiresAtMs;
      return { allowed: true, readOnly, mode: readOnly ? 'subscription_expired' : `paid_${paidPlan}`, plan: paidPlan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
    }
    if (rawStatus === 'member') return { allowed: true, readOnly: false, mode: 'member', plan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
    return { allowed: false, readOnly: true, mode: rawStatus || 'pending_activation', plan, serverNowMs: serverNow, trialEndsAtMs, expiresAtMs };
  }

  function accessClockNow(state = {}, clientNowMs = Date.now()) {
    const validatedServerNowMs = timestampMs(state.serverNowMs);
    const validatedAtClientMs = timestampMs(state.validatedAtClientMs);
    const clientNow = timestampMs(clientNowMs);
    if (!validatedServerNowMs) return 0;
    if (!validatedAtClientMs || !clientNow) return validatedServerNowMs;
    return validatedServerNowMs + Math.max(0, clientNow - validatedAtClientMs);
  }

  function reanchorTrustedClock(previous = {}, nextServerNowMs = 0, clientNowMs = Date.now()) {
    const clientNow = timestampMs(clientNowMs);
    const previousNow = accessClockNow(previous, clientNow);
    const nextServerNow = timestampMs(nextServerNowMs);
    return {
      serverNowMs: Math.max(previousNow, nextServerNow),
      validatedAtClientMs: clientNow
    };
  }

  function createOperationGate() {
    const inFlight = new Map();
    return Object.freeze({
      begin(key, snapshot = null) {
        const normalizedKey = String(key || '');
        if (!normalizedKey) return { acquired: false, snapshot: null, token: null };
        const current = inFlight.get(normalizedKey);
        if (current) return { acquired: false, snapshot: current.snapshot, token: null };
        const token = Symbol(normalizedKey);
        inFlight.set(normalizedKey, { token, snapshot });
        return { acquired: true, snapshot, token };
      },
      end(key, token) {
        const normalizedKey = String(key || '');
        const current = inFlight.get(normalizedKey);
        if (!current || current.token !== token) return false;
        inFlight.delete(normalizedKey);
        return true;
      },
      clear() { inFlight.clear(); },
      size() { return inFlight.size; }
    });
  }

  function offlineRecoveryDecision({ pendingRemoteSync = false, baseRevision = 0, remoteRevision = 0, localHash = '', remoteHash = '' } = {}) {
    if (!pendingRemoteSync) return { action: 'apply_remote' };
    if (localHash && remoteHash && localHash === remoteHash) return { action: 'already_synced' };
    if (Number(baseRevision || 0) !== Number(remoteRevision || 0)) return { action: 'conflict' };
    return { action: 'push_local' };
  }

  function trialRemaining(state = {}, clientNowMs = Date.now()) {
    const endsAtMs = timestampMs(state.trialEndsAtMs);
    const nowMs = accessClockNow(state, clientNowMs);
    const totalMs = Math.max(0, endsAtMs - nowMs);
    const days = Math.floor(totalMs / DAY_MS);
    const hours = Math.floor((totalMs % DAY_MS) / (60 * 60 * 1000));
    return { totalMs, days, hours, endsAtMs, expired: !endsAtMs || !nowMs || totalMs <= 0 };
  }

  // Legacy-shaped projection ({businesses, workers}) for the two pre-existing
  // enforced ceilings in app.js (businessLimit at the multi-business switcher,
  // workerLimit at the legacy settings.workers list -- distinct from the
  // modular Worker Data Boundary seat system, which enforces its own
  // entitlement independently via firestore.rules). Use planEntitlements()
  // for the full quota set (productsActive, storageBytes, workerSeatsIncluded).
  function planLimits(plan) {
    const normalized = normalizePlan(plan);
    if (normalized === 'founder' || normalized === 'lifetime') return { businesses: 10, workers: 25 };
    const limits = planEntitlements(normalized).limits;
    return { businesses: limits.businesses, workers: limits.workerSeatsMax == null ? 9999 : limits.workerSeatsMax };
  }

  function initialTenantBootstrapDecision({
    snapshotPrepared = false,
    localPersisted = false,
    indexedPersisted = false,
    onlineOnlySafe = false,
    online = false,
    readOnly = false
  } = {}) {
    if (readOnly) return { allowed: false, reason: 'read_only' };
    if (!snapshotPrepared) return { allowed: false, reason: 'snapshot_preparation_required' };
    if (localPersisted || indexedPersisted) return { allowed: true, mode: 'local_and_cloud' };
    if (onlineOnlySafe && online) return { allowed: true, mode: 'cloud_only' };
    return { allowed: false, reason: online ? 'local_storage_required' : 'connection_required' };
  }

  function publicIntentAllowsTrialCreation(intent) {
    return intent === 'trial' || intent === 'register';
  }

  function calculatorOperation(leftValue, rightValue, operator) {
    const left = Number(leftValue);
    const right = Number(rightValue);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    if (operator === '+') return roundMoney(left + right);
    if (operator === '-') return roundMoney(left - right);
    if (operator === '*') return roundMoney(left * right);
    if (operator === '/') return right === 0 ? null : roundMoney(left / right);
    return roundMoney(right);
  }

  function formatBusinessClock(value = Date.now(), locale = 'es-EC', timeZone = 'America/Guayaquil', compact = false) {
    const dateValue = new Date(value);
    if (!Number.isFinite(dateValue.getTime())) return '';
    const date = new Intl.DateTimeFormat(locale, compact
      ? { day: 'numeric', month: 'long', timeZone }
      : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(dateValue);
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(dateValue);
    const formattedDate = compact ? date : date.charAt(0).toUpperCase() + date.slice(1);
    return `${formattedDate} · ${time}`;
  }

  function normalizeTaxConfig(value = {}) {
    const legacyRate = Number(value.iva || 0);
    const rate = Math.max(0, Math.min(100, Number(value.rate ?? legacyRate) || 0));
    const priceMode = ['included', 'excluded'].includes(value.priceMode) ? value.priceMode : 'included';
    const hasExplicitEnabled = Object.prototype.hasOwnProperty.call(value, 'enabled');
    return {
      enabled: hasExplicitEnabled ? value.enabled === true : rate > 0,
      rate,
      priceMode,
      showLabel: value.showLabel !== false,
      rounding: 'line'
    };
  }

  function taxModeForProduct(product = {}, config = {}) {
    const mode = String(product.taxMode || 'inherit').toLowerCase();
    if (mode === 'exempt') return 'exempt';
    if (mode === 'included' || mode === 'excluded') return mode;
    return normalizeTaxConfig(config).priceMode;
  }

  function calculateCart(lines = [], discountValue = 0, configValue = {}) {
    const config = normalizeTaxConfig(configValue);
    const rawLines = (Array.isArray(lines) ? lines : []).map((line) => {
      const quantity = Math.max(0, Number(line.qty || line.quantity || 0));
      const unitPrice = Math.max(0, Number(line.unitPrice ?? line.price) || 0);
      return { ...line, quantity, unitPrice, gross: roundMoney(quantity * unitPrice) };
    });
    const gross = roundMoney(rawLines.reduce((sum, line) => sum + line.gross, 0));
    const discount = roundMoney(Math.min(gross, Math.max(0, Number(discountValue) || 0)));
    let distributed = 0;
    const linesWithTax = rawLines.map((line, index) => {
      const lineDiscount = index === rawLines.length - 1
        ? roundMoney(discount - distributed)
        : roundMoney(gross ? discount * (line.gross / gross) : 0);
      distributed = roundMoney(distributed + lineDiscount);
      const discounted = roundMoney(Math.max(0, line.gross - lineDiscount));
      const mode = taxModeForProduct(line, config);
      let base = discounted;
      let tax = 0;
      let total = discounted;
      if (config.enabled && config.rate > 0 && mode !== 'exempt') {
        if (mode === 'included') {
          base = roundMoney(discounted / (1 + config.rate / 100));
          tax = roundMoney(discounted - base);
        } else {
          tax = roundMoney(discounted * config.rate / 100);
          total = roundMoney(discounted + tax);
        }
      }
      return { ...line, taxMode: mode, lineDiscount, base, tax, total };
    });
    const subtotal = roundMoney(linesWithTax.reduce((sum, line) => sum + line.base, 0));
    const tax = roundMoney(linesWithTax.reduce((sum, line) => sum + line.tax, 0));
    const total = roundMoney(linesWithTax.reduce((sum, line) => sum + line.total, 0));
    const displaySubtotal = roundMoney(subtotal + discount);
    return { lines: linesWithTax, gross, discount, subtotal, displaySubtotal, tax, total, config };
  }

  function taxLegend(product = {}, configValue = {}) {
    const config = normalizeTaxConfig(configValue);
    if (!config.showLabel || !config.enabled || config.rate <= 0) return '';
    const mode = taxModeForProduct(product, config);
    if (mode === 'exempt') return 'Exento de IVA';
    return mode === 'included' ? 'Incluye IVA' : 'No incluye IVA';
  }

  function normalizePhone(value, countryCode = '593') {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = countryCode + digits.slice(1);
    // A cashier who types the bare 9-digit subscriber number (no leading 0,
    // no country code -- e.g. "987654321" instead of "0987654321") used to
    // pass through unchanged, producing a WhatsApp link with an incomplete
    // number. WhatsApp then can't resolve it to an exact contact and falls
    // back to a "choose a contact" / invalid-number screen, which drops the
    // prefilled message text -- this is the actual root cause of "WhatsApp
    // opens but the message is gone" for Apartados reminders. Detect that
    // shape (exactly 9 digits, doesn't already carry the country code) and
    // prepend it, same as the leading-0 case above.
    if (digits.length === 9 && !digits.startsWith(countryCode)) digits = countryCode + digits;
    return digits;
  }

  // Conservative E.164-shaped check: correct-looking length and, when a
  // country code is expected, that it's actually present. This exists to
  // catch the specific "phone is missing/incomplete" failure mode before a
  // WhatsApp link is ever built, not to fully validate arbitrary
  // international numbers.
  function isValidWhatsAppPhone(normalizedDigits, countryCode = '593') {
    const digits = String(normalizedDigits || '');
    if (!/^\d+$/.test(digits)) return false;
    if (digits.length < 11 || digits.length > 15) return false;
    if (countryCode && !digits.startsWith(countryCode)) return false;
    return true;
  }

  // Single source of truth for building a WhatsApp deep link with a
  // prefilled message. Returns { valid:false, reason } instead of a broken
  // URL when the phone can't be confidently normalized, so callers can show
  // a clear "fix the phone number" message instead of opening a dead link.
  function buildWhatsAppReminderLink(rawPhone, text, countryCode = '593') {
    const normalized = normalizePhone(rawPhone, countryCode);
    if (!normalized) return { valid:false, reason:'phone_missing', normalized:'' };
    if (!isValidWhatsAppPhone(normalized, countryCode)) return { valid:false, reason:'phone_invalid', normalized };
    return { valid:true, reason:'ok', normalized, url:`https://wa.me/${normalized}?text=${encodeURIComponent(String(text || ''))}` };
  }

  function layawayStatus(layaway = {}, nowMs = Date.now()) {
    if (['cancelled', 'refunded', 'disputed', 'picked_up', 'ready_for_pickup'].includes(layaway.status)) return layaway.status;
    const total = Math.max(0, Number(layaway.total) || 0);
    const paid = Math.max(0, Number(layaway.paid ?? layaway.received) || 0);
    if (paid >= total && total > 0) return layaway.pickedUpAt ? 'picked_up' : 'paid';
    const dueAt = timestampMs(layaway.pickupDueAt || layaway.dueAt || layaway.dueDate);
    if (dueAt && nowMs > dueAt) return 'expired';
    return paid > 0 ? 'partially_paid' : 'active';
  }

  function layawayPaymentDecision(layaway = {}, amountValue = 0, methodValue = 'Efectivo') {
    const status = layawayStatus(layaway);
    const balance = roundMoney(Math.max(0, Number(layaway.balance ?? (Number(layaway.total || 0) - Number(layaway.paid || 0))) || 0));
    const amount = roundMoney(amountValue);
    const method = String(methodValue || '').trim();
    if (['cancelled', 'refunded', 'picked_up'].includes(status)) return { allowed:false, reason:`layaway_${status}`, balance, amount, method };
    if (!Number.isFinite(amount) || amount <= 0) return { allowed:false, reason:'invalid_amount', balance, amount, method };
    if (amount > balance) return { allowed:false, reason:'amount_exceeds_balance', balance, amount, method };
    if (!['Efectivo', 'Tarjeta', 'Transferencia'].includes(method)) return { allowed:false, reason:'invalid_payment_method', balance, amount, method };
    return { allowed:true, reason:'ok', balance, amount, method, nextBalance:roundMoney(balance - amount) };
  }

  function layawayTransitionDecision(layaway = {}, nextStatus = '') {
    const current = layawayStatus(layaway);
    const balance = roundMoney(Math.max(0, Number(layaway.balance ?? (Number(layaway.total || 0) - Number(layaway.paid || 0))) || 0));
    const transitions = {
      paid: new Set(['ready_for_pickup', 'picked_up']),
      ready_for_pickup: new Set(['picked_up'])
    };
    if (balance > 0) return { allowed:false, reason:'balance_pending', current, nextStatus, balance };
    if (!transitions[current]?.has(nextStatus)) return { allowed:false, reason:'invalid_transition', current, nextStatus, balance };
    return { allowed:true, reason:'ok', current, nextStatus, balance };
  }

  function linkedMovementClosureDecision(movements = [], isClosed = () => false) {
    const blocked = (Array.isArray(movements) ? movements : [])
      .filter((movement) => movement?.status !== 'cancelled' && isClosed(movement?.date, movement))
      .map((movement) => ({ id:String(movement.id || ''), date:String(movement.date || ''), cashSessionId:String(movement.cashSessionId || '') }));
    return { allowed:blocked.length === 0, reason:blocked.length ? 'linked_closed_cash_session' : 'ok', blocked };
  }

  function operationAlreadyApplied(state = {}, operationId = '') {
    const id = String(operationId || '');
    if (!id) return false;
    return (Array.isArray(state.operationLedger) && state.operationLedger.some((entry) => entry?.operationId === id))
      || (Array.isArray(state.movements) && state.movements.some((entry) => entry?.operationId === id))
      || (Array.isArray(state.auditLogs) && state.auditLogs.some((entry) => entry?.details?.operationId === id));
  }

  function cashAmountForPayment(amountValue, methodValue = '') {
    const method = String(methodValue || '').trim();
    return method === 'Efectivo' ? roundMoney(Math.max(0, Number(amountValue) || 0)) : 0;
  }

  function formatBusinessDate(value, locale = 'es-EC', timeZone = 'America/Guayaquil', includeTime = true) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, includeTime
      ? { dateStyle: 'long', timeStyle: 'short', timeZone }
      : { dateStyle: 'long', timeZone }).format(date);
  }

  async function sha256(value) {
    if (!root.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('Hash seguro no disponible.');
    const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function randomToken() {
    if (!root.crypto?.getRandomValues) throw new Error('Generador seguro no disponible.');
    const bytes = new Uint8Array(32);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  const api = Object.freeze({
    APP_VERSION,
    TERMS_VERSION,
    TRIAL_DAYS,
    PLAN_CATALOG,
    QUOTA_THRESHOLDS,
    planEntitlements,
    evaluateQuota,
    roundMoney,
    normalizePlan,
    normalizeEpochMs,
    timestampMs,
    evaluateEntitlement,
    accessClockNow,
    reanchorTrustedClock,
    createOperationGate,
    offlineRecoveryDecision,
    trialRemaining,
    planLimits,
    initialTenantBootstrapDecision,
    publicIntentAllowsTrialCreation,
    calculatorOperation,
    formatBusinessClock,
    normalizeTaxConfig,
    taxModeForProduct,
    calculateCart,
    taxLegend,
    normalizePhone,
    isValidWhatsAppPhone,
    buildWhatsAppReminderLink,
    layawayStatus,
    layawayPaymentDecision,
    layawayTransitionDecision,
    linkedMovementClosureDecision,
    operationAlreadyApplied,
    cashAmountForPayment,
    formatBusinessDate,
    sha256,
    randomToken
  });
  root.CLICK360_V16_DOMAIN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
