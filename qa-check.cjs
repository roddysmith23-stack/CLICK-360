
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

function assert(name, condition) {
  if (!condition) {
    console.error('FAIL', name);
    process.exitCode = 1;
  } else {
    console.log('PASS', name);
  }
}

assert('sin CDN QR externo', !html.includes('cdn.jsdelivr'));
assert('generador QR local', app.includes('const QR = (() =>'));
assert('scanner cámara/foto/manual', app.includes('startScanner') && app.includes('scanImageFile') && app.includes('Código manual'));
assert('lector local CLICK 360', app.includes('decodeLocalC360QR'));
assert('QR simple por código', app.includes('return String(product.code'));
assert('normaliza URL scan', app.includes("searchParams.get('scan')") || app.includes('searchParams.get("scan")'));
assert('imagen opcional producto', app.includes('pImage') && app.includes('imageData'));
assert('miniaturas producto', css.includes('productImg'));
assert('descargar PNG etiqueta', app.includes('downloadLabelPng'));
assert('imprimir por stock', app.includes('printStock'));
assert('roles trabajador', app.includes('cajero123') && app.includes('inventario123'));
assert('PWA manifest', fs.existsSync(path.join(__dirname, 'manifest.webmanifest')));
assert('service worker', fs.existsSync(path.join(__dirname, 'service-worker.js')));

console.log('\\nCLICK 360 MVP FINAL v2 FULL POWER QA checks finished.');

assert('logo no triangle CSS', fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8').includes('CLICK 360 v3 logo fix'));


const jsqrSize = fs.statSync(path.join(__dirname, 'vendor', 'jsQR.js')).size;
const qrgSize = fs.statSync(path.join(__dirname, 'vendor', 'qrcode-generator.js')).size;
assert('jsQR real local incluido', jsqrSize > 200000);
assert('qrcode-generator real local incluido', qrgSize > 50000);
assert('HTML carga qrcode-generator antes de app', html.includes('vendor/qrcode-generator.js') && html.indexOf('vendor/qrcode-generator.js') < html.indexOf('app.js'));
assert('HTML carga jsQR antes de app', html.includes('vendor/jsQR.js') && html.indexOf('vendor/jsQR.js') < html.indexOf('app.js'));
assert('cache v6 persistence', fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').includes('click360-mvp-final-v6-persistence'));
