/**
 * r37 (Section 33): the thermal printer offer card in "Mi plan y acceso"
 * must show a struck-through regular price and the discounted offer
 * price, sourced from ONE canonical catalog entry (never a literal number
 * duplicated in the page markup) so a future price change only touches
 * one place.
 */
const assert = require('assert');
const fs = require('fs');

const domain = fs.readFileSync('v16-domain.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

assert(/const HARDWARE_CATALOG = Object\.freeze\(\{/.test(domain), 'v16-domain.js must define a single canonical HARDWARE_CATALOG');
assert(/thermalPrinter:\s*Object\.freeze\(\{/.test(domain), 'HARDWARE_CATALOG must have a thermalPrinter entry');
assert(/regularPrice:\s*78(\.0+)?,/.test(domain), 'thermalPrinter.regularPrice must be 78.00');
assert(/offerPrice:\s*64\.99,/.test(domain), 'thermalPrinter.offerPrice must be 64.99');
assert(/HARDWARE_CATALOG,/.test(domain.slice(domain.indexOf('const api = Object.freeze'))), 'HARDWARE_CATALOG must be exported on the public domain API');

assert(
  app.includes('window.CLICK360_V16_DOMAIN?.HARDWARE_CATALOG?.thermalPrinter'),
  'app.js printerOfferCard must read price/name/description from the canonical HARDWARE_CATALOG, not a hardcoded literal'
);
assert(!/<strong>\$?\{fmt\(65\)\}<\/strong>/.test(app), 'app.js must not hardcode a stale literal $65 printer price outside the catalog');
assert(app.includes('<s>${fmt(hw.regularPrice)}</s>'), 'the printer card must render the regular price struck through when on offer');

console.log('PASS r37 hardware catalog harness: thermal printer price lives in one canonical HARDWARE_CATALOG entry ($78.00 struck through -> $64.99 offer), no hardcoded duplicate in the page markup');
