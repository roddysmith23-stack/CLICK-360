(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const OBJECT_TYPES = Object.freeze(['qr', 'barcode', 'name', 'price', 'sku', 'text']);
  const MAX_HISTORY = 40;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }

  function normalizeObject(object = {}, index = 0) {
    const type = OBJECT_TYPES.includes(object.type) ? object.type : 'text';
    return {
      id: String(object.id || `${type}-${index + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || `text-${index + 1}`,
      type,
      text: String(object.text || '').slice(0, 160),
      x: clamp(object.x, 0, 1000), y: clamp(object.y, 0, 1000),
      width: clamp(object.width, 6, 1000), height: clamp(object.height, 6, 1000),
      rotation: clamp(number(object.rotation, 0), -180, 180),
      locked: object.locked === true,
      visible: object.visible !== false,
      z: Math.max(0, Math.trunc(number(object.z, index)))
    };
  }

  function normalizeDocument(input = {}) {
    const paper = input.paper || {};
    const objects = Array.isArray(input.objects) ? input.objects : [];
    return {
      version: 1,
      paper: {
        id: String(paper.id || 'custom').slice(0, 64),
        mediaType: ['sheet', 'roll', 'roll-1', 'roll-2', 'roll-3'].includes(paper.mediaType) ? paper.mediaType : 'roll-1',
        widthMm: clamp(paper.widthMm, 10, 250), heightMm: clamp(paper.heightMm, 10, 400),
        mediaWidthMm: clamp(paper.mediaWidthMm || paper.widthMm, 10, 1000),
        mediaHeightMm: clamp(paper.mediaHeightMm || paper.heightMm, 10, 2000),
        columns: Math.max(1, Math.trunc(clamp(paper.columns, 1, 12))),
        rows: Math.max(1, Math.trunc(clamp(paper.rows, 1, 100))),
        gapXmm: clamp(paper.gapXmm, 0, 50), gapYmm: clamp(paper.gapYmm, 0, 50),
        orientation: paper.orientation === 'landscape' ? 'landscape' : 'portrait'
      },
      objects: objects.map(normalizeObject).sort((a, b) => a.z - b.z),
      quantity: Math.max(1, Math.trunc(clamp(input.quantity, 1, 500))),
      startSlot: Math.max(1, Math.trunc(clamp(input.startSlot, 1, 120)))
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
  function duplicateObject(document, id) {
    const next = clone(document);
    const target = next.objects.find((entry) => entry.id === id);
    if (!target) return next;
    const copy = { ...target, id: `${target.id}-copy-${Date.now().toString(36)}`, x: target.x + 8, y: target.y + 8, z: Math.max(...next.objects.map((entry) => entry.z), 0) + 1 };
    next.objects.push(copy);
    return normalizeDocument(next);
  }
  function alignObjects(document, ids, axis = 'center') {
    const next = clone(document);
    const selected = next.objects.filter((entry) => ids.includes(entry.id) && !entry.locked);
    if (selected.length < 2) return next;
    const value = axis === 'left' ? Math.min(...selected.map((entry) => entry.x))
      : axis === 'right' ? Math.max(...selected.map((entry) => entry.x + entry.width))
        : axis === 'top' ? Math.min(...selected.map((entry) => entry.y))
          : axis === 'bottom' ? Math.max(...selected.map((entry) => entry.y + entry.height))
            : axis === 'middle' ? selected.reduce((sum, entry) => sum + entry.y + entry.height / 2, 0) / selected.length
              : selected.reduce((sum, entry) => sum + entry.x + entry.width / 2, 0) / selected.length;
    selected.forEach((entry) => {
      if (axis === 'left') entry.x = value;
      else if (axis === 'right') entry.x = value - entry.width;
      else if (axis === 'top') entry.y = value;
      else if (axis === 'bottom') entry.y = value - entry.height;
      else if (axis === 'middle') entry.y = value - entry.height / 2;
      else entry.x = value - entry.width / 2;
    });
    return normalizeDocument(next);
  }

  function buildPrintPlan(groups, paper, options = {}) {
    const engine = root.CLICK360_SMART_PRINT;
    if (!engine?.buildSheetPlan) return { valid: false, errors: ['El motor físico no está disponible.'], pages: [], count: 0 };
    return engine.buildSheetPlan(groups, paper, { startSlot: options.startSlot, usedSlots: options.usedSlots });
  }
  function planFingerprint(plan = {}) {
    return [plan.mediaType, plan.count, plan.columns, plan.rows, plan.capacity, ...(plan.pages || []).flatMap((page) => page.cells || []).map((cell) => `${cell.page || ''}:${cell.slot}:${cell.status}:${cell.xMm}:${cell.yMm}`)].join('|');
  }

  root.CLICK360_UNIVERSAL_LABEL_CANVAS = Object.freeze({
    VERSION, OBJECT_TYPES, normalizeDocument, createHistory, commit, undo, redo,
    updateObject, duplicateObject, alignObjects, buildPrintPlan, planFingerprint
  });
})(typeof window !== 'undefined' ? window : globalThis);
