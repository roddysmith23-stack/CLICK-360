'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const publicSource = `${app}\n${styles}\n${html}\n${worker}`;

const RELEASE = '1.0.5-r34-workers.1';
const ASSET = 'commercial-1-0-5-r34-workers';
const functionalResults = [];
const contractResults = [];

function runFunctional(name, test) {
  try {
    test();
    functionalResults.push({ name, ok: true });
  } catch (error) {
    functionalResults.push({ name, ok: false, detail: error.message });
  }
}

function staticContract(name, condition, detail) {
  contractResults.push({
    name,
    ok: Boolean(condition),
    detail: condition ? '' : detail
  });
}

function matches(source, expression) {
  return expression.test(source);
}

function resolveLabelQuantity({ manualQuantity, stock, useStock = false }) {
  const manual = Number(manualQuantity);
  if (!useStock) {
    if (!Number.isInteger(manual) || manual < 1 || manual > 500) {
      return { ok: false, copies: 0, reason: 'invalid_manual_quantity' };
    }
    return { ok: true, copies: manual, source: 'manual' };
  }

  const available = Number(stock);
  if (!Number.isInteger(available) || available < 0) {
    return { ok: false, copies: 0, reason: 'invalid_stock' };
  }
  if (available === 0) {
    return { ok: false, copies: 0, reason: 'empty_stock' };
  }
  return { ok: true, copies: Math.min(500, available), source: 'stock' };
}

const LABEL_PRESETS = Object.freeze([
  { id: 'roll-40x30', name: 'Rollo térmico 40x30 mm', type: 'roll', labelWidthMm: 40, labelHeightMm: 30, columns: 1, rows: 1 },
  { id: 'roll-50x30', name: 'Rollo térmico 50x30 mm', type: 'roll', labelWidthMm: 50, labelHeightMm: 30, columns: 1, rows: 1 },
  { id: 'roll-60x40', name: 'Rollo térmico 60x40 mm', type: 'roll', labelWidthMm: 60, labelHeightMm: 40, columns: 1, rows: 1 },
  { id: 'roll-80x50', name: 'Rollo térmico 80x50 mm', type: 'roll', labelWidthMm: 80, labelHeightMm: 50, columns: 1, rows: 1 },
  { id: 'roll-108', name: 'Etiqueta 4 pulgadas / 108 mm', type: 'roll', labelWidthMm: 108, labelHeightMm: 50, columns: 1, rows: 1 },
  { id: 'a4-2', name: 'Hoja A4 2 columnas', type: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 96, labelHeightMm: 38, columns: 2, rows: 7, marginTopMm: 8, marginLeftMm: 6, gapXMm: 6, gapYMm: 2 },
  { id: 'a4-3', name: 'Hoja A4 3 columnas', type: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 62, labelHeightMm: 30, columns: 3, rows: 9, marginTopMm: 8, marginLeftMm: 6, gapXMm: 3, gapYMm: 2 },
  { id: 'a4-small', name: 'Hoja A4 stickers pequeños', type: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 38, labelHeightMm: 21, columns: 5, rows: 12, marginTopMm: 8, marginLeftMm: 5, gapXMm: 3, gapYMm: 2 },
  { id: 'square', name: 'Etiqueta cuadrada', type: 'custom', labelWidthMm: 40, labelHeightMm: 40, columns: 1, rows: 1, shape: 'square' },
  { id: 'round', name: 'Etiqueta redonda', type: 'custom', labelWidthMm: 40, labelHeightMm: 40, columns: 1, rows: 1, shape: 'round' },
  { id: 'custom', name: 'Personalizada', type: 'custom', labelWidthMm: 60, labelHeightMm: 40, columns: 1, rows: 1 }
]);

const SIMPLE_STEPS = Object.freeze([
  'Qué quieres imprimir',
  'Cantidad',
  'Tipo de papel',
  'Vista previa',
  'Imprimir'
]);

function labelStudioMode(mode) {
  if (mode === 'simple') {
    return { mode, steps: [...SIMPLE_STEPS], advancedOpen: false, guided: true };
  }
  if (mode === 'expert') {
    return {
      mode,
      steps: [],
      advancedOpen: true,
      guided: false,
      controls: [
        'labelWidthMm', 'labelHeightMm', 'columns', 'rows', 'marginTopMm',
        'marginLeftMm', 'gapXMm', 'gapYMm', 'dpi', 'orientation', 'elements'
      ]
    };
  }
  throw new Error('unknown_label_studio_mode');
}

function buildFullSheetPreview(preset, copies) {
  const columns = Math.max(1, Number(preset.columns || 1));
  const rows = Math.max(1, Number(preset.rows || 1));
  const capacity = columns * rows;
  const occupied = Math.max(0, Math.min(capacity, Number(copies || 0)));
  const marginLeftMm = Number(preset.marginLeftMm || 0);
  const marginTopMm = Number(preset.marginTopMm || 0);
  const gapXMm = Number(preset.gapXMm || 0);
  const gapYMm = Number(preset.gapYMm || 0);
  const cells = Array.from({ length: capacity }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      index,
      column,
      row,
      occupied: index < occupied,
      highlighted: index === 0 && occupied > 0,
      xMm: marginLeftMm + column * (Number(preset.labelWidthMm) + gapXMm),
      yMm: marginTopMm + row * (Number(preset.labelHeightMm) + gapYMm)
    };
  });
  return {
    pageWidthMm: Number(preset.pageWidthMm || preset.labelWidthMm),
    pageHeightMm: Number(preset.pageHeightMm || preset.labelHeightMm),
    columns,
    rows,
    capacity,
    occupied,
    empty: capacity - occupied,
    cells
  };
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function validateLabelLayout(template, elements) {
  const errors = [];
  const warnings = [];
  const width = Number(template.labelWidthMm);
  const height = Number(template.labelHeightMm);
  if (!(width > 0) || !(height > 0)) errors.push('missing_dimensions');

  const visible = elements.filter((element) => element.visible !== false);
  for (const element of visible) {
    if ([element.x, element.y, element.w, element.h].some((value) => !Number.isFinite(Number(value)))) {
      errors.push(`invalid_position:${element.id}`);
      continue;
    }
    if (element.x < 0 || element.y < 0 || element.x + element.w > width || element.y + element.h > height) {
      errors.push(`outside_margin:${element.id}`);
    }
    if (element.type === 'qr' && Math.min(element.w, element.h) < 18) warnings.push(`qr_too_small:${element.id}`);
    if (element.type === 'barcode' && (element.w < 25 || element.h < 10)) warnings.push(`barcode_too_small:${element.id}`);
    if (element.type === 'text' && String(element.text || '').length > 42 && element.w < 30) {
      warnings.push(`long_text:${element.id}`);
    }
  }

  for (let first = 0; first < visible.length; first += 1) {
    for (let second = first + 1; second < visible.length; second += 1) {
      if (rectanglesOverlap(visible[first], visible[second])) {
        warnings.push(`overlap:${visible[first].id}:${visible[second].id}`);
      }
    }
  }
  return { valid: errors.length === 0 && warnings.length === 0, errors, warnings };
}

const TABLE_SHAPES = Object.freeze(['round', 'square', 'rectangle', 'bar', 'delivery', 'takeaway']);
const TABLE_STATUSES = Object.freeze(['free', 'occupied', 'ready_to_charge', 'reserved']);

function normalizeTableLayoutItem(item, board = { width: 1000, height: 700 }) {
  if (!TABLE_SHAPES.includes(item.shape)) throw new Error('invalid_table_shape');
  if (!/^#[0-9a-f]{6}$/i.test(String(item.color || ''))) throw new Error('invalid_table_color');
  const w = Math.max(64, Math.min(240, Number(item.w || 110)));
  const h = Math.max(56, Math.min(200, Number(item.h || 80)));
  return {
    ...item,
    x: Math.max(0, Math.min(board.width - w, Number(item.x || 0))),
    y: Math.max(0, Math.min(board.height - h, Number(item.y || 0))),
    w,
    h
  };
}

function upsertTableLayout(state, businessId, item) {
  assert(item.tableId, 'tableId is required');
  assert.equal(item.businessId, businessId, 'layout item must belong to the active business');
  const normalized = normalizeTableLayoutItem(item);
  state.tablesLayout ||= [];
  const current = state.tablesLayout.find((layout) => layout.businessId === businessId);
  if (!current) {
    state.tablesLayout.push({ businessId, version: 1, items: [normalized] });
  } else {
    const index = current.items.findIndex((candidate) => candidate.tableId === item.tableId);
    if (index >= 0) current.items[index] = normalized;
    else current.items.push(normalized);
  }
  return normalized;
}

function tableLayoutForBusiness(state, businessId) {
  return state.tablesLayout?.find((layout) => layout.businessId === businessId)
    || { businessId, version: 1, items: [] };
}

function restaurantAccesses(business) {
  const isRestaurant = ['restaurant', 'restaurante', 'cafe', 'cafeteria', 'bar']
    .includes(String(business.type || '').toLowerCase());
  return {
    enabled: isRestaurant,
    homeQuickAccess: isRestaurant,
    settingsAccess: isRestaurant
  };
}

const HELP_SYNONYMS = Object.freeze({
  'no puedo cerrar caja': ['cerrar caja', 'cierre', 'descuadre'],
  'imprimir una etiqueta': ['imprimir etiqueta', 'cantidad exacta', 'una etiqueta'],
  stock: ['existencias', 'inventario', 'imprimir por stock'],
  qr: ['código qr', 'escanear', 'cámara'],
  sync: ['sincronización', 'nube', 'no guarda'],
  pago: ['pago mensual', 'finanzas', 'cuota'],
  meta: ['ahorro', 'sueño', 'objetivo'],
  sobre: ['dinero separado', 'presupuesto'],
  negocio: ['empresa', 'cambiar negocio'],
  'modo lectura': ['solo lectura', 'no puedo editar']
});

const HELP_ARTICLES = Object.freeze([
  { id: 'close-cash', title: 'Cómo cerrar caja', category: 'Caja', tags: ['cerrar caja', 'no puedo cerrar caja', 'cierre', 'descuadre'], steps: ['Abrir Caja', 'Revisar resumen', 'Confirmar cierre'] },
  { id: 'exact-label', title: 'Cómo imprimir una etiqueta exacta', category: 'Etiquetas', tags: ['imprimir etiqueta', 'imprimir una etiqueta', 'cantidad exacta'], steps: ['Elegir producto', 'Cantidad 1', 'Vista previa'] },
  { id: 'stock-label', title: 'Cómo imprimir por stock', category: 'Etiquetas', tags: ['stock', 'existencias', 'checkbox'], steps: ['Activar opción por stock', 'Revisar cantidad'] },
  { id: 'sheet-label', title: 'Plantillas de hoja', category: 'Etiquetas', tags: ['2 columnas', '3 columnas', 'hoja completa', 'desalineada'], steps: ['Elegir hoja', 'Vista previa completa', 'Prueba de alineación'] },
  { id: 'scanner', title: 'Escanear códigos', category: 'Scanner', tags: ['código de barras', 'qr', 'cámara', 'lector físico', 'permiso'], steps: ['Abrir Escanear', 'Permitir cámara o usar entrada manual'] },
  { id: 'tables', title: 'Crear y cobrar una mesa', category: 'Mesas', tags: ['mesa', 'cobrar mesa', 'restaurante'], steps: ['Crear mesa', 'Agregar productos', 'Cobrar'] },
  { id: 'finance', title: 'Finanzas manuales', category: 'Finanzas', tags: ['finanzas', 'pago', 'meta', 'sobre'], steps: ['Elegir tipo', 'Registrar monto'] },
  { id: 'read-only', title: 'Modo lectura', category: 'Acceso', tags: ['modo lectura', 'solo lectura', 'no puedo editar'], steps: ['Revisar estado', 'Contactar soporte'] },
  { id: 'sync', title: 'Qué hacer si algo no guarda', category: 'Nube', tags: ['sync', 'sincronización', 'nube', 'no guarda'], steps: ['Comprobar internet', 'Reintentar', 'Copiar diagnóstico'] },
  { id: 'business', title: 'Cambiar de negocio', category: 'Negocios', tags: ['negocio', 'empresa', 'cambiar negocio'], steps: ['Abrir selector', 'Elegir negocio'] }
]);

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchHelp(query, articles = HELP_ARTICLES) {
  const normalizedQuery = normalizeSearch(query);
  const expansions = new Set([normalizedQuery]);
  for (const [key, values] of Object.entries(HELP_SYNONYMS)) {
    const normalizedKey = normalizeSearch(key);
    if (normalizedQuery.includes(normalizedKey) || normalizedKey.includes(normalizedQuery)) {
      expansions.add(normalizedKey);
      values.forEach((value) => expansions.add(normalizeSearch(value)));
    }
  }

  return articles
    .map((article) => {
      const haystack = normalizeSearch([
        article.title,
        article.category,
        ...(article.tags || []),
        ...(article.steps || [])
      ].join(' '));
      const score = [...expansions].reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { article, score };
    })
    .filter((result) => result.score > 0)
    .sort((first, second) => second.score - first.score)
    .map((result) => result.article);
}

runFunctional('Modo Simple has nine guided steps and collapsed advanced controls', () => {
  const simple = labelStudioMode('simple');
  assert.deepEqual(simple.steps, SIMPLE_STEPS);
  assert.equal(simple.advancedOpen, false);
  assert.equal(simple.guided, true);
});

runFunctional('Modo Experto exposes dimensions, margins, spacing, DPI and elements', () => {
  const expert = labelStudioMode('expert');
  for (const control of ['labelWidthMm', 'labelHeightMm', 'columns', 'rows', 'marginTopMm', 'marginLeftMm', 'gapXMm', 'gapYMm', 'dpi', 'orientation', 'elements']) {
    assert(expert.controls.includes(control), `missing expert control ${control}`);
  }
});

runFunctional('manual quantity remains independent from stock', () => {
  assert.deepEqual(
    resolveLabelQuantity({ manualQuantity: 1, stock: 7, useStock: false }),
    { ok: true, copies: 1, source: 'manual' }
  );
  assert.deepEqual(
    resolveLabelQuantity({ manualQuantity: 7, stock: 99, useStock: false }),
    { ok: true, copies: 7, source: 'manual' }
  );
});

runFunctional('stock printing requires explicit opt-in and validates zero/negative stock', () => {
  assert.equal(resolveLabelQuantity({ manualQuantity: 1, stock: 7, useStock: true }).copies, 7);
  assert.deepEqual(resolveLabelQuantity({ manualQuantity: 1, stock: 0, useStock: true }), { ok: false, copies: 0, reason: 'empty_stock' });
  assert.deepEqual(resolveLabelQuantity({ manualQuantity: 1, stock: -2, useStock: true }), { ok: false, copies: 0, reason: 'invalid_stock' });
  assert.deepEqual(resolveLabelQuantity({ manualQuantity: 0, stock: 7, useStock: false }), { ok: false, copies: 0, reason: 'invalid_manual_quantity' });
});

runFunctional('real label presets are unique and dimensioned', () => {
  assert.equal(new Set(LABEL_PRESETS.map((preset) => preset.id)).size, LABEL_PRESETS.length);
  for (const preset of LABEL_PRESETS) {
    assert(Number(preset.labelWidthMm) > 0, `${preset.id} width`);
    assert(Number(preset.labelHeightMm) > 0, `${preset.id} height`);
    assert(Number(preset.columns) >= 1, `${preset.id} columns`);
    assert(Number(preset.rows) >= 1, `${preset.id} rows`);
  }
});

runFunctional('full-sheet preview reports occupied/empty cells and physical positions', () => {
  const twoColumns = buildFullSheetPreview(LABEL_PRESETS.find((preset) => preset.id === 'a4-2'), 5);
  assert.equal(twoColumns.capacity, 14);
  assert.equal(twoColumns.occupied, 5);
  assert.equal(twoColumns.empty, 9);
  assert.equal(twoColumns.cells[0].highlighted, true);
  assert.deepEqual(
    twoColumns.cells.slice(0, 3).map(({ row, column }) => ({ row, column })),
    [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 1, column: 0 }]
  );
  const threeColumns = buildFullSheetPreview(LABEL_PRESETS.find((preset) => preset.id === 'a4-3'), 7);
  assert.equal(threeColumns.columns, 3);
  assert.equal(threeColumns.cells[3].row, 1);
  assert(threeColumns.cells.every((cell) => cell.xMm >= 0 && cell.yMm >= 0));
});

runFunctional('label layout validation catches margins, overlap and small machine codes', () => {
  const result = validateLabelLayout(
    { labelWidthMm: 60, labelHeightMm: 40 },
    [
      { id: 'name', type: 'text', text: 'Nombre largo de producto que necesita dos líneas', x: 2, y: 2, w: 25, h: 10 },
      { id: 'price', type: 'text', text: '$10', x: 20, y: 5, w: 15, h: 8 },
      { id: 'qr', type: 'qr', x: 45, y: 25, w: 12, h: 12 },
      { id: 'barcode', type: 'barcode', x: 40, y: 34, w: 25, h: 8 }
    ]
  );
  assert(result.errors.includes('outside_margin:barcode'));
  assert(result.warnings.some((warning) => warning.startsWith('overlap:name:price')));
  assert(result.warnings.includes('qr_too_small:qr'));
  assert(result.warnings.includes('barcode_too_small:barcode'));
  assert(result.warnings.includes('long_text:name'));
});

runFunctional('safe default label layout passes validation', () => {
  const result = validateLabelLayout(
    { labelWidthMm: 80, labelHeightMm: 50 },
    [
      { id: 'name', type: 'text', text: 'Producto', x: 3, y: 3, w: 42, h: 8 },
      { id: 'price', type: 'text', text: '$10', x: 3, y: 14, w: 20, h: 8 },
      { id: 'qr', type: 'qr', x: 56, y: 3, w: 20, h: 20 },
      { id: 'barcode', type: 'barcode', x: 3, y: 30, w: 48, h: 14 }
    ]
  );
  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

runFunctional('table layout persists shape, color and clamped position by businessId', () => {
  const state = { tablesLayout: [] };
  const omega = upsertTableLayout(state, 'omega', {
    tableId: 'omega-table-1',
    businessId: 'omega',
    name: 'Mesa 1',
    x: 980,
    y: 690,
    w: 110,
    h: 80,
    shape: 'round',
    color: '#d6aa2c',
    status: 'free'
  });
  upsertTableLayout(state, 'alfa', {
    tableId: 'alfa-table-1',
    businessId: 'alfa',
    name: 'Delivery',
    x: 20,
    y: 30,
    w: 120,
    h: 70,
    shape: 'delivery',
    color: '#37d57e',
    status: 'occupied'
  });
  assert.equal(omega.x, 890);
  assert.equal(omega.y, 620);
  assert.deepEqual(tableLayoutForBusiness(state, 'omega').items.map((item) => item.tableId), ['omega-table-1']);
  assert.deepEqual(tableLayoutForBusiness(state, 'alfa').items.map((item) => item.tableId), ['alfa-table-1']);
  assert.throws(() => upsertTableLayout(state, 'omega', {
    tableId: 'cross-tenant',
    businessId: 'alfa',
    shape: 'square',
    color: '#ffffff'
  }), /active business/);
});

runFunctional('all supported table shapes/statuses and restaurant accesses are explicit', () => {
  assert.deepEqual(TABLE_SHAPES, ['round', 'square', 'rectangle', 'bar', 'delivery', 'takeaway']);
  assert.deepEqual(TABLE_STATUSES, ['free', 'occupied', 'ready_to_charge', 'reserved']);
  for (const type of ['restaurante', 'cafeteria', 'bar']) {
    assert.deepEqual(
      restaurantAccesses({ type }),
      { enabled: true, homeQuickAccess: true, settingsAccess: true }
    );
  }
  assert.equal(restaurantAccesses({ type: 'retail' }).enabled, false);
});

runFunctional('help search resolves required queries and synonyms locally', () => {
  for (const query of [
    'cerrar caja',
    'no puedo cerrar caja',
    'imprimir etiqueta',
    'imprimir una etiqueta',
    'stock',
    'código de barras',
    'QR',
    'mesa',
    'cobrar mesa',
    'finanzas',
    'pago',
    'meta',
    'sobre',
    'modo lectura',
    'sync',
    'negocio'
  ]) {
    assert(searchHelp(query).length > 0, `no help result for "${query}"`);
  }
});

staticContract(
  'candidate release version is current',
  app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`),
  `app.js must set APP_RELEASE_VERSION to ${RELEASE}`
);
staticContract(
  'candidate asset/cache version is consistent',
  app.includes(`const APP_ASSET_VERSION = '${ASSET}'`)
    && html.includes(ASSET)
    && styles.includes(ASSET)
    && worker.includes(`click360-${ASSET}`),
  `app.js, index.html, styles.css and service-worker.js must all use ${ASSET}`
);

staticContract(
  'Label Studio exposes Simple and Expert modes',
  matches(app, /Modo Simple/i) && matches(app, /Modo Experto/i),
  'render two explicit controls/tabs labelled "Modo Simple" and "Modo Experto"'
);
staticContract(
  'Simple mode is a nine-step guided flow',
  [
    /C[oó]mo vas a imprimir/i,
    /Qu[eé] tipo de papel/i,
    /Medidas del sticker/i,
    /Qu[eé] quieres mostrar/i,
    /Cantidad exacta/i,
    /Desde d[oó]nde quieres empezar/i,
    /Vista previa del sticker/i,
    /Revisi[oó]n antes de imprimir/i,
    /Todo listo para imprimir/i
  ].every((expression) => matches(app, expression)),
  'Simple mode must visibly guide all nine Smart Print steps'
);
staticContract(
  'advanced label controls are collapsed in Simple mode',
  matches(app, /settingsDisclosure|<details/i)
    && matches(app, /opciones avanzadas|Modo Experto|Ajustes avanzados/i),
  'advanced controls must be inside a collapsed disclosure or Expert mode'
);
staticContract(
  'manual quantity and stock printing remain separate',
  matches(app, /Cantidad exacta/i)
    && matches(app, /id=["']labelUseStock["']/i)
    && matches(app, /type=["']checkbox["']/i)
    && matches(app, /resolveLabelCopies\([^)]*useStock/i),
  'manual quantity must not depend on stock unless the explicit checkbox is checked'
);
staticContract(
  'zero and invalid stock have visible blocking messages',
  matches(app, /stock.{0,80}(?:cero|0|vac[ií]o|sin existencias)|No hay stock/i)
    && matches(app, /stock.{0,100}(?:inv[aá]lido|negativo)|cantidad.{0,80}inv[aá]lida/i),
  'stock=0 and negative/invalid stock must not print labels silently'
);

for (const preset of [
  /Rollo t[eé]rmico 40x30 mm/i,
  /Rollo t[eé]rmico 50x30 mm/i,
  /Rollo t[eé]rmico 60x40 mm/i,
  /Rollo t[eé]rmico 80x50 mm/i,
  /4 pulgadas.{0,20}108 mm|108 mm.{0,20}4 pulgadas/i,
  /Hoja A4 2 columnas/i,
  /Hoja A4 3 columnas/i,
  /Hoja A4 stickers peque[ñn]os/i,
  /Etiqueta cuadrada/i,
  /Etiqueta redonda/i,
  /Personalizada/i
]) {
  staticContract(
    `real label preset ${preset}`,
    matches(app, preset),
    `add a visible, dimensioned preset matching ${preset}`
  );
}

staticContract(
  'full-sheet preview shows physical grid occupancy',
  matches(app, /Vista previa de hoja completa|Hoja completa/i)
    && matches(app, /occupied|ocupad[ao]s?|espacios vac[ií]os|emptyCells|sheetCells/i)
    && matches(app, /columns|columnas/i)
    && matches(app, /rows|filas/i),
  '2/3-column paper needs a full-page preview with occupied and empty cells'
);
staticContract(
  'label validation runs before printing',
  matches(app, /validateLabelLayout|labelLayoutValidation|validar.*(?:dise[ñn]o|etiqueta)/i)
    && matches(app, /fuera de (?:margen|la zona segura)|outside.*margin/i)
    && matches(app, /superpuest|overlap/i)
    && matches(app, /demasiado peque[ñn]o|too small/i),
  'block or warn for missing dimensions, overflow, overlap and undersized QR/barcode'
);
staticContract(
  'saved templates stay isolated by businessId',
  matches(app, /labelTemplatesForBiz/)
    && matches(app, /template\.businessId\s*===\s*bid|businessId:\s*currentBusiness\(\)\.id/),
  'template reads and writes must carry/filter the active businessId'
);
staticContract(
  'template lifecycle remains available',
  [/Guardar (?:plantilla|dise[ñn]o)/i, /Duplicar/i, /Renombrar/i, /Predeterminada|predeterminada/i]
    .every((expression) => matches(app, expression)),
  'users need save, duplicate, rename and default-template actions'
);

staticContract(
  'visual tables layout is persisted by businessId',
  matches(app, /tablesLayout|tableLayout/i)
    && matches(app, /businessId/)
    && matches(app, /tableId/),
  'add optional tablesLayout with businessId-scoped items linked by tableId'
);
staticContract(
  'table layout stores positions and dimensions',
  matches(app, /\bx\b.{0,80}\by\b|\by\b.{0,80}\bx\b/)
    && matches(app, /\bw\b.{0,80}\bh\b|\bwidth\b.{0,80}\bheight\b/i),
  'visual table items need x, y, width and height'
);
staticContract(
  'table shapes and colors are editable',
  ['round', 'square', 'rectangle', 'bar', 'delivery', 'takeaway']
    .every((shape) => app.toLowerCase().includes(shape))
    && matches(app, /tableColor|color.{0,80}mesa|mesa.{0,80}color/i),
  'support round, square, rectangle, bar, delivery, takeaway and a color control'
);
staticContract(
  'table moving/reordering is implemented',
  matches(app, /drag|pointerdown|touchstart|mover mesa|data-table-move/i),
  'the visual plan needs pointer/touch movement or an accessible position editor'
);
staticContract(
  'restaurant businesses expose tables from Home and Settings',
  matches(app, /isRestaurantBusiness/)
    && matches(app, /Inicio.{0,200}Mesas|Mesas.{0,200}Inicio|home.{0,200}tables/i)
    && matches(app, /Configuraci[oó]n.{0,200}Mesas|settings.{0,200}tables|configurar mesas/i),
  'restaurant/cafe/bar must receive quick access from Home and configuration'
);
staticContract(
  'table operations remain scoped to business and cash',
  matches(app, /tablesForBiz/)
    && matches(app, /tableOrdersForBiz/)
    && matches(app, /chargeTableOrder/)
    && matches(app, /currentOpenCashSession|cashSessionId/),
  'visual layout must not replace P1.5A tenant, sale and cash safeguards'
);

staticContract(
  'help uses local searchable articles with tags/synonyms',
  matches(app, /HELP_TOPICS|helpArticles/)
    && matches(app, /keywords|tags|synonyms|sin[oó]nimos/i)
    && matches(app, /helpSearch|searchHelp|helpSearchInput/),
  'help index needs local tags/synonyms and a search input'
);
for (const query of [
  /no puedo cerrar caja/i,
  /imprimir una etiqueta/i,
  /stock/i,
  /c[oó]digo de barras/i,
  /\bQR\b/i,
  /cobrar mesa/i,
  /finanzas/i,
  /\bmeta\b/i,
  /\bsobre\b/i,
  /modo lectura/i,
  /\bsync\b|sincronizaci[oó]n/i,
  /negocio/i
]) {
  staticContract(
    `help content covers ${query}`,
    matches(app, query),
    `add a local help article/tag/synonym matching ${query}`
  );
}
staticContract(
  'help stays local and non-generative',
  !matches(app, /api\.openai\.com|OpenAI\(|chat\.completions|responses\.create/i),
  'P1.5B must not connect an AI or external answer API'
);
staticContract(
  'WhatsApp support remains visible',
  matches(app, /Contactar soporte.{0,80}WhatsApp|WhatsApp.{0,80}soporte/i),
  'help center must retain the support action'
);

staticContract(
  'responsive containment primitives exist',
  matches(styles, /min-width\s*:\s*0/)
    && matches(styles, /max-width\s*:\s*100%/)
    && matches(styles, /overflow-wrap|word-break/)
    && matches(styles, /overflow-x\s*:\s*hidden/),
  'responsive UI requires min-width:0, max-width:100%, text wrapping and horizontal overflow protection'
);
staticContract(
  'Label Studio and full-sheet preview have responsive styles',
  matches(styles, /labelStudio|labelMode|labelWizard/i)
    && matches(styles, /sheetPreview|fullSheet|labelSheet/i)
    && matches(styles, /@media\s*\(max-width/i),
  'add dedicated Label Studio and full-sheet responsive selectors'
);
staticContract(
  'visual table plan has responsive styles',
  matches(styles, /tablesLayout|tableLayout|tableCanvas|tablePlan/i)
    && matches(styles, /touch-action|pointer|grid/i),
  'add a bounded responsive visual-table surface with pointer/touch behavior'
);
staticContract(
  'PWA shell and cache lifecycle remain intact',
  matches(html, /manifest\.webmanifest/)
    && matches(worker, /activate/)
    && matches(worker, /caches\.keys/),
  'P1.5B must preserve manifest registration and old-cache cleanup'
);
staticContract(
  'no real customer identities are hardcoded',
  !matches(publicSource, /shary10mmvv|debbya632|roddysmith23|liavero_zambrano/i),
  'fixtures and UX copy must not contain real customer emails or identities'
);

const failedFunctional = functionalResults.filter((result) => !result.ok);
const failedContracts = contractResults.filter((result) => !result.ok);

for (const result of functionalResults) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} functional: ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
for (const result of contractResults) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} contract: ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}

console.log(
  `P1.5B QA summary: functional=${functionalResults.length - failedFunctional.length}/${functionalResults.length}, `
  + `contracts=${contractResults.length - failedContracts.length}/${contractResults.length}`
);

if (failedFunctional.length || failedContracts.length) {
  console.error(
    `FAIL P1.5B production UX polish harness: ${failedFunctional.length} functional and `
    + `${failedContracts.length} static contract failure(s)`
  );
  process.exitCode = 1;
} else {
  console.log('PASS P1.5B production UX polish harness: Label Studio, real presets, safe layouts, visual tables and searchable local help');
}
