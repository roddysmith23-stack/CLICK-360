(() => {
  'use strict';

  const PREVIEW_VERSION = '1.0.5-p2-preview';
  const PREVIEW_CACHE_KEY = 'click360-p2-owner-preview-r1';
  const STORAGE_PREFIX = 'CLICK360_P2_OWNER_PREVIEW:';
  const BUILD_SHA = '__CLICK360_BUILD_SHA__';
  const app = document.getElementById('ownerPreviewApp');
  const toastElement = document.getElementById('ownerPreviewToast');
  const fixtureBusiness = Object.freeze({
    id: 'p2-preview-business',
    name: 'CLICK 360 P2 DEMO',
    type: 'restaurant',
    schemaFamily: 'p2',
    status: 'active'
  });
  const fixtureOwner = Object.freeze({
    uid: 'owner-preview-synthetic',
    name: 'Owner Preview',
    role: 'owner',
    status: 'active',
    schemaFamily: 'p2'
  });
  const product = Object.freeze({ id: 'preview-product-cafe', name: 'Café de demostración', code: 'P2-DEMO-401', price: 6.5, qty: 24, businessId: fixtureBusiness.id });
  const navigation = Object.freeze([
    ['core', 'Inicio', 'home', 'home'],
    ['core', 'Ventas', 'sell', 'shopping-cart'],
    ['core', 'Inventario', 'inventory', 'package'],
    ['core', 'Caja', 'cash', 'wallet-cards'],
    ['core', 'Reportes', 'reports', 'chart-no-axes-combined'],
    ['p2', 'Etiquetas', 'labels', 'tags'],
    ['p2', 'Trabajadores', 'workers', 'users-round'],
    ['p2', 'Restaurante', 'restaurant', 'utensils'],
    ['p2', 'Cocina', 'kitchen', 'cooking-pot'],
    ['p2', 'Logística', 'logistics', 'truck'],
    ['p2', 'Rutas', 'routes', 'route'],
    ['p2', 'Liquidaciones', 'settlements', 'scale'],
    ['p2', 'Administración', 'admin', 'shield-check']
  ]);

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
  const formatMoney = (value) => new Intl.NumberFormat('es-EC', { style:'currency', currency:'USD' }).format(Number(value) || 0);
  const icon = (name) => `<i data-lucide="${escapeHtml(name)}" aria-hidden="true"></i>`;
  const refreshIcons = (root = document) => requestAnimationFrame(() => window.lucide?.createIcons({ root, attrs:{ width:18, height:18, 'stroke-width':2 } }));
  const generatedId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function defaultState() {
    return {
      activeRoute: 'home',
      modules: { workers:true, restaurant:true, logistics:true, labels:true, admin:true },
      members: [
        ['Owner Preview', 'owner', 'active'], ['Administrador QA', 'admin', 'active'], ['Cajero QA', 'cashier', 'active'],
        ['Mesero QA', 'server', 'active'], ['Cocina QA', 'kitchen', 'active'], ['Vendedor de ruta QA', 'routeSeller', 'active'], ['Cobrador QA', 'collector', 'active']
      ].map(([name, roleId, status], index) => ({ id:`preview-member-${index + 1}`, name, email:`${roleId}.preview@example.test`, roleId, status, businessId:fixtureBusiness.id, invitedAt:'2026-07-28T10:00:00.000Z', acceptedAt:'2026-07-28T10:05:00.000Z' })),
      invitations: [],
      tables: [
        ['Mesa 01', 'free', 'Libre'], ['Mesa 02', 'occupied', 'Ocupada'], ['Mesa 03', 'preparing', 'Preparando'],
        ['Mesa 04', 'ready', 'Lista'], ['Mesa 05', 'charge', 'Por cobrar'], ['Mesa 06', 'paid', 'Pagada']
      ].map(([name, state, label], index) => ({ id:`preview-table-${index + 1}`, name, state, label, businessId:fixtureBusiness.id, amount:[0,14,21,18,12,0][index] })),
      kitchenTickets: [
        { id:'preview-ticket-kitchen', area:'Cocina', table:'Mesa 03', state:'Preparando', minutes:8, items:['2 × Café americano', '1 × Croissant sin azúcar'], action:'Marcar lista' },
        { id:'preview-ticket-bar', area:'Barra', table:'Mesa 05', state:'Lista', minutes:4, items:['1 × Jugo natural', '1 × Agua con gas'], action:'Entregar' }
      ],
      vehicles: [
        { id:'preview-vehicle-1', name:'Unidad Norte', plate:'P2-401', driver:'Conductor QA', capacity:'600 unidades', status:'Activa' },
        { id:'preview-vehicle-2', name:'Unidad Sur', plate:'P2-402', driver:'Conductor QA 2', capacity:'400 unidades', status:'Activa' }
      ],
      routes: [
        { id:'preview-route-north', name:'Ruta Norte', zone:'Zona Norte', seller:'Vendedor de ruta QA', helper:'Ayudante QA', vehicle:'P2-401', status:'En ruta', cash:125, credit:32, collection:18, returnQty:3, settlement:'Pendiente' },
        { id:'preview-route-south', name:'Ruta Sur', zone:'Zona Sur', seller:'Vendedor QA 2', helper:'Ayudante QA 2', vehicle:'P2-402', status:'Despachada', cash:89, credit:15, collection:0, returnQty:1, settlement:'Pendiente' }
      ],
      routeActivity: [{ id:'preview-load', kind:'Hoja de carga', text:'Ruta Norte · 24 productos despachados', amount:0 }, { id:'preview-sale-cash', kind:'Venta contado', text:'Cliente sintético · Café de demostración', amount:18 }, { id:'preview-sale-credit', kind:'Venta crédito', text:'Cliente sintético · saldo pendiente', amount:32 }, { id:'preview-collection', kind:'Cobranza', text:'Crédito de ruta · efectivo recibido', amount:18 }, { id:'preview-return', kind:'Retorno', text:'3 unidades vendibles · 1 dañada', amount:0 }],
      templates: [],
      profiles: [],
      selectedRouteId: 'preview-route-north',
      lastAction: 'Preview sintético listo'
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}state`) || 'null');
      if (saved?.schema === 1 && saved.businessId === fixtureBusiness.id) return { ...defaultState(), ...saved.state };
    } catch {}
    return defaultState();
  }

  let state = loadState();

  function persist() {
    try { localStorage.setItem(`${STORAGE_PREFIX}state`, JSON.stringify({ schema:1, businessId:fixtureBusiness.id, state })); } catch {}
  }

  function toast(message, type = 'ok') {
    toastElement.textContent = message;
    toastElement.className = `toast show ${type}`;
    clearTimeout(toastElement._timer);
    toastElement._timer = setTimeout(() => { toastElement.className = 'toast'; }, 3000);
  }

  function showModal(html) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="modalOverlay show"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    root.querySelectorAll('[data-close]').forEach((button) => { button.addEventListener('click', closeModal); });
    root.querySelector('.modalOverlay')?.addEventListener('pointerdown', (event) => { if (event.target === event.currentTarget) closeModal(); });
    refreshIcons(root);
  }

  function closeModal() { document.getElementById('modalRoot').replaceChildren(); }

  function sectionTitle(title, description, actions = '') {
    return `<header class="ownerPreviewTop"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="ownerPreviewBuild"><b>CLICK 360 P2 OWNER PREVIEW</b><span>${PREVIEW_VERSION} · ${escapeHtml(BUILD_SHA)}</span></div></header>${actions}`;
  }

  function previewNotice() {
    return `<section class="ownerPreviewBanner"><div><b>Preview sintético aislado</b><div class="ownerPreviewFinePrint">No inicia Firebase, no registra Service Worker, no llama Functions y no carga datos de clientes.</div></div><button class="btn" data-preview-action="reload">${icon('refresh-cw')} Recargar versión nueva</button></section>`;
  }

  function navMarkup(active, mobile = false) {
    let previousGroup = '';
    return navigation.map(([group, label, route, iconName]) => {
      const groupLabel = group === 'core' ? 'Operación base' : 'Módulos P2';
      const heading = !mobile && group !== previousGroup ? `<div class="previewNavGroup">${groupLabel}</div>` : '';
      previousGroup = group;
      return `${heading}<button type="button" data-preview-route="${route}" class="${active === route ? 'active' : ''}" title="${escapeHtml(label)}">${icon(iconName)}<span>${escapeHtml(label)}</span></button>`;
    }).join('');
  }

  function shell(content, active) {
    return `<div class="ownerPreviewShell"><aside class="ownerPreviewSide"><div class="ownerPreviewBrand"><strong>CLICK 360 P2</strong><span>OWNER PREVIEW</span><small>Negocio: ${escapeHtml(fixtureBusiness.name)}</small><small>Owner sintético · schemaFamily p2</small></div><nav class="ownerPreviewNav" aria-label="Navegación de preview">${navMarkup(active)}</nav><div class="ownerPreviewActions"><span class="ownerPreviewMeta">Cache local: ${PREVIEW_CACHE_KEY}</span><button class="btn" data-preview-action="reload">${icon('refresh-cw')} Recargar versión nueva</button></div></aside><main class="ownerPreviewMain">${content}</main><nav class="ownerPreviewMobileNav" aria-label="Navegación móvil de preview">${navMarkup(active, true)}</nav></div>`;
  }

  function metrics(cards) {
    return `<section class="ownerPreviewGrid">${cards.map(([label, value, detail]) => `<article class="card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(detail)}</span></article>`).join('')}</section>`;
  }

  function homeView() {
    return `${sectionTitle('Inicio', 'Vista integral del negocio sintético para revisión visual.')}${previewNotice()}${metrics([
      ['Módulos activos', '5', 'Workers, restaurante, logística, etiquetas, admin'], ['Equipo', `${state.members.length}/10`, 'Roles y permisos sintéticos'], ['Mesas activas', '4', 'Cocina y barra con fixtures'], ['Rutas en curso', '2', 'Carga, venta, cobranza y retorno']
    ])}<section class="ownerPreviewColumns"><section class="ownerPreviewSection"><h2>Recorrido recomendado</h2><div class="ownerPreviewRows">${[['Etiquetas','Abre el Lienzo Universal tipo Canva.','labels'],['Trabajadores','Revisa roles, invitaciones y permisos.','workers'],['Restaurante','Abre mesas, comandas y pagos.','restaurant'],['Logística','Revisa ruta, carga, cobranzas y liquidación.','logistics'],['Administración','Activa módulos solo en esta demo.','admin']].map(([name, text, target]) => `<article><span><b>${name}</b><small>${text}</small></span><button class="btn" data-preview-route="${target}">Abrir</button></article>`).join('')}</div></section><section class="ownerPreviewSection"><h2>Contrato de aislamiento</h2><div class="ownerPreviewKpiList"><article><span><b>Datos</b><small>Fixtures locales del negocio P2 DEMO.</small></span><span class="ownerPreviewPill green">Aislado</span></article><article><span><b>Cloud</b><small>Sin Firebase ni Functions en esta página.</small></span><span class="ownerPreviewPill green">0 llamadas</span></article><article><span><b>Funciones P2</b><small>Flags visibles solo en el estado de preview.</small></span><span class="ownerPreviewPill gold">Local</span></article></div></section></section>`;
  }

  function simpleOperationView(title, description, rows) {
    return `${sectionTitle(title, description)}${previewNotice()}${metrics(rows.slice(0, 4).map(([label, value, detail]) => [label, value, detail]))}<section class="ownerPreviewSection"><h2>Registro sintético</h2><div class="ownerPreviewRows">${rows.map(([label, value, detail]) => `<article><span><b>${escapeHtml(label)}</b><small>${escapeHtml(detail)}</small></span><strong>${escapeHtml(String(value))}</strong></article>`).join('')}</div></section>`;
  }

  function labelsView() {
    return `${sectionTitle('Lienzo Universal', 'Editor físico de etiquetas en milímetros, con preview y salida compartida.')}${previewNotice()}<section class="ownerPreviewSection"><div class="ownerPreviewLabelEntry"><div><h2>Diseña una etiqueta sin pasos obligatorios</h2><p>Usa papel A4, rollo o un formato personalizado. El zoom visual no cambia el PrintPlan físico.</p><div class="ownerPreviewToolbar"><button class="btn primary" data-preview-action="open-canvas">${icon('pen-tool')} Abrir Lienzo Universal</button><button class="btn" data-preview-action="advanced-print">${icon('list-checks')} Asistente avanzado</button><span class="ownerPreviewPill gold">Perfil provisional 40 × 60 mm · 2 columnas</span></div><ul class="ownerPreviewFinePrint"><li>Producto sintético: ${escapeHtml(product.name)}.</li><li>QR y código de barras se generan localmente.</li><li>Plantillas y perfiles se guardan solo bajo el namespace del preview.</li></ul></div><div class="ownerPreviewLabelMock" aria-label="Vista de etiqueta de ejemplo"><div class="mockQr"></div><div class="mockText"><b>Café demo</b><span>${formatMoney(product.price)}</span><small>${product.code}</small></div></div></div></section><section class="ownerPreviewColumns"><section class="ownerPreviewSection"><h2>Herramientas disponibles</h2><p class="ownerPreviewFinePrint">Texto, precio, nombre, QR, código de barras, imagen, mover, redimensionar, rotar, duplicar, bloquear, alinear, deshacer, rehacer y zoom.</p></section><section class="ownerPreviewSection"><h2>Calibración</h2><p class="ownerPreviewFinePrint">El perfil es provisional. El smoke físico deberá medir ancho total, gap, pitch y desplazamientos X/Y antes de certificar impresión.</p></section></section>`;
  }

  function workersView() {
    const memberCards = state.members.map((member) => `<article class="ownerPreviewMember"><header><span><b>${escapeHtml(member.name)}</b><small>${escapeHtml(member.email)}</small></span><span class="ownerPreviewPill ${member.status === 'active' ? 'green' : 'red'}">${escapeHtml(member.status)}</span></header><div><b>${escapeHtml(member.roleId)}</b><small> · ${member.businessId === fixtureBusiness.id ? 'CLICK 360 P2 DEMO' : 'Aislado'}</small></div><div class="ownerPreviewToolbar"><button class="btn" data-preview-action="member-permissions" data-member-id="${member.id}">Permisos</button><button class="btn" data-preview-action="member-toggle" data-member-id="${member.id}">${member.status === 'active' ? 'Suspender' : 'Reactivar'}</button></div></article>`).join('');
    return `${sectionTitle('Trabajadores y roles', 'Membresías sintéticas por negocio con roles iniciales P2.')}${previewNotice()}<section class="ownerPreviewSection"><div class="ownerPreviewToolbar"><button class="btn primary" data-preview-action="invite-worker">${icon('user-plus')} Invitar trabajador</button><span class="ownerPreviewPill blue">workerAccessEnabled: true solo en preview</span></div><div class="ownerPreviewMemberGrid">${memberCards}</div></section>`;
  }

  function restaurantView() {
    const cards = state.tables.map((table) => `<article class="ownerPreviewTable ${table.state}"><header><span><b>${escapeHtml(table.name)}</b><small>${escapeHtml(table.label)}</small></span><span class="ownerPreviewPill ${table.state === 'free' || table.state === 'paid' ? 'green' : 'gold'}">${escapeHtml(table.label)}</span></header><strong>${formatMoney(table.amount)}</strong><small>${table.state === 'free' ? 'Sin comanda abierta' : 'Mesero QA · comanda sintética'}</small><button class="btn ${table.state === 'free' ? '' : 'primary'}" data-preview-action="table" data-table-id="${table.id}">${table.state === 'free' ? 'Abrir mesa' : 'Abrir comanda'}</button></article>`).join('');
    return `${sectionTitle('Restaurante avanzado', 'Mesas, comandas, rondas, cocina y pagos parciales en datos sintéticos.')}${previewNotice()}${metrics([['Mesas abiertas','4','6 mesas de demostración'],['Comandas activas','3','Cocina y barra'],['Saldo por cobrar',formatMoney(47),'Pago parcial incluido'],['Tiempo de cocina','8 min','Fixture de KDS']])}<section class="ownerPreviewSection"><div class="ownerPreviewToolbar"><button class="btn" data-preview-route="kitchen">${icon('cooking-pot')} Abrir Cocina / KDS</button><button class="btn" data-preview-action="restaurant-payment">${icon('credit-card')} Simular pago parcial</button></div><div class="ownerPreviewTableGrid">${cards}</div><div id="ownerPreviewRestaurantDetail" class="ownerPreviewDetail"><b>Comanda de Mesa 03</b><p class="ownerPreviewFinePrint">2 × Café americano · 1 × Croissant · prioridad normal · área cocina.</p><div class="ownerPreviewToolbar"><button class="btn" data-preview-action="restaurant-round">Añadir ronda</button><button class="btn" data-preview-action="restaurant-split">Dividir cuenta</button><button class="btn primary" data-preview-action="restaurant-payment">Cobrar</button></div></div></section>`;
  }

  function kitchenView() {
    return `${sectionTitle('Cocina y barra', 'KDS sintético para tablet, escritorio y móvil.')}${previewNotice()}<section class="ownerPreviewKitchen">${['Cocina','Barra'].map((area) => `<section class="ownerPreviewSection"><h2>${area}</h2>${state.kitchenTickets.filter((ticket) => ticket.area === area).map((ticket) => `<article class="ownerPreviewTicket"><header><span><b>${escapeHtml(ticket.table)}</b><small>${ticket.minutes} min · ${escapeHtml(ticket.state)}</small></span><span class="ownerPreviewPill gold">${escapeHtml(ticket.state)}</span></header><ul>${ticket.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><div class="ownerPreviewToolbar"><button class="btn primary" data-preview-action="ticket" data-ticket-id="${ticket.id}">${escapeHtml(ticket.action)}</button><button class="btn" data-preview-action="kitchen-print">${icon('printer')} Comanda</button></div></article>`).join('') || '<div class="ownerPreviewEmpty">No hay pedidos en esta área.</div>'}</section>`).join('')}</section>`;
  }

  function logisticsView(routeOnly = false) {
    const selectedRoute = state.routes.find((route) => route.id === state.selectedRouteId) || state.routes[0];
    const vehicles = state.vehicles.map((vehicle) => `<article class="ownerPreviewMember"><header><span><b>${escapeHtml(vehicle.name)}</b><small>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.driver)}</small></span><span class="ownerPreviewPill green">${escapeHtml(vehicle.status)}</span></header><strong>${escapeHtml(vehicle.capacity)}</strong></article>`).join('');
    const routes = state.routes.map((route) => `<article class="ownerPreviewRoute"><header><span><b>${escapeHtml(route.name)}</b><small>${escapeHtml(route.zone)} · ${escapeHtml(route.vehicle)}</small></span><span class="ownerPreviewPill gold">${escapeHtml(route.status)}</span></header><small>${escapeHtml(route.seller)} · ${escapeHtml(route.helper)}</small><div><b>Contado ${formatMoney(route.cash)}</b><small> · crédito ${formatMoney(route.credit)} · cobranza ${formatMoney(route.collection)}</small></div><div class="ownerPreviewToolbar"><button class="btn primary" data-preview-action="route" data-route-id="${route.id}">Abrir ruta</button><button class="btn" data-preview-action="route-print">${icon('printer')} Carga</button></div></article>`).join('');
    const workspace = `<section class="ownerPreviewDetail"><h3>${escapeHtml(selectedRoute.name)} · operación de ruta</h3><div class="ownerPreviewGrid"><article class="card"><small>Hoja de carga</small><strong>24</strong><span>Productos reservados</span></article><article class="card"><small>Venta contado</small><strong>${formatMoney(selectedRoute.cash)}</strong><span>Registro sintético</span></article><article class="card"><small>Crédito</small><strong>${formatMoney(selectedRoute.credit)}</strong><span>Saldo pendiente</span></article><article class="card"><small>Retornos</small><strong>${selectedRoute.returnQty}</strong><span>Unidades por revisar</span></article></div><div class="ownerPreviewToolbar"><button class="btn" data-preview-action="route-sale">Registrar venta</button><button class="btn" data-preview-action="route-collection">Registrar cobranza</button><button class="btn" data-preview-action="route-return">Registrar retorno</button><button class="btn primary" data-preview-route="settlements">Liquidar ruta</button></div></section>`;
    return `${sectionTitle(routeOnly ? 'Rutas' : 'Logística y transporte', 'Vehículos, hojas de carga, ventas, cobranzas, retornos y liquidación.')}${previewNotice()}${routeOnly ? '' : `<section class="ownerPreviewSection"><h2>Vehículos</h2><div class="ownerPreviewMemberGrid">${vehicles}</div></section>`}<section class="ownerPreviewSection"><h2>Rutas asignadas</h2><div class="ownerPreviewRouteGrid">${routes}</div>${workspace}</section>`;
  }

  function settlementsView() {
    const rows = state.routes.map((route) => ({ route, expected: route.cash + route.collection - 4, received: route.cash + route.collection - 4, difference:0 }));
    return `${sectionTitle('Liquidaciones', 'Cierre de ruta, retornos, gastos y diferencias antes de aprobación.')}${previewNotice()}${metrics([['Liquidaciones pendientes', rows.length, 'Aprobación owner/admin'],['Efectivo esperado',formatMoney(rows.reduce((sum, row) => sum + row.expected, 0)),'Cobranza incluida'],['Diferencia',formatMoney(0),'Fixture conciliado'],['Retornos',state.routes.reduce((sum, route) => sum + route.returnQty, 0),'A validar']])}<section class="ownerPreviewSection"><h2>Cuadre por ruta</h2><div class="ownerPreviewRows">${rows.map(({ route, expected, received, difference }) => `<article><span><b>${escapeHtml(route.name)}</b><small>Ventas, cobranzas, retornos y gastos sintéticos.</small></span><span><b>${formatMoney(difference)}</b><small>Esperado ${formatMoney(expected)} · recibido ${formatMoney(received)}</small></span><button class="btn primary" data-preview-action="settle" data-route-id="${route.id}">Aprobar</button></article>`).join('')}</div></section>`;
  }

  function adminView() {
    const cards = [['workers','Trabajadores','Roles, invitaciones y permisos'],['restaurant','Restaurante','Mesas, comandas y KDS'],['logistics','Logística','Rutas, carga y liquidación'],['labels','Etiquetas','Lienzo y perfiles físicos'],['admin','Administración','Diagnóstico de preview']].map(([key, name, detail]) => `<article class="ownerPreviewModuleCard"><header><span><b>${name}</b><small>${detail}</small></span><span class="ownerPreviewPill ${state.modules[key] ? 'green' : 'red'}">${state.modules[key] ? 'Activo' : 'Apagado'}</span></header><label><span>Disponible en CLICK 360 P2 DEMO</span><input type="checkbox" data-preview-module="${key}" ${state.modules[key] ? 'checked' : ''}></label></article>`).join('');
    return `${sectionTitle('Administración modular', 'Resolución visual de módulos únicamente para el owner sintético.')}${previewNotice()}<section class="ownerPreviewSection"><div class="ownerPreviewToolbar"><button class="btn" data-preview-action="admin-diagnostic">${icon('clipboard-check')} Ver diagnóstico seguro</button><span class="ownerPreviewPill blue">Sin accountAccess ni claims reales</span></div><div class="ownerPreviewModuleGrid">${cards}</div></section><section class="ownerPreviewSection"><h2>Eventos del preview</h2><p class="ownerPreviewFinePrint">${escapeHtml(state.lastAction)}</p></section>`;
  }

  function advancedPrintModal() {
    showModal(`<div class="modalHeader"><div><h2>Asistente avanzado</h2><p>El flujo anterior queda disponible para quien prefiera una revisión guiada.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><ol class="smartPrintSteps">${['Salida','Papel','Medidas','Contenido','Cantidad','Inicio','Vista','Revisión','Imprimir'].map((item, index) => `<li><b>${index + 1}</b><span>${item}</span></li>`).join('')}</ol><div class="ownerPreviewToolbar"><button class="btn primary" id="ownerPreviewOpenCanvasFromAdvanced">Volver al Lienzo Universal</button></div>`);
    document.getElementById('ownerPreviewOpenCanvasFromAdvanced')?.addEventListener('click', () => { closeModal(); openCanvas(); });
  }

  function readImage(input, onImage) {
    const file = input?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecciona una imagen válida.', 'err');
    const reader = new FileReader();
    reader.onload = () => onImage(String(reader.result || ''));
    reader.onerror = () => toast('No se pudo leer la imagen.', 'err');
    reader.readAsDataURL(file);
  }

  function previewDocument() {
    return window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument({
      paper: { id:'preview-roll-2-40x60', mediaType:'roll-2', widthMm:40, heightMm:60, columns:2, rows:1, mediaHeightMm:60, dpi:203, gapXmm:2, orientation:'portrait' },
      quantity:2,
      startSlot:1
    });
  }

  function mediaSize(documentModel) {
    const paper = documentModel.paper;
    return {
      widthMm: paper.mediaWidthMm || paper.marginLeftMm + paper.marginRightMm + paper.columns * paper.widthMm + Math.max(0, paper.columns - 1) * paper.gapXmm,
      heightMm: paper.mediaHeightMm || paper.marginTopMm + paper.marginBottomMm + paper.rows * paper.heightMm + Math.max(0, paper.rows - 1) * (paper.pitchMm || paper.heightMm + paper.gapYmm)
    };
  }

  async function printCanvasDocument(documentModel, providerId = 'system') {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    const normalized = canvasApi.normalizeDocument(documentModel);
    const plan = canvasApi.buildPrintPlan([{ product, copies:normalized.quantity }], normalized, { startSlot:normalized.startSlot });
    if (!plan.valid || !plan.count) throw new Error(plan.errors?.[0] || 'El plan físico no es válido.');
    const pageSize = mediaSize(normalized);
    const root = document.createElement('div');
    for (const page of plan.pages) {
      const pageElement = document.createElement('section');
      pageElement.style.cssText = `position:relative;width:${pageSize.widthMm}mm;height:${pageSize.heightMm}mm;overflow:hidden;page-break-after:always;background:#fff;`;
      for (const cell of page.cells) {
        const cellElement = document.createElement('div');
        cellElement.style.cssText = `position:absolute;left:${cell.xMm}mm;top:${cell.yMm}mm;width:${normalized.paper.widthMm}mm;height:${normalized.paper.heightMm}mm;overflow:hidden;`;
        if (cell.status === 'filled') {
          const label = document.createElement('canvas');
          await canvasApi.renderLabelToCanvas(label, normalized, { product, price:formatMoney(product.price), sku:product.code, qrPayload:product.code });
          const image = document.createElement('img');
          image.src = label.toDataURL('image/png');
          image.alt = 'Etiqueta de preview';
          image.style.cssText = `width:${normalized.paper.widthMm}mm;height:${normalized.paper.heightMm}mm;display:block;`;
          cellElement.append(image);
        }
        pageElement.append(cellElement);
      }
      root.append(pageElement);
    }
    const result = await window.CLICK360_PRINTING.print(providerId, { node:root, media:'label', mediaWidthMm:pageSize.widthMm, mediaHeightMm:pageSize.heightMm, widthMm:normalized.paper.widthMm, heightMm:normalized.paper.heightMm, copiesHandled:true, filename:'CLICK360_P2_OWNER_PREVIEW.pdf' });
    state.lastAction = `Salida ${providerId} preparada con ${plan.count} etiqueta(s) sintéticas.`;
    persist();
    return result;
  }

  function openCanvas() {
    const editor = window.CLICK360_UNIVERSAL_LABEL_EDITOR;
    if (!editor) return toast('El editor del Lienzo Universal no está disponible.', 'err');
    editor.open({
      product,
      initialDocument: previewDocument(),
      initialTemplate: state.templates[0] || null,
      initialProfile: state.profiles[0] || null,
      formatPrice:formatMoney,
      productPayload:(entry) => entry.code || entry.id,
      showModal,
      closeModal,
      toast,
      readImage,
      getTemplates:() => clone(state.templates),
      getProfiles:() => clone(state.profiles),
      saveTemplate:async (name, universalDocument, templateId = '') => {
        const id = templateId || generatedId('template');
        const entry = { id, name:String(name || 'Plantilla P2').slice(0, 80), universalDocument:window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument(universalDocument), businessId:fixtureBusiness.id, preview:true };
        state.templates = [...state.templates.filter((template) => template.id !== id), entry]; persist(); toast('Plantilla guardada solo en este preview.'); return entry;
      },
      deleteTemplate:async (id) => { state.templates = state.templates.filter((template) => template.id !== id); persist(); toast('Plantilla eliminada del preview.'); },
      saveProfile:async (universalDocument, profileId = '', profileName = '') => {
        const id = profileId || generatedId('profile');
        const entry = { id, name:String(profileName || 'Perfil P2 provisional').slice(0, 80), universalPaper:window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument(universalDocument).paper, businessId:fixtureBusiness.id, status:'provisional', preview:true };
        state.profiles = [...state.profiles.filter((profile) => profile.id !== id), entry]; persist(); toast('Perfil guardado solo en este preview.'); return entry;
      },
      print:async (documentModel, providerId) => {
        try { const result = await printCanvasDocument(documentModel, providerId); toast(providerId === 'pdf' ? 'PDF sintético preparado.' : 'Diálogo de impresión preparado.'); return result; } catch (error) { toast(error.message || 'No se pudo preparar la salida.', 'err'); throw error; }
      },
      printCalibration:async (documentModel) => printCanvasDocument({ ...documentModel, quantity:2, startSlot:1 }, 'system'),
      openAdvanced:advancedPrintModal
    });
  }

  function render(route = state.activeRoute || 'home') {
    if (!navigation.some(([, , itemRoute]) => itemRoute === route)) route = 'home';
    state.activeRoute = route;
    const views = {
      home:homeView,
      sell:() => simpleOperationView('Ventas', 'Flujo visual de ventas sintéticas y separación por negocio.', [['Venta de hoy',formatMoney(182),'4 comprobantes sintéticos'],['Ticket promedio',formatMoney(14.5),'Sin facturación fiscal'],['Métodos','3','Efectivo, tarjeta, transferencia'],['Pendientes','1','Solo fixture']]),
      inventory:() => simpleOperationView('Inventario', 'Productos sintéticos, stock y etiqueta de demostración.', [['Productos','24','Catálogo sintético'],['Stock bajo','2','Revisión visual'],['Movimientos','11','Sin nube'],['Etiqueta activa','40 × 60','2 columnas provisional']]),
      cash:() => simpleOperationView('Caja', 'Apertura, movimientos y cierre de un caso de demostración.', [['Apertura',formatMoney(100),'Caja QA'],['Ingresos',formatMoney(182),'Ventas y cobranzas'],['Egresos',formatMoney(12),'Gasto de ruta'],['Diferencia',formatMoney(0),'Caso conciliado']]),
      reports:() => simpleOperationView('Reportes', 'Resumen de módulos P2 sobre fixtures, no datos comerciales.', [['Ventas',formatMoney(271),'Base + restaurante + ruta'],['Comandas','3','Estado operativo'],['Cobranzas',formatMoney(18),'Ruta Norte'],['Liquidaciones','2','Pendientes de aprobación']]),
      labels:labelsView,
      workers:workersView,
      restaurant:restaurantView,
      kitchen:kitchenView,
      logistics:() => logisticsView(false),
      routes:() => logisticsView(true),
      settlements:settlementsView,
      admin:adminView
    };
    app.innerHTML = shell((views[route] || homeView)(), route);
    bind();
    refreshIcons(app);
    if (route === 'labels') {
      // Etiquetas entra directamente al editor; el asistente queda como modo experto.
      setTimeout(() => {
        if (state.activeRoute === 'labels' && !document.getElementById('ulcStage')) openCanvas();
      }, 0);
    }
  }

  function openMemberPermissions(member) {
    showModal(`<div class="modalHeader"><div><h2>Permisos de ${escapeHtml(member.name)}</h2><p>Preview sintético, no cambia membresías reales.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><section class="ownerPreviewSection"><div class="ownerPreviewRows">${['business.read','inventory.write','sales.create','cash.read','tables.write','kitchen.update','routes.write','collections.write','members.manage'].map((permission) => `<article><span>${permission}</span><span class="ownerPreviewPill ${member.roleId === 'owner' || ['admin','cashier','server','kitchen','routeSeller','collector'].includes(member.roleId) ? 'green' : 'red'}">${member.roleId}</span></article>`).join('')}</div></section>`);
  }

  function bind() {
    document.querySelectorAll('[data-preview-route]').forEach((button) => button.addEventListener('click', () => render(button.dataset.previewRoute)));
    document.querySelectorAll('[data-preview-module]').forEach((input) => input.addEventListener('change', () => { state.modules[input.dataset.previewModule] = input.checked; state.lastAction = `Módulo ${input.dataset.previewModule} ${input.checked ? 'activado' : 'desactivado'} en el preview.`; persist(); render('admin'); }));
    document.querySelectorAll('[data-preview-action]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.previewAction;
      if (action === 'reload') {
        Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX)).forEach((key) => localStorage.removeItem(key));
        location.reload();
      }
      if (action === 'open-canvas') openCanvas();
      if (action === 'advanced-print') advancedPrintModal();
      if (action === 'invite-worker') {
        const invite = { id:generatedId('invite'), roleId:'seller', status:'pending', expiresAt:'2026-08-04T00:00:00.000Z' };
        state.invitations.push(invite); state.lastAction = `Invitación sintética ${invite.id} creada para rol seller.`; persist(); toast('Invitación sintética creada.'); render('workers');
      }
      if (action === 'member-toggle') {
        const member = state.members.find((entry) => entry.id === button.dataset.memberId); if (!member) return;
        member.status = member.status === 'active' ? 'suspended' : 'active'; state.lastAction = `Estado de ${member.roleId} actualizado dentro del preview.`; persist(); render('workers');
      }
      if (action === 'member-permissions') { const member = state.members.find((entry) => entry.id === button.dataset.memberId); if (member) openMemberPermissions(member); }
      if (action === 'table') { const table = state.tables.find((entry) => entry.id === button.dataset.tableId); if (table) { state.lastAction = `Comanda sintética abierta para ${table.name}.`; persist(); toast(`${table.name}: comanda sintética abierta.`); } }
      if (action === 'restaurant-round' || action === 'restaurant-split' || action === 'restaurant-payment') { state.lastAction = `Acción de restaurante simulada: ${action}.`; persist(); toast('Acción registrada solo en los fixtures.'); }
      if (action === 'ticket') { const ticket = state.kitchenTickets.find((entry) => entry.id === button.dataset.ticketId); if (ticket) { ticket.state = ticket.action === 'Marcar lista' ? 'Lista' : 'Entregada'; ticket.action = ticket.action === 'Marcar lista' ? 'Entregar' : 'Completada'; state.lastAction = `KDS: ${ticket.area} pasó a ${ticket.state}.`; persist(); render('kitchen'); } }
      if (action === 'kitchen-print' || action === 'route-print') { state.lastAction = 'Documento sintético preparado para impresión del sistema.'; persist(); toast('Documento sintético preparado.'); }
      if (action === 'route') { state.selectedRouteId = button.dataset.routeId; state.lastAction = `Ruta sintética ${button.dataset.routeId} abierta.`; persist(); render('logistics'); }
      if (action === 'route-sale' || action === 'route-collection' || action === 'route-return') { state.lastAction = `Operación logística simulada: ${action}.`; persist(); toast('Operación registrada solo en el fixture.'); }
      if (action === 'settle') { state.lastAction = `Liquidación sintética aprobada para ${button.dataset.routeId}.`; persist(); toast('Liquidación aprobada solo en preview.'); render('settlements'); }
      if (action === 'admin-diagnostic') showModal(`<div class="modalHeader"><div><h2>Diagnóstico seguro</h2><p>Sin UID, correo, token, datos de clientes o configuración Firebase.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><pre class="ownerPreviewFinePrint">${escapeHtml(JSON.stringify({ preview:true, version:PREVIEW_VERSION, buildSha:BUILD_SHA, business:'p2-demo', modules:state.modules, firebaseCalls:0, functionsCalls:0, serviceWorker:false }, null, 2))}</pre>`);
    }));
  }

  window.__CLICK360_OWNER_PREVIEW__ = Object.freeze({
    version: PREVIEW_VERSION,
    buildSha: BUILD_SHA,
    cacheKey: PREVIEW_CACHE_KEY,
    business: fixtureBusiness.id,
    owner: fixtureOwner.uid,
    firebaseCalls: 0,
    functionsCalls: 0,
    serviceWorkerRegistered: false,
    openCanvas,
    state:() => clone(state)
  });
  render();
})();
