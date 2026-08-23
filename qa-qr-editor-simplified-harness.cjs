/**
 * r36: QR editor -- Normal-mode contract (Section 6 of the release brief).
 *
 * The canvas drag/resize/select/align system already existed and is not
 * gated by expertOnly (verified: pointerdown/pointermove/keydown listeners
 * are attached unconditionally in JS, and #labelCanvasAlign/Rotate/
 * Duplicate live outside any expertOnly wrapper) -- so Normal-mode users
 * could already select, drag, resize and align the QR directly on the
 * canvas. What was missing, and what this locks in:
 *  - QR resize is hard-locked to a 1:1 aspect ratio (never deformable into
 *    a rectangle), with a real minimum printable size.
 *  - Every dragged/resized element is clamped back inside the sticker
 *    bounds, never allowed to hang off the edge.
 *  - A visible "which element is selected" indicator exists outside the
 *    expertOnly element dropdown, so a Normal-mode user has explicit
 *    confirmation they are editing the QR, not a silent/invisible default.
 *  - X/Y/width/height/QR margin numeric fields stay Advanced-only.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

// ── 1:1 aspect ratio lock + minimum size on QR resize ──
assert(app.includes("if (dragState.key === 'qr') element.width = element.height = Math.max(element.width, element.height);"),
  'resizing the QR on the canvas must force width === height (no deformation into a rectangle)');
assert(app.includes("Math.max(dragState.key === 'qr' ? 90 : 20, Math.round((dragState.width + dx) / snap) * snap)"),
  'QR must have a real minimum printable size during drag-resize, distinct from other elements');
assert(app.includes("element.height = Math.max(key === 'qr' ? 90 : 8, Number($('#labelElementHeight').value || element.height || element.width));"),
  'the Advanced numeric-field path must enforce the same QR minimum size as the canvas drag path');

// ── Bounds clamping keeps every element inside the sticker ──
assert(/if \(bounds\.left < 0\) element\.x -= bounds\.left;[\s\S]{0,200}if \(bounds\.right > baseWidth\) element\.x -= bounds\.right - baseWidth;/.test(app),
  'dragging/resizing any element must clamp it back inside the sticker bounds');

// ── Simple mode: a visible selected-element indicator exists outside the expertOnly dropdown ──
const indicatorIdx = app.indexOf('id="labelSelectedElementIndicator"');
assert(indicatorIdx !== -1, 'a selected-element indicator must exist for Normal-mode users');
const indicatorLine = app.slice(app.lastIndexOf('<p', indicatorIdx), app.indexOf('>', indicatorIdx) + 1);
assert(!indicatorLine.includes('expertOnly'), 'the selected-element indicator must be visible in Simple mode, not hidden behind expertOnly');
assert(app.includes('indicator.textContent = `Elemento seleccionado: ${elementSelect.options[elementSelect.selectedIndex]?.textContent || key}`;'),
  'the indicator must update live as the canvas selection changes');

// ── Advanced-only numeric geometry fields stay gated ──
const elementPanelIdx = app.indexOf('class="labelElementPanel expertOnly"');
assert(elementPanelIdx !== -1, 'the full 14-element dropdown/quick-controls panel must stay expertOnly (Normal mode selects via the canvas, not a technical list)');
const advancedBodyIdx = app.indexOf('class="settingsDisclosure labelAdvanced expertOnly"');
assert(advancedBodyIdx !== -1, 'the numeric X/Y/width/height/QR-margin fields must stay inside an expertOnly details block');
const advancedBodyEnd = app.indexOf('</details>', advancedBodyIdx);
const advancedBody = app.slice(advancedBodyIdx, advancedBodyEnd);
['id="labelElementX"', 'id="labelElementY"', 'id="labelElementWidth"', 'id="labelElementHeight"', 'id="labelQrMargin"']
  .forEach((field) => assert(advancedBody.includes(field), `${field} must live inside the Advanced-only geometry block`));

console.log('PASS QR editor: 1:1 lock + minimum size + bounds clamping on drag-resize, visible Normal-mode selection indicator, X/Y/width/height/margin stay Advanced-only');
