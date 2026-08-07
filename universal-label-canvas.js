(function (root) {
  'use strict';

  const VERSION = '2.0.0';
  const OBJECT_TYPES = Object.freeze(['qr', 'barcode', 'name', 'price', 'sku', 'text', 'image']);
  const MAX_HISTORY = 80;
  const MM_PER_INCH = 25.4;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function clamp(value, minimum, maximum, fallback = minimum) {
    return Math.max(minimum, Math.min(maximum, number(value, fallback)));
  }
  function safeId(value, fallback) {
    return String(value || fallback).replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || fallback;
  }
  function legacyToMm(value, axisMm, legacyBase, fallback) {
    const parsed = number(value, fallback);
    return clamp(parsed / legacyBase * axisMm, 0, axisMm, fallback);
  }

  function normalizePaper(input = {}) {
    const widthMm = clamp(input.widthMm || input.labelWidthMm, 10, 250, 60);
    const heightMm = clamp(input.heightMm || input.labelHeightMm, 10, 400, 40);
    const columns = Math.max(1, Math.trunc(clamp(input.columns, 1, 12, 1)));
    const rows = Math.max(1, Math.trunc(clamp(input.rows, 1, 100, 1)));
    const mediaType = ['sheet', 'roll', 'roll-1', 'roll-2', 'roll-3'].includes(input.mediaType)
      ? input.mediaType : columns > 1 ? `roll-${Math.min(columns, 3)}` : 'roll-1';
    return {
      id: safeId(input.id, 'custom'),
      mediaType,
      widthMm,
      heightMm,
      mediaWidthMm: clamp(input.mediaWidthMm, 0, 1000, 0),
      mediaHeightMm: clamp(input.mediaHeightMm, 0, 2000, 0),
      columns,
      rows,
      gapXmm: clamp(input.gapXmm || input.gapHorizontalMm, 0, 50, 0),
      gapYmm: clamp(input.gapYmm || input.gapVerticalMm, 0, 50, 0),
      marginTopMm: clamp(input.marginTopMm, 0, 200, 0),
      marginRightMm: clamp(input.marginRightMm, 0, 200, 0),
      marginBottomMm: clamp(input.marginBottomMm, 0, 200, 0),
      marginLeftMm: clamp(input.marginLeftMm, 0, 200, 0),
      pitchMm: clamp(input.pitchMm, 0, 500, 0),
      xOffsetMm: clamp(input.xOffsetMm, -50, 50, 0),
      yOffsetMm: clamp(input.yOffsetMm, -50, 50, 0),
      scaleX: clamp(input.scaleX, 0.8, 1.2, 1),
      scaleY: clamp(input.scaleY, 0.8, 1.2, 1),
      dpi: Math.max(72, Math.trunc(clamp(input.dpi || input.nominalDpi, 72, 1200, 203))),
      orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
      // Additive, backward-compatible: legacy advanced-wizard physical knobs, unchanged defaults
      // for every document that doesn't set them (shape:'rounded' and contentRotation:0 render
      // identically to the pre-existing behavior — see renderLabelToCanvas).
      shape: ['square', 'circle'].includes(input.shape) ? input.shape : 'rounded',
      contentRotation: [90, 180, 270].includes(Number(input.contentRotation)) ? Number(input.contentRotation) : 0
    };
  }

  function normalizeObject(object = {}, index = 0, paper = normalizePaper(), legacyBase = { width: 1000, height: 1000 }) {
    const type = OBJECT_TYPES.includes(object.type) ? object.type : 'text';
    const legacyWidth = Math.max(1, number(object.width, 40));
    const legacyHeight = Math.max(1, number(object.height || object.size, 12));
    const hasMillimeters = ['xMm', 'yMm', 'widthMm', 'heightMm'].some((key) => Object.prototype.hasOwnProperty.call(object, key));
    const widthMm = hasMillimeters
      ? clamp(object.widthMm, 2, paper.widthMm, Math.min(20, paper.widthMm))
      : clamp(legacyWidth / legacyBase.width * paper.widthMm, 2, paper.widthMm, Math.min(20, paper.widthMm));
    const heightMm = hasMillimeters
      ? clamp(object.heightMm, 2, paper.heightMm, type === 'text' ? 5 : Math.min(20, paper.heightMm))
      : clamp(legacyHeight / legacyBase.height * paper.heightMm, 2, paper.heightMm, type === 'text' ? 5 : Math.min(20, paper.heightMm));
    const xMm = hasMillimeters
      ? clamp(object.xMm, 0, Math.max(0, paper.widthMm - widthMm), 0)
      : legacyToMm(object.x, Math.max(0, paper.widthMm - widthMm), legacyBase.width, 0);
    const yMm = hasMillimeters
      ? clamp(object.yMm, 0, Math.max(0, paper.heightMm - heightMm), 0)
      : legacyToMm(object.y, Math.max(0, paper.heightMm - heightMm), legacyBase.height, 0);
    return {
      id: safeId(object.id, `${type}-${index + 1}`),
      type,
      text: String(object.text || '').slice(0, 160),
      imageData: String(object.imageData || '').slice(0, 2_000_000),
      xMm,
      yMm,
      widthMm,
      heightMm,
      rotation: clamp(object.rotation, -180, 180, 0),
      locked: object.locked === true,
      visible: object.visible !== false,
      z: Math.max(0, Math.trunc(number(object.z, index)))
    };
  }

  function defaultsForPaper(paper) {
    const width = paper.widthMm;
    const height = paper.heightMm;
    const qrSize = Math.min(width * 0.42, height * 0.48);
    return [
      { id: 'qr-1', type: 'qr', xMm: 3, yMm: 3, widthMm: qrSize, heightMm: qrSize, z: 1 },
      { id: 'name-1', type: 'name', xMm: qrSize + 6, yMm: 5, widthMm: Math.max(12, width - qrSize - 9), heightMm: 7, z: 2 },
      { id: 'price-1', type: 'price', xMm: qrSize + 6, yMm: 15, widthMm: Math.max(12, width - qrSize - 9), heightMm: 8, z: 2 },
      { id: 'sku-1', type: 'sku', xMm: qrSize + 6, yMm: 26, widthMm: Math.max(12, width - qrSize - 9), heightMm: 5, z: 2 }
    ].map((object, index) => normalizeObject(object, index, paper));
  }

  function normalizeLegacyLayout(layout = {}, paper = normalizePaper()) {
    const entries = Object.entries(layout || {}).map(([key, value], index) => {
      const type = key === 'code' ? 'sku' : key === 'customText' ? 'text' : key === 'logo' ? 'image' : key;
      const imageData = key === 'logo' || key === 'image' ? String(value?.imageData || '') : '';
      return normalizeObject({ id: key, type, text: value?.text || '', imageData, ...value, type }, index, paper, { width: 260, height: 380 });
    });
    return entries.filter((object) => OBJECT_TYPES.includes(object.type));
  }

  function normalizeDocument(input = {}) {
    const paper = normalizePaper(input.paper || input);
    const sourceObjects = Array.isArray(input.objects) ? input.objects
      : input.layout ? normalizeLegacyLayout(input.layout, paper) : defaultsForPaper(paper);
    // Older saved canvas documents stored coordinates on a 0..1000 logical grid.
    const legacyBase = { width: 1000, height: 1000 };
    return {
      schemaVersion: 2,
      paper,
      objects: sourceObjects.map((object, index) => normalizeObject(object, index, paper, legacyBase)).sort((a, b) => a.z - b.z),
      quantity: Math.max(1, Math.trunc(clamp(input.quantity || input.copies, 1, 500, 1))),
      startSlot: Math.max(1, Math.trunc(clamp(input.startSlot, 1, Math.max(1, paper.columns * paper.rows), 1))),
      gridMm: clamp(input.gridMm, 0.5, 20, 2),
      snap: input.snap !== false
    };
  }

  function createHistory(document) { return { past: [], present: normalizeDocument(document), future: [] }; }
  function commit(history, document) {
    const next = normalizeDocument(document);
    return { past: [...history.past, clone(history.present)].slice(-MAX_HISTORY), present: next, future: [] };
  }
  function undo(history) {
    if (!history.past.length) return history;
    const previous = history.past[history.past.length - 1];
    return { past: history.past.slice(0, -1), present: clone(previous), future: [clone(history.present), ...history.future].slice(0, MAX_HISTORY) };
  }
  function redo(history) {
    if (!history.future.length) return history;
    const next = history.future[0];
    return { past: [...history.past, clone(history.present)].slice(-MAX_HISTORY), present: clone(next), future: history.future.slice(1) };
  }
  function updateObject(document, id, patch = {}) {
    const next = clone(document);
    const target = next.objects.find((entry) => entry.id === id);
    if (!target || target.locked) return next;
    Object.assign(target, patch);
    return normalizeDocument(next);
  }
  function addObject(document, type, patch = {}) {
    const next = clone(document);
    const paper = next.paper;
    const index = next.objects.length + 1;
    const object = normalizeObject({
      id: `${type}-${Date.now().toString(36)}-${index}`,
      type,
      xMm: Math.max(2, paper.widthMm * 0.2), yMm: Math.max(2, paper.heightMm * 0.2),
      widthMm: type === 'qr' ? Math.min(24, paper.widthMm * 0.45) : Math.min(36, paper.widthMm * 0.7),
      heightMm: type === 'qr' || type === 'image' ? Math.min(24, paper.heightMm * 0.45) : 7,
      z: Math.max(0, ...next.objects.map((entry) => entry.z)) + 1,
      ...patch
    }, index, paper);
    next.objects.push(object);
    return normalizeDocument(next);
  }
  function deleteObjects(document, ids = []) {
    const next = clone(document);
    next.objects = next.objects.filter((entry) => !ids.includes(entry.id));
    return normalizeDocument(next);
  }
  function duplicateObject(document, id) {
    const next = clone(document);
    const target = next.objects.find((entry) => entry.id === id);
    if (!target) return next;
    const copy = { ...target, id: `${target.id}-copy-${Date.now().toString(36)}`, xMm: target.xMm + 2, yMm: target.yMm + 2, locked: false, z: Math.max(...next.objects.map((entry) => entry.z), 0) + 1 };
    next.objects.push(copy);
    return normalizeDocument(next);
  }
  function alignObjects(document, ids, axis = 'center') {
    const next = clone(document);
    const selected = next.objects.filter((entry) => ids.includes(entry.id) && !entry.locked);
    if (selected.length < 2) return next;
    const value = axis === 'left' ? Math.min(...selected.map((entry) => entry.xMm))
      : axis === 'right' ? Math.max(...selected.map((entry) => entry.xMm + entry.widthMm))
        : axis === 'top' ? Math.min(...selected.map((entry) => entry.yMm))
          : axis === 'bottom' ? Math.max(...selected.map((entry) => entry.yMm + entry.heightMm))
            : axis === 'middle' ? selected.reduce((sum, entry) => sum + entry.yMm + entry.heightMm / 2, 0) / selected.length
              : selected.reduce((sum, entry) => sum + entry.xMm + entry.widthMm / 2, 0) / selected.length;
    selected.forEach((entry) => {
      if (axis === 'left') entry.xMm = value;
      else if (axis === 'right') entry.xMm = value - entry.widthMm;
      else if (axis === 'top') entry.yMm = value;
      else if (axis === 'bottom') entry.yMm = value - entry.heightMm;
      else if (axis === 'middle') entry.yMm = value - entry.heightMm / 2;
      else entry.xMm = value - entry.widthMm / 2;
    });
    return normalizeDocument(next);
  }
  function arrangeObject(document, id, direction = 'front') {
    const next = clone(document);
    const target = next.objects.find((entry) => entry.id === id);
    if (!target) return next;
    target.z = direction === 'back' ? Math.min(...next.objects.map((entry) => entry.z)) - 1 : Math.max(...next.objects.map((entry) => entry.z)) + 1;
    return normalizeDocument(next);
  }

  function toPrintPaper(document) {
    const paper = normalizeDocument(document).paper;
    const gapVerticalMm = paper.pitchMm > paper.heightMm
      ? Number((paper.pitchMm - paper.heightMm).toFixed(3))
      : paper.gapYmm;
    return {
      id: paper.id,
      mediaType: paper.mediaType,
      labelWidthMm: paper.widthMm,
      labelHeightMm: paper.heightMm,
      mediaWidthMm: paper.mediaWidthMm,
      mediaHeightMm: paper.mediaHeightMm,
      columns: paper.columns,
      rows: paper.rows,
      gapHorizontalMm: paper.gapXmm,
      gapVerticalMm,
      marginTopMm: paper.marginTopMm,
      marginRightMm: paper.marginRightMm,
      marginBottomMm: paper.marginBottomMm,
      marginLeftMm: paper.marginLeftMm,
      xOffsetMm: paper.xOffsetMm,
      yOffsetMm: paper.yOffsetMm,
      nominalDpi: paper.dpi,
      status: 'provisional',
      measurementsConfirmed: false
    };
  }
  function buildPrintPlan(groups, document, options = {}) {
    const engine = root.CLICK360_SMART_PRINT;
    if (!engine?.buildSheetPlan) return { valid: false, errors: ['El motor físico no está disponible.'], pages: [], count: 0 };
    const normalized = normalizeDocument(document);
    return engine.buildSheetPlan(groups, toPrintPaper(normalized), { startSlot: options.startSlot || normalized.startSlot, usedSlots: options.usedSlots });
  }
  function planFingerprint(plan = {}) {
    return [plan.mediaType, plan.count, plan.columns, plan.rows, plan.capacity, ...(plan.pages || []).flatMap((page) => page.cells || []).map((cell) => `${cell.page || ''}:${cell.slot}:${cell.status}:${cell.xMm}:${cell.yMm}`)].join('|');
  }

  function textValue(object, data = {}) {
    const product = data.product || {};
    if (object.type === 'name') return String(product.name || data.name || 'Producto');
    if (object.type === 'price') return String(data.price || product.price || '0.00');
    if (object.type === 'sku') return String(product.code || data.sku || 'SKU');
    if (object.type === 'text') return object.text || String(data.text || 'Texto');
    return '';
  }
  function drawRotated(ctx, object, pxPerMm, draw) {
    const x = object.xMm * pxPerMm;
    const y = object.yMm * pxPerMm;
    const width = object.widthMm * pxPerMm;
    const height = object.heightMm * pxPerMm;
    if (!object.rotation) return draw(x, y, width, height);
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(object.rotation * Math.PI / 180);
    draw(-width / 2, -height / 2, width, height);
    ctx.restore();
  }
  function drawQr(ctx, value, x, y, width, height, background) {
    if (typeof root.qrcode !== 'function') return false;
    try {
      const qr = root.qrcode(0, 'M');
      qr.addData(value || 'CLICK360');
      qr.make();
      const count = qr.getModuleCount();
      const cell = Math.min(width, height) / count;
      ctx.fillStyle = String(background || '#ffffff'); ctx.fillRect(x, y, width, height);
      ctx.fillStyle = '#000000';
      for (let row = 0; row < count; row += 1) for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) ctx.fillRect(x + column * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell));
      }
      return true;
    } catch { return false; }
  }
  async function renderLabelToCanvas(canvas, input, data = {}, options = {}) {
    const document = normalizeDocument(input);
    const paper = document.paper;
    const dpi = Math.max(72, Number(options.dpi || paper.dpi || 203));
    const pxPerMm = dpi / MM_PER_INCH;
    canvas.width = Math.max(1, Math.round(paper.widthMm * pxPerMm));
    canvas.height = Math.max(1, Math.round(paper.heightMm * pxPerMm));
    canvas.dataset.widthMm = String(paper.widthMm);
    canvas.dataset.heightMm = String(paper.heightMm);
    canvas.dataset.renderer = 'universal-mm-v2';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = String(options.background || '#ffffff');
    if (paper.shape === 'circle') {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = String(options.foreground || '#111111');
    const payload = String(data.qrPayload || data.product?.code || data.product?.id || 'CLICK360');
    const qrBackground = options.qrBackground || options.background || '#ffffff';
    // qrMarginRatio insets the QR module grid within its object box, preserving a quiet zone
    // (0..0.3 of the box). Matches the legacy advanced wizard's "labelQrMargin" control.
    const qrMarginRatio = Math.max(0, Math.min(0.3, Number(options.qrMarginRatio || 0)));
    ctx.save();
    ctx.scale(paper.scaleX, paper.scaleY);
    for (const object of document.objects.filter((entry) => entry.visible).sort((a, b) => a.z - b.z)) {
      if (object.type === 'qr') {
        drawRotated(ctx, object, pxPerMm, (x, y, width, height) => {
          const insetX = width * qrMarginRatio / 2;
          const insetY = height * qrMarginRatio / 2;
          drawQr(ctx, payload, x + insetX, y + insetY, width - insetX * 2, height - insetY * 2, qrBackground);
        });
      } else if (object.type === 'barcode' && typeof root.JsBarcode === 'function') {
        const barcode = root.document?.createElement?.('canvas');
        if (!barcode) continue;
        try {
          root.JsBarcode(barcode, String(data.product?.code || data.sku || 'CLICK360'), { format: 'CODE128', displayValue: false, margin: 0, height: 120, background: '#ffffff', lineColor: '#111111' });
          drawRotated(ctx, object, pxPerMm, (x, y, width, height) => ctx.drawImage(barcode, x, y, width, height));
        } catch {}
      } else if (object.type === 'image' && object.imageData && typeof root.Image === 'function') {
        const image = await new Promise((resolve) => { const item = new root.Image(); item.onload = () => resolve(item); item.onerror = () => resolve(null); item.src = object.imageData; });
        if (image) drawRotated(ctx, object, pxPerMm, (x, y, width, height) => ctx.drawImage(image, x, y, width, height));
      } else {
        const value = textValue(object, data);
        if (!value) continue;
        drawRotated(ctx, object, pxPerMm, (x, y, width, height) => {
          let size = Math.max(7, height * 0.72);
          ctx.font = `700 ${size}px Arial`;
          while (ctx.measureText(value).width > width && size > 7) { size -= 1; ctx.font = `700 ${size}px Arial`; }
          ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          ctx.fillText(value, x, y + height / 2, width);
        });
      }
    }
    ctx.restore();
    if (paper.contentRotation) {
      const rotated = canvas.ownerDocument.createElement('canvas');
      rotated.width = canvas.width; rotated.height = canvas.height;
      rotated.getContext('2d').drawImage(canvas, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = String(options.background || '#ffffff');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(paper.contentRotation * Math.PI / 180);
      if (paper.contentRotation === 90 || paper.contentRotation === 270) {
        ctx.drawImage(rotated, -canvas.height / 2, -canvas.width / 2, canvas.height, canvas.width);
      } else {
        ctx.drawImage(rotated, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      }
      ctx.restore();
    }
    return { widthPx: canvas.width, heightPx: canvas.height, widthMm: paper.widthMm, heightMm: paper.heightMm };
  }

  root.CLICK360_UNIVERSAL_LABEL_CANVAS = Object.freeze({
    VERSION, OBJECT_TYPES, MM_PER_INCH, normalizePaper, normalizeObject, normalizeDocument, normalizeLegacyLayout, defaultsForPaper,
    createHistory, commit, undo, redo, updateObject, addObject, deleteObjects, duplicateObject, alignObjects, arrangeObject,
    toPrintPaper, buildPrintPlan, planFingerprint, renderLabelToCanvas
  });
})(typeof window !== 'undefined' ? window : globalThis);
