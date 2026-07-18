'use strict';

function createPrng(seed = 360) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length) % values.length];
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function createSyntheticTenant({ seed = 360, products = 100, businessCount = 3 } = {}) {
  const random = createPrng(seed);
  const businesses = Array.from({ length: businessCount }, (_, index) => ({
    id: `qa-biz-${index + 1}`,
    name: `Negocio QA ${index + 1}`,
    status: 'activo',
    lastCashBalance: 0,
    settings: { ruc: `QA${index + 1}`, phone: '0000000000' }
  }));
  const productsRows = Array.from({ length: products }, (_, index) => {
    const business = businesses[index % businesses.length];
    return {
      id: `qa-prod-${index + 1}`,
      businessId: business.id,
      code: `QA${String(index + 1).padStart(5, '0')}`,
      name: `Producto QA ${index + 1}`,
      category: pick(random, ['General', 'Premium', 'Liquidacion']),
      price: money(5 + random() * 90),
      cost: money(1 + random() * 30),
      stock: 10 + Math.floor(random() * 80)
    };
  });
  return {
    schemaVersion: 10,
    identity: {
      ownerUid: 'qa-owner-synthetic',
      ownerId: 'qa-owner-synthetic',
      businessId: 'qa-owner-synthetic',
      tenantKey: 'owner:qa-owner-synthetic:business:qa-owner-synthetic'
    },
    activeBusinessId: businesses[0].id,
    businesses,
    products: productsRows,
    sales: [],
    movements: [],
    dailyReports: [],
    invoices: [],
    deletedProducts: [],
    auditLogs: [],
    layaways: [],
    cashSessions: [],
    notifications: [],
    legalAcceptances: [],
    settings: { workers: [], labelTemplates: [], userProfiles: {}, customers: [], reminders: [], onboarding: {}, activationRequests: [], policies: {}, legal: {}, appVersion: '16.2.0' },
    updatedAtMs: 0
  };
}

module.exports = { createPrng, createSyntheticTenant, money, pick };
