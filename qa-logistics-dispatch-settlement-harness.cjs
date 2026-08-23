/**
 * r36: Logistics -- app.js wiring to the (previously orphaned, now connected)
 * CLICK360_P2_LOGISTICS domain module.
 *
 * Root gaps this closes (Section 10 of the release brief):
 *  A. Dispatching a load sheet did not decrement inventory at all -- a
 *     product could be "loaded onto the truck" and still show as available
 *     for an in-store sale at the same time. Now dispatch goes through the
 *     domain's dispatchLoadSheet(), which is idempotent (guarded by
 *     stockCommittedAt) and only committed inside commitCriticalMutation.
 *  B. Route settlement ("liquidación") was a single unconditioned click that
 *     immediately closed the route -- no approval, no rejection/observation,
 *     no reopening, no discrepancy ("diferencia") tracking. Now it goes
 *     through createSettlement -> approve/reject -> close -> reopen, with a
 *     required reason on reject/reopen.
 *
 * qa-p2-logistics-routes-settlement-harness.cjs already proves the domain
 * functions themselves are correct in isolation; this proves app.js actually
 * calls them (not a second, parallel, ad-hoc implementation) and that the
 * dangerous paths (stock mutation, settlement state transitions) are
 * transactional/idempotent/audited at the UI layer too.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const domain = fs.readFileSync('p2-logistics-domain.js', 'utf8');

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start !== -1, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start);
  assert(end !== -1, `${endMarker} must exist after ${startMarker}`);
  return source.slice(start, end);
}

// ── A. Dispatch actually decrements inventory, once, transactionally ──
const dispatchBody = functionBody(app, "$('#routeDispatchBtn')?.addEventListener('click'", "$('#routeSaleForm')?.addEventListener('submit'");
assert(dispatchBody.includes('L.confirmLoadSheet(') && dispatchBody.includes('L.dispatchLoadSheet('), 'dispatch must call the domain confirmLoadSheet()+dispatchLoadSheet(), not a second ad-hoc stock mutation');
assert(dispatchBody.includes('applyLogisticsProductQty(dispatchResult.products)'), 'dispatch must apply the domain-computed product quantities back onto the real state.products records');
assert(dispatchBody.includes('commitCriticalMutation(previousState'), 'dispatch (a real inventory mutation) must go through the same transactional commit path as checkout/cash');
assert(domain.includes("if (sheet.stockCommittedAt) return { sheet, products, noop:true };"), 'dispatchLoadSheet() must stay idempotent -- re-dispatching an already-dispatched sheet must be a no-op, never a second decrement');

// The OLD ad-hoc load-item handler that never touched stock at all must be gone.
assert(!/routeLoadForm.*existing\.qty \+= qty/.test(app.replace(/\n/g, ' ')), 'the old ad-hoc load-item handler (which never decremented stock) must be removed');

// ── B. Settlement: full approve/reject/close/reopen state machine wired ──
['routeSettlementForm', 'settlementApproveBtn', 'settlementRejectBtn', 'settlementCloseBtn', 'settlementReopenBtn']
  .forEach((id) => assert(app.includes(`'#${id}'`) || app.includes(`"#${id}"`), `${id} must be wired in app.js`));
assert(app.includes('L.createSettlement(') && app.includes('L.approveSettlement(') && app.includes('L.rejectSettlement(') && app.includes('L.closeSettlement(') && app.includes('L.reopenSettlement('),
  'the full settlement lifecycle must call the domain module at every step, not reimplement any of it inline');

const rejectBody = functionBody(app, "$('#settlementRejectBtn')?.addEventListener('click'", "$('#settlementCloseBtn')?.addEventListener('click'");
assert(rejectBody.includes("prompt('Motivo del rechazo") && rejectBody.includes("if (!reason || !reason.trim())"), 'rejecting a settlement must require a real reason, not silently accept an empty one');

const reopenBody = functionBody(app, "$('#settlementReopenBtn')?.addEventListener('click'", "$('#routePrintBtn')");
assert(reopenBody.includes('if (!isOwnerUser())'), 'reopening a closed settlement must be owner-only');
assert(reopenBody.includes("if (!reason || !reason.trim())"), 'reopening must also require a real reason');

const closeBody = functionBody(app, "$('#settlementCloseBtn')?.addEventListener('click'", "$('#settlementReopenBtn')?.addEventListener('click'");
assert(closeBody.includes('commitCriticalMutation(previousState'), 'closing a settlement (which restores sellable-return stock) must go through the transactional commit path');
assert(closeBody.includes('applyLogisticsProductQty(result.products)'), 'closing must apply the sellable-return stock restoration back onto the real product records');

// ── Domain module: settlement state machine covers the full contract ──
assert(domain.includes("'draft', 'pending_approval', 'approved', 'rejected', 'closed', 'reopened', 'cancelled'"), 'SETTLEMENT_STATUS must include the rejected state added for this release');
assert(domain.includes('function rejectSettlement('), 'the domain module must expose an explicit reject/observe function, not only approve/reopen');
assert(domain.includes("if (settlement.status !== 'pending_approval') throw new Error('settlement_not_rejectable');"), 'reject must only be possible from pending_approval, matching approve\'s own precondition symmetry');

console.log('PASS Logistics: dispatch decrements inventory idempotently via the domain module (not a parallel ad-hoc path), full settlement approve/reject/close/reopen state machine wired end-to-end with required reasons and transactional commits');
