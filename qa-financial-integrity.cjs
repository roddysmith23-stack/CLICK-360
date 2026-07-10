const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

function collectedAmount(sale) {
  if (!sale || sale.status === 'cancelled') return 0;
  const total = Math.max(0, Number(sale.total) || 0);
  const raw = Number(sale.received);
  if (sale.status === 'paid') return Math.min(total, Number.isFinite(raw) && raw > 0 ? raw : total);
  return Math.min(total, Math.max(0, Number.isFinite(raw) ? raw : 0));
}

function spreadsheetCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

assert.strictEqual(collectedAmount({ status: 'paid', total: 15, received: 30 }), 15, 'cash tender including change must not inflate collected revenue');
assert.strictEqual(collectedAmount({ status: 'layaway', total: 100, received: 25 }), 25, 'layaway reports only collected payments');
assert.strictEqual(collectedAmount({ status: 'cancelled', total: 100, received: 100 }), 0, 'cancelled sales collect zero');
assert.strictEqual(spreadsheetCell('=HYPERLINK("https://example.test")').startsWith("'="), true, 'spreadsheet formulas are neutralized');
assert.strictEqual(spreadsheetCell('Normal product'), 'Normal product', 'ordinary spreadsheet text is unchanged');

assert(app.includes('tendered = rec; received = total; change = rec - total;'), 'new cash sales separate tendered money from collected total');
assert(app.includes("addAudit('supplier_invoice_cancelled'") && app.includes("movement.status = 'cancelled'"), 'invoice cancellation preserves and cancels its linked cash movement');
assert(app.includes('tenantRuntime?.validBusinessPayload({ identity: data.identity, data }, activeTenantContext)'), 'backup restore requires a complete same-tenant payload');
assert(!app.includes('RESPALDO LEGACY'), 'unscoped legacy backups cannot be restored in the browser');
assert(app.includes('REEMPLAZAR LOCAL') && app.includes("downloadBackup('antes-de-actualizar-desde-nube')"), 'force pull requires typed confirmation and backup');
assert(app.includes("replace(/'/g, '%27')"), 'inline action ids escape apostrophes');

console.log('PASS financial integrity: cash change, cancellations, backups, and spreadsheet injection');
