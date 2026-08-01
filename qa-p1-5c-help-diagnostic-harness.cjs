const { assert, loadSmartPrintCore, paper } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const topics = [
  { id: 'measure', title: 'Como medir un sticker', keywords: 'medir sticker milimetros regla', aliases: ['medir sticker'], stepsFor: [3] },
  { id: 'columns', title: 'Una columna funciona y otra no', keywords: 'dos columnas izquierda derecha', aliases: ['dos columnas'], stepsFor: [2, 7] },
  { id: 'rotated', title: 'La impresion sale girada', keywords: 'rotacion orientacion 90 grados', aliases: ['sale girada'], stepsFor: [9] },
  { id: 'diagnostic', title: 'Compartir diagnostico', keywords: 'soporte copiar json', aliases: ['compartir diagnostico'], stepsFor: [8, 9] }
];
assert.equal(core.searchHelp(topics, 'medir sticker', 3)[0].id, 'measure');
assert.equal(core.searchHelp(topics, 'dos columnas', 7)[0].id, 'columns');
assert.equal(core.searchHelp(topics, 'sale girada', 9)[0].id, 'rotated');
assert.equal(core.searchHelp(topics, 'compartir diagnostico', 8)[0].id, 'diagnostic');
assert.equal(core.searchHelp(topics, 'como', 1).length, 0);

const secrets = [
  'private.person@example.com',
  '3UTjgHd1QNSvqlcXNKQ6tL79X7u2',
  '+593999999999',
  'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
  'owner:secret:business:secret',
  'businesses/secret/state/main',
  'C:\\Users\\Private\\labels',
  '\\\\server\\private\\share',
  'Producto Ultra Secreto',
  'VENTA-9999'
];
const report = core.sanitizeDiagnostic({
  diagnosticId: 'PRNREP-7F2K9M4Q',
  release: '1.0.5',
  buildSha: 'abc123def456',
  assetVersion: 'commercial-1-0-5-r17',
  browser: `Safari ${secrets.join(' ')}`,
  operatingSystem: `iPhone ${secrets.join(' ')}`,
  outputMode: 'system',
  paper: { ...paper(), name: secrets.join(' '), notes: secrets.join(' ') },
  printer: { displayName: secrets.join(' '), nominalDpi: 203 },
  exactQuantity: 7,
  startSlot: 5,
  preflightStatus: 'blocked',
  paperValid: false,
  paperIncomplete: true,
  message: secrets.join(' '),
  token: secrets.join(' ')
});
const serialized = JSON.stringify(report);
for (const secret of secrets) assert.equal(serialized.includes(secret), false, `diagnostic excludes ${secret}`);
assert.ok(serialized.length < 12000);
assert.equal(report.supportCode, 'PRN-PAPER-001');
assert.equal(report.diagnosticId, 'PRNREP-7F2K9M4Q');
assert.deepEqual(Object.keys(report).sort(), ['diagnosticId', 'job', 'paper', 'preflight', 'printer', 'release', 'runtime', 'schemaVersion', 'supportCode', 'wizard'].sort());

console.log('P1.5C help and diagnostic harness PASS');
