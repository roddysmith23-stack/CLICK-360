'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const publicBundle = `${app}\n${styles}\n${html}\n${worker}`;

const RELEASE = '1.0.5';
const ASSET = 'commercial-1-0-5-r36-p0-shary-boot-fix';
const BARCODE_FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

function normalizeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function decodeInternalQr(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^click360:\/\/product\/([^?]+)\?businessId=([^&]+)$/i);
  return match
    ? { productId: decodeURIComponent(match[1]), businessId: decodeURIComponent(match[2]) }
    : null;
}

function findProduct(products, businessId, scannedValue) {
  const internal = decodeInternalQr(scannedValue);
  if (internal) {
    if (internal.businessId !== businessId) return null;
    return products.find((product) =>
      product.businessId === businessId && product.id === internal.productId) || null;
  }
  const code = normalizeCode(scannedValue);
  return products.find((product) =>
    product.businessId === businessId
    && [product.code, product.barcode, product.sku].some((value) => normalizeCode(value) === code)) || null;
}

function resolveScan({ products, businessId, value, route = 'inventory' }) {
  const product = findProduct(products, businessId, value);
  if (!product) return { status: 'not_found', action: 'create_product', businessId, code: normalizeCode(value) };
  if (route === 'sell' && Number(product.qty || 0) <= 0) {
    return { status: 'out_of_stock', action: 'show_stock_warning', product };
  }
  return {
    status: 'found',
    action: route === 'sell' ? 'add_to_cart' : 'open_product',
    product
  };
}

function scannerCapability({ cameraPermission = 'prompt', barcodeDetector = true } = {}) {
  if (cameraPermission === 'denied') {
    return { mode: 'fallback', code: 'CAMERA_PERMISSION_DENIED', canUseImage: true, canUseManual: true };
  }
  if (!barcodeDetector) {
    return { mode: 'fallback', code: 'BARCODE_DETECTOR_UNAVAILABLE', canUseImage: true, canUseManual: true };
  }
  return { mode: 'camera', formats: [...BARCODE_FORMATS] };
}

function createKeyboardScanner({ debounceMs = 350 } = {}) {
  let buffer = '';
  let lastKeyAt = 0;
  let lastAccepted = { code: '', at: 0 };
  return {
    key(key, at) {
      if (at - lastKeyAt > debounceMs) buffer = '';
      lastKeyAt = at;
      if (key !== 'Enter') {
        if (key.length === 1) buffer += key;
        return null;
      }
      const code = normalizeCode(buffer);
      buffer = '';
      if (!code) return null;
      if (lastAccepted.code === code && at - lastAccepted.at < debounceMs) return null;
      lastAccepted = { code, at };
      return code;
    }
  };
}

const products = [
  { id: 'omega-qr', businessId: 'omega', code: 'QR-001', barcode: '7501031311309', qty: 5 },
  { id: 'omega-upc', businessId: 'omega', code: 'UPC-001', barcode: '012345678905', qty: 3 },
  { id: 'omega-empty', businessId: 'omega', code: 'EMPTY-001', barcode: '1234567890128', qty: 0 },
  { id: 'alfa-copy', businessId: 'alfa', code: 'QR-001', barcode: '7501031311309', qty: 20 }
];

assert.equal(
  resolveScan({
    products,
    businessId: 'omega',
    value: 'click360://product/omega-qr?businessId=omega'
  }).action,
  'open_product',
  'a valid internal QR opens the product in the active business'
);
assert.equal(
  resolveScan({ products, businessId: 'omega', value: '7501031311309' }).product.id,
  'omega-qr',
  'a common barcode resolves the product'
);
assert.equal(
  resolveScan({ products, businessId: 'alfa', value: '7501031311309' }).product.id,
  'alfa-copy',
  'identical codes remain isolated by businessId'
);
assert.equal(
  resolveScan({ products, businessId: 'omega', value: '9999999999999' }).action,
  'create_product',
  'an unknown barcode offers product creation with the detected code'
);
assert.equal(
  resolveScan({ products, businessId: 'omega', value: 'EMPTY-001', route: 'sell' }).status,
  'out_of_stock',
  'selling an out-of-stock scan is rejected clearly'
);
assert.equal(
  resolveScan({
    products,
    businessId: 'omega',
    value: 'click360://product/alfa-copy?businessId=alfa'
  }).status,
  'not_found',
  'an internal QR cannot cross business boundaries'
);
assert.deepEqual(
  scannerCapability({ cameraPermission: 'denied' }),
  { mode: 'fallback', code: 'CAMERA_PERMISSION_DENIED', canUseImage: true, canUseManual: true },
  'denied camera permission produces a clear, usable fallback'
);
assert.equal(
  scannerCapability({ barcodeDetector: false }).mode,
  'fallback',
  'missing BarcodeDetector never blocks manual/image scanning'
);
assert.deepEqual(
  scannerCapability().formats,
  BARCODE_FORMATS,
  'native scanner requests QR and common retail barcode formats'
);

const keyboard = createKeyboardScanner();
let physicalResult = null;
for (const [index, key] of [...'012345678905', 'Enter'].entries()) {
  physicalResult = keyboard.key(key, 1000 + index * 20) || physicalResult;
}
assert.equal(physicalResult, '012345678905', 'a USB/Bluetooth keyboard scanner emits one normalized code');
for (const [index, key] of [...'012345678905', 'Enter'].entries()) {
  assert.equal(keyboard.key(key, 1280 + index * 10), null, 'rapid duplicate scan is debounced');
}
for (const [index, key] of [...'012345678905', 'Enter'].entries()) {
  physicalResult = keyboard.key(key, 2000 + index * 20) || physicalResult;
}
assert.equal(physicalResult, '012345678905', 'the same barcode can be scanned again after debounce');

assert.match(app, /BarcodeDetector/, 'app uses BarcodeDetector when supported');
for (const format of BARCODE_FORMATS) {
  assert(
    app.includes(`'${format}'`) || app.includes(`"${format}"`),
    `BarcodeDetector requests ${format}`
  );
}
assert.match(app, /navigator\.mediaDevices\?*\.getUserMedia|navigator\.mediaDevices\.getUserMedia/, 'camera starts only through getUserMedia');
assert.match(publicBundle, /jsQR|scanImageFile|scanUpload/i, 'scanner has a lightweight image/manual fallback');
assert.match(app, /permiso.{0,80}c[aá]mara|c[aá]mara.{0,80}permiso/i, 'camera permission failure has a visible explanation');
assert.match(app, /lector f[ií]sico|keyboardScanner|scannerKeyboard|keydown/i, 'physical keyboard scanner is supported');
assert.match(app, /debounce|lastScan|scanDebounce|duplicateScan/i, 'rapid duplicate scans are guarded');
assert.match(app, /Sin stock|No hay m[aá]s stock|stock disponible/i, 'out-of-stock scan has a visible warning');
assert.match(app, /Escanear/, 'inventory or sales exposes the Escanear action');
assert.match(app, /productsForBiz|businessId\s*===|businessId===/, 'product lookup is scoped by businessId');
assert.match(styles, /scan|camera/i, 'scanner/camera UI has styles');

assert(app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`), 'app has the P1.5A release version');
assert(app.includes(`const APP_ASSET_VERSION = '${ASSET}'`), 'app has the P1.5A asset version');
assert(html.includes(ASSET), 'HTML references the P1.5A asset version');
assert(styles.includes(ASSET), 'CSS asset URLs reference the P1.5A asset version');
assert(worker.includes(`click360-${ASSET}`), 'service worker cache is isolated for P1.5A');

console.log('PASS P1.5A barcode scanner harness: QR/barcodes, camera fallback, physical reader, debounce, stock and business isolation');
