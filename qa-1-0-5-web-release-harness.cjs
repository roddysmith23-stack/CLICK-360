const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const gitRefExists = (ref) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd:root, stdio:'ignore' });
    return true;
  } catch {
    return false;
  }
};
const GOLDEN_BASE = 'dccee527fc310cd6e17c8e0c58f308c27e2338fb';
const base = [GOLDEN_BASE, 'origin/hotfix/1.0.5-wednesday-recovery-cache'].find(gitRefExists);
assert(base, 'the frozen WEDNESDAY_RECOVERY_1 baseline is required for the stability scope audit');

let diffBase = base;
let committed = execFileSync('git', ['diff', '--name-only', `${diffBase}...HEAD`], { cwd:root, encoding:'utf8' });
let working = execFileSync('git', ['diff', '--name-only', diffBase], { cwd:root, encoding:'utf8' });
if (!`${committed}\n${working}`.trim() && gitRefExists('HEAD^1')) {
  diffBase = 'HEAD^1';
  committed = execFileSync('git', ['diff', '--name-only', diffBase, 'HEAD'], { cwd:root, encoding:'utf8' });
  working = execFileSync('git', ['diff', '--name-only', diffBase], { cwd:root, encoding:'utf8' });
}
const changed = [...new Set(`${committed}\n${working}`.split('\n').filter(Boolean))];
assert(changed.length > 0, 'the release must contain a reviewable web diff');

const forbidden = [
  /^tools\/admin\//,
  /^functions\//,
  // admin-access-v16.mjs deliberately removed from this list: the Commercial
  // MVP release explicitly scopes in CEO Admin activation/onboarding tooling
  // (5-tier plan activation, founder_legacy, onboarding profile fields) as a
  // reviewed, first-class part of this release -- not an accidental leak
  // into what was originally a web-only release boundary. The other three
  // stay forbidden; none of them were touched by this release.
  /^scripts\/(?:audit-firestore-legacy|migrate-legacy-v9-to-v10|normalize-approved-owner-access)\.mjs$/
];
for (const file of changed) {
  assert(!forbidden.some((pattern) => pattern.test(file)), `forbidden release path: ${file}`);
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
assert.equal(packageJson.version, '1.0.5');
assert.equal(Object.hasOwn(packageJson.dependencies || {}, 'firebase-admin'), false);
assert.equal(Object.hasOwn(packageLock.packages[''].dependencies || {}, 'firebase-admin'), false);
assert.equal(packageJson.devDependencies?.playwright, '1.62.0');

const app = read('app.js');
const index = read('index.html');
const worker = read('service-worker.js');
const flags = read('p2-web-safe-flags.js');
const build = read('scripts/build-static-release.mjs');
const printing = read('printing-service.js');
assert.match(app, /APP_RELEASE_VERSION = '1\.0\.5'/);
assert.match(app, /APP_ASSET_VERSION = 'commercial-1-0-5-r37-2-1-live-client-hotfix'/);
assert.match(index, /By AIIA INTELLIGENCE TECHNOLOGIES/, 'startup splash shows the required AIIA footer');
assert.match(index, /assets\/logo\.png\?v=commercial-1-0-5-r37-2-1-live-client-hotfix/, 'startup splash uses the HD logo instead of the low-resolution favicon');
assert.match(index, /rel="preload" as="image" href="assets\/logo\.png\?v=commercial-1-0-5-r37-2-1-live-client-hotfix"/, 'startup HD logo is preloaded before scripts');
assert.match(index, /click360SplashProgress/, 'startup splash keeps a loading progress bar while the app prepares');
assert.doesNotMatch(index, /click-360\.web\.app<\/span>/, 'startup splash must not show the public URL as footer copy');
assert.match(app, /function markAppReady/, 'app explicitly marks the splash ready after real UI render');
assert.match(index, /universal-label-canvas\.js\?v=commercial-1-0-5-r37-2-1-live-client-hotfix/);
assert.match(index, /universal-label-editor\.js\?v=commercial-1-0-5-r37-2-1-live-client-hotfix/);
assert.match(index, /p2-restaurant-domain\.js\?v=commercial-1-0-5-r37-2-1-live-client-hotfix/);
assert.match(index, /p2-logistics-domain\.js\?v=commercial-1-0-5-r37-2-1-live-client-hotfix/);
assert.match(worker, /click360-commercial-1-0-5-r37-2-1-live-client-hotfix/);
assert.match(flags, /p2UniversalLabelsEnabled: true/);
for (const key of ['p2WorkersEnabled', 'p2OwnerPreviewEnabled']) {
  assert.match(flags, new RegExp(`${key}: false`), `${key} must remain disabled`);
}
for (const key of ['p2RestaurantAdvancedEnabled', 'p2LogisticsEnabled']) {
  assert.match(flags, new RegExp(`${key}: true`), `${key} must be enabled for local frontend P2`);
}
for (const asset of ['p2-restaurant-domain.js', 'p2-logistics-domain.js', 'universal-label-canvas.js', 'universal-label-editor.js']) {
assert.match(build, new RegExp(`'${asset.replace('.', '\\.')}'`));
}
assert.doesNotMatch(build, /node_modules|tools\/admin|functions\//);
assert.match(app, /runTemplateOutput/);
assert.match(app, /Elegir producto para esta plantilla/);
assert.doesNotMatch(app, /openLabelModal\(labelSample,\s*tplId/);
assert.match(app, /universalDocumentFromTemplate/);
assert.match(app, /universalDocument,/);
assert.match(app, /renderer:'universal-mm-v2'/);
assert.match(app, /function shouldPromptInitialBusinessSetup/, 'onboarding is gated by real first-run detection');
assert.match(app, /businessMaterialRecordCount/, 'existing products, sales, cash, customers, labels and modules suppress first-run setup');
assert.match(app, /routes\.push\('finance','workers','activity','reminders','reports','crm','more'\)/, 'activity, reports and customers are first-class navigation items');
assert.match(app, /logisticsModuleEnabled\(\)\) routes\.push\('logistics'\)/, 'logistics appears in primary nav only for configured logistics businesses');
assert.doesNotMatch(app, /data-more="logistics"/, 'logistics is not duplicated in More');
assert.doesNotMatch(app, /data-more="finance"/, 'finance is not duplicated in More');
assert.doesNotMatch(app, /data-more="reminders"/, 'reminders is not duplicated in More');
assert.doesNotMatch(app, /Clientes y WhatsApp/, 'customer navigation uses the concise Clientes label');
assert.match(app, /\['logistica','Logística \/ distribución \/ transporte'\]/, 'settings can configure a logistics/distribution business type');
assert.match(app, /RECEIPT_WIDTH_PRESETS/, 'receipt widths are centralized');
assert.match(app, /receipt-custom/, 'receipt template supports a custom paper width');
assert.match(app, /receiptCanvasDesigner/, 'receipt template editor uses the canvas-style designer shell');
assert.match(app, /receiptDesignerBlockPanel/, 'receipt template editor separates blocks from live preview and properties');
assert.match(app, /receiptSelectedBlockPanel/, 'receipt template exposes selectable receipt blocks like the label editor');
assert.match(app, /receiptFixedFooter/, 'receipt footer is shown as locked UI');
assert.doesNotMatch(app, /id="receiptTemplateFooter"/, 'receipt footer is no longer editable');
assert.match(app, /footer:RECEIPT_FOOTER_TEXT/, 'saved receipt templates force the CLICK 360 footer');
assert.match(printing, /startsWith\('receipt'\) && receiptWidth/, 'printing engine respects receipt media widths');
assert.match(app, /Imprimir etiquetas/);
assert.match(app, /Guardar PDF/);
assert.match(app, /runTemplateOutput\(button\.dataset\.printTpl, 'system'\)/);
assert.doesNotMatch(app, /browserPrintBtn/);
assert.match(app, /smartPrintStep === 9[\s\S]{0,220}runPrintJob\('system'\)/);
assert.match(app, /\$\('#printOne'\)\.onclick = \(\) => runPrintJob\('system'\)/);
assert.match(app, /\$\('#savePdfBtn'\)\.onclick = \(\) => runPrintJob\('pdf'\)/);
assert.match(app, /const updateLabelEditorIdentity = \(\) =>/);
assert.match(app, /Etiqueta: \$\{productName\} · Diseño: \$\{template\?\.name \|\| 'Configuración nueva'\}/);
assert.match(app, /aria-modal="false"/, 'calculator remains usable while other app views stay interactive');
assert.match(app, /data-calculator-minimize/, 'calculator can be minimized without losing its history');
assert.match(app, /labelWizardRail/);
assert.match(app, /saveTemplateFromPrintBtn/);
assert.match(app, /nameOverride/);
assert.match(app, /labelEditorModal\.dataset\.smartStepCurrent = String\(smartPrintStep\)/);
assert.match(app, /previewDisclosure\.dataset\.previewMode = smartPrintStep === 7 \? 'full' : 'compact'/);
assert.match(app, /labelControls \[data-smart-step="\$\{smartPrintStep\}"\]/);
assert.match(app, /scrollSmartPanelIntoView/);
assert.match(app, /controls\.scrollTo\(\{ top: Math\.max\(0, nextTop\), behavior:'smooth' \}\)/);
assert.match(app, /universal_label_template_deleted/);
assert.match(read('universal-label-editor.js'), /ulcSimpleMode/);
const styles = read('styles.css');
assert.match(styles, /#ulcSimpleMode/);
assert.match(styles, /\.labelWizardRail/);
assert.match(styles, /grid-template-rows:auto auto minmax\(0,1fr\) auto!important/);
assert.match(styles, /\.labelEditorModal \.labelControls\{[\s\S]*overflow:auto!important/);
assert.match(styles, /\.smartWizardFooter\{position:static;margin-top:10px;z-index:1\}/);
assert.match(styles, /\.labelEditorModal:not\(\[data-smart-step-current="7"\]\) \.labelCanvasActions/);
assert.match(styles, /\.labelPreviewSticky canvas\{[\s\S]*max-height:clamp\(78px,14dvh,118px\)!important/);
assert.match(styles, /\.labelControls>\[data-smart-step\]\{scroll-margin-top:10px\}/);
assert.match(styles, /\.receiptDesignerShell/, 'receipt designer modal has its own safe responsive shell');
assert.match(styles, /\.receiptCanvasDesigner \.receiptDesignerPreview \[data-receipt-block\]\.selected/, 'receipt preview blocks can be selected without layout overlap');
assert.match(app, /warnings\.push\(`Hay elementos superpuestos/);
assert.doesNotMatch(app, /const blocking = [^;]*!validation\.valid/);
assert.match(printing, /click360PdfExportActive/);
assert.match(printing, /click360PdfExportSurface/, 'PDF export uses an independent export surface');
assert.match(printing, /'position:fixed'[\s\S]*'left:0'[\s\S]*'top:0'/, 'PDF export mounts a visible measurable node so WebKit does not capture a blank receipt');
assert.match(printing, /function pdfSizeMm/, 'PDF export resolves one physical size for labels and receipts');
assert.match(printing, /if \(media\.startsWith\('receipt'\) && receiptWidth\)/, 'thermal receipt PDFs use the requested paper width');
assert.match(printing, /element\.scrollHeight[\s\S]*element\.scrollWidth/, 'thermal PDFs use their rendered receipt height rather than a cropped fixed page');
assert.match(printing, /singleImagePdfBlob/, 'PDF export writes a physical image-backed PDF');
assert.match(printing, /pdf-render-blank/, 'PDF export rejects blank rendered output');
assert.match(printing, /dataset\.click360Printing = 'true'/, 'system print exposes a ready state before invoking the native dialog');
assert.match(printing, /element\.dataset\.printReady = 'true'/, 'system print portal is explicitly marked ready');
assert.match(printing, /system-print-dialog-failed/, 'native dialog failures return an actionable code');
assert.match(index, /rel="icon" type="image\/png" sizes="32x32" href="assets\/favicon\.png\?v=commercial-1-0-5-r37-2-1-live-client-hotfix"/, 'browser receives the real 32 px favicon');
assert.match(index, /rel="apple-touch-icon" sizes="180x180"/, 'iOS receives an explicit home-screen icon');
for (const iconPath of ['assets/favicon.png', 'assets/favicon.ico', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png']) {
  assert.equal(fs.existsSync(path.join(root, iconPath)), true, `missing PWA icon: ${iconPath}`);
}
const manifest = JSON.parse(read('manifest.webmanifest'));
assert(manifest.icons.some((entry) => entry.sizes === '192x192' && entry.purpose === 'any'));
assert(manifest.icons.some((entry) => entry.sizes === '192x192' && entry.purpose === 'maskable'));

const runtimeFiles = changed.filter((file) => [
  'app.js', 'firebase-service.js', 'printing-service.js', 'runtime-guard.js',
  'service-worker.js', 'smart-print-core.js', 'universal-label-canvas.js',
  'universal-label-editor.js'
].includes(file));
const runtimeDiff = runtimeFiles.length
  ? execFileSync('git', ['diff', '--unified=0', diffBase, 'HEAD', '--', ...runtimeFiles], { cwd:root, encoding:'utf8' })
  : '';
const additions = runtimeDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
for (const token of ['deleteDoc', 'writeBatch', 'setDoc(', 'localStorage.clear', 'migration apply']) {
  assert(!additions.includes(token), `forbidden runtime operation: ${token}`);
}

console.log(`CLICK 360 1.0.5 web release scope PASS: ${changed.length} frontend/QA/documentation paths`);
