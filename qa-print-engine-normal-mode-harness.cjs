/**
 * r36: Print Engine "Normal mode" contract.
 *
 * SHARY's original incident (mediaWidthMm:800) happened because a raw
 * millimeter input for the TOTAL roll/sheet size was exposed as something
 * a non-technical user could type into by mistake. r35 fixed her stored
 * data; this locks in the systemic fix so it can never happen to anyone
 * else: in Simple mode, the media width/height inputs are hidden
 * (expertOnly) and CLICK 360 computes the physical page size automatically
 * (the existing r33 SANITY_FACTOR fallback in universalMediaSize()) --
 * Normal-mode users are never asked to type a value like "800".
 *
 * Also locks in that DPI and content orientation -- both explicitly called
 * for as Normal-mode fields -- are visible outside the expertOnly gate, and
 * that the wizard's physical-impossibility validation actually disables
 * print/PDF, not just shows a warning.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

// ── Simple/Expert mode toggle exists and both directions of visibility are wired ──
assert(app.includes('data-label-mode="simple"') && app.includes('data-label-mode="expert"'), 'the label editor must offer a Simple/Expert mode toggle');
assert(css.includes('.labelEditorModal[data-label-mode="simple"] .expertOnly{display:none!important}'), 'expertOnly fields must be hidden in Simple mode');
assert(css.includes('.labelEditorModal[data-label-mode="expert"] .simpleOnly{display:none!important}'), 'simpleOnly fields/hints must be hidden in Expert mode');

// ── The exact field that caused SHARY's incident must be expert-only ──
const mediaWidthField = app.match(/<div class="field expertOnly"><label>Ancho total del rollo\/hoja \(mm\)<\/label><input id="labelMediaWidth"[^>]*>/);
assert(mediaWidthField, 'labelMediaWidth (total roll/sheet width) must be wrapped in an expertOnly field -- a Normal-mode user must never be asked to type this raw value');
const mediaHeightField = app.match(/<div class="field expertOnly"><label>Alto total de hoja\/tramo \(mm\)<\/label><input id="labelMediaHeight"[^>]*>/);
assert(mediaHeightField, 'labelMediaHeight (total roll/sheet height) must be wrapped in an expertOnly field for the same reason');
assert(app.includes('El tamaño total del rollo u hoja se calcula automaticamente'), 'Simple mode must explain that the total media size is computed automatically, not left unexplained');

// ── DPI and orientation are explicit Normal-mode fields per the release spec -- must NOT be expertOnly ──
const dpiFieldIdx = app.indexOf('id="labelDpi"');
assert(dpiFieldIdx !== -1, 'labelDpi must exist');
const dpiFieldStart = app.lastIndexOf('<div class="field', dpiFieldIdx);
assert(!app.slice(dpiFieldStart, dpiFieldIdx).includes('expertOnly'), 'DPI must be visible in Simple mode (it is an explicit Normal-mode field in the release spec)');
const rotationFieldIdx = app.indexOf('id="labelContentRotation"');
assert(rotationFieldIdx !== -1, 'labelContentRotation must exist');
const rotationFieldStart = app.lastIndexOf('<div class="field', rotationFieldIdx);
assert(!app.slice(rotationFieldStart, rotationFieldIdx).includes('expertOnly'), 'orientation (content rotation) must be visible in Simple mode');

// ── Physical-impossibility validation actually blocks output, not just warns ──
assert(app.includes("const blocking = !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;"), 'the wizard must compute a real blocking flag from paper/quantity/sheet-plan validity');
assert(app.includes("$('#printOne').disabled = copies < 1 || !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;"), 'Print must be disabled when the geometry is physically invalid');
assert(app.includes("$('#savePdfBtn').disabled = copies < 1 || !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;"), 'Save PDF must be disabled when the geometry is physically invalid');

console.log('PASS Print Engine Normal mode: raw media-size inputs are expert-only, DPI/orientation are Normal-mode fields, physically impossible geometry blocks output');
