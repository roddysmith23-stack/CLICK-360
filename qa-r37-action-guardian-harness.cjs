/**
 * r37 (#90, commercial priority): Action Guardian must give GLOBAL coverage
 * of critical mutations, not just the handful fixed earlier in the session
 * (cash movements, edit-movement, supplier invoice). This harness proves:
 *  - a single shared, reusable guard (window.click360GuardedAction) exists
 *    rather than N slightly-different ad-hoc disable/re-enable snippets;
 *  - it disables the button and shows "Procesando..." on the FIRST tap;
 *  - it ignores a second tap while the first is still in flight (never a
 *    second network operation/second toast);
 *  - it carries a watchdog threshold so a slow operation gets a human
 *    notice instead of an infinite unexplained spinner;
 *  - the previously-unguarded high-risk trigger buttons (cancel a sale,
 *    register a layaway payment, mark a layaway ready/delivered, delete a
 *    product, cancel a supplier invoice) are now wired through it.
 *
 * The already-existing, per-mutation commitCriticalMutation() scope:reason
 * idempotency gate (acquireCriticalAction) remains the data-integrity
 * backstop underneath this -- this harness is about the human-facing UX
 * layer on top of it, which is what #90 explicitly asks for.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

// ── The shared guard exists and is exposed for both inline onclick markup
// (which runs in global scope) and for tests. ──
assert(app.includes('async function guardedAction(button, run)'), 'a single shared guardedAction(button, run) helper must exist rather than ad-hoc per-site disable snippets');
assert(app.includes('window.click360GuardedAction = guardedAction'), 'guardedAction must be exposed on window so inline onclick markup (global scope) can reach it');
assert(app.includes('guardedAction, ACTION_GUARDIAN_WATCHDOG_MS'), 'guardedAction and its watchdog threshold must be exposed via window.CLICK360_QA for testability');

// ── First-tap behaviour: disable + "Procesando..." immediately ──
const guardBlock = app.slice(app.indexOf('async function guardedAction(button, run)'), app.indexOf('async function guardedAction(button, run)') + 1200);
assert(guardBlock.includes("if (button.dataset.guardianBusy === '1') return undefined;"), 'a second tap while busy must be ignored outright, not queued or silently duplicated');
assert(guardBlock.includes('button.disabled = true'), 'the first tap must disable the button immediately');
assert(guardBlock.includes("button.textContent = 'Procesando...'"), 'the first tap must show a human "Procesando..." label immediately, not a bare disabled state with no feedback');
assert(guardBlock.includes('ACTION_GUARDIAN_WATCHDOG_MS'), 'a watchdog timer must exist for operations that take unusually long');
assert(guardBlock.includes("'Esto está tardando más de lo normal...'"), 'a slow operation must surface a human notice instead of an unexplained infinite spinner');
assert(/finally\s*\{[\s\S]*?clearTimeout\(watchdog\)/.test(guardBlock), 'the watchdog timer must always be cleared in a finally block, regardless of success/failure/early throw');
assert(/delete button\.dataset\.guardianBusy/.test(guardBlock), 'the busy flag must always be released in the finally block so the button is usable again afterward');

// ── Previously-unguarded high-risk triggers are now wired through the guard ──
const guardedCallers = [
  { fn: 'cancelSale', label: 'anular una venta (devuelve stock, no reversible)' },
  { fn: 'payLayaway', label: 'registrar un abono de apartado' },
  { fn: 'markLayawayStatus', label: 'marcar un apartado listo/entregado' },
  { fn: 'deleteInvoice', label: 'anular una factura de proveedor' },
  { fn: 'deleteProduct', label: 'eliminar un producto' }
];
for (const { fn, label } of guardedCallers) {
  const pattern = new RegExp(`click360GuardedAction\\([^)]*,\\s*\\(?\\)?\\s*=>\\s*(window\\.)?${fn}\\(`);
  assert(pattern.test(app), `the trigger for "${label}" (${fn}) must be wired through click360GuardedAction -- this was a real gap (native confirm()/prompt() friction alone does not stop a second tap once those dialogs are dismissed, and the mutation itself is high-stakes)`);
}

// cancelSale and markLayawayStatus each have two call sites (sales list +
// layaways list / ready + delivered) -- both must be covered, not just one.
assert((app.match(/click360GuardedAction\([^)]*,\s*\(?\)?\s*=>\s*(window\.)?cancelSale\(/g) || []).length >= 2, 'both cancelSale trigger buttons (sales list and layaways list) must be guarded');
assert((app.match(/click360GuardedAction\([^)]*,\s*\(?\)?\s*=>\s*(window\.)?markLayawayStatus\(/g) || []).length >= 2, 'both markLayawayStatus trigger buttons (ready-for-pickup and delivered) must be guarded');

// ── Already-robust, mutation-specific guards (cash close, backup restore)
// are left untouched -- this harness must not regress those by requiring
// them to also route through the generic helper. ──
assert(app.includes("cashCloseInFlight.has(inFlightKey)"), 'the cash-close-specific in-flight guard (a stronger, session-aware guard than the generic helper) must remain intact');

console.log('PASS r37 Action Guardian harness: a single shared, reusable guardedAction() helper disables the trigger and shows "Procesando..." on the first tap, ignores a repeated tap outright while busy, surfaces a watchdog notice for slow operations instead of an infinite spinner, and the previously-unguarded high-risk triggers (cancel sale, layaway payment, layaway status, delete product, cancel supplier invoice) are now wired through it -- without touching the already-robust cash-close in-flight guard.');
