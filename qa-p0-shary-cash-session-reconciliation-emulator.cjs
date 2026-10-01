'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, setDoc } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-p0-rules';
const OWNER_ID = 'owner-shary-cash-synthetic';
const BUSINESS_ID = 'business-shary-synthetic';
const DATE = '2026-09-02';

function ownerProfile() {
  return { uid: OWNER_ID, email: 'owner-shary-cash@example.test', role: 'owner', isOwner: true, ownerId: OWNER_ID, status: 'active', approved: true };
}

function stateDocument() {
  const tenantKey = `owner:${OWNER_ID}:business:${OWNER_ID}`;
  return {
    schemaVersion: 10,
    ownerUid: OWNER_ID,
    ownerId: OWNER_ID,
    businessId: OWNER_ID,
    tenantKey,
    revision: 1,
    payload: {
      schemaVersion: 10,
      identity: { schemaVersion: 10, ownerUid: OWNER_ID, ownerId: OWNER_ID, businessId: OWNER_ID, tenantKey },
      data: {
        businesses: [{ id: BUSINESS_ID, name: 'SHARY Synthetic', status: 'activo' }],
        products: [{ id: 'product-48-a', businessId: BUSINESS_ID, code: 'SYN-48-A', name: 'Synthetic A', stock: 4, qty: 4, price: 10 }],
        sales: [{ id: 'sale-48', operationId: 'sale-op-48', businessId: BUSINESS_ID, date: DATE, cashSessionId: 'cash-with-sale', total: 48, status: 'paid' }],
        movements: [
          { id: 'open-target', operationId: 'open-target', businessId: BUSINESS_ID, date: DATE, cashSessionId: 'cash-target', kind: 'apertura', amount: 0 },
          { id: 'sale-movement-48', operationId: 'sale-op-48', businessId: BUSINESS_ID, date: DATE, cashSessionId: 'cash-with-sale', kind: 'ingreso', amount: 48 }
        ],
        cashSessions: [
          { id: 'cash-with-sale', operationId: 'cash-with-sale', businessId: BUSINESS_ID, date: DATE, status: 'closed', reportId: 'report-with-sale', openedAt: '2026-09-25T23:50:50.490Z' },
          { id: 'cash-target', operationId: 'cash-target', businessId: BUSINESS_ID, date: DATE, status: 'open', openedAt: '2026-09-25T23:54:50.534Z' }
        ],
        dailyReports: [{ id: 'report-with-sale', operationId: 'report-with-sale', businessId: BUSINESS_ID, date: DATE, cashSessionId: 'cash-with-sale', status: 'closed', saleIds: ['sale-48'] }],
        invoices: [], deletedProducts: [], auditLogs: [], layaways: [], notifications: [], legalAcceptances: [], tables: [], tableOrders: [],
        settings: { workers: [], labelTemplates: [], customers: [], reminders: [] }
      }
    }
  };
}

async function closeFromDevice(db, deviceId, expectedRevision) {
  const reference = doc(db, 'businesses', OWNER_ID, 'state', 'main');
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data();
    if (Number(current.revision || 0) !== expectedRevision) {
      const error = new Error('revision conflict');
      error.code = 'click360/revision-conflict';
      throw error;
    }
    const next = structuredClone(current);
    const data = next.payload.data;
    const target = data.cashSessions.find((session) => session.id === 'cash-target');
    assert(target && target.status === 'open', `${deviceId}: target session must be open at the expected revision`);
    const sessionSales = data.sales.filter((sale) => sale.cashSessionId === target.id);
    const sessionMovements = data.movements.filter((movement) => movement.cashSessionId === target.id);
    assert.equal(sessionSales.length, 0, `${deviceId}: sales from another session cannot leak into this close`);
    assert.equal(sessionMovements.length, 1, `${deviceId}: only the target opening movement is in scope`);
    const reportId = `report-${deviceId}`;
    data.dailyReports.push({ id: reportId, operationId: reportId, businessId: BUSINESS_ID, date: DATE, cashSessionId: target.id, status: 'closed', saleIds: [] });
    Object.assign(target, { status: 'closed', reportId, closedBy: deviceId });
    next.revision = expectedRevision + 1;
    transaction.set(reference, next);
    return reportId;
  });
}

async function main() {
  const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', OWNER_ID), ownerProfile());
      await setDoc(doc(db, 'businesses', OWNER_ID, 'state', 'main'), stateDocument());
    });

    const owner = env.authenticatedContext(OWNER_ID, { email: ownerProfile().email }).firestore();
    const outcomes = await Promise.allSettled([
      closeFromDevice(owner, 'device-a', 1),
      closeFromDevice(owner, 'device-b', 1)
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'exactly one device closes the session');
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1, 'the stale concurrent close is rejected');
    assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 'click360/revision-conflict');

    const finalSnapshot = await getDoc(doc(owner, 'businesses', OWNER_ID, 'state', 'main'));
    const finalDocument = finalSnapshot.data();
    const finalState = finalDocument.payload.data;
    assert.equal(finalDocument.revision, 2, 'one atomic close advances the revision once');
    assert.equal(finalState.dailyReports.filter((item) => item.cashSessionId === 'cash-target').length, 1, 'only one report exists for the target session');
    assert.deepEqual(finalState.dailyReports.find((item) => item.cashSessionId === 'cash-target').saleIds, [], 'the $48 sale remains scoped to its original session');
    assert.equal(finalState.sales.length, 1, 'the existing sale is neither duplicated nor deleted');
    assert.equal(finalState.movements.length, 2, 'no movement is duplicated or altered');
    assert.equal(finalState.products[0].stock, 4, 'inventory is unchanged by cash-session repair');
    assert.equal(finalState.products[0].qty, 4, 'legacy qty mirror remains unchanged');

    console.log('PASS SHARY P0 Firestore emulator: two devices produce one exact-session close, one CAS conflict, and no sale/movement/inventory mutation');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
