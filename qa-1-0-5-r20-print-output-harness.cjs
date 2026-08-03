const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const printing = read('printing-service.js');
const index = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

assert.match(app, /APP_ASSET_VERSION = 'commercial-1-0-5-r20'/);
assert.match(app, /id="printOne"[\s\S]{0,120}Imprimir etiquetas/);
assert.match(app, /id="savePdfBtn"[\s\S]{0,100}Guardar PDF/);
assert.match(app, /\$\('#printOne'\)\.onclick = \(\) => runPrintJob\('system'\)/);
assert.match(app, /\$\('#savePdfBtn'\)\.onclick = \(\) => runPrintJob\('pdf'\)/);
assert.match(app, /runTemplateOutput\(button\.dataset\.printTpl, 'system'\)/);
assert.doesNotMatch(app, /browserPrintBtn/);
assert.match(app, /id="labelEditorIdentity"/);
assert.match(app, /const updateLabelEditorIdentity = \(\) =>/);

assert.match(app, /class="calculatorWorkspace"/);
assert.match(app, /aria-modal="false"/);
assert.match(app, /data-calculator-minimize/);
assert.match(printing, /dataset\.printReady = 'true'/);
assert.match(printing, /dataset\.click360Printing = 'true'/);
assert.match(printing, /pdf-render-blank/);
assert.match(printing, /singleImagePdfBlob/);

assert.match(index, /assets\/favicon\.png\?v=commercial-1-0-5-r20/);
assert.match(index, /apple-touch-icon" sizes="180x180"/);
for (const iconPath of ['assets/favicon.png', 'assets/favicon.ico', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png']) {
  assert.equal(fs.existsSync(path.join(root, iconPath)), true, `missing PWA icon: ${iconPath}`);
}
assert(manifest.icons.some((entry) => entry.sizes === '192x192' && entry.purpose === 'any'));
assert(manifest.icons.some((entry) => entry.sizes === '192x192' && entry.purpose === 'maskable'));

console.log('CLICK 360 1.0.5 r20 print actions, calculator and PWA icon contract PASS');
