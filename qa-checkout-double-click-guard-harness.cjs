/**
 * Commercial MVP UX audit finding (P0): checkout and table-checkout were
 * async, non-idempotent money-mutating handlers with no disable-while-
 * awaiting guard -- a fast double-click/double-tap during the await window
 * could create two sales and double-decrement stock, since each click
 * generates its own unique sale id/operationId (the idempotency ledger
 * checks operationId equality, which does not catch two DISTINCT operations
 * from two clicks of the same button).
 *
 * Locks in the fix: both handlers must disable their button synchronously
 * before any async work and re-enable it in a finally block, matching the
 * pre-existing pattern already used by cash-close (cashCloseInFlight) and
 * the seat/plan-request buttons.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

// asserts that `before` appears, then `disableMarker` within `maxGap` chars,
// then `finallyMarker` within `finallyMaxGap` chars after that.
function assertGuarded(label, before, disableMarker, maxGap, finallyMarker, finallyMaxGap) {
  const startIdx = app.indexOf(before);
  assert(startIdx !== -1, `${label}: could not find handler start "${before}"`);
  const disableIdx = app.indexOf(disableMarker, startIdx);
  assert(disableIdx !== -1 && disableIdx - startIdx <= maxGap,
    `${label}: "${disableMarker}" must appear within ${maxGap} chars after the handler starts`);
  const finallyIdx = app.indexOf(finallyMarker, disableIdx);
  assert(finallyIdx !== -1 && finallyIdx - disableIdx <= finallyMaxGap,
    `${label}: "${finallyMarker}" must appear within ${finallyMaxGap} chars after "${disableMarker}" (i.e. the button must be re-enabled once the async work settles)`);
}

// ── Point of sale checkout (#chargeBtn) ──
assertGuarded('chargeBtn', "$('#chargeBtn').onclick=async()=>{", 'chargeBtn.disabled = true;', 200, 'chargeBtn.disabled = false;', 200);
assert(app.includes('async function chargeCart(chargeBtn)'), 'the checkout mutation must live in a separate chargeCart() function, called only through the disable-guarded onclick');
assert(app.includes('await chargeCart(chargeBtn);'), 'the onclick guard must actually await chargeCart(), not fire-and-forget it');

// ── Table checkout (#tableCheckoutForm submit -> finalizeTableCharge) ──
assertGuarded('tableCheckoutForm', "$('#tableCheckoutForm').onsubmit = async (event) => {", 'submitBtn.disabled = true;', 600, 'submitBtn.disabled = false;', 1200);
assert(app.includes('await finalizeTableCharge(table, order,'), 'the table-checkout guard must actually await finalizeTableCharge()');

// ── Cash open / reopen (lower blast radius, but same class of bug) ──
assertGuarded('startDayBtnCash', 'startBtn.onclick = async () => {', 'startBtn.disabled = true;', 300, 'startBtn.disabled = false;', 2500);
assertGuarded('reopenCashBtn', 'btnReopenCash.onclick = async () => {', 'btnReopenCash.disabled = true;', 600, 'btnReopenCash.disabled = false;', 2500);

// ── Business settings save (#saveBiz) -- consistency with #saveUser ──
assertGuarded('saveBiz', "$('#saveBiz').onclick=async ()=>{", 'saveBizBtn.disabled = true;', 300, 'saveBizBtn.disabled = false;', 3000);

// ── r37 (Section 36-38, Action Guardian): cash movements and supplier
// invoices had NO anti-double-submit guard at all -- unlike checkout,
// where a duplicate op is at least idempotency-adjacent, these forms
// generate a fresh id on every submit event, so a fast double-click
// created two genuinely distinct financial records (a doubled income/
// expense entry, or a doubled supplier invoice + its linked movement). ──
assertGuarded('moveForm (new cash movement)', "$('#moveForm').onsubmit = async (e) => {", 'submitBtn.disabled = true;', 900, 'submitBtn.disabled = false;', 1500);
assertGuarded('editMoveForm (edit cash movement)', "$('#editMoveForm').onsubmit = async (e) => {", 'submitBtn.disabled = true;', 400, 'submitBtn.disabled = false;', 1800);
assertGuarded('invoiceForm (supplier invoice)', "$('#invoiceForm').onsubmit = async e => {", 'submitBtn.disabled = true;', 500, 'submitBtn.disabled = false;', 3500);

console.log('PASS Checkout/cash/settings double-click guard (structural regression against app.js)');
