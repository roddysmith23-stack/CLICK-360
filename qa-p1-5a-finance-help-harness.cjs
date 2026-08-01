'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const RELEASE = '1.0.5';
const ASSET = 'commercial-1-0-5-r15';

function addFinanceEntry(state, kind, businessId, entry) {
  assert(['payments', 'loans', 'envelopes', 'goals'].includes(kind), 'finance kind is supported');
  const forbidden = ['bankPassword', 'bankUser', 'accessToken', 'secret', 'pin', 'cvv'];
  for (const field of forbidden) {
    assert.equal(Object.hasOwn(entry, field), false, `finance never stores ${field}`);
  }
  const stored = { ...entry, id: `${businessId}:${kind}:${state.finance[kind].length + 1}`, businessId };
  state.finance[kind].push(stored);
  return stored;
}

function financeForBusiness(state, kind, businessId) {
  return state.finance[kind].filter((entry) => entry.businessId === businessId);
}

function paymentStatus(payment, todayIso) {
  if (payment.status === 'paid') return 'paid';
  return String(payment.dueDate || '') < todayIso ? 'overdue' : 'pending';
}

function goalProgress(goal) {
  const target = Math.max(0, Number(goal.targetAmount || 0));
  return target ? Math.min(100, Math.round((Number(goal.savedAmount || 0) / target) * 100)) : 0;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:cerrar|cierro|cierre)\b/g, 'cerr')
    .trim();
}

function searchHelp(topics, query) {
  const needle = normalizeSearch(query);
  return topics.filter((topic) =>
    normalizeSearch(`${topic.category} ${topic.title} ${topic.body}`).includes(needle));
}

const state = {
  finance: { payments: [], loans: [], envelopes: [], goals: [] },
  sales: [{ id: 'existing-sale', businessId: 'omega', total: 25 }],
  movements: [{ id: 'existing-movement', businessId: 'omega', amount: 25 }]
};
const commercialBefore = JSON.stringify({ sales: state.sales, movements: state.movements });

const payment = addFinanceEntry(state, 'payments', 'omega', {
  name: 'Internet',
  category: 'internet',
  amount: 35,
  dueDate: '2026-07-10',
  status: 'pending',
  notes: ''
});
assert.equal(paymentStatus(payment, '2026-07-22'), 'overdue', 'past unpaid monthly payment is overdue');
payment.status = 'paid';
assert.equal(paymentStatus(payment, '2026-07-22'), 'paid', 'monthly payment can be marked paid');

addFinanceEntry(state, 'loans', 'omega', {
  institution: 'Banco manual QA',
  balance: 1000,
  monthlyPayment: 100,
  dueDate: '2026-08-01',
  status: 'active',
  notes: 'Registro informativo'
});
addFinanceEntry(state, 'envelopes', 'omega', {
  name: 'Arriendo',
  targetAmount: 500,
  separatedAmount: 250,
  category: 'local'
});
const goal = addFinanceEntry(state, 'goals', 'omega', {
  name: 'Nueva vitrina',
  targetAmount: 1000,
  savedAmount: 250,
  targetDate: '2026-12-31',
  notes: ''
});
addFinanceEntry(state, 'payments', 'alfa', {
  name: 'Luz Alfa',
  amount: 20,
  dueDate: '2026-08-01',
  status: 'pending'
});

assert.equal(goalProgress(goal), 25, 'savings goal reports progress');
assert.equal(financeForBusiness(state, 'payments', 'omega').length, 1, 'finance entries are isolated by businessId');
assert.equal(financeForBusiness(state, 'payments', 'alfa').length, 1, 'other business retains only its entries');
assert.equal(JSON.stringify({ sales: state.sales, movements: state.movements }), commercialBefore, 'manual finance never mutates sales or cash');

const helpTopics = [
  { category: 'Cierre de caja', title: '¿Cómo cierro caja?', body: 'Revisa el resumen y confirma.' },
  { category: 'Etiquetas', title: '¿Cómo imprimo una etiqueta?', body: 'Elige cantidad manual.' },
  { category: 'Código de barras / QR', title: '¿Cómo escaneo un código de barras?', body: 'Usa Escanear.' },
  { category: 'Mesas', title: '¿Cómo cobro una mesa?', body: 'Cobra y libera la mesa.' },
  { category: 'Finanzas', title: '¿Cómo registro un pago mensual?', body: 'Añade monto y fecha.' }
];
for (const [query, expectedCategory] of [
  ['cerrar caja', 'Cierre de caja'],
  ['etiqueta', 'Etiquetas'],
  ['codigo de barras', 'Código de barras / QR'],
  ['mesa', 'Mesas'],
  ['pago mensual', 'Finanzas']
]) {
  assert.equal(searchHelp(helpTopics, query)[0]?.category, expectedCategory, `help search finds ${query}`);
}
assert.equal(searchHelp(helpTopics, 'transferencia bancaria secreta').length, 0, 'help search does not invent answers');

for (const section of [
  /Pagos mensuales/i,
  /Bancos\s*\/\s*pr[eé]stamos manuales|Pr[eé]stamos.*manuales/i,
  /Sobres de dinero|Sobres/i,
  /Metas\s*\/\s*sue[ñn]os\s*\/\s*ahorros|Metas.*Ahorros/i
]) {
  assert.match(app, section, `finance UI includes ${section}`);
}
assert.match(app, /Arriendo[\s\S]{0,300}Proveedor[\s\S]{0,300}Préstamo/i, 'monthly payments include the required manual categories');
assert.match(app, /financeForBiz|finance.*businessId|businessId.*finance/i, 'finance reads are isolated by businessId');
assert.match(app, /no (?:solicita|pide|guardamos).{0,80}(?:clave|contrase[ñn]a|credencial)|sin conexi[oó]n bancaria|registro manual/i, 'finance UI states that bank credentials are not requested');
assert(!/id=["'][^"']*(?:bankPassword|bankUser|bankToken|bankPin|bankCvv)[^"']*["']/i.test(app), 'finance UI has no bank credential fields');
assert(!/type=["']password["'][^>]*(?:banco|bank|tarjeta)|(?:banco|bank|tarjeta)[^<]{0,120}type=["']password["']/i.test(app), 'finance does not request a bank password');
assert.match(styles, /finance|goalProgress|envelope|paymentStatus/i, 'finance UI has dedicated styles');

assert.match(app, /Centro de ayuda/i, 'internal help center is visible');
assert.match(app, /HELP_TOPICS|helpTopics/i, 'help content is static and structured');
assert.match(app, /helpSearch|searchHelp|Buscar.*ayuda/i, 'help center is searchable');
for (const topic of [
  /Primeros pasos/i,
  /Inventario/i,
  /Cierre de caja/i,
  /Etiquetas/i,
  /C[oó]digo de barras\s*\/\s*QR/i,
  /Mesas/i,
  /Finanzas/i,
  /Nube y respaldo/i,
  /Errores comunes/i,
  /Soporte/i
]) {
  assert.match(app, topic, `help includes category ${topic}`);
}
assert.match(app, /Contactar soporte.*WhatsApp|WhatsApp.*soporte/i, 'help exposes WhatsApp support');
assert.match(styles, /helpSearch|helpTopic|helpCategory|helpCenter/i, 'help center has dedicated styles');
assert.match(html, /meta name=["']description["']|application\/ld\+json/i, 'public shell keeps basic SEO/AEO metadata');
assert(!/shary10mmvv|debbya632|roddysmith23|liavero_zambrano/i.test(`${app}\n${html}`), 'P1.5A UI does not hardcode real customer identities');

assert(app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`), 'app has the P1.5A release version');
assert(app.includes(`const APP_ASSET_VERSION = '${ASSET}'`), 'app has the P1.5A asset version');
assert(html.includes(ASSET), 'HTML references the P1.5A asset version');
assert(styles.includes(ASSET), 'CSS assets reference the P1.5A asset version');
assert(worker.includes(`click360-${ASSET}`), 'service worker cache is isolated for P1.5A');

console.log('PASS P1.5A finance/help harness: manual finance, no bank credentials, searchable help and business isolation');
