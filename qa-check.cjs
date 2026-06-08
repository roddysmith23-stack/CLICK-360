
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
