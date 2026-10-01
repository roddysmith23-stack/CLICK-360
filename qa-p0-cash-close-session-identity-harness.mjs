/**
 * qa-p0-cash-close-session-identity-harness.mjs
 *
 * Regression suite for the cashSessionId identity bug (P0, r89).
 *
 * Root cause: cashCloseBasis() may return activeSession=null for a retroactive
 * session between modal-open and submit, causing cashCloseTarget.cashSessionId=""
 * which then queries legacy reports on the server and proceeds to a 850 KB cloud
 * write that fails with save_rejected.
 *
 * This harness exercises the guard, recovery, and idempotency paths using the
 * same CLICK360_CASH_RECONCILIATION API that production uses.
 */

import assert from 'assert';
import { createRequire } from 'module';
// cash-session-reconciliation.js assigns its API to globalThis.CLICK360_CASH_RECONCILIATION.
// module.exports returns an empty object (CJS IIFE pattern), so we use globalThis.
const _require = createRequire(import.meta.url);
_require('./cash-session-reconciliation.js');
const reconciliation = globalThis.CLICK360_CASH_RECONCILIATION;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession({ id, businessId, date, status = 'open', openedAt = '2026-09-03T08:00:00Z' }) {
  return { id, businessId, date, status, openedAt, createdAtMs: Date.parse(openedAt) };
}

function makeReport({ id, businessId, date, cashSessionId, status = 'closed', closedAt = '2026-09-03T18:00:00Z' }) {
  return { id, businessId, date, cashSessionId, status, closedAt };
}

// ---------------------------------------------------------------------------
// 1. currentOpenCashSession: retroactive session resolved correctly
// ---------------------------------------------------------------------------
console.log('\n[1] currentOpenCashSession — retroactive date');

test('open session for 03/09 resolved when date passed explicitly', () => {
  const sessions = [
    makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' }),
    makeSession({ id: 'cash_sep4', businessId: 'biz1', date: '2026-09-04', status: 'closed' })
  ];
  const reports = [];
  const result = reconciliation.currentOpenCashSession(sessions, reports, 'biz1', '2026-09-03');
  assert.strictEqual(result?.id, 'cash_sep3', 'Should find the open session for 2026-09-03');
});

test('no open session returned when date is today() and only historical sessions exist', () => {
  const sessions = [
    makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' })
  ];
  const reports = [];
  const today = new Date().toISOString().slice(0, 10);
  const result = reconciliation.currentOpenCashSession(sessions, reports, 'biz1', today);
  assert.strictEqual(result, null, 'Should not return a retroactive session when today is queried');
});

test('null returned when retroactive session already has a closed report', () => {
  const sessions = [makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' })];
  const reports = [makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' })];
  const result = reconciliation.currentOpenCashSession(sessions, reports, 'biz1', '2026-09-03');
  assert.strictEqual(result, null, 'Already-closed session should not appear as open');
});

// ---------------------------------------------------------------------------
// 2. cashCloseEligibility: gate correctly signals already-closed
// ---------------------------------------------------------------------------
console.log('\n[2] cashCloseEligibility');

test('allowed=true for open session', () => {
  const session = makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' });
  const { allowed } = reconciliation.cashCloseEligibility(session, []);
  assert.strictEqual(allowed, true);
});

test('allowed=false when session already has a closed report', () => {
  const session = makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' });
  const reports = [makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' })];
  const { allowed, reason } = reconciliation.cashCloseEligibility(session, reports);
  assert.strictEqual(allowed, false);
  assert.strictEqual(reason, 'session_already_closed');
});

test('allowed=true when no session (legacy date close)', () => {
  const { allowed } = reconciliation.cashCloseEligibility(null, []);
  assert.strictEqual(allowed, true);
});

// ---------------------------------------------------------------------------
// 3. cashCloseTargetMatches: never match "" against a session report
// ---------------------------------------------------------------------------
console.log('\n[3] cashCloseTargetMatches — identity guard');

test('target with cashSessionId="" does NOT match a report that has a sessionId', () => {
  const report = makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' });
  const target = { businessId: 'biz1', date: '2026-09-03', cashSessionId: '' };
  const matches = reconciliation.cashCloseTargetMatches(report, target);
  assert.strictEqual(matches, false,
    'Empty cashSessionId must NOT match a report that belongs to a specific session');
});

test('target with real cashSessionId matches its own report', () => {
  const report = makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' });
  const target = { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' };
  assert.strictEqual(reconciliation.cashCloseTargetMatches(report, target), true);
});

test('target with cashSessionId="" matches a legacy report without a sessionId', () => {
  const report = makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-02', cashSessionId: '' });
  const target = { businessId: 'biz1', date: '2026-09-02', cashSessionId: '' };
  assert.strictEqual(reconciliation.cashCloseTargetMatches(report, target), true);
});

test('target with wrong businessId never matches', () => {
  const report = makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' });
  const target = { businessId: 'biz2', date: '2026-09-03', cashSessionId: 'cash_sep3' };
  assert.strictEqual(reconciliation.cashCloseTargetMatches(report, target), false);
});

test('target with wrong date never matches', () => {
  const report = makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' });
  const target = { businessId: 'biz1', date: '2026-09-04', cashSessionId: 'cash_sep3' };
  assert.strictEqual(reconciliation.cashCloseTargetMatches(report, target), false);
});

// ---------------------------------------------------------------------------
// 4. recordsForCashSession: isolation between sessions on the same date
// ---------------------------------------------------------------------------
console.log('\n[4] recordsForCashSession — session isolation');

test('sales are isolated by cashSessionId', () => {
  const session = { id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' };
  const sales = [
    { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3', id: 'sale1' },
    { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep2', id: 'sale2' },
    { businessId: 'biz1', date: '2026-09-03', cashSessionId: '', id: 'sale3' }
  ];
  const result = reconciliation.recordsForCashSession(sales, session, 'biz1', '2026-09-03');
  assert.strictEqual(result.length, 1, 'Only sale for session cash_sep3 should be returned');
  assert.strictEqual(result[0].id, 'sale1');
});

test('movements for different session on same date are not included', () => {
  const session = { id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' };
  const movements = [
    { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3', id: 'mov1', kind: 'ingreso', amount: 100 },
    { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_other', id: 'mov2', kind: 'ingreso', amount: 999 }
  ];
  const result = reconciliation.recordsForCashSession(movements, session, 'biz1', '2026-09-03');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'mov1');
});

// ---------------------------------------------------------------------------
// 5. closedCashReportForTarget: idempotency proof — existing close detected
// ---------------------------------------------------------------------------
console.log('\n[5] closedCashReportForTarget — idempotency');

test('existing closed report for session detected correctly', () => {
  const reports = [
    makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' }),
    makeReport({ id: 'rep2', businessId: 'biz1', date: '2026-09-02', cashSessionId: 'cash_sep2' })
  ];
  const target = { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' };
  const found = reconciliation.closedCashReportForTarget(reports, target);
  assert.strictEqual(found?.id, 'rep1', 'Should find the existing close to prevent duplicate');
});

test('empty cashSessionId target finds legacy report only', () => {
  const reports = [
    makeReport({ id: 'rep_legacy', businessId: 'biz1', date: '2026-09-01', cashSessionId: '' }),
    makeReport({ id: 'rep_session', businessId: 'biz1', date: '2026-09-01', cashSessionId: 'cash_sep1' })
  ];
  const target = { businessId: 'biz1', date: '2026-09-01', cashSessionId: '' };
  const found = reconciliation.closedCashReportForTarget(reports, target);
  assert.strictEqual(found?.id, 'rep_legacy');
});

test('no false positive when no closed report exists for target', () => {
  const reports = [
    makeReport({ id: 'rep2', businessId: 'biz1', date: '2026-09-02', cashSessionId: 'cash_sep2' })
  ];
  const target = { businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' };
  const found = reconciliation.closedCashReportForTarget(reports, target);
  assert.strictEqual(found, null, 'No report should be found for a different date/session');
});

// ---------------------------------------------------------------------------
// 6. isBusinessDateClosed: retroactive date behaviour
// ---------------------------------------------------------------------------
console.log('\n[6] isBusinessDateClosed — retroactive');

test('retroactive date not closed when session still open', () => {
  const sessions = [makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' })];
  const reports = [];
  assert.strictEqual(reconciliation.isBusinessDateClosed(reports, sessions, '2026-09-03', 'biz1'), false);
});

test('retroactive date closed after close report added', () => {
  const sessions = [makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03', status: 'closed' })];
  const reports = [makeReport({ id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3' })];
  assert.strictEqual(reconciliation.isBusinessDateClosed(reports, sessions, '2026-09-03', 'biz1'), true);
});

// ---------------------------------------------------------------------------
// 7. staleOpenCashSession: detects unclosed historical sessions
// ---------------------------------------------------------------------------
console.log('\n[7] staleOpenCashSession');

const today = new Date().toISOString().slice(0, 10);

test('detects session from 2026-09-03 as stale when today is ' + today, () => {
  const sessions = [makeSession({ id: 'cash_sep3', businessId: 'biz1', date: '2026-09-03' })];
  const stale = reconciliation.staleOpenCashSession(sessions, [], 'biz1', today);
  assert.strictEqual(stale?.id, 'cash_sep3');
});

test('today session is not reported as stale', () => {
  const sessions = [makeSession({ id: 'cash_today', businessId: 'biz1', date: today })];
  const stale = reconciliation.staleOpenCashSession(sessions, [], 'biz1', today);
  assert.strictEqual(stale, null);
});

// ---------------------------------------------------------------------------
// 8. compactCashCloseReport: no html in stored reports
// ---------------------------------------------------------------------------
console.log('\n[8] compactCashCloseReport — payload size safety');

test('html field removed from compact report', () => {
  const report = {
    id: 'rep1', businessId: 'biz1', date: '2026-09-03', cashSessionId: 'cash_sep3',
    status: 'closed', html: '<html>huge printable content</html>',
    income: 500, expenses: 50
  };
  const compact = reconciliation.compactCashCloseReport(report);
  assert.strictEqual(compact.html, undefined, 'html must not be stored in compact report');
  assert.strictEqual(compact.renderVersion, 'cash-close-structured-v1');
  assert.strictEqual(compact.income, 500, 'non-html fields preserved');
});

// ---------------------------------------------------------------------------
// 9. cashCloseOutcomeFromEvidence: correct classification
// ---------------------------------------------------------------------------
console.log('\n[9] cashCloseOutcomeFromEvidence');

test('pending when pending=true', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({ pending: true }), 'pending');
});

test('rejected when localRejected=true', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({ localRejected: true }), 'rejected');
});

test('confirmed when server says ok+closed', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({ serverCheck: { ok: true, closed: true } }), 'confirmed');
});

test('rejected when server says ok+not closed', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({ serverCheck: { ok: true, closed: false } }), 'rejected');
});

test('unknown when no evidence', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({}), 'unknown');
});

test('unknown when server check failed (ok=false)', () => {
  assert.strictEqual(reconciliation.cashCloseOutcomeFromEvidence({ serverCheck: { ok: false } }), 'unknown');
});

// ---------------------------------------------------------------------------
// 10. Tenant isolation: reports from different businessId never cross
// ---------------------------------------------------------------------------
console.log('\n[10] Tenant isolation');

test('reports from tenant B not visible to tenant A queries', () => {
  const reports = [
    makeReport({ id: 'rep_a', businessId: 'biz_a', date: '2026-09-03', cashSessionId: 'cs_a' }),
    makeReport({ id: 'rep_b', businessId: 'biz_b', date: '2026-09-03', cashSessionId: 'cs_a' })
  ];
  const target = { businessId: 'biz_a', date: '2026-09-03', cashSessionId: 'cs_a' };
  const found = reconciliation.closedCashReportForTarget(reports, target);
  assert.strictEqual(found?.id, 'rep_a', 'Must only return report for correct businessId');
});

test('open sessions from different tenants isolated', () => {
  const sessions = [
    makeSession({ id: 'cs_a', businessId: 'biz_a', date: '2026-09-03' }),
    makeSession({ id: 'cs_b', businessId: 'biz_b', date: '2026-09-03' })
  ];
  const result = reconciliation.currentOpenCashSession(sessions, [], 'biz_a', '2026-09-03');
  assert.strictEqual(result?.id, 'cs_a');
  assert.strictEqual(result?.businessId, 'biz_a');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`qa-p0-cash-close-session-identity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
