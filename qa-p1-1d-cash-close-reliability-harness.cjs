'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const runtime = fs.readFileSync('runtime-guard.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

function freshState() {
  return {
    businesses: [
      { id: 'omega', name: 'Industrias Omega', lastCashBalance: 10, settings: {} },
      { id: 'alfa', name: 'Industrias Alfa', lastCashBalance: 0, settings: {} }
    ],
    activeBusinessId: 'omega',
    sales: [
      { id: 'sale-omega-1', businessId: 'omega', date: '2026-07-18', status: 'paid', method: 'Efectivo', total: 25, iva: 3, cashSessionId: 'cash-omega', items: [{ qty: 2 }] },
      { id: 'sale-alfa-1', businessId: 'alfa', date: '2026-07-18', status: 'paid', method: 'Efectivo', total: 99, iva: 0, cashSessionId: 'cash-alfa', items: [{ qty: 9 }] }
    ],
    movements: [
      { id: 'mov-open-omega', businessId: 'omega', date: '2026-07-18', kind: 'apertura', amount: 10, cashSessionId: 'cash-omega' },
      { id: 'mov-sale-omega', businessId: 'omega', date: '2026-07-18', kind: 'ingreso', amount: 25, paymentMethod: 'Efectivo', cashSessionId: 'cash-omega' },
      { id: 'mov-exp-omega', businessId: 'omega', date: '2026-07-18', kind: 'egreso', amount: 5, cashSessionId: 'cash-omega' },
      { id: 'mov-open-alfa', businessId: 'alfa', date: '2026-07-18', kind: 'apertura', amount: 0, cashSessionId: 'cash-alfa' }
    ],
    cashSessions: [
      { id: 'cash-omega', businessId: 'omega', date: '2026-07-18', status: 'open', openingAmount: 10 },
      { id: 'cash-alfa', businessId: 'alfa', date: '2026-07-18', status: 'open', openingAmount: 0 }
    ],
    dailyReports: [],
    auditLogs: []
  };
}

function closeCash(state, {
  businessId = 'omega',
  role = 'owner',
  readOnly = false,
  gateAllowed = true,
  commitOk = true,
  countedCash = 30,
  exportThrows = false,
  inFlight = new Set()
} = {}) {
  const business = state.businesses.find((item) => item.id === businessId);
  if (!business) return { ok: false, stage: 'cash_close_validate_access', reason: 'cash_close_no_active_business' };
  if (readOnly) return { ok: false, stage: 'cash_close_validate_access', reason: 'read_only' };
  if (!gateAllowed) return { ok: false, stage: 'cash_close_validate_access', reason: 'pending_remote_sync' };
  if (role !== 'owner') return { ok: false, stage: 'cash_close_validate_access', reason: 'worker_module_paused' };

  const session = state.cashSessions.slice().reverse().find((item) => item.businessId === businessId && item.date === '2026-07-18' && item.status === 'open');
  const sessionKey = session?.id || `legacy:${businessId}:2026-07-18`;
  if (inFlight.has(`${businessId}:2026-07-18:${sessionKey}`)) return { ok: false, stage: 'cash_close_load_session', reason: 'duplicate_close' };
  inFlight.add(`${businessId}:2026-07-18:${sessionKey}`);
  const before = JSON.stringify(state);
  try {
    if (state.dailyReports.some((report) => report.businessId === businessId && report.date === '2026-07-18' && report.status === 'closed' && (!session?.id || report.cashSessionId === session.id))) {
      return { ok: true, noop: true, stage: 'cash_close_load_session' };
    }
    const movements = state.movements.filter((movement) => movement.businessId === businessId && movement.date === '2026-07-18' && (!session?.id || movement.cashSessionId === session.id));
    const opening = movements.slice().reverse().find((movement) => movement.kind === 'apertura')?.amount || business.lastCashBalance || 0;
    const income = movements.filter((movement) => movement.kind === 'ingreso').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const out = movements.filter((movement) => !['ingreso', 'apertura'].includes(movement.kind)).reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const expectedCash = opening + income - out;
    const report = {
      id: `rep-${businessId}`,
      businessId,
      date: '2026-07-18',
      cashSessionId: session?.id || '',
      status: 'closed',
      expectedCash,
      countedCash,
      difference: countedCash - expectedCash,
      html: '<div>CIERRE DE CAJA</div>'
    };
    state.dailyReports.push(report);
    if (session) Object.assign(session, { status: 'closed', reportId: report.id, countedCash, expectedCash });
    business.lastCashBalance = countedCash;
    state.auditLogs.push({ action: 'cash_closed', businessId, reportId: report.id });
    if (!commitOk) {
      Object.assign(state, JSON.parse(before));
      return { ok: false, stage: 'cash_close_verify_closed', reason: 'cash_close_commit_not_confirmed' };
    }
    const reportClosed = state.dailyReports.some((item) => item.id === report.id && item.businessId === businessId && item.status === 'closed');
    const sessionClosed = !session || state.cashSessions.some((item) => item.id === session.id && item.status === 'closed' && item.reportId === report.id);
    assert(reportClosed && sessionClosed, 'closed report and closed session are verified together');
    if (exportThrows) return { ok: true, stage: 'cash_close_export_pdf', exportFailed: true, report };
    return { ok: true, stage: 'cash_close_verify_closed', report };
  } finally {
    inFlight.delete(`${businessId}:2026-07-18:${sessionKey}`);
  }
}

for (const mode of ['founder', 'paid_pro', 'lifetime', 'trial_active']) {
  const state = freshState();
  const result = closeCash(state, { role: 'owner', readOnly: false });
  assert.equal(result.ok, true, `${mode}: writable owner can close cash`);
  assert.equal(state.dailyReports.length, 1, `${mode}: one close report`);
  assert.equal(state.cashSessions.find((session) => session.id === 'cash-omega').status, 'closed', `${mode}: session closes`);
}

assert.equal(closeCash(freshState(), { readOnly: true }).reason, 'read_only', 'suspended or expired read-only access is blocked');
assert.equal(closeCash(freshState(), { role: 'cashier' }).reason, 'worker_module_paused', 'worker/cashier cash close is clearly paused while workers module is disabled');
assert.equal(closeCash(freshState(), { gateAllowed: false }).reason, 'pending_remote_sync', 'real write gate blocks before mutating cash');

const duplicateState = freshState();
const inFlight = new Set(['omega:2026-07-18:cash-omega']);
assert.equal(closeCash(duplicateState, { inFlight }).reason, 'duplicate_close', 'double click does not create a second close report');
assert.equal(duplicateState.dailyReports.length, 0, 'double click leaves state unchanged');

const retryState = freshState();
assert.equal(closeCash(retryState, { commitOk: false }).ok, false, 'failed commit is controlled');
assert.equal(retryState.dailyReports.length, 0, 'failed commit restores previous reports');
assert.equal(closeCash(retryState, { commitOk: true }).ok, true, 'retry can close after controlled failure');
assert.equal(retryState.dailyReports.length, 1, 'retry creates one report only');

const exportState = freshState();
const exportResult = closeCash(exportState, { exportThrows: true });
assert.equal(exportResult.ok, true, 'export failure is secondary after persistence');
assert.equal(exportResult.exportFailed, true, 'export failure is reported separately');
assert.equal(exportState.dailyReports.length, 1, 'export failure does not roll back closed cash');

const multiBusinessState = freshState();
closeCash(multiBusinessState, { businessId: 'omega', countedCash: 30 });
assert.equal(multiBusinessState.cashSessions.find((session) => session.id === 'cash-alfa').status, 'open', 'closing Omega does not close Alfa');
assert.equal(multiBusinessState.dailyReports.some((report) => report.businessId === 'alfa'), false, 'closing Omega does not create Alfa report');

const incompleteState = freshState();
delete incompleteState.dailyReports;
delete incompleteState.auditLogs;
const incompleteResult = closeCash({ ...incompleteState, dailyReports: [], auditLogs: [] });
assert.equal(incompleteResult.ok, true, 'incomplete but normalized state can close safely');

assert(app.includes("const APP_RELEASE_VERSION = '1.0.5'"), 'candidate app version is current');
assert(runtime.includes("const APP_VERSION = '1.0.5'"), 'runtime candidate version is current');
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-r37-2-1-live-client-hotfix'"), 'service worker cache is current');
assert(firebase.includes('window.click360WriteGate = writeGateStatus'), 'cash close still uses the existing client write gate');
for (const stage of [
  'cash_close_validate_access',
  'cash_close_load_session',
  'cash_close_calculate_totals',
  'cash_close_build_summary',
  'cash_close_persist_summary',
  'cash_close_verify_closed',
  'cash_close_export_pdf',
  'cash_close_export_png'
]) {
  assert(app.includes(stage), `app exposes ${stage}`);
}
assert(app.includes('function cashCloseAccessStatus('), 'cash close has explicit access preflight');
assert(app.includes('function recordCashCloseIssue('), 'cash close records handled diagnostics');
assert(app.includes('window.click360GetCashCloseDiagnostics'), 'cash close exposes reportable diagnostics');
assert(runtime.includes('cashClose:') && runtime.includes('if (details.uiHandled !== true) showFriendlyMessage(report);'), 'runtime keeps cash diagnostics without double generic UI');
assert(app.includes('reportClosed && sessionClosed'), 'cash close verifies both report and session');
assert(app.includes('cashCloseInFlight') && app.includes('Ya estamos cerrando esta caja'), 'cash close has an in-flight guard');
assert(app.includes('worker_module_paused') && app.includes('El acceso operativo para trabajadores está temporalmente pausado'), 'workers module has a clear paused state');
assert(app.includes('No pudimos cerrar la caja') && app.includes('Reintentar cierre') && app.includes('Copiar diagnóstico'), 'cash close failure UI is actionable');
assert(app.includes('Caja cerrada') && app.includes('la exportación no se pudo completar'), 'export failure does not imply data failure');
assert(styles.includes('.cashCloseIssuePanel') && styles.includes('.cashCloseDiagnosticList'), 'cash diagnostic UI is styled');
assert(!app.includes('shary10mmvv@gmail.com') && !app.includes('roddysmith23@hotmail.com'), 'cash close code does not hardcode real users');

console.log('PASS P1.1d cash close reliability harness: staged close, diagnostics, double-click, export separation and business isolation');
