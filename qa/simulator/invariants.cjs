'use strict';

const assert = require('node:assert/strict');
const { hash } = require('./fake-storage.cjs');

function businessRows(state, businessId) {
  return {
    products: (state.products || []).filter((item) => item.businessId === businessId),
    sales: (state.sales || []).filter((item) => item.businessId === businessId),
    movements: (state.movements || []).filter((item) => item.businessId === businessId),
    dailyReports: (state.dailyReports || []).filter((item) => item.businessId === businessId),
    cashSessions: (state.cashSessions || []).filter((item) => item.businessId === businessId)
  };
}

function assertBusinessIsolation(state) {
  const businessIds = new Set((state.businesses || []).map((business) => business.id));
  for (const collection of ['products', 'sales', 'movements', 'dailyReports', 'cashSessions']) {
    for (const row of state[collection] || []) {
      assert(businessIds.has(row.businessId), `${collection} row ${row.id || row.code || 'unknown'} points to an unknown business`);
    }
  }
}

function assertCashIntegrity(state) {
  for (const report of state.dailyReports || []) {
    if (report.status !== 'closed') continue;
    if (report.cashSessionId) {
      const session = (state.cashSessions || []).find((item) => item.id === report.cashSessionId && item.businessId === report.businessId);
      assert(session, `closed report ${report.id} must point to an existing session`);
      assert.equal(session.status, 'closed', `session ${session.id} must be closed`);
      assert.equal(session.reportId, report.id, `session ${session.id} must point back to report`);
    }
    assert(Number.isFinite(Number(report.expectedCash)), `report ${report.id} expected cash must be numeric`);
    assert(Number.isFinite(Number(report.countedCash)), `report ${report.id} counted cash must be numeric`);
  }
}

function assertNoDuplicateCloseReports(state) {
  const seen = new Set();
  for (const report of state.dailyReports || []) {
    if (report.status !== 'closed') continue;
    const key = `${report.businessId}:${report.date}:${report.cashSessionId || 'legacy'}`;
    assert(!seen.has(key), `duplicate close report for ${key}`);
    seen.add(key);
  }
}

function assertCoreInvariants(state) {
  assert(Array.isArray(state.businesses) && state.businesses.length > 0, 'state has businesses');
  assertBusinessIsolation(state);
  assertCashIntegrity(state);
  assertNoDuplicateCloseReports(state);
  return { hash: hash(state), businesses: state.businesses.length, reports: (state.dailyReports || []).length };
}

module.exports = { assertCoreInvariants, businessRows };
