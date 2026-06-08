
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function assert(name, condition) {
  if (!condition) {
    console.error('FAIL', name);
    process.exitCode = 1;
  } else {
    console.log('PASS', name);
  }
}

assert('app contains local QR generator', app.includes('const QR = (() =>'));
assert('does not load QR CDN in HTML', !fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').includes('cdn.jsdelivr'));
assert('contains BarcodeDetector camera scanner fallback', app.includes('BarcodeDetector'));
assert('contains manual code fallback', app.includes('Código manual'));
assert('contains PNG label download', app.includes('downloadLabelPng'));
assert('contains stock printing', app.includes('printStock'));
assert('contains worker users', app.includes('cajero123') && app.includes('inventario123'));
assert('contains PWA manifest', fs.existsSync(path.join(__dirname, 'manifest.webmanifest')));
assert('contains service worker', fs.existsSync(path.join(__dirname, 'service-worker.js')));

console.log('\\nCLICK 360 QA basic checks finished.');

const appFull = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
assert('contains local custom scanner decoder', appFull.includes('decodeLocalC360QR'));
assert('contains photo QR scan fallback', appFull.includes('Leer QR desde foto'));
