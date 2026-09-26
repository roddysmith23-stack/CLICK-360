import assert from 'node:assert/strict';

await import('./cash-session-reconciliation.js');
const cash = globalThis.CLICK360_CASH_RECONCILIATION;
assert(cash, 'cash reconciliation domain must load');

const businessId = 'tenant-shary-synthetic';
const oldDate = '2026-09-02';
const today = '2026-09-25';
const session = (id, date, status, openedAt) => ({ id, businessId, date, status, openedAt });
const report = (id, cashSessionId, status = 'closed', closedAt = '2026-09-25T23:00:00.000Z') => ({
  id, businessId, date: oldDate, cashSessionId, status, closedAt
});

// Caja antigua abierta while a different session/report on the same date is closed.
const oldOpen = session('cash-old-open', oldDate, 'open', '2026-09-25T23:50:24.321Z');
const previouslyClosed = session('cash-closed', oldDate, 'closed', '2026-09-02T16:55:18.788Z');
const closedReport = report('report-closed', previouslyClosed.id);
assert.equal(cash.staleOpenCashSession([previouslyClosed, oldOpen], [closedReport], businessId, today)?.id, oldOpen.id);
assert.deepEqual(cash.cashCloseEligibility(oldOpen, [closedReport]), { allowed: true, reason: 'open_session' });
assert.equal(cash.isBusinessDateClosed([closedReport], [previouslyClosed, oldOpen], oldDate, businessId), false, 'a report for another session cannot close the unresolved one');

// Caja antigua already closed must never return as a blocking stale session.
const staleStatusButReported = session('cash-stale-status', oldDate, 'open', '2026-09-02T18:00:00.000Z');
const exactClosedReport = report('report-exact', staleStatusButReported.id);
assert.equal(cash.staleOpenCashSession([staleStatusButReported], [exactClosedReport], businessId, today), null);
assert.deepEqual(cash.cashCloseEligibility(staleStatusButReported, [exactClosedReport]), { allowed: false, reason: 'session_already_closed' });

// Two reports on one date remain independent and preserve their own session IDs.
const reportA = report('report-a', 'cash-a', 'reopened', '2026-09-25T23:51:53.244Z');
const reportB = report('report-b', 'cash-b', 'closed', '2026-09-26T01:41:02.634Z');
assert.deepEqual(cash.cashReportsForSession([reportA, reportB], session('cash-a', oldDate, 'closed', '2026-09-25T23:50:50.490Z')).map((item) => item.id), ['report-a']);

// Reopen, then close: only the selected latest report is reopened; history remains.
const firstReport = report('report-first', 'cash-first', 'closed', '2026-09-25T20:00:00.000Z');
const latestReport = report('report-latest', 'cash-latest', 'closed', '2026-09-25T21:00:00.000Z');
assert.equal(cash.latestClosedCashReport([firstReport, latestReport], businessId, oldDate)?.id, latestReport.id);
latestReport.status = 'reopened';
const reopenedSession = session('cash-reopened', oldDate, 'open', '2026-09-25T22:00:00.000Z');
assert.equal(cash.isBusinessDateClosed([firstReport, latestReport], [reopenedSession], oldDate, businessId), false);
reopenedSession.status = 'closed';
const reopenedCloseReport = report('report-after-reopen', reopenedSession.id, 'closed', '2026-09-25T22:05:00.000Z');
assert.equal(cash.isBusinessDateClosed([firstReport, latestReport, reopenedCloseReport], [reopenedSession], oldDate, businessId), true);
assert.equal(latestReport.status, 'reopened', 'the previous report remains as immutable reopen history');

// Multiple sessions on one date use actual timestamps, not array order.
const earlierOpen = session('cash-earlier-open', oldDate, 'open', '2026-09-25T18:00:00.000Z');
const laterOpen = session('cash-later-open', oldDate, 'open', '2026-09-25T19:00:00.000Z');
assert.equal(cash.latestCashSession([laterOpen, earlierOpen], businessId, oldDate)?.id, laterOpen.id);
assert.equal(cash.currentOpenCashSession([laterOpen, earlierOpen], [], businessId, oldDate)?.id, laterOpen.id);

// Sales and movements are scoped strictly to the session, even when another
// report on the same business date already contains real sales.
const sale48 = { id: 'sale-48', businessId, date: oldDate, cashSessionId: 'cash-with-sale', total: 48 };
const saleOther = { id: 'sale-other', businessId, date: oldDate, cashSessionId: 'cash-other', total: 8 };
assert.deepEqual(cash.recordsForCashSession([sale48, saleOther], session('cash-empty', oldDate, 'open', '2026-09-25T20:00:00.000Z'), businessId, oldDate), []);
assert.deepEqual(cash.recordsForCashSession([sale48, saleOther], session('cash-with-sale', oldDate, 'open', '2026-09-25T20:00:00.000Z'), businessId, oldDate).map((item) => item.id), ['sale-48']);

// Local/remote contradiction: a server-confirmed exact report wins over an
// obsolete local session status and cannot block the interface again.
assert.equal(cash.cashSessionIsClosed({ ...oldOpen, id: 'cash-server-closed' }, [report('report-server', 'cash-server-closed')]), true);

// Double-click: the same session key can only be in flight once, and after
// the first close its exact report makes subsequent attempts a no-op.
const inFlight = new Set();
const closeKey = `${businessId}:${oldDate}:${oldOpen.id}`;
assert.equal(inFlight.has(closeKey), false);
inFlight.add(closeKey);
assert.equal(inFlight.has(closeKey), true);
const afterFirstClose = report('report-first-click', oldOpen.id);
assert.equal(cash.cashCloseEligibility(oldOpen, [afterFirstClose]).allowed, false);

// Restablecimiento de la jornada actual: a new session becomes active after
// the prior one closes; an old report cannot make the new session disappear.
const currentClosed = session('cash-today-closed', today, 'closed', '2026-09-25T15:00:00.000Z');
const currentReport = { ...report('report-today', currentClosed.id), date: today };
const resetSession = session('cash-today-reset', today, 'open', '2026-09-25T16:00:00.000Z');
assert.equal(cash.currentOpenCashSession([currentClosed, resetSession], [currentReport], businessId, today)?.id, resetSession.id);
assert.equal(cash.isBusinessDateClosed([currentReport], [currentClosed, resetSession], today, businessId), false);

console.log('PASS SHARY P0 cash-session reconciliation: exact session identity, reopen history, contradictory state, duplicate close and current-day reset');
