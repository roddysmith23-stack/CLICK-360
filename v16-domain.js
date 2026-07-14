(function (root) {
  'use strict';

  const APP_VERSION = '16.1.1';
  const TERMS_VERSION = '2026-07-14';
  const TRIAL_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const PLAN_CATALOG = Object.freeze({
    base: Object.freeze({
      name: 'Base',
      prices: Object.freeze({ month: 40, quarter: 114, semester: 180, year: 240, lifetime: 1000 }),
      limits: Object.freeze({ businesses: 1, workers: 2 }),
      features: Object.freeze(['Inventario', 'Ventas', 'Caja', 'Etiquetas QR', 'Reportes', 'Clientes', 'Sincronizacion'])
    }),
    pro: Object.freeze({
      name: 'Pro',
      prices: Object.freeze({ month: 59.99, quarter: 169, semester: 299, year: 499 }),
      limits: Object.freeze({ businesses: 5, workers: 10 }),
      features: Object.freeze(['Todo Base', 'CRM ampliado', 'WhatsApp', 'Cobranzas', 'Recordatorios avanzados', 'Apartados avanzados', 'Proveedores', 'Exportaciones'])
    })
  });

  function roundMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
  }

  function normalizePlan(value) {
    const plan = String(value || '').trim().toLowerCase();
    if (['normal', 'base', 'paid_base'].includes(plan)) return 'base';
    if (['pro', 'paid_pro'].includes(plan)) return 'pro';
    if (plan === 'founder') return 'founder';
    if (plan === 'lifetime') return 'lifetime';
    return 'base';
  }

  function timestampMs(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
    if (Number.isFinite(Number(value))) return Number(value);
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function evaluateEntitlement(data = {}, serverNowMs = 0) {
    const rawStatus = String(data.status || '').toLowerCase();
    const plan = normalizePlan(data.planCode || data.plan);
    const serverNow = timestampMs(serverNowMs || data.lastSeenAt || data.serverNow);
    const trialStartedAtMs = timestampMs(data.trialStartedAt);
    const trialDays = Math.max(1, Math.min(30, Number(data.trialDays || TRIAL_DAYS)));
    const trialEndsAtMs = timestampMs(data.trialEndsAt) || (trialStartedAtMs ? trialStartedAtMs + trialDays * DAY_MS : 0);
    const expiresAtMs = timestampMs(data.expiresAt);
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

  function planLimits(plan) {
    const normalized = normalizePlan(plan);
    if (normalized === 'founder' || normalized === 'lifetime') return { businesses: 10, workers: 25 };
    return { ...PLAN_CATALOG[normalized].limits };
  }

  function initialTenantBootstrapDecision({ localPersisted = false, onlineOnlySafe = false, online = false, readOnly = false } = {}) {
    if (readOnly) return { allowed: false, reason: 'read_only' };
    if (localPersisted) return { allowed: true, mode: 'local_and_cloud' };
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
    return {
      enabled: value.enabled === true || rate > 0,
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
    return { lines: linesWithTax, gross, discount, subtotal, tax, total, config };
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
    return digits;
  }

  function layawayStatus(layaway = {}, nowMs = Date.now()) {
    if (['cancelled', 'refunded', 'disputed', 'picked_up'].includes(layaway.status)) return layaway.status;
    const total = Math.max(0, Number(layaway.total) || 0);
    const paid = Math.max(0, Number(layaway.paid ?? layaway.received) || 0);
    if (paid >= total && total > 0) return layaway.pickedUpAt ? 'picked_up' : 'paid';
    const dueAt = timestampMs(layaway.pickupDueAt || layaway.dueAt || layaway.dueDate);
    if (dueAt && nowMs > dueAt) return 'expired';
    return paid > 0 ? 'partially_paid' : 'active';
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
    roundMoney,
    normalizePlan,
    timestampMs,
    evaluateEntitlement,
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
    layawayStatus,
    formatBusinessDate,
    sha256,
    randomToken
  });
  root.CLICK360_V16_DOMAIN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
