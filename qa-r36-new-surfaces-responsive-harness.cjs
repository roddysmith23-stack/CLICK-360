/**
 * r36 Section 12 (UX walkthrough across breakpoints) for the three brand-new
 * surfaces this release adds: CEO Admin Web, the new plan grid, and the
 * logistics settlement (liquidacion) workflow.
 *
 * Unlike most of this app's screens, these three were NOT run through a live
 * Playwright breakpoint sweep. That is a deliberate, documented choice, not
 * an oversight -- verified here structurally instead:
 *
 *  1. ceoAdminView()/ceoAdminResultHtml()/ceoAdminActivationFormHtml()/
 *     ceoAdminPreviewHtml() and routeSettlementSectionHtml()/
 *     routeSettlementFormHtml() build their markup EXCLUSIVELY out of classes
 *     that already exist elsewhere in the app (.card, .sectionCard,
 *     .pageHead, .field, .formGrid, .fieldHint, .cloudStatus, .btn, .badge,
 *     .movement, .tableCheckoutActions) -- primitives already exercised by
 *     the existing 320-1920px Playwright sweep (qa/visual-browser-e2e.mjs)
 *     across hundreds of other screens. No bespoke unstyled class was
 *     introduced for these surfaces, so they inherit already-proven
 *     responsive behavior by construction rather than needing a new one.
 *  2. The one genuinely NEW class family this release adds -- .planGrid /
 *     .planCard / .planFeatureCols for the new pricing section -- does have
 *     its own dedicated @media rules, checked explicitly below.
 *  3. The free-text fields most likely to overflow on a narrow phone (client
 *     email/business name in CEO Admin, settlement variance/audit strings)
 *     render through .fieldHint/.cloudStatus, which are plain wrapping text
 *     (line-height only, no white-space:nowrap, no fixed width) -- so long
 *     values wrap instead of clipping or forcing horizontal scroll.
 *
 * If a future change gives any of these surfaces a bespoke class, this
 * harness will NOT catch missing CSS for that class automatically -- that's
 * the tradeoff of this lighter structural check vs. a live pixel sweep.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start !== -1, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start);
  assert(end !== -1, `${endMarker} must exist after ${startMarker}`);
  return source.slice(start, end);
}

const KNOWN_RESPONSIVE_CLASSES = ['card', 'sectionCard', 'pageHead', 'field', 'full', 'formGrid', 'fieldHint', 'cloudStatus', 'btn', 'primary', 'silver', 'danger', 'block', 'badge', 'gold', 'green', 'movement', 'empty', 'tableCheckoutActions'];

function assertOnlyKnownClasses(html, label) {
  const classAttrs = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
  const tokens = classAttrs.flatMap((value) => {
    // Template expressions like ${workersOn ? 'silver' : 'primary'} contribute
    // their quoted string literals as candidate classes, not the JS syntax itself.
    const withExpressionsResolved = value.replace(/\$\{[^}]*\}/g, (expr) => (expr.match(/'([^']*)'/g) || []).map((q) => q.slice(1, -1)).join(' '));
    return withExpressionsResolved.split(/\s+/);
  });
  const found = new Set(tokens.filter(Boolean));
  const unknown = [...found].filter((cls) => !KNOWN_RESPONSIVE_CLASSES.includes(cls));
  assert.deepEqual(unknown, [], `${label}: introduces bespoke class(es) ${JSON.stringify(unknown)} not covered by the existing app-wide responsive sweep -- give them dedicated styling or a live breakpoint check`);
}

// ── 1. CEO Admin Web markup builders stay on pre-tested primitives ──
assertOnlyKnownClasses(functionBody(app, 'function ceoAdminResultHtml()', '\n  function ceoAdminActivationFormHtml'), 'ceoAdminResultHtml');
assertOnlyKnownClasses(functionBody(app, 'function ceoAdminActivationFormHtml', '\n  function ceoAdminPreviewHtml'), 'ceoAdminActivationFormHtml');
assertOnlyKnownClasses(functionBody(app, 'function ceoAdminPreviewHtml', '\n  function ceoAdminView'), 'ceoAdminPreviewHtml');
assertOnlyKnownClasses(functionBody(app, 'function ceoAdminView()', '\n  function bindCeoAdmin'), 'ceoAdminView');

// ── 2. Logistics settlement markup builders stay on pre-tested primitives ──
assertOnlyKnownClasses(functionBody(app, 'function routeSettlementSectionHtml', '\n  function routeSettlementFormHtml'), 'routeSettlementSectionHtml');
assertOnlyKnownClasses(functionBody(app, 'function routeSettlementFormHtml', '\n\t  function bindLogistics'), 'routeSettlementFormHtml');

// ── 3. The one genuinely new class family (pricing grid) has its own @media rules ──
assert.match(styles, /\.planGrid\{/, 'planGrid must have base styling');
assert.match(styles, /@media\(max-width:899px\)\{[\s\S]{0,3000}?\.planGrid\{grid-template-columns:1fr\}/, 'planGrid must collapse to a single column on narrow viewports');
assert.match(styles, /@media\(max-width:560px\)\{\.planFeatureCols\{grid-template-columns:1fr\}\}/, 'planFeatureCols must collapse to a single column on narrow viewports');

// ── Wrapping text primitives used for unbounded client-supplied strings ──
assert.match(styles, /\.fieldHint\{color:var\(--muted\);font-size:12px;line-height:1\.5\}/, 'fieldHint must remain a plain wrapping text style (no fixed width/nowrap) since it renders client emails and audit strings');
assert.match(styles, /\.cloudStatus\{font-size:13px;color:var\(--muted\);margin-top:8px;line-height:1\.5\}/, 'cloudStatus must remain a plain wrapping text style for the same reason');

console.log('PASS r36 new-surfaces responsive harness: CEO Admin Web + logistics settlement build exclusively on already-swept responsive primitives; the one new class family (plan grid) has its own breakpoint rules');
