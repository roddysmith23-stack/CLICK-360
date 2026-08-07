const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const guard = fs.readFileSync('runtime-guard.js', 'utf8');

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

ok(app.includes("commercial-1-0-5-r31"), 'app.js must report r30');
ok(sw.includes("commercial-1-0-5-r31"), 'service-worker must report r30');
ok(guard.includes("commercial-1-0-5-r31"), 'runtime guard must report r30');
ok(!app.includes("commercial-1-0-5-r29"), 'app.js still contains r29');
ok(!sw.includes("commercial-1-0-5-r29"), 'service-worker still contains r29');

ok(app.includes('function openSimpleLabelModal('), 'simple label home is missing');
ok(app.includes('data-r30-simple-label="true"'), 'simple label home marker is missing');
ok(app.includes('id="quickLabelTemplateSelect"'), 'template selector missing');
ok(app.includes('id="quickLabelHomeQuantity"'), 'quantity input missing');
ok(app.includes('id="quickLabelHomeStartSlot"'), 'start slot input missing');
ok(app.includes('id="quickLabelHomePrint"'), 'print action missing');
ok(app.includes('id="quickLabelHomePdf"'), 'PDF action missing');
ok(app.includes('id="quickLabelHomeEdit"'), 'edit-template action missing');
ok(app.includes('id="quickLabelHomeAdvanced"'), 'advanced action missing');
ok(app.includes("if (!options.editorOnly) return openSimpleLabelModal(product, initialTemplateId);"), 'normal label entry does not route to simple screen');
ok(app.includes("if (options.advancedOnly) return openAdvancedLabelModal(product, initialTemplateId, options);"), 'advanced wizard is not explicitly gated');

const openStart = app.indexOf("  async function openLabelModal(product, initialTemplateId = '', options = {}) {");
const openEnd = app.indexOf('  window.click360UniversalLabelTest', openStart);
ok(openStart >= 0 && openEnd > openStart, 'cannot isolate openLabelModal');
const openBody = app.slice(openStart, openEnd);
ok(!openBody.includes('p2UniversalLabelsEnabled'), 'legacy feature flag still controls the primary label route');
ok(openBody.indexOf('options.directPrint || options.directPdf') < openBody.indexOf('openSimpleLabelModal'), 'direct print must be resolved before simple editor route');

ok(app.includes("const sourcePriceFormat = sourceDocument?.priceFormat || 'full';"), 'final renderer does not preserve priceFormat');
ok(app.includes('priceFormat:sourcePriceFormat'), 'render snapshot does not carry priceFormat');
ok(app.includes("const resolvedFallbackPriceFormat = priceFormat || resolvedTemplate?.priceFormat || 'full';"), 'inline-paper fallback loses priceFormat');
ok(app.includes("priceFormat:initialTemplate?.priceFormat || 'full'"), 'editor print loses saved template price format');
ok(app.includes("priceFormat:template.priceFormat || 'full'"), 'simple print does not use saved template price format');

ok(app.includes('if (prepared.plan?.count !== quantity)'), 'simple flow does not verify exact copy count');
ok(app.includes("startInput.value = String(columns >= 2 ? 2 : 1);"), 'second-column shortcut is missing');
ok(app.includes("return await executeCanonicalLabelPrint(prepared, providerId);"), 'simple flow bypasses canonical print executor');
ok(app.includes("const criticalErrors = (preflight.validation?.errors || []).filter"), 'advanced warning/nonblocking guard regressed');

ok(styles.includes('CLICK360_R30_SIMPLE_LABEL'), 'responsive simple label CSS missing');
ok(styles.includes('@media(max-width:600px)'), 'mobile simple label breakpoint missing');

console.log('CLICK360_R30_LABEL_SIMPLE_CONTRACT: PASS');
