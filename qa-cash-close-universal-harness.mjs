import assert from 'node:assert/strict';

await import('./v16-domain.js');
await import('./worker-data-boundary.js');
await import('./cash-session-reconciliation.js');

const domain = globalThis.CLICK360_V16_DOMAIN;
const boundary = globalThis.CLICK360_WORKER_DATA_BOUNDARY;
const cash = globalThis.CLICK360_CASH_RECONCILIATION;
assert(domain && boundary && cash, 'shared cash-close dependencies must load');

const now = Date.parse('2026-09-26T17:45:00.000Z');
for (const plan of ['base', 'pro', 'business', 'enterprise']) {
  const access = domain.evaluateEntitlement({ status:'active', planCode:plan, expiresAt:now + 86400000 }, now);
  assert.equal(access.allowed, true, `${plan} remains entitled`);
  assert.equal(access.readOnly, false, `${plan} remains writable`);
  assert.equal(access.plan, plan, `${plan} retains its own quota catalog entry`);
}
const founderLegacy = domain.evaluateEntitlement({ status:'founder_legacy', planCode:'founder_legacy' }, now);
assert.deepEqual(
  { allowed:founderLegacy.allowed, readOnly:founderLegacy.readOnly, plan:founderLegacy.plan },
  { allowed:true, readOnly:false, plan:'founder_legacy' },
  'Founder Legacy follows the same shared writable path'
);

for (const role of ['owner', 'admin', 'supervisor', 'cashier']) {
  assert.equal(boundary.can(boundary.normalizePermissionMap(role), 'cashSessions', 'close'), true, `${role} may close when tenant policy allows it`);
}
for (const role of ['seller', 'inventory']) {
  assert.equal(boundary.can(boundary.normalizePermissionMap(role), 'cashSessions', 'close'), false, `${role} cannot gain cash-close permission implicitly`);
}

const tenants = [
  { ownerUid:'owner-a', businessId:'business-shared', sessionId:'session-shared', reportId:'report-a' },
  { ownerUid:'owner-b', businessId:'business-shared', sessionId:'session-shared', reportId:'report-b' },
  { ownerUid:'owner-c', businessId:'business-c', sessionId:'session-c', reportId:'report-c' }
];
const identities = tenants.map(({ ownerUid, businessId }) => boundary.identity(ownerUid, businessId));
assert.equal(new Set(identities.map((identity) => identity.tenantKey)).size, tenants.length, 'same business id under different owners remains tenant-isolated');

const reports = tenants.map((tenant) => ({
  id:tenant.reportId,
  ownerUid:tenant.ownerUid,
  businessId:tenant.businessId,
  cashSessionId:tenant.sessionId,
  date:'2026-09-03',
  status:'closed',
  total:30
}));
const targetA = { businessId:'business-shared', cashSessionId:'session-shared', date:'2026-09-03' };
assert.equal(cash.closedCashReportForTarget(reports.filter((report) => report.ownerUid === 'owner-a'), targetA)?.id, 'report-a');
assert.equal(cash.closedCashReportForTarget(reports.filter((report) => report.ownerUid === 'owner-b'), targetA)?.id, 'report-b');
assert.equal(cash.cashCloseTargetMatches(reports[2], targetA), false, 'another business cannot satisfy a close target');
assert.equal(cash.cashCloseTargetMatches({ ...reports[0], cashSessionId:'different-session' }, targetA), false, 'another session on the same date cannot satisfy a close target');

const historicalSessions = [
  { id:'open-0903', businessId:'business-shared', date:'2026-09-03', status:'open', openedAt:'2026-09-03T08:00:00-05:00' },
  { id:'closed-0903', businessId:'business-shared', date:'2026-09-03', status:'closed', reportId:'closed-report', openedAt:'2026-09-03T09:00:00-05:00' },
  { id:'reopened-0903', businessId:'business-shared', date:'2026-09-03', status:'open', openedAt:'2026-09-03T09:30:00-05:00', reopenedAt:'2026-09-03T12:00:00-05:00' },
  { id:'current-0926', businessId:'business-shared', date:'2026-09-26', status:'open', openedAt:'2026-09-26T09:00:00-05:00' }
];
const linkedReports = [{ id:'closed-report', businessId:'business-shared', date:'2026-09-03', cashSessionId:'closed-0903', status:'closed' }];
assert.equal(cash.cashCloseEligibility(historicalSessions[0], linkedReports).allowed, true, 'a historical open session can close');
assert.equal(cash.cashCloseEligibility(historicalSessions[1], linkedReports).reason, 'session_already_closed', 'a closed session never blocks or closes twice');
assert.equal(cash.cashCloseEligibility(historicalSessions[2], linkedReports).allowed, true, 'a legitimately reopened session can close again through its own id');
assert.equal(cash.currentOpenCashSession(historicalSessions, linkedReports, 'business-shared', '2026-09-26')?.id, 'current-0926');
assert.equal(cash.staleOpenCashSession(historicalSessions, linkedReports, 'business-shared', '2026-09-26')?.id, 'open-0903');

const sessionRecords = [
  { id:'sale-cash', businessId:'business-shared', date:'2026-09-03', cashSessionId:'open-0903', method:'Efectivo', total:10 },
  { id:'sale-card', businessId:'business-shared', date:'2026-09-03', cashSessionId:'open-0903', method:'Tarjeta', total:20 },
  { id:'sale-transfer', businessId:'business-shared', date:'2026-09-03', cashSessionId:'open-0903', method:'Transferencia', total:30 },
  { id:'other-session', businessId:'business-shared', date:'2026-09-03', cashSessionId:'reopened-0903', method:'Efectivo', total:999 },
  { id:'other-business', businessId:'business-c', date:'2026-09-03', cashSessionId:'open-0903', method:'Efectivo', total:999 }
];
assert.deepEqual(
  cash.recordsForCashSession(sessionRecords, historicalSessions[0], 'business-shared', '2026-09-03').map((record) => record.id),
  ['sale-cash', 'sale-card', 'sale-transfer'],
  'totals include all payment methods but never another session or business'
);

const sourceReport = { id:'compact', businessId:'business-shared', date:'2026-09-03', cashSessionId:'open-0903', status:'closed', html:'<div>derived</div>' };
const compact = cash.compactCashCloseReport(sourceReport);
assert.equal(compact.html, undefined, 'derived HTML is omitted near storage limits');
assert.equal(sourceReport.html, '<div>derived</div>', 'compaction never mutates caller state');
assert.equal(cash.cashCloseOutcomeFromEvidence({ pending:true }), 'pending');
assert.equal(cash.cashCloseOutcomeFromEvidence({ localRejected:true }), 'rejected');
assert.equal(cash.cashCloseOutcomeFromEvidence({ serverCheck:{ ok:true, closed:true } }), 'confirmed');
assert.equal(cash.cashCloseOutcomeFromEvidence({ serverCheck:{ ok:true, closed:false } }), 'rejected');
assert.equal(cash.cashCloseOutcomeFromEvidence({ serverCheck:{ ok:false } }), 'unknown');
assert.equal(cash.cashCloseOutcomeFromEvidence(), 'unknown');

const beforeMidnight = domain.formatBusinessDate('2026-09-04T04:59:59.000Z', 'en-CA', 'America/Guayaquil', false);
const afterMidnight = domain.formatBusinessDate('2026-09-04T05:00:01.000Z', 'en-CA', 'America/Guayaquil', false);
assert.notEqual(beforeMidnight, afterMidnight, 'America/Guayaquil business date rolls over at local midnight, not UTC midnight');

const serialized = JSON.stringify({ identities, reports, historicalSessions, sessionRecords, compact });
for (const forbidden of ['SHARY', 'shary', 'biz-shary', 'cash-0903']) {
  assert.equal(serialized.includes(forbidden), false, `shared regression fixtures must not encode a customer exception: ${forbidden}`);
}

console.log('PASS universal cash-close harness: 5 plans, 6 roles, 3 isolated tenants, historical/current/reopened sessions, payment methods, Guayaquil rollover and 4 UI outcomes');
