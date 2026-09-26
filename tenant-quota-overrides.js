(function (root) {
  'use strict';

  function sanitizeOverrideLimit(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function planEntitlements(domain, planCode, overrides) {
    const base = domain?.planEntitlements?.(planCode);
    if (!base) return null;
    const limits = { ...base.limits };
    const businesses = sanitizeOverrideLimit(overrides?.businesses);
    const workerSeatsMax = sanitizeOverrideLimit(overrides?.workers ?? overrides?.workerSeatsMax);
    const productsActive = sanitizeOverrideLimit(overrides?.productsActive);
    const storageBytes = sanitizeOverrideLimit(overrides?.storageBytes);
    if (businesses != null) limits.businesses = businesses;
    if (workerSeatsMax != null) limits.workerSeatsMax = workerSeatsMax;
    if (productsActive != null) limits.productsActive = productsActive;
    if (storageBytes != null) limits.storageBytes = storageBytes;
    return { ...base, limits };
  }

  function planLimits(domain, plan, overrides) {
    const normalized = domain?.normalizePlan?.(plan) || String(plan || '').trim().toLowerCase();
    if (normalized === 'founder' || normalized === 'lifetime') {
      const businesses = sanitizeOverrideLimit(overrides?.businesses) ?? 10;
      const workers = sanitizeOverrideLimit(overrides?.workers ?? overrides?.workerSeatsMax) ?? 25;
      return { businesses, workers };
    }
    const entitlements = planEntitlements(domain, normalized, overrides);
    if (!entitlements) return null;
    return {
      businesses: entitlements.limits.businesses,
      workers: entitlements.limits.workerSeatsMax == null ? 9999 : entitlements.limits.workerSeatsMax
    };
  }

  const api = Object.freeze({ sanitizeOverrideLimit, planEntitlements, planLimits });
  root.CLICK360_TENANT_QUOTA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
