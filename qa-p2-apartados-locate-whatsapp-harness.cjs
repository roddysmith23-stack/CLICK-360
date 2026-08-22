/**
 * Phase 3.4: Apartados findability + WhatsApp reminder regression.
 *
 * Root problem reported: a worker creates an Apartado, saves it, and later
 * can't find it (no search existed), and the WhatsApp reminder button opened
 * WhatsApp but dropped the prefilled message for any customer whose phone
 * was captured without the leading 0 / country code.
 *
 * This harness locks in the structural fixes in app.js (search input wired
 * to a per-row search key covering name/phone/short id, every status,
 * always -- see debtorsView()/bindDebtards()) and the single shared,
 * validated WhatsApp link builder (sendLayawayWhatsAppReminder), so neither
 * regresses silently. The phone normalization math itself is covered
 * end-to-end in qa-v16-domain-harness.mjs; this file checks the app.js
 * wiring that calls it.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

// ── Findability: search input exists, is wired, and searches across every status ──
assert(app.includes('id="layawaySearch"'), 'Apartados view must render a search input (#layawaySearch)');
assert(app.includes("data-layaway-search="), 'each Apartado row must carry a searchable data attribute combining name/phone/short-id');
assert(/searchKey\s*=\s*\[customerName,\s*sale\.customerPhone[^\]]*shortId/.test(app), 'the search key must include customer name, phone, and the short id shown in the row');
assert(app.includes("search?.addEventListener('input', apply)"), 'the search input must be wired to the same apply() that drives status filtering');
assert(/query\.length > 0[\s\S]{0,200}row\.hidden = !\(row\.dataset\.layawaySearch/.test(app), 'a non-empty search query must look across ALL statuses, not just the currently selected status filter');

// due date now visible in the row list (was previously only in the detail modal)
assert(/dueDate \? ` · L[ií]mite: \$\{escapeHtml\(dueDate\)\}` : ''/.test(app), 'the due date must be visible directly in the Apartados row list, not only inside the detail modal');

// ── WhatsApp: single shared, phone-validated path, used by both call sites ──
assert(app.includes('function sendLayawayWhatsAppReminder('), 'a single shared sendLayawayWhatsAppReminder function must exist');
assert(app.includes('function buildLayawayWhatsAppMessage('), 'the reminder message text must be built by a single shared function');
assert((app.match(/sendLayawayWhatsAppReminder\(/g) || []).length >= 3, 'sendLayawayWhatsAppReminder must be both defined and called from both the Apartados list and the post-sale modal (>=3 occurrences: definition + 2 call sites)');
assert(!/const url = `https:\/\/wa\.me\/\$\{phone\}/.test(app), 'no inline, unvalidated wa.me URL construction may remain for the layaway reminder (must go through buildWhatsAppReminderLink)');
assert(app.includes('CLICK360_V16_DOMAIN?.buildWhatsAppReminderLink?.('), 'the shared reminder function must use the validated link builder, not build the URL by hand');
assert(/if \(!link\?\.valid\)/.test(app), 'an invalid/incomplete phone must be caught and reported instead of opening a dead WhatsApp link');
assert(app.includes("Corrígelo en el detalle del Apartado antes de enviar el recordatorio") || app.includes('teléfono registrado no parece completo'), 'a clear, actionable error message must be shown when the phone is missing or malformed');
assert(!/reason === 'phone_missing'[\s\S]{0,300}(sale\.id|venta previa)/.test(app), 'the missing-phone message must not blame a missing prior sale -- the Apartado itself is always the source of truth');

// ── Regression: the message must read only from the sale/layaway record, never a separate CRM/customer lookup ──
assert(/function buildLayawayWhatsAppMessage\(sale, businessName\)[\s\S]{0,20}return `Hola \$\{sale\.customer\}/.test(app), 'the message must be built purely from the sale object fields (customer, total, received, balance, dueDate), independent of whether that customer ever completed a normal sale');

// ── Printing: the logistics route sheet must go through the same protected handoffPrint() path ──
assert(!/popup\.print\(\)/.test(app), 'no print button may bypass handoffPrint() via a raw window.open()+popup.print() -- this previously skipped the anti-double-print guard entirely for the logistics route sheet');
assert(/routePrintBtn['"]?\)\.onclick = \(\) => \{[\s\S]{0,400}handoffPrint\(/.test(app), 'the logistics route print button must call handoffPrint(), the same guarded path as every other print button');
assert(app.includes("'routePrintBtn'") && /\[.*'routePrintBtn'.*\]\.forEach/.test(app), 'routePrintBtn must be included in the set of buttons disabled while a print job is in flight');

console.log('PASS Apartados findability + WhatsApp reminder + route-sheet print guard (structural regression against app.js)');
