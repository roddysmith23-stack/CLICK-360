import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('./cash-session-reconciliation.js');
const cash = globalThis.CLICK360_CASH_RECONCILIATION;
assert(cash, 'cash reconciliation API must load');

const target = { businessId:'biz-shary', date:'2026-09-03', cashSessionId:'cash-0903' };
const fullReport = {
  id:'report-0903', operationId:'report-0903', businessId:target.businessId, date:target.date,
  cashSessionId:target.cashSessionId, status:'closed', total:30, html:`<div>${'x'.repeat(14000)}</div>`
};
const compact = cash.compactCashCloseReport(fullReport);
assert.equal(compact.html, undefined, 'derived printable HTML must not be persisted in new cash reports');
assert.equal(compact.renderVersion, 'cash-close-structured-v1');
assert.equal(fullReport.html.length > 14000, true, 'the transient printable report must remain available to the caller');
assert.equal(cash.cashCloseTargetMatches(compact, target), true);
assert.equal(cash.cashCloseTargetMatches({ ...compact, cashSessionId:'' }, target), false);
assert.equal(cash.cashCloseTargetMatches({ ...compact, cashSessionId:'' }, { businessId:target.businessId, date:target.date, cashSessionId:'' }), true, 'legacy no-session reports remain date scoped');
assert.equal(cash.closedCashReportForTarget([compact], target)?.id, compact.id);

const limit = 850000;
const base = {
  products:Array.from({ length:463 }, (_, index) => ({ id:`p-${index}`, businessId:target.businessId, stock:1, qty:1, name:`Product ${index}` })),
  sales:Array.from({ length:30 }, (_, index) => ({ id:`s-${index}`, operationId:`op-${index}`, businessId:target.businessId, date:'2026-09-02', total:1 })),
  movements:Array.from({ length:107 }, (_, index) => ({ id:`m-${index}`, businessId:target.businessId, date:'2026-09-02', kind:'ingreso', amount:1 })),
  cashSessions:Array.from({ length:24 }, (_, index) => ({ id:`c-${index}`, businessId:target.businessId, date:'2026-09-02', status:'closed' })),
  dailyReports:Array.from({ length:21 }, (_, index) => ({ id:`r-${index}`, businessId:target.businessId, date:'2026-09-02', status:'closed', html:`<div>${'h'.repeat(4000)}</div>` })),
  auditLogs:Array.from({ length:271 }, (_, index) => ({ id:`a-${index}`, businessId:target.businessId, action:'historical', details:{ note:'kept' } })),
  settings:{ padding:'' }
};
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
base.settings.padding = 'z'.repeat(Math.max(0, 847200 - bytes(base)));
while (bytes(base) < 847150) base.settings.padding += 'z';
while (bytes(base) > 847300) base.settings.padding = base.settings.padding.slice(0, -1);
const beforeBytes = bytes(base);
const withFull = structuredClone(base);
withFull.dailyReports.push(fullReport);
const withCompact = structuredClone(base);
withCompact.dailyReports.push(compact);
assert(beforeBytes < limit && beforeBytes > 847000, `fixture must reproduce SHARY's near-limit state, got ${beforeBytes}`);
assert(bytes(withFull) > limit, 'legacy HTML report must reproduce local_state_too_large');
assert(bytes(withCompact) < limit, 'structured report must remain under the existing safety limit');

const app = await readFile('app.js', 'utf8');
const firebase = await readFile('firebase-service.js', 'utf8');
const submitStart = app.indexOf('async function submitCashClose');
const submitEnd = app.indexOf('async function reopenCashDay', submitStart);
const submit = app.slice(submitStart, submitEnd);
assert(submit.includes("stage = 'cash_close_verify_server_before_write'"), 'cash close must read the server before creating a retry report');
assert(submit.indexOf('click360VerifyCashCloseOnServer') < submit.indexOf('state.dailyReports.push'), 'server verification must precede local report mutation');
assert(submit.includes('compactCashCloseReport'), 'cash close must persist the compact report');
assert(submit.includes('cash_close_already_confirmed_server'), 'an already-committed close must be treated as success without duplication');
assert(app.includes("reason:lastSaveFailure?.code || lastWriteBlock?.reason || 'save_rejected'"), 'the concrete local save rejection must replace generic save_rejected');
assert(firebase.includes('window.click360VerifyCashCloseOnServer = async'), 'the read-only server preflight must be exported');
assert(firebase.includes("session?.status === 'closed' && !report"), 'inconsistent server session/report state must fail closed');

console.log(`PASS SHARY cash-close save_rejected harness: ${beforeBytes} bytes, full=${bytes(withFull)}, compact=${bytes(withCompact)}, 463 products and extended history`);
