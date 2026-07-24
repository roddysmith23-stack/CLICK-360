(function initClick360SmartPrint(root) {
  'use strict';

  const VERSION = '1.0.4-p2';
  const MAX_COPIES = 500;
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);
  const PROFILE_STATUSES = Object.freeze(['provisional', 'verified', 'certified']);
  const MEDIA_TYPES = Object.freeze([
    'roll-1',
    'roll-2',
    'roll-3',
    'sheet',
    'round',
    'square',
    'receipt',
    'continuous',
    'unsure',
    'custom'
  ]);
  const SUPPORT_CODES = Object.freeze([
    'PRN-PAPER-001',
    'PRN-PAPER-002',
    'PRN-QTY-001',
    'PRN-SLOT-001',
    'PRN-LAYOUT-001',
    'PRN-LAYOUT-002',
    'PRN-QR-001',
    'PRN-BAR-001',
    'PRN-CAL-001',
    'PRN-PROFILE-001',
    'PRN-HANDOFF-001',
    'PRN-PDF-001',
    'PRN-STORAGE-001',
    'PRN-UNKNOWN-000'
  ]);

  const PAPER_PRESETS = Object.freeze({
    'thermal-40x30': {
      id: 'thermal-40x30',
      name: 'Rollo termico 40 x 30 mm',
      mediaType: 'roll-1',
      labelWidthMm: 40,
      labelHeightMm: 30,
      mediaWidthMm: 40,
      columns: 1,
      rows: 1,
      nominalDpi: 203
    },
    'thermal-50x30': {
      id: 'thermal-50x30',
      name: 'Rollo termico 50 x 30 mm',
      mediaType: 'roll-1',
      labelWidthMm: 50,
      labelHeightMm: 30,
      mediaWidthMm: 50,
      columns: 1,
      rows: 1,
      nominalDpi: 203
    },
    'thermal-60x40': {
      id: 'thermal-60x40',
      name: 'Rollo termico 60 x 40 mm',
      mediaType: 'roll-1',
      labelWidthMm: 60,
      labelHeightMm: 40,
      mediaWidthMm: 60,
      columns: 1,
      rows: 1,
      nominalDpi: 203
    },
    'thermal-80x50': {
      id: 'thermal-80x50',
      name: 'Rollo termico 80 x 50 mm',
      mediaType: 'roll-1',
      labelWidthMm: 80,
      labelHeightMm: 50,
      mediaWidthMm: 80,
      columns: 1,
      rows: 1,
      nominalDpi: 203
    },
    'thermal-108': {
      id: 'thermal-108',
      name: 'Rollo termico 4 pulgadas / 108 mm',
      mediaType: 'roll-1',
      labelWidthMm: 108,
      labelHeightMm: 60,
      mediaWidthMm: 108,
      columns: 1,
      rows: 1,
      nominalDpi: 203
    },
    'sheet-2': {
      id: 'sheet-2',
      name: 'Hoja A4 2 columnas',
      mediaType: 'sheet',
      labelWidthMm: 90,
      labelHeightMm: 45,
      mediaWidthMm: 210,
      mediaHeightMm: 297,
      columns: 2,
      rows: 5,
      gapHorizontalMm: 4,
      gapVerticalMm: 4,
      marginTopMm: 8,
      marginRightMm: 8,
      marginBottomMm: 8,
      marginLeftMm: 8,
      nominalDpi: 300
    },
    'sheet-3': {
      id: 'sheet-3',
      name: 'Hoja A4 3 columnas',
      mediaType: 'sheet',
      labelWidthMm: 60,
      labelHeightMm: 35,
      mediaWidthMm: 210,
      mediaHeightMm: 297,
      columns: 3,
      rows: 7,
      gapHorizontalMm: 3,
      gapVerticalMm: 3,
      marginTopMm: 7,
      marginRightMm: 7,
      marginBottomMm: 7,
      marginLeftMm: 7,
      nominalDpi: 300
    },
    'sheet-small': {
      id: 'sheet-small',
      name: 'Hoja A4 stickers pequenos',
      mediaType: 'sheet',
      labelWidthMm: 38,
      labelHeightMm: 25,
      mediaWidthMm: 210,
      mediaHeightMm: 297,
      columns: 4,
      rows: 10,
      gapHorizontalMm: 2,
      gapVerticalMm: 2,
      marginTopMm: 6,
      marginRightMm: 6,
      marginBottomMm: 6,
      marginLeftMm: 6,
      nominalDpi: 300
    },
    'square-50': {
      id: 'square-50',
      name: 'Etiqueta cuadrada 50 x 50 mm',
      mediaType: 'square',
      labelWidthMm: 50,
      labelHeightMm: 50,
      mediaWidthMm: 50,
      columns: 1,
      rows: 1,
      shape: 'square',
      nominalDpi: 203
    },
    'round-50': {
      id: 'round-50',
      name: 'Etiqueta redonda 50 mm',
      mediaType: 'round',
      labelWidthMm: 50,
      labelHeightMm: 50,
      mediaWidthMm: 50,
      columns: 1,
      rows: 1,
      shape: 'circle',
      nominalDpi: 203
    },
    'shary-ltt214-2col': {
      id: 'shary-ltt214-2col',
      name: 'Shary - 3nStar LTT214 - 2 columnas',
      mediaType: 'roll-2',
      labelWidthMm: 40,
      labelHeightMm: 60,
      mediaWidthMm: 0,
      columns: 2,
      rows: 1,
      nominalDpi: 203,
      manufacturer: '3nStar',
      model: 'LTT214',
      driverDisplayName: '4BARCODE 4B-2054L',
      status: 'provisional',
      measurementsConfirmed: false,
      notes: 'Confirma el ancho total del soporte y los gaps antes de guardar.'
    }
  });

  const DESIGN_PRESETS = Object.freeze({
    'qr-only': { name: 'Solo QR', showQr: true, showName: false, showPrice: false, showBarcode: false, showSku: false, showUrl: false },
    'qr-name': { name: 'QR + nombre', showQr: true, showName: true, showPrice: false, showBarcode: false, showSku: false, showUrl: false },
    'qr-name-price': { name: 'QR + nombre + precio', showQr: true, showName: true, showPrice: true, showBarcode: false, showSku: false, showUrl: false },
    'barcode-price': { name: 'Codigo de barras + precio', showQr: false, showName: false, showPrice: true, showBarcode: true, showSku: false, showUrl: false },
    'name-price-sku': { name: 'Nombre + precio + SKU', showQr: false, showName: true, showPrice: true, showBarcode: false, showSku: true, showUrl: false },
    compact: { name: 'Completa compacta', showQr: true, showName: true, showPrice: true, showBarcode: true, showSku: true, showUrl: false },
    custom: { name: 'Personalizada segura', showQr: true, showName: true, showPrice: true, showBarcode: false, showSku: false, showUrl: false }
  });

  function text(value, fallback = '') {
    const normalized = String(value == null ? '' : value).trim();
    return normalized || fallback;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum, fallback = minimum) {
    return Math.min(maximum, Math.max(minimum, number(value, fallback)));
  }

  function integer(value, minimum, maximum, fallback = minimum) {
    return Math.trunc(clamp(value, minimum, maximum, fallback));
  }

  function iso(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }

  function safeId(value, fallback = '') {
    return text(value, fallback).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120);
  }

  function normalizeStatus(value) {
    return PROFILE_STATUSES.includes(value) ? value : 'provisional';
  }

  function normalizeRotation(value) {
    const rotation = Math.trunc(number(value, 0));
    return ROTATIONS.includes(rotation) ? rotation : 0;
  }

  function normalizePaperProfile(input = {}, businessId = '') {
    const preset = PAPER_PRESETS[input.presetId || input.paperType] || {};
    const source = { ...preset, ...input };
    const columns = integer(source.columns, 1, 6, 1);
    const rows = integer(source.rows, 1, 20, 1);
    const mediaType = MEDIA_TYPES.includes(source.mediaType)
      ? source.mediaType
      : (String(source.paperType || '').startsWith('sheet-') ? 'sheet' : `roll-${Math.min(3, columns)}`);
    const shape = ['rounded', 'square', 'circle'].includes(source.shape)
      ? source.shape
      : mediaType === 'round' ? 'circle' : mediaType === 'square' ? 'square' : 'rounded';
    return {
      id: safeId(source.id, safeId(source.presetId || source.paperType, 'paper-custom')),
      businessId: safeId(source.businessId || businessId),
      name: text(source.name || source.label, 'Perfil de papel'),
      mediaType,
      labelWidthMm: clamp(source.labelWidthMm ?? source.widthMm ?? source.width, 5, 250, 60),
      labelHeightMm: clamp(source.labelHeightMm ?? source.heightMm ?? source.height, 5, 400, 40),
      mediaWidthMm: clamp(source.mediaWidthMm, 0, 1000, 0),
      mediaHeightMm: clamp(source.mediaHeightMm, 0, 2000, 0),
      columns,
      rows,
      gapHorizontalMm: clamp(source.gapHorizontalMm ?? source.gapXmm ?? source.gapX, 0, 100, 0),
      gapVerticalMm: clamp(source.gapVerticalMm ?? source.gapYmm ?? source.gapY, 0, 100, 0),
      marginTopMm: clamp(source.marginTopMm ?? source.marginTop, 0, 200, 0),
      marginRightMm: clamp(source.marginRightMm ?? source.marginRight, 0, 200, 0),
      marginBottomMm: clamp(source.marginBottomMm ?? source.marginBottom, 0, 200, 0),
      marginLeftMm: clamp(source.marginLeftMm ?? source.marginLeft, 0, 200, 0),
      shape,
      cornerRadiusMm: clamp(source.cornerRadiusMm, 0, 100, shape === 'rounded' ? 2 : 0),
      contentRotation: normalizeRotation(source.contentRotation ?? source.rotation),
      xOffsetMm: clamp(source.xOffsetMm, -25, 25, 0),
      yOffsetMm: clamp(source.yOffsetMm, -25, 25, 0),
      printerProfileId: safeId(source.printerProfileId),
      nominalDpi: [203, 300, 600].includes(Number(source.nominalDpi ?? source.dpi)) ? Number(source.nominalDpi ?? source.dpi) : 203,
      status: normalizeStatus(source.status || source.verificationStatus),
      measurementsConfirmed: source.measurementsConfirmed === true,
      notes: text(source.notes).slice(0, 500),
      createdAt: iso(source.createdAt),
      updatedAt: iso(source.updatedAt)
    };
  }

  function normalizePrinterProfile(input = {}, businessId = '') {
    return {
      id: safeId(input.id, 'printer-system'),
      businessId: safeId(input.businessId || businessId),
      deviceProfileId: safeId(input.deviceProfileId),
      displayName: text(input.displayName, 'Impresora del sistema'),
      manufacturer: text(input.manufacturer).slice(0, 100),
      model: text(input.model).slice(0, 100),
      driverDisplayName: text(input.driverDisplayName).slice(0, 140),
      connectionType: ['system', 'pdf', 'usb', 'bluetooth', 'network', 'unknown'].includes(input.connectionType)
        ? input.connectionType : 'system',
      nominalDpi: [203, 300, 600].includes(Number(input.nominalDpi)) ? Number(input.nominalDpi) : 203,
      status: normalizeStatus(input.status || input.verificationStatus),
      notes: text(input.notes).slice(0, 500),
      createdAt: iso(input.createdAt),
      updatedAt: iso(input.updatedAt)
    };
  }

  function normalizeDesignProfile(input = {}, businessId = '') {
    const presetId = DESIGN_PRESETS[input.layoutPreset] ? input.layoutPreset : 'qr-name-price';
    const preset = DESIGN_PRESETS[presetId];
    return {
      id: safeId(input.id, 'design-safe'),
      businessId: safeId(input.businessId || businessId),
      name: text(input.name, preset.name),
      layoutPreset: presetId,
      elements: input.elements && typeof input.elements === 'object' ? JSON.parse(JSON.stringify(input.elements)) : {},
      safeArea: {
        top: clamp(input.safeArea?.top, 0, 0.45, 0.04),
        right: clamp(input.safeArea?.right, 0, 0.45, 0.04),
        bottom: clamp(input.safeArea?.bottom, 0, 0.45, 0.04),
        left: clamp(input.safeArea?.left, 0, 0.45, 0.04)
      },
      barcodeType: ['CODE128', 'EAN13', 'EAN8', 'UPC'].includes(input.barcodeType) ? input.barcodeType : 'CODE128',
      qrPayloadMode: ['product', 'code', 'custom'].includes(input.qrPayloadMode) ? input.qrPayloadMode : 'product',
      showUrl: input.showUrl === true,
      showPrice: input.showPrice ?? preset.showPrice,
      showBusiness: input.showBusiness !== false,
      showSku: input.showSku ?? preset.showSku,
      createdAt: iso(input.createdAt),
      updatedAt: iso(input.updatedAt)
    };
  }

  function normalizePrintProfile(input = {}, businessId = '') {
    const normalizedBusinessId = safeId(input.businessId || businessId);
    return {
      id: safeId(input.id, 'print-profile'),
      businessId: normalizedBusinessId,
      name: text(input.name, 'Perfil de impresion'),
      outputMode: ['system', 'pdf', 'certified', 'custom'].includes(input.outputMode) ? input.outputMode : 'system',
      printer: normalizePrinterProfile(input.printer || input.printerProfile || {}, normalizedBusinessId),
      paper: normalizePaperProfile(input.paper || input.paperProfile || input, normalizedBusinessId),
      design: normalizeDesignProfile(input.design || input.designProfile || input, normalizedBusinessId),
      status: normalizeStatus(input.status || input.verificationStatus),
      createdAt: iso(input.createdAt),
      updatedAt: iso(input.updatedAt)
    };
  }

  function normalizeLegacyTemplate(template = {}, businessId = '') {
    return normalizePrintProfile({
      id: template.profileId || template.id,
      businessId: template.businessId || businessId,
      name: template.name,
      outputMode: 'system',
      paper: {
        id: template.paperType,
        presetId: template.paperType,
        paperType: template.paperType,
        widthMm: template.widthMm,
        heightMm: template.heightMm,
        mediaWidthMm: template.mediaWidthMm,
        mediaHeightMm: template.mediaHeightMm,
        columns: template.columns,
        rows: template.rows,
        gapXmm: template.gapXmm,
        gapYmm: template.gapYmm,
        marginTopMm: template.marginTopMm,
        marginRightMm: template.marginRightMm,
        marginBottomMm: template.marginBottomMm,
        marginLeftMm: template.marginLeftMm,
        shape: template.shape,
        dpi: template.dpi,
        contentRotation: template.contentRotation,
        xOffsetMm: template.xOffsetMm,
        yOffsetMm: template.yOffsetMm
      },
      design: {
        id: template.id,
        name: template.name,
        layoutPreset: template.layoutPreset || 'custom',
        elements: template.layout || {},
        showUrl: template.showUrl === true,
        showPrice: true,
        showBusiness: true,
        showSku: true
      },
      status: template.status || 'provisional',
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }, businessId);
  }

  function validatePaperProfile(input = {}) {
    const paper = normalizePaperProfile(input, input.businessId);
    const errors = [];
    const warnings = [];
    const requiredWidth = paper.marginLeftMm + paper.marginRightMm
      + paper.columns * paper.labelWidthMm
      + Math.max(0, paper.columns - 1) * paper.gapHorizontalMm;
    const requiredHeight = paper.marginTopMm + paper.marginBottomMm
      + paper.rows * paper.labelHeightMm
      + Math.max(0, paper.rows - 1) * paper.gapVerticalMm;

    if (paper.labelWidthMm < 10 || paper.labelHeightMm < 10) errors.push('Cada sticker debe medir al menos 10 mm por lado.');
    if (paper.columns > 1 && paper.mediaWidthMm <= 0) errors.push('Confirma el ancho total del rollo u hoja para usar varias columnas.');
    if (paper.mediaWidthMm > 0 && requiredWidth > paper.mediaWidthMm + 0.01) {
      errors.push(`Las columnas, gaps y margenes requieren ${requiredWidth.toFixed(1)} mm, pero el soporte mide ${paper.mediaWidthMm.toFixed(1)} mm.`);
    }
    if (paper.marginLeftMm + paper.xOffsetMm < -0.01
      || (paper.mediaWidthMm > 0 && requiredWidth + paper.xOffsetMm > paper.mediaWidthMm + 0.01)) {
      warnings.push('La calibracion X alcanza el borde del soporte; confirma con una prueba fisica.');
    }
    if (paper.mediaHeightMm > 0 && requiredHeight > paper.mediaHeightMm + 0.01) {
      errors.push(`Las filas, gaps y margenes requieren ${requiredHeight.toFixed(1)} mm, pero el soporte mide ${paper.mediaHeightMm.toFixed(1)} mm.`);
    }
    if (paper.marginTopMm + paper.yOffsetMm < -0.01
      || (paper.mediaHeightMm > 0 && requiredHeight + paper.yOffsetMm > paper.mediaHeightMm + 0.01)) {
      warnings.push('La calibracion Y alcanza el borde del soporte; confirma con una prueba fisica.');
    }
    if (paper.shape === 'circle' && Math.abs(paper.labelWidthMm - paper.labelHeightMm) > 0.1) {
      errors.push('Una etiqueta redonda debe tener el mismo ancho y alto.');
    }
    if (paper.mediaType === 'unsure') warnings.push('Mide el sticker y el soporte completo antes de imprimir.');
    if (paper.status === 'provisional') warnings.push('Este perfil es provisional y requiere una prueba fisica.');
    if (!paper.measurementsConfirmed && (paper.columns > 1 || paper.mediaType === 'custom')) {
      warnings.push('Confirma las medidas fisicas antes de guardar este perfil.');
    }
    return {
      valid: errors.length === 0,
      paper,
      errors,
      warnings,
      requiredWidthMm: Number(requiredWidth.toFixed(3)),
      requiredHeightMm: Number(requiredHeight.toFixed(3))
    };
  }

  function resolveCopies(manualQuantity, useStock, stock) {
    if (useStock) {
      const parsedStock = Number(stock);
      if (!Number.isFinite(parsedStock) || parsedStock < 0 || !Number.isInteger(parsedStock)) {
        return { valid: false, count: 0, mode: 'stock', error: 'El stock debe ser un numero entero valido.' };
      }
      const count = Math.min(MAX_COPIES, parsedStock);
      return {
        valid: true,
        count,
        mode: 'stock',
        warning: count === 0 ? 'El producto no tiene stock; no se imprimira ninguna etiqueta.' : '',
        message: `Se imprimiran ${count} etiquetas porque activaste la opcion por stock.`
      };
    }
    const parsed = Number(manualQuantity);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_COPIES) {
      return { valid: false, count: 0, mode: 'exact', error: `La cantidad exacta debe ser un entero entre 1 y ${MAX_COPIES}.` };
    }
    return {
      valid: true,
      count: parsed,
      mode: 'exact',
      message: `Se imprimiran ${parsed} etiquetas exactas. El stock no cambia esta cantidad.`
    };
  }

  function normalizeUsedSlots(usedSlots, capacity) {
    const unique = new Set();
    for (const value of Array.isArray(usedSlots) ? usedSlots : []) {
      const slot = Math.trunc(Number(value));
      if (slot >= 1 && slot <= capacity) unique.add(slot);
    }
    return [...unique].sort((a, b) => a - b);
  }

  function flattenGroups(groups) {
    const items = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      const parsed = Number(group?.copies);
      const copies = Number.isInteger(parsed) && parsed >= 0 ? Math.min(MAX_COPIES, parsed) : 0;
      for (let copy = 1; copy <= copies; copy += 1) items.push({ product: group?.product || null, copy });
    }
    return items;
  }

  function buildSheetPlan(groups = [], inputPaper = {}, options = {}) {
    const paper = normalizePaperProfile(inputPaper, inputPaper.businessId);
    const items = flattenGroups(groups);
    const capacity = paper.columns * paper.rows;
    const requestedStart = Math.trunc(number(options.startSlot, 1));
    const startValid = requestedStart >= 1 && requestedStart <= capacity;
    const startSlot = startValid ? requestedStart : 1;
    const usedSlots = normalizeUsedSlots(options.usedSlots, capacity);
    const pages = [];
    let itemIndex = 0;
    let pageIndex = 0;

    while (itemIndex < items.length && startValid) {
      const firstPage = pageIndex === 0;
      const cells = [];
      for (let index = 0; index < capacity; index += 1) {
        const slot = index + 1;
        const used = firstPage && (slot < startSlot || usedSlots.includes(slot));
        const item = !used && itemIndex < items.length ? items[itemIndex++] : null;
        const column = index % paper.columns;
        const row = Math.floor(index / paper.columns);
        cells.push({
          page: pageIndex + 1,
          slot,
          row: row + 1,
          column: column + 1,
          status: used ? 'used' : item ? 'filled' : 'empty',
          item,
          xMm: Number((paper.marginLeftMm + column * (paper.labelWidthMm + paper.gapHorizontalMm) + paper.xOffsetMm).toFixed(3)),
          yMm: Number((paper.marginTopMm + row * (paper.labelHeightMm + paper.gapVerticalMm) + paper.yOffsetMm).toFixed(3))
        });
      }
      if (firstPage && items.length > 0 && cells.every((cell) => cell.status !== 'filled')) {
        return {
          valid:false,
          errors:['Todas las casillas disponibles de la primera hoja o tramo estan marcadas como usadas. Cambia el material o el inicio.'],
          items,
          count:items.length,
          paper,
          columns:paper.columns,
          rows:paper.rows,
          capacity,
          startSlot,
          usedSlots,
          pages:[],
          mediaType:paper.mediaType === 'sheet' ? 'sheet' : 'roll'
        };
      }
      pages.push({
        index: pageIndex,
        cells,
        occupied: cells.filter((cell) => cell.status === 'filled').length,
        used: cells.filter((cell) => cell.status === 'used').length,
        emptyCells: cells.filter((cell) => cell.status === 'empty').length
      });
      pageIndex += 1;
    }

    return {
      valid:startValid,
      errors:startValid ? [] : [`La casilla inicial debe estar entre 1 y ${capacity}.`],
      items,
      count: items.length,
      paper,
      columns: paper.columns,
      rows: paper.rows,
      capacity,
      startSlot,
      usedSlots,
      pages,
      mediaType: paper.mediaType === 'sheet' ? 'sheet' : 'roll'
    };
  }

  function boxForElement(key, element = {}) {
    const width = Math.max(0, number(element.width, 0));
    const height = Math.max(0, number(element.height ?? element.size, 0));
    const centered = element.centered === true || (!['qr', 'barcode', 'logo', 'image'].includes(key) && element.centered !== false);
    const x = number(element.x, 0);
    const y = number(element.y, 0);
    return {
      key,
      left: centered ? x - width / 2 : x,
      right: centered ? x + width / 2 : x + width,
      top: centered ? y - height : y,
      bottom: centered ? y : y + height,
      critical: ['qr', 'barcode'].includes(key)
    };
  }

  function detectLayoutCollisions(elements = {}, bounds = {}) {
    const width = Math.max(1, number(bounds.width, 1));
    const height = Math.max(1, number(bounds.height, 1));
    const safe = {
      left: clamp(bounds.safeLeft, 0, width, 0),
      top: clamp(bounds.safeTop, 0, height, 0),
      right: width - clamp(bounds.safeRight, 0, width, 0),
      bottom: height - clamp(bounds.safeBottom, 0, height, 0)
    };
    const boxes = Object.entries(elements)
      .filter(([, element]) => element && element.visible !== false)
      .map(([key, element]) => boxForElement(key, element));
    const outside = boxes.filter((box) => box.left < safe.left || box.top < safe.top || box.right > safe.right || box.bottom > safe.bottom);
    const collisions = [];
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first];
        const b = boxes[second];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          collisions.push({ first: a.key, second: b.key, critical: a.critical || b.critical });
        }
      }
    }
    return { safe, boxes, outside, collisions, critical: outside.some((box) => box.critical) || collisions.some((item) => item.critical) };
  }

  function buildPreflight(input = {}) {
    const paperValidation = validatePaperProfile(input.paper || {});
    const quantity = resolveCopies(input.manualQuantity ?? 1, input.useStock === true, input.stock ?? 0);
    const layout = detectLayoutCollisions(input.elements || {}, input.bounds || {});
    const checks = [];
    const add = (status, code, message) => checks.push({ status, code, message });

    add(paperValidation.valid ? 'pass' : 'error', 'paper', paperValidation.valid ? 'Perfil de papel valido' : paperValidation.errors[0]);
    add(quantity.valid ? 'pass' : 'error', 'quantity', quantity.valid ? `Cantidad exacta: ${quantity.count}` : quantity.error);
    add(input.useStock ? 'warning' : 'pass', 'stock-mode', input.useStock ? `Modo por stock activo: ${quantity.count}` : 'Opcion por stock desactivada');
    add(layout.outside.length ? (layout.critical ? 'error' : 'warning') : 'pass', 'safe-area',
      layout.outside.length ? 'Hay elementos fuera de la zona segura' : 'Contenido dentro de la zona segura');
    add(layout.collisions.length ? (layout.critical ? 'error' : 'warning') : 'pass', 'collisions',
      layout.collisions.length ? 'Hay elementos montados' : 'Sin elementos montados');

    const qr = input.elements?.qr;
    if (qr?.visible !== false) {
      const qrMm = number(input.qrSizeMm, 0);
      add(qrMm > 0 && qrMm < 18 ? 'error' : 'pass', 'qr-size', qrMm > 0 && qrMm < 18 ? 'El QR es menor a 18 mm' : 'QR con tamano legible');
    }
    if (input.showUrl === true && text(input.visibleUrl).length > 36) {
      add('warning', 'long-url', 'La URL visible es larga; ocultala porque el QR ya contiene el enlace');
    } else add('pass', 'long-url', 'URL larga oculta');
    add('warning', 'system-scale', 'En Chrome o Windows usa escala 100 % o Tamano real');
    add('warning', 'headers', 'Desactiva encabezados y pies de pagina');

    const errors = checks.filter((check) => check.status === 'error');
    const warnings = checks.filter((check) => check.status === 'warning');
    return {
      status: errors.length ? 'blocked' : warnings.length ? 'warning' : 'ready',
      blocking: errors.length > 0,
      checks,
      errors,
      warnings,
      paper: paperValidation.paper,
      quantity,
      layout
    };
  }

  function autoCorrectLayout(elements = {}, bounds = {}) {
    const width = Math.max(1, number(bounds.width, 1));
    const height = Math.max(1, number(bounds.height, 1));
    const result = JSON.parse(JSON.stringify(elements || {}));
    for (const [key, element] of Object.entries(result)) {
      if (!element || element.visible === false) continue;
      const box = boxForElement(key, element);
      if (box.left < 0) element.x = number(element.x, 0) - box.left;
      if (box.top < 0) element.y = number(element.y, 0) - box.top;
      if (box.right > width) element.x = number(element.x, 0) - (box.right - width);
      if (box.bottom > height) element.y = number(element.y, 0) - (box.bottom - height);
      if (!['qr', 'barcode', 'logo', 'image'].includes(key) && number(element.size, 10) > 24) element.size = 24;
    }
    const initial = detectLayoutCollisions(result, bounds);
    for (const collision of initial.collisions.filter((item) => item.critical)) {
      const criticalKey = ['qr', 'barcode'].includes(collision.first) ? collision.first : collision.second;
      const movingKey = criticalKey === collision.first ? collision.second : collision.first;
      const critical = boxForElement(criticalKey, result[criticalKey]);
      const moving = result[movingKey];
      if (!moving || moving.locked === true) continue;
      const movingBox = boxForElement(movingKey, moving);
      const movingHeight = Math.max(1, movingBox.bottom - movingBox.top);
      const centered = !['qr', 'barcode', 'logo', 'image'].includes(movingKey);
      const belowTop = critical.bottom + 1;
      if (belowTop + movingHeight <= height) moving.y = centered ? belowTop + movingHeight : belowTop;
      else if (critical.top - movingHeight - 1 >= 0) moving.y = centered ? critical.top - 1 : critical.top - movingHeight - 1;
      else if (!['name', 'price', 'code'].includes(movingKey)) moving.visible = false;
    }
    const remaining = detectLayoutCollisions(result, bounds);
    for (const collision of remaining.collisions.filter((item) => item.critical)) {
      const movableKey = [collision.first, collision.second].find((key) => !['qr'].includes(key));
      if (movableKey && result[movableKey]?.locked !== true) result[movableKey].visible = false;
    }
    return result;
  }

  function buildCalibrationGrid(stepMm = 1) {
    const step = clamp(stepMm, 0.1, 5, 1);
    return [
      [-step, -step], [0, -step], [step, -step],
      [-step, 0], [0, 0], [step, 0],
      [-step, step], [0, step], [step, step]
    ].map(([deltaXmm, deltaYmm], index) => ({
      cell:index + 1,
      deltaXmm:Number(deltaXmm.toFixed(2)),
      deltaYmm:Number(deltaYmm.toFixed(2))
    }));
  }

  function applyCalibrationCell(input = {}) {
    const cell = Math.trunc(Number(input.cell));
    const selected = buildCalibrationGrid(input.stepMm).find((item) => item.cell === cell);
    if (!selected) return { valid:false, error:'Selecciona una casilla de calibracion entre 1 y 9.' };
    const currentX = Number(input.currentXOffsetMm);
    const currentY = Number(input.currentYOffsetMm);
    if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
      return { valid:false, error:'Los offsets actuales no son validos.' };
    }
    const result = calculateCalibration({
      currentXOffsetMm:currentX,
      currentYOffsetMm:currentY,
      observedXmm:-selected.deltaXmm,
      observedYmm:-selected.deltaYmm,
      targetXmm:0,
      targetYmm:0
    });
    return result.valid
      ? { ...result, cell, status:cell === 5 ? 'verified' : 'provisional' }
      : result;
  }

  function paperGeometryFingerprint(input = {}) {
    const paper = normalizePaperProfile(input, input.businessId);
    return [
      paper.mediaType,
      paper.labelWidthMm,
      paper.labelHeightMm,
      paper.mediaWidthMm,
      paper.mediaHeightMm,
      paper.columns,
      paper.rows,
      paper.gapHorizontalMm,
      paper.gapVerticalMm,
      paper.marginTopMm,
      paper.marginRightMm,
      paper.marginBottomMm,
      paper.marginLeftMm,
      paper.contentRotation,
      paper.nominalDpi
    ].join('|');
  }

  function localDeviceStorageKey(input = {}) {
    const uid = safeId(input.uid);
    const tenantKey = safeId(input.tenantKey);
    const businessId = safeId(input.businessId);
    const deviceId = safeId(input.deviceId);
    if (!uid || !tenantKey || !businessId || !deviceId) return '';
    return `CLICK360:P1_5C:PRINT_DEVICE:${uid}:${tenantKey}:${businessId}:${deviceId}`;
  }

  function normalizeLocalDeviceState(input = {}, context = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const selectedProfileId = safeId(source.selectedProfileId);
    const calibrations = {};
    for (const [key, calibration] of Object.entries(source.calibrations || {})) {
      const safeKey = safeId(key, '').slice(0, 120);
      if (!safeKey || !calibration || typeof calibration !== 'object') continue;
      const xOffsetMm = Number(calibration.xOffsetMm);
      const yOffsetMm = Number(calibration.yOffsetMm);
      if (!Number.isFinite(xOffsetMm) || !Number.isFinite(yOffsetMm)
        || Math.abs(xOffsetMm) > 10 || Math.abs(yOffsetMm) > 10) continue;
      calibrations[safeKey] = {
        xOffsetMm:Number(xOffsetMm.toFixed(2)),
        yOffsetMm:Number(yOffsetMm.toFixed(2)),
        status:calibration.status === 'verified' ? 'verified' : 'provisional',
        geometryFingerprint:text(calibration.geometryFingerprint).slice(0, 240),
        attemptId:safeId(calibration.attemptId),
        updatedAt:iso(calibration.updatedAt)
      };
    }
    return {
      schemaVersion:1,
      uid:safeId(context.uid),
      tenantKey:safeId(context.tenantKey),
      businessId:safeId(context.businessId),
      deviceId:safeId(context.deviceId),
      selectedProfileId,
      calibrations
    };
  }

  function calculateCalibration(input = {}) {
    const required = ['currentXOffsetMm', 'currentYOffsetMm', 'observedXmm', 'observedYmm', 'targetXmm', 'targetYmm'];
    if (required.some((key) => !Number.isFinite(Number(input[key])))) {
      return { valid:false, error:'Las medidas de calibracion deben ser numeros validos.' };
    }
    const currentX = clamp(input.currentXOffsetMm, -25, 25, 0);
    const currentY = clamp(input.currentYOffsetMm, -25, 25, 0);
    const observedX = number(input.observedXmm, 0);
    const observedY = number(input.observedYmm, 0);
    const targetX = number(input.targetXmm, 0);
    const targetY = number(input.targetYmm, 0);
    const proposedX = currentX + targetX - observedX;
    const proposedY = currentY + targetY - observedY;
    if (Math.abs(proposedX) > 10 || Math.abs(proposedY) > 10) {
      return { valid:false, error:'El ajuste supera 10 mm. Revisa primero las medidas del papel y el driver.' };
    }
    return {
      valid:true,
      xOffsetMm: Number(proposedX.toFixed(2)),
      yOffsetMm: Number(proposedY.toFixed(2)),
      deltaXmm: Number((targetX - observedX).toFixed(2)),
      deltaYmm: Number((targetY - observedY).toFixed(2))
    };
  }

  function supportCode(input = {}) {
    if (SUPPORT_CODES.includes(input.code)) return input.code;
    if (input.quantityValid === false) return 'PRN-QTY-001';
    if (input.startSlotValid === false) return 'PRN-SLOT-001';
    if (input.paperValid === false) return input.paperIncomplete ? 'PRN-PAPER-001' : 'PRN-PAPER-002';
    if (input.layoutOutside === true) return 'PRN-LAYOUT-001';
    if (input.layoutCollision === true) return 'PRN-LAYOUT-002';
    if (input.qrUnsafe === true) return 'PRN-QR-001';
    return 'PRN-UNKNOWN-000';
  }

  function runtimeFamily(value, type) {
    const normalized = String(value || '').toLowerCase();
    const allowed = type === 'browser'
      ? [['edge', /edg/], ['firefox', /firefox/], ['chrome', /chrome|crios/], ['safari', /safari/]]
      : [['windows', /windows/], ['ios', /iphone|ipad|ios/], ['android', /android/], ['macos', /mac os|macos/], ['linux', /linux/]];
    return allowed.find(([, matcher]) => matcher.test(normalized))?.[0] || 'other';
  }

  function localDiagnosticId(value) {
    const normalized = safeId(value).toUpperCase();
    return /^PRNREP-[A-Z0-9]{8,16}$/.test(normalized) ? normalized : 'PRNREP-LOCAL';
  }

  function sanitizeDiagnostic(input = {}) {
    const paper = normalizePaperProfile(input.paper || {});
    const code = supportCode({
      code:input.supportCode,
      quantityValid:input.quantityValid,
      startSlotValid:input.startSlotValid,
      paperValid:input.paperValid,
      paperIncomplete:input.paperIncomplete,
      layoutOutside:input.layoutOutside,
      layoutCollision:input.layoutCollision,
      qrUnsafe:input.qrUnsafe
    });
    const result = {
      schemaVersion:'click360.print-diagnostic.v1',
      diagnosticId:localDiagnosticId(input.diagnosticId),
      release: {
        version:safeId(input.release).slice(0, 32),
        sha:safeId(input.buildSha).slice(0, 16),
        asset:safeId(input.assetVersion).slice(0, 80)
      },
      runtime: {
        browserFamily:runtimeFamily(input.browser, 'browser'),
        operatingSystemFamily:runtimeFamily(input.operatingSystem, 'os'),
        displayMode:input.displayMode === 'standalone' ? 'standalone' : 'browser',
        online:input.online !== false
      },
      wizard: {
        step:integer(input.step, 1, 9, 1),
        outputMode:['system', 'pdf', 'certified', 'custom'].includes(input.outputMode) ? input.outputMode : 'system'
      },
      printer: {
        nominalDpi:[203, 300, 600].includes(Number(input.printer?.nominalDpi)) ? Number(input.printer.nominalDpi) : paper.nominalDpi,
        status:normalizeStatus(input.printer?.status)
      },
      paper: {
        mediaType: paper.mediaType,
        labelMm:[paper.labelWidthMm, paper.labelHeightMm],
        mediaMm:[paper.mediaWidthMm, paper.mediaHeightMm],
        columns: paper.columns,
        rows: paper.rows,
        gapsMm:[paper.gapHorizontalMm, paper.gapVerticalMm],
        offsetsMm:[paper.xOffsetMm, paper.yOffsetMm],
        rotation:paper.contentRotation,
        status: paper.status
      },
      job: {
        quantity:integer(input.exactQuantity, 0, MAX_COPIES, 0),
        stockMode:input.stockMode === true,
        startSlot:integer(input.startSlot, 1, Math.max(1, paper.columns * paper.rows), 1)
      },
      preflight: {
        status:['ready', 'warning', 'blocked'].includes(input.preflightStatus) ? input.preflightStatus : 'unknown',
        codes:[code]
      },
      supportCode:code
    };
    return result;
  }

  function normalizeSearch(value) {
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function searchHelp(topics = [], query = '', step = 0) {
    const ignored = new Set(['a', 'al', 'como', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'por', 'que', 'un', 'una', 'y']);
    const normalizedQuery = normalizeSearch(query);
    const words = normalizedQuery.split(' ').filter((word) => word.length > 1 && !ignored.has(word));
    if (!words.length) return [];
    return (Array.isArray(topics) ? topics : []).map((topic, index) => {
      const title = normalizeSearch(topic.title);
      const aliases = (Array.isArray(topic.aliases) ? topic.aliases : String(topic.keywords || '').split(/\s+/)).map(normalizeSearch);
      const haystack = normalizeSearch(`${topic.title || ''} ${topic.keywords || ''} ${(topic.steps || []).join(' ')}`);
      const exactAlias = aliases.includes(normalizedQuery);
      const titlePhrase = title.includes(normalizedQuery);
      const allWords = words.every((word) => haystack.includes(word));
      const score = (exactAlias ? 100 : 0) + (titlePhrase ? 80 : 0) + (allWords ? 60 : 0)
        + (Array.isArray(topic.stepsFor) && topic.stepsFor.includes(Number(step)) ? 20 : 0)
        + Math.max(0, 10 - index / 100);
      return { topic, score };
    }).filter((entry) => entry.score >= 60)
      .sort((a, b) => b.score - a.score || String(a.topic.id).localeCompare(String(b.topic.id)))
      .map((entry) => entry.topic);
  }

  const api = Object.freeze({
    VERSION,
    MAX_COPIES,
    ROTATIONS,
    PROFILE_STATUSES,
    MEDIA_TYPES,
    SUPPORT_CODES,
    PAPER_PRESETS,
    DESIGN_PRESETS,
    normalizePaperProfile,
    normalizePrinterProfile,
    normalizeDesignProfile,
    normalizePrintProfile,
    normalizeLegacyTemplate,
    validatePaperProfile,
    resolveCopies,
    buildSheetPlan,
    detectLayoutCollisions,
    buildPreflight,
    autoCorrectLayout,
    calculateCalibration,
    buildCalibrationGrid,
    applyCalibrationCell,
    paperGeometryFingerprint,
    localDeviceStorageKey,
    normalizeLocalDeviceState,
    sanitizeDiagnostic,
    supportCode,
    searchHelp
  });

  root.CLICK360_SMART_PRINT = api;
})(typeof window !== 'undefined' ? window : globalThis);
