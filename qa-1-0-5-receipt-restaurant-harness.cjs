'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const printing = fs.readFileSync('printing-service.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

assert.match(app, /const RECEIPT_BLOCKS/, 'receipt editor defines its editable flow blocks');
assert.match(app, /function normalizeReceiptBlocks/, 'legacy receipt templates are normalized safely');
assert.match(app, /data-receipt-block-up/, 'receipt blocks can be moved upward');
assert.match(app, /data-receipt-block-down/, 'receipt blocks can be moved downward');
assert.match(app, /receiptCanvasDesigner/, 'receipt editor opens as a canvas-style simple/expert designer');
assert.match(app, /receiptSelectedBlockPanel/, 'receipt editor exposes a selected block panel');
assert.doesNotMatch(app, /saveReceiptTemplatePreferences\(draft\);\s*closeModal\(\);\s*openReceiptTemplateDesigner\(\)/, 'switching receipt mode must not autosave and reopen the modal');
assert.match(app, /data-receipt-block="locked-footer"/, 'CLICK 360 receipt footer remains locked');
assert.match(app, /function chargeTableOrder\(table, order\)/, 'table checkout has a dedicated entry point');
assert.match(app, /id="tableCheckoutMethod"/, 'restaurant checkout exposes a real payment selector');
assert.doesNotMatch(app, /prompt\('Método de pago/, 'restaurant checkout no longer depends on a browser prompt');
assert.match(app, /customerCedula:checkout\.customerCedula/, 'table checkout keeps invoice identity fields');
assert.match(app, /window\.showSaleCompleteModal/, 'table checkout opens the normal receipt flow');
assert.match(app, /Detalle de venta asociado/, 'movement editor exposes linked sale detail without mutating it');
assert.match(styles, /movementSaleSummary/, 'linked sale detail remains contained on mobile and desktop');
assert.match(app, /kitchenItemImage/, 'kitchen tickets render the product image when it exists');
assert.match(app, /Receta para cocina/, 'recipes are editable from the inventory product form');
assert.match(printing, /print-plan-no-layout/, 'PDF export rejects a blank layout');
assert.match(printing, /position:fixed;left:0;top:0/, 'PDF export uses a visible renderable portal for WebKit/iOS');
assert.match(printing, /image: \{ type: 'png', quality: 1 \}/, 'receipt PDF keeps crisp text and avoids lossy JPEG capture');
assert.match(printing, /physicalHeight/, 'receipt PDF height is derived from content');
assert.match(styles, /receiptDesignerShell/, 'receipt modal has a dedicated responsive shell');
assert.match(styles, /receiptBlockRail/, 'receipt block controls have responsive styles');
assert.match(html, /assets\/logo\.png\?v=commercial-1-0-5-r14/, 'startup uses the HD CLICK 360 logo');
assert.match(styles, /tableCheckoutSummary/, 'restaurant checkout total has a contained layout');
assert.match(html, /minimumIntroMs = 5000/, 'splash stays visible for the promised five seconds');

console.log('PASS 1.0.5 receipt/restaurant harness: block editor, PDF layout, checkout, recipe and five-second intro contracts');
