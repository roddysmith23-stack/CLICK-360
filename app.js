
(() => {
  'use strict';

  const LS = 'click360_mvp_qa_final_state_v1';
  const SESSION = 'click360_mvp_qa_final_session_v1';
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const app = $('#app');
  const toastEl = $('#toast');

  let state = loadState();
  let session = loadSession();
  let route = 'home';
  let scanStream = null;
  let scanTimer = null;
  let lastScanAt = 0;

  function uid(prefix='id') { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }
  function slug(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'negocio'; }
  function today() { return new Date().toISOString().slice(0,10); }
  function nowLabel() { return new Date().toLocaleString('es-EC', { dateStyle:'short', timeStyle:'short' }); }
  function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  
  function imageThumb(product){
    if(product?.imageData) return `<img class="productImg" src="${product.imageData}" alt="${escapeHtml(product.name || 'Producto')}" loading="lazy">`;
    return `<div class="productImg emptyImg">▧</div>`;
  }
  function readImageInput(input, cb){
    const file = input?.files?.[0];
    if(!file) return cb('');
    if(!file.type.startsWith('image/')) return toast('Selecciona una imagen válida','err');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 720;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        cb(canvas.toDataURL('image/jpeg', .82));
      };
      img.onerror = () => toast('No se pudo leer la imagen','err');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
    let s = String(value ?? '').trim().replace(/\s/g,'');
    if (!s) return 0;
    s = s.replace(/[^0-9,.-]/g,'');
    const neg = s.startsWith('-');
    s = s.replace(/-/g,'');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let sep = null;
    if (lastComma >= 0 || lastDot >= 0) sep = lastComma > lastDot ? ',' : '.';
    let n;
    if (sep) {
      const parts = s.split(sep);
      const dec = (parts.pop() || '').replace(/\D/g,'').slice(0,2);
      const whole = parts.join('').replace(/\D/g,'') || '0';
      n = Number(whole + '.' + dec.padEnd(2,'0'));
    } else n = Number(s.replace(/\D/g,'') || 0);
    if (!Number.isFinite(n)) return NaN;
    return neg ? -n : Math.round(n * 100) / 100;
  }
  function fmt(value) { return `$${(Number(value)||0).toFixed(2)}`; }
  function toast(msg, type='ok') {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type}`;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.className = 'toast', 2800);
  }
  function beep(kind='ok') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        osc.type = kind === 'err' ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(kind === 'sale' ? 1040 : kind === 'err' ? 180 : 880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(kind === 'err' ? 0.11 : 0.16, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.13);
      }
    } catch {}
    try { if (navigator.vibrate) navigator.vibrate(kind === 'err' ? [50,30,50] : 35); } catch {}
  }

  function save() { localStorage.setItem(LS, JSON.stringify(state)); }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch {}
    return seed();
  }
  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; } }
  function setSession(s) { 
    session=s; 
    if(s) localStorage.setItem(SESSION, JSON.stringify(s)); 
    else localStorage.removeItem(SESSION);
  }
  window.click360AppLogout = async function() {
    setSession(null);
    if(window.click360Logout) await window.click360Logout();
    else renderLogin();
  };
  function normalizeState(s) {
    const d = seed();
    const out = Object.assign(d, s || {});
    out.users ||= d.users; out.businesses ||= d.businesses; out.products ||= []; out.sales ||= []; out.movements ||= [];
    return out;
  }
  function seed() {
    const b1 = { id:'biz_main', code:'EMPRESA-001', name:'Mi Negocio', type:'ropa', status:'activo', due:'2026-07-08' };
    return {
      version:'MVP_QA_FINAL',
      activeBusinessId:b1.id,
      users:[
        { username:'demo', password:'demo123', role:'owner', label:'Dueño', businessIds:[b1.id] },
        { username:'cajero', password:'cajero123', role:'cashier', label:'Cajero', businessIds:[b1.id] },
        { username:'inventario', password:'inventario123', role:'inventory', label:'Inventario', businessIds:[b1.id] },
        { username:'click360admin', password:'click360admin', role:'admin', label:'Admin CLICK 360', businessIds:[] }
      ],
      businesses:[b1],
      products:[],
      sales:[],
      movements:[],
      settings:{}
    };
  }

  function currentUser(){ return session ? state.users.find(u=>u.username===session.username) : null; }
  function authUser() { return window.click360User || { name: 'Sistema', role: 'owner', email: '' }; }
  function currentBusiness(){ return state.businesses.find(b=>b.id===state.activeBusinessId) || state.businesses[0]; }
  function productsForBiz(bid=currentBusiness()?.id){ return state.products.filter(p=>p.businessId===bid); }
  function salesForBiz(bid=currentBusiness()?.id){ return state.sales.filter(s=>s.businessId===bid); }
  function movementsForBiz(bid=currentBusiness()?.id){ return state.movements.filter(m=>m.businessId===bid); }
  function can(section) {
    const role = authUser().role;
    if (role === 'owner') return true;
    if (role === 'worker') return true; // Para esta iteración, los trabajadores pueden hacer todo, pero dejan rastro.
    return false;
  }
  function checkAuth(required='business') {
    if (!session) { renderLogin(); return false; }
    const u = currentUser();
    if (!u) { setSession(null); renderLogin(); return false; }
    if (required === 'admin') {
      if (u.role !== 'admin') { renderLogin('No tienes permiso para abrir admin.'); return false; }
      return true;
    }
    if (u.role === 'admin') { renderAdmin(); return false; }
    const b = currentBusiness();
    if (b && ['pausado','vencido'].includes(b.status)) { renderPaused(b); return false; }
    return true;
  }

  function businessVocabulary(type) {
    return {
      ropa: { singular:'prenda', plural:'prendas', category:'Categoría', examples:'Talla, color, colección' },
      restaurante: { singular:'producto/plato', plural:'productos/platos', category:'Categoría', examples:'Comida, bebida, combo' },
      barberia: { singular:'servicio', plural:'servicios', category:'Tipo de servicio', examples:'Corte, barba, combo' },
      ganaderia: { singular:'animal/activo', plural:'animales/activos', category:'Estado o lote', examples:'Peso, edad, vacuna' },
      ferreteria: { singular:'producto', plural:'productos', category:'Categoría', examples:'Marca, medida, proveedor' },
      otro: { singular:'producto/activo', plural:'productos/activos', category:'Categoría', examples:'Notas del negocio' }
    }[type] || { singular:'producto/activo', plural:'productos/activos', category:'Categoría', examples:'Notas' };
  }

  // -------- QR GENERATOR: real local library wrapper, no CDN --------
  const QR = (() => {
    function make(text){
      const value = String(text || '').trim().toUpperCase();
      if(!value) throw new Error('Código QR vacío');
      if(window.qrcode){
        const qr = window.qrcode(0, 'M');
        qr.addData(value);
        qr.make();
        const n = qr.getModuleCount();
        const mat = Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>qr.isDark(r,c)));
        return mat;
      }
      // Emergency fallback only. Normal build uses vendor/qrcode-generator.js.
      const size=21;
      const mat=Array.from({length:size},()=>Array(size).fill(false));
      for(let i=0;i<size;i++){mat[0][i]=mat[size-1][i]=mat[i][0]=mat[i][size-1]=true;}
      return mat;
    }
    function draw(canvas,text,size=280,margin=5){
      const mat=make(text), n=mat.length;
      canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,size,size);
      const cell=size/(n+margin*2);
      ctx.fillStyle='#000';
      for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(mat[r][c]) ctx.fillRect(Math.round((c+margin)*cell),Math.round((r+margin)*cell),Math.ceil(cell),Math.ceil(cell));
    }
    return { draw, make };
  })();

  function generateCode(name='P') {
    const base = slug(name).split('-').map(x=>x[0]).join('').slice(0,4).toUpperCase() || 'P';
    let c;
    do { c = `${base}${Math.random().toString(36).slice(2,7).toUpperCase()}`; } while(codeExists(c));
    return c;
  }
  function codeExists(code, productId=null) { return state.products.some(p => p.code.toUpperCase() === String(code).toUpperCase() && p.id !== productId); }
  function productPayload(product) {
    // QR ultra-simple for faster camera/photo decoding. The business is validated by the active inventory.
    return String(product.code || '').trim().toUpperCase();
  }
  function productDeepLink(product){
    const base = `${location.origin}${location.pathname}`;
    return `${base}?scan=${encodeURIComponent(productPayload(product))}`;
  }
  function normalizeCode(input) {
    const s = String(input||'').trim();
    if (!s) return '';
    if (s.includes('C360|')) return s.split('|').pop().trim();
    if (s.includes('CLICK360|PRODUCT|')) return s.split('|').pop().trim();
    try {
      const u = new URL(s, location.href);
      const q = u.searchParams.get('scan') || u.searchParams.get('code') || '';
      if (q) return normalizeCode(q);
      const scan = u.hash.startsWith('#scan=') ? decodeURIComponent(u.hash.slice(6)) : '';
      if (scan) return normalizeCode(scan);
    } catch {}
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  function renderLogin(message='') {
    stopScanner();
    app.innerHTML = `
      <main class="loginPage">
        <section class="loginShell" style="text-align:center;">
          <div class="loginBrand">
            <div class="logoIcon" style="margin: 0 auto;"></div>
            <div class="logoText" style="margin-top:20px;"><b>CLICK</b><span>360</span></div>
          </div>
          <div style="margin-top:30px;color:var(--gold);font-weight:bold;">
            ${escapeHtml(message || 'Validando seguridad...')}
          </div>
        </section>
      </main>`;
  }

  function renderPaused(b) {
    app.innerHTML = `<main class="pausedPage"><section class="card"><div class="logoMark" style="justify-content:center;margin-bottom:18px"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360</span></div></div><h1>Cuenta ${escapeHtml(b.status)}</h1><p>Tu cuenta está ${escapeHtml(b.status)}. Contacta a CLICK 360 para reactivar tu servicio.</p><button class="btn primary block" id="logoutPaused">Cerrar sesión</button></section></main>`;
    $('#logoutPaused').onclick=()=>window.click360AppLogout();
  }

  function shell(content, active='home') {
    const b=currentBusiness();
    const bizOptions=state.businesses.map(x=>`<option value="${x.id}" ${x.id===b?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');
    return `<div class="app"><div class="desktopLayout">
      <aside class="sidebar">
        <div class="logoMark"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360</span><small>Control total de tu negocio</small></div></div>
        <div class="field"><label>Negocio activo</label><select id="businessPickerSide">${bizOptions}</select></div>
        <nav class="sideNav">${navButtons(active, true)}</nav>
      </aside>
      <div>
        <header class="topbar">
          <div class="logoMark"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360</span><small>Control total</small></div></div>
          <select class="businessSelect" id="businessPickerTop">${bizOptions}</select>
          <button class="logoutBtn" id="logoutTop" title="Salir">↗</button>
        </header>
        <main class="main">${content}</main>
      </div>
    </div>${bottomNav(active)}<div id="modalRoot"></div><div id="printRoot" class="printSheet"></div></div>`;
  }
  function allowedRoutes(){
    const r=currentUser()?.role;
    if(r==='cashier') return ['home','sell','cash','more'];
    if(r==='inventory') return ['home','inventory','more'];
    return ['home','inventory','sell','cash','more'];
  }
  function navButtons(active, side=false) {
    const items = [
      ['home', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>', 'Inicio'],
      ['inventory', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>', 'Inventario'],
      ['sell', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>', 'Vender'],
      ['cash', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>', 'Caja'],
      ['more', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>', 'Más']
    ].filter(x=>allowedRoutes().includes(x[0]));
    return items.map(([key,ico,label])=>`<button class="${side?'btn':'navBtn'} ${active===key?'active':''}" data-route="${key}">${side?ico+' ':`<span class="navIcon">${ico}</span>`}<span>${label}</span></button>`).join('');
  }
  function bottomNav(active){ return `<nav class="bottomNav">${navButtons(active)}</nav>`; }
  function bindShell(){
    $$('[data-route]').forEach(b=>b.onclick=()=>renderApp(b.dataset.route));
    ['businessPickerTop','businessPickerSide'].forEach(id=>{ const el=$('#'+id); if(el) el.onchange=()=>{state.activeBusinessId=el.value;save();renderApp(route);}; });
    $('#logoutTop')?.addEventListener('click',()=>window.click360AppLogout());
  }
  function renderApp(r='home') {
    if(!checkAuth('business')) return;
    if(!can(r)) r='home';
    stopScanner(); route=r;
    history.replaceState(null, '', '#' + r);
    const views={home:homeView,inventory:inventoryView,sell:sellView,cash:cashView,more:moreView,reports:reportsView,settings:settingsView,workers:workersView,backup:backupView,debtors:debtorsView};
    app.innerHTML=shell((views[r]||homeView)(), r);
    bindShell(); bindView(r);
  }

  function homeView() {
    const b=currentBusiness(), products=productsForBiz(), sales=salesForBiz().filter(s=>s.date===today()), mov=movementsForBiz().filter(m=>m.date===today());
    const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
    const out=mov.filter(m=>m.kind!=='ingreso').reduce((a,m)=>a+m.amount,0);
    const low=products.filter(p=>p.qty<=3).length;
    return `<div class="pageHead"><div><h1>Hola 👋</h1><p>${escapeHtml(b.name)} · ${escapeHtml(currentUser()?.label || 'Usuario')}</p></div></div>
      <section class="grid kpis">
        <div class="card kpi gold"><div class="icon">↗</div><small>Ventas de hoy</small><strong class="goldText">${fmt(income)}</strong></div>
        <div class="card kpi"><div class="icon">▣</div><small>Caja</small><strong>${fmt(income-out)}</strong></div>
        <div class="card kpi"><div class="icon">▧</div><small>Inventario</small><strong>${products.length}</strong></div>
        <div class="card kpi"><div class="icon">⚠</div><small>Stock bajo</small><strong>${low}</strong></div>
      </section>
      <section class="split" style="margin-top:14px">
        <div class="card sectionCard"><h3>Últimas ventas</h3>${sales.slice(-3).reverse().map(s=>`<div class="movement"><span>${s.items.map(i=>escapeHtml(i.name)).join(', ')}</span><b class="pos">${fmt(s.total)}</b></div>`).join('') || '<p class="empty">Aún no hay ventas hoy.</p>'}</div>
        <div class="card sectionCard"><h3>Acciones rápidas</h3><div class="split"><button class="btn primary" onclick="window.click360Route('sell')">Vender</button><button class="btn silver" onclick="window.click360Route('inventory')">Inventario</button></div></div>
      </section>`;
  }

  function inventoryView() {
    const b=currentBusiness(), v=businessVocabulary(b.type), products=productsForBiz();
    return `<div class="pageHead"><div><h1>Inventario</h1><p>Registra, controla y genera etiquetas.</p></div><div class="toolbar"><button class="btn primary" id="newProduct">＋ Nuevo</button></div></div>
      <div class="searchBox" style="display:flex; gap:10px;">
         <input id="productSearch" placeholder="Buscar por nombre o código..." style="flex:1;" />
         <button type="button" class="iconBtn" id="openCamera" title="Escanear QR">
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
         </button>
      </div>
      <div id="cameraPanel" class="cameraPanel" style="margin-bottom:14px;"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para cámara.</div></div>
      <section id="productList" class="productList" style="margin-top:14px">${productList(products,v)}</section>`;
  }
  function productList(products,v) {
    if(!products.length) return `<div class="card empty">Aún no hay ${escapeHtml(v.plural)}. Crea el primero con Nuevo.</div>`;
    return products.map(p=>`<article class="card productCard hasImage" data-pid="${p.id}">
      ${imageThumb(p)}
      <div class="productInfo"><h3>${escapeHtml(p.name)}</h3><div class="meta"><span>${escapeHtml(p.category||'General')}</span><span class="badge">${escapeHtml(p.code)}</span><span>Stock: <b>${p.qty}</b></span><span class="badge gold">${fmt(p.price)}</span></div></div>
      <div class="actions"><button class="iconBtn gold" data-label="${p.id}" title="Etiqueta QR">▦</button><button class="iconBtn" data-edit="${p.id}" title="Editar">✎</button><button class="iconBtn danger" data-del="${p.id}" title="Borrar">🗑</button></div>
    </article>`).join('');
  }

  function sellView() {
    return `<div class="pageHead"><div><h1>Vender</h1><p>Escanea QR o ingresa el código.</p></div></div>
      <section class="sellWrap">
        <div class="card scanBox">
          <div class="scanRows">
            <div class="searchBox"><input id="sellSearch" placeholder="Buscar por nombre o código..." /></div>
            <div class="manualRow">
               <input id="manualCode" placeholder="Código manual" />
               <button type="button" class="btn silver" id="addCode" title="Agregar a carrito">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
               </button>
               <button type="button" class="iconBtn" id="openCamera" title="Escanear QR">
                 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
               </button>
            </div>
            <div id="quickProducts" class="productList"></div>
            <div id="cameraPanel" class="cameraPanel"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para cámara.</div></div>
          </div>
        </div>
        <div class="card cartPanel"><h3>Carrito</h3><div id="cartItems"><p class="empty">Vacío. Agrega productos para vender.</p></div>
          <div class="formGrid">
            <div class="field"><label>Descuento</label><input id="discount" value="0" inputmode="decimal" /></div>
            <div class="field"><label>Método</label><select id="payMethod"><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Pendiente">Pendiente</option><option value="Apartado">Apartado</option></select></div>
            <div class="field" id="receivedField" style="display:none;"><label>Efectivo Recibido</label><input id="cashReceived" inputmode="decimal" /></div>
            <div class="field" id="changeField" style="display:none;"><label>Vuelto</label><input id="cashChange" readonly style="background:#111;color:var(--gold);" /></div>
            <div class="field full"><label id="lblCustomer">Cliente (opcional)</label><input id="customer" placeholder="Ej. Juan Pérez - 0990000000" /></div>
          </div>
          <div class="cartSummary" style="margin-bottom:10px; font-size:13px; color:var(--muted); text-align:right;">
             <div id="cartSubtotalView" style="display:none; justify-content:space-between; margin-bottom:4px;"><span>Subtotal:</span> <b>$0.00</b></div>
             <div id="cartIvaView" style="display:none; justify-content:space-between;"><span>IVA:</span> <b>$0.00</b></div>
          </div>
          <div class="totalRow">
             <div><small>Total</small><strong id="cartTotal">$0.00</strong></div>
             <div style="display:flex; gap:10px;">
                <button type="button" class="btn silver" id="clearCartBtn" title="Limpiar carrito">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button type="button" class="btn primary" id="chargeBtn">Cobrar</button>
             </div>
          </div>
        </div>
      </section>`;
  }

  function cashView() {
    const mov=movementsForBiz().filter(m=>m.date===today());
    const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
    const expenses=mov.filter(m=>m.kind==='egreso').reduce((a,m)=>a+m.amount,0);
    const compras=mov.filter(m=>m.kind==='compra').reduce((a,m)=>a+m.amount,0);
    const retiros=mov.filter(m=>m.kind==='retiro').reduce((a,m)=>a+m.amount,0);
    const out=expenses+compras+retiros;
    return `<div class="pageHead"><div><h1>Caja diaria</h1><p>Ingresos, egresos y cierre del día.</p></div><button class="btn primary" id="newMove">＋ Movimiento</button></div>
      <section class="grid cashGrid"><div class="card kpi"><small>Ingresos</small><strong class="goldText">${fmt(income)}</strong></div><div class="card kpi"><small>Egresos</small><strong>${fmt(out)}</strong></div><div class="card kpi"><small>Saldo</small><strong class="goldText">${fmt(income-out)}</strong></div><div class="card kpi"><small>Gastos</small><strong>${fmt(expenses)}</strong></div><div class="card kpi"><small>Compras</small><strong>${fmt(compras)}</strong></div><div class="card kpi"><small>Retiros</small><strong>${fmt(retiros)}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Movimientos de hoy</h3><div class="movementList">${mov.slice().reverse().map(m=>`<div class="movement"><span>${escapeHtml(labelKind(m.kind))}<br><small>${escapeHtml(m.note||'')}</small><br><span style="font-size:10px;color:var(--gold);opacity:0.8;">🧑‍💻 ${escapeHtml(m.createdBy||'Sistema')}</span></span><b class="${m.kind==='ingreso'?'pos':'neg'}">${m.kind==='ingreso'?'+':'−'}${fmt(m.amount)}</b></div>`).join('') || '<p class="empty">No hay movimientos.</p>'}</div></section>
      <button class="btn silver block" style="margin-top:14px" id="closeDayBtn">Cerrar día</button>`;
  }
  function labelKind(k){ return ({ingreso:'Ingreso',egreso:'Gasto',compra:'Compra',retiro:'Retiro'})[k]||k; }

  function buildChartHtml(sales) {
     const last7Days = [];
     for(let i=6; i>=0; i--) {
       const d = new Date(); d.setDate(d.getDate() - i);
       const pad = (n) => n.toString().padStart(2, '0');
       last7Days.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
     }
     const salesByDay = {};
     last7Days.forEach(d => salesByDay[d] = 0);
     sales.filter(s=>s.status!=='cancelled').forEach(s => {
       if (salesByDay[s.date] !== undefined) {
         salesByDay[s.date] += (s.status==='layaway' ? (s.received||0) : s.total);
       }
     });
     
     const vals = last7Days.map(d => salesByDay[d]);
     const max = Math.max(...vals, 1);
     
     const width = 300;
     const height = 120;
     const padX = 20;
     const padY = 25;
     const chartW = width - padX * 2;
     const chartH = height - padY * 1.5;
     
     const points = vals.map((val, i) => {
         const x = padX + (i / 6) * chartW;
         const y = padY + chartH - ((val / max) * chartH);
         return {x, y, val, d: last7Days[i]};
     });
     
     let pathD = `M ${points[0].x} ${points[0].y}`;
     for(let i=0; i<points.length - 1; i++) {
         const p0 = points[i];
         const p1 = points[i+1];
         const cp1x = p0.x + (p1.x - p0.x) / 2;
         const cp2x = cp1x;
         pathD += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`;
     }
     
     const fillPathD = pathD + ` L ${points[points.length-1].x} ${height} L ${points[0].x} ${height} Z`;

     const circlesHtml = points.map(p => `
       <g class="chart-point-group" transform="translate(${p.x}, ${p.y})">
         <circle cx="0" cy="0" r="4" fill="var(--gold)" stroke="#111" stroke-width="2" />
         <!-- hitbox invisible -->
         <rect x="-15" y="-20" width="30" height="40" fill="transparent" style="cursor:pointer;" />
         <g class="chart-tooltip" style="opacity:0; pointer-events:none; transition:0.2s;">
            <rect x="-25" y="-32" width="50" height="20" rx="4" fill="#222" stroke="var(--gold)" stroke-width="1"/>
            <text x="0" y="-18" fill="#fff" font-size="9" text-anchor="middle" font-family="monospace">${fmt(p.val)}</text>
         </g>
       </g>
     `).join('');
     
     const daysHtml = points.map(p => `
       <text x="${p.x}" y="${height - 4}" fill="var(--muted)" font-size="9" text-anchor="middle">${p.d.slice(-2)}</text>
     `).join('');

     return `
       <div style="position:relative; width:100%; overflow:hidden; background:rgba(255,255,255,0.02); border-radius:12px; border: 1px solid var(--line); margin-bottom:8px;">
         <style>
           .chart-point-group:hover .chart-tooltip { opacity: 1 !important; transform: translateY(-4px); }
           .chart-point-group:active .chart-tooltip { opacity: 1 !important; transform: translateY(-4px); }
         </style>
         <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; display:block; overflow:visible;">
            <defs>
              <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.3" />
                <stop offset="100%" stop-color="var(--gold)" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <path d="${fillPathD}" fill="url(#curveGradient)" />
            <path d="${pathD}" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="${padX}" y1="${padY}" x2="${width-padX}" y2="${padY}" stroke="var(--line)" stroke-dasharray="2 4" />
            <line x1="${padX}" y1="${padY + chartH/2}" x2="${width-padX}" y2="${padY + chartH/2}" stroke="var(--line)" stroke-dasharray="2 4" />
            ${daysHtml}
            ${circlesHtml}
         </svg>
       </div>
       <div style="text-align:center; font-size:12px; color:var(--muted);">Curva de Crecimiento - Últimos 7 Días</div>
     `;
  }

  function reportsView() {
    const sales=salesForBiz(), tickets=sales.length;
    // Calculate total taking into account statuses
    const total=sales.filter(s=>s.status==='paid'||s.status==='layaway').reduce((a,s)=>a+(s.status==='layaway' ? (s.received||0) : s.total),0);
    const counts={}; sales.filter(s=>s.status!=='cancelled').forEach(s=>s.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return `<div class="pageHead"><div><h1>Reportes</h1><p>Resumen general de tu negocio.</p></div><button class="btn silver" onclick="window.printReports()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Imprimir
      </button></div>
      <section class="grid cashGrid"><div class="card kpi"><small>Ingreso Ventas</small><strong class="goldText">${fmt(total)}</strong></div><div class="card kpi"><small>Tickets</small><strong>${tickets}</strong></div><div class="card kpi"><small>Promedio</small><strong>${fmt(tickets?total/tickets:0)}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Crecimiento</h3>${buildChartHtml(sales)}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Más vendidos</h3>${top.map(([n,c])=>`<div class="movement"><span>${escapeHtml(n)}</span><b class="goldText">${c}</b></div>`).join('') || '<p class="empty">Sin ventas.</p>'}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Historial</h3>
        ${sales.slice().reverse().map(s=>`
        <div class="movement" style="flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; width:100%;">
             <span>${escapeHtml(s.when)}<br>
               <small>${s.items.length} items · ${escapeHtml(s.method)} ${s.customer?'· '+escapeHtml(s.customer):''}</small><br>
               <span class="badge ${s.status==='cancelled'?'danger':'gold'}">${s.status==='cancelled'?'Anulada':s.status==='pending_payment'?'Pendiente':s.status==='layaway'?'Apartado':'Pagada'}</span>
               <br><small style="font-size:10px;color:var(--gold);">🧑‍💻 ${escapeHtml(s.createdBy||'Sistema')}</small>
             </span>
             <b class="${s.status==='cancelled'?'neg':'goldText'}">${fmt(s.total)}</b>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; width:100%; flex-wrap:wrap; margin-top:6px;">
            <button class="btn silver" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.printReceipt('${s.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Ticket
            </button>
            ${s.status!=='cancelled' ? `<button class="btn danger" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.cancelSale('${s.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Anular
            </button>` : ''}
          </div>
        </div>`).join('') || '<p class="empty">Sin ventas.</p>'}
      </section>`;
  }

  function debtorsView() {
    const pendings = salesForBiz().filter(s=>s.status==='layaway' || s.status==='pending_payment');
    const totalPending = pendings.reduce((a,s)=>a+(s.balance||0),0);
    return `<div class="pageHead"><div><h1>Por Cobrar</h1><p>Apartados y deudas pendientes.</p></div></div>
      <section class="grid cashGrid"><div class="card kpi"><small>Saldo en la calle</small><strong class="goldText">${fmt(totalPending)}</strong></div><div class="card kpi"><small>Cuentas activas</small><strong>${pendings.length}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Listado de Pendientes</h3>
        ${pendings.slice().reverse().map(s=>`
        <div class="movement" style="flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; width:100%;">
             <span>${escapeHtml(s.customer || 'Cliente sin nombre')} <br>
               <small>${escapeHtml(s.when)} · ${Math.floor((new Date()-new Date(s.date))/(1000*60*60*24))} días transcurridos</small><br>
               <span class="badge ${s.status==='layaway'?'gold':'danger'}">${s.status==='layaway'?'Apartado':'Pendiente'}</span>
             </span>
             <div style="text-align:right;">
                <b class="neg">${fmt(s.balance)}</b><br>
                <small>de ${fmt(s.total)}</small>
             </div>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; width:100%; flex-wrap:wrap; margin-top:6px;">
            <button class="btn silver" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.printReceipt('${s.id}')">
               Ticket
            </button>
            <button class="btn primary" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.payLayaway('${s.id}')">
               Abonar
            </button>
          </div>
        </div>`).join('') || '<p class="empty">No hay apartados ni deudas pendientes.</p>'}
      </section>`;
  }

  function moreView(){
    return `<div class="pageHead"><div><h1>Más</h1></div></div><section class="moreList">
      <button class="card bigRow" data-more="reports"><span>▥ Reportes</span><b>›</b></button>
      <button class="card bigRow" data-more="backup"><span>☁ Respaldo y nube</span><b>›</b></button>
      <button class="card bigRow" data-more="workers"><span>👥 Trabajadores</span><b>›</b></button>
      <button class="card bigRow" data-more="settings"><span>⚙ Ajustes</span><b>›</b></button>
      <button class="btn block" id="logoutMore">Cerrar sesión</button>
    </section>`;
  }
  function backupView(){
    return `<div class="pageHead"><div><h1>Nube y Respaldo</h1><p>Sincronización y reportes contables.</p></div></div>
      <section class="card sectionCard">
        <h3>Nube CLICK 360</h3>
        <p class="cloudStatus" style="margin-bottom:10px; color:var(--gold);">★ Sincronización en la nube Activa.</p>
        <p class="cloudStatus">Tus datos se guardan y protegen en tiempo real. Abre tu cuenta en cualquier dispositivo con tu correo y tendrás la misma información.</p>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Reporte Contable General</h3>
        <p class="cloudStatus">Descarga todo el historial de ventas y movimientos de caja en Excel (CSV).</p>
        <button type="button" class="btn primary block" id="exportCsvBtn">Descargar Historial (CSV)</button>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Base de Datos (Avanzado)</h3><p class="cloudStatus">Archivo interno para restaurar sistema.</p>
        <div class="split"><button type="button" class="btn silver" id="backupBtn">Bajar DB</button><label class="btn silver"><input type="file" id="restoreFile" accept="application/json" hidden/>Subir DB</label></div>
      </section>`;
  }
  function workersView(){
    return `<div class="pageHead"><div><h1>Trabajadores</h1><p>Administra los accesos a tu negocio.</p></div></div>
      <section class="card sectionCard">
         <h3>Invitar Trabajador</h3>
         <div style="display:flex; gap:10px; margin-top:8px;">
            <input id="workerEmail" type="email" placeholder="correo@gmail.com" style="flex:1;">
            <button class="btn primary" id="inviteWorkerBtn" type="button">Invitar</button>
         </div>
         <div id="inviteLinkBox" style="display:none; margin-top:14px; background:rgba(55,213,126,0.1); border:1px solid rgba(55,213,126,0.3); padding:10px; border-radius:8px;">
            <small style="color:var(--green); display:block; margin-bottom:6px;">Invitación creada. Envía este enlace a tu trabajador:</small>
            <input type="text" id="inviteLinkVal" readonly style="width:100%; font-size:12px; margin-bottom:8px; background:#000; border:1px solid #444; color:#fff; padding:6px; border-radius:4px;">
            <button class="btn silver block" id="copyInviteLinkBtn" type="button">Copiar Enlace</button>
         </div>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
         <h3>Trabajadores Activos</h3>
         <div id="workersList"><p class="empty">Cargando...</p></div>
      </section>`;
  }
  function settingsView(){
    const b=currentBusiness();
    const iva = state.settings?.iva || 0;
    const ruc = state.settings?.ruc || '';
    const phone = state.settings?.phone || '';
    const logoUrl = state.settings?.logoUrl || '';

    return `<div class="pageHead"><div><h1>Ajustes</h1><p>Configura tu empresa.</p></div></div>
      <section class="card sectionCard">
        <h3>Datos del Negocio</h3>
        <div class="field" style="display:flex; flex-direction:column; align-items:center;">
          <div style="width:80px; height:80px; border-radius:50%; background:#222; border:1px solid #444; overflow:hidden; margin-bottom:10px; display:flex; justify-content:center; align-items:center;">
             ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" style="width:100%; height:100%; object-fit:cover;">` : `<svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`}
          </div>
          <label class="btn silver" style="font-size:12px; padding:4px 8px;">
            Cambiar Logo
            <input type="file" id="bizLogoUpload" accept="image/*" hidden>
          </label>
        </div>
        <div class="field"><label>Nombre del Negocio</label><input id="bizName" value="${escapeHtml(b.name)}"></div>
        <div class="field"><label>RUC o Identificación</label><input id="bizRuc" value="${escapeHtml(ruc)}" placeholder="1234567890001"></div>
        <div class="field"><label>Teléfono</label><input id="bizPhone" type="tel" value="${escapeHtml(phone)}" placeholder="+593 999999999"></div>
        <div class="field"><label>¿Cuál es tu negocio?</label><select id="bizType">${typeOptions(b.type)}</select></div>
        <div class="field"><label>IVA Global (%)</label><input type="number" inputmode="numeric" id="bizIva" value="${iva}" placeholder="0 para desactivar"></div>
        <button type="button" class="btn primary block" id="saveBiz">Guardar cambios</button>
      </section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Agregar otro negocio</h3><div class="field"><label>Nombre</label><input id="newBizName"></div><div class="field"><label>Tipo</label><select id="newBizType">${typeOptions('otro')}</select></div><button type="button" class="btn silver block" id="createBiz">Crear negocio</button></section>`;
  }
  function typeOptions(selected){ return [['ropa','Ropa'],['restaurante','Restaurante'],['barberia','Barbería'],['ganaderia','Ganadería'],['ferreteria','Ferretería'],['otro','Otro']].map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join(''); }

  function bindView(r){
    if(r==='inventory') bindInventory();
    if(r==='sell') bindSell();
    if(r==='cash') bindCash();
    if(r==='more') bindMore();
    if(r==='backup') bindBackup();
    if(r==='settings') bindSettings();
    if(r==='workers') bindWorkers();
  }
  function bindInventory(){
    $('#newProduct').onclick=()=>openProductModal();
    $('#productSearch').oninput=()=>{ const q=$('#productSearch').value.toLowerCase(); const p=productsForBiz().filter(x=>x.name.toLowerCase().includes(q)||x.code.toLowerCase().includes(q)); $('#productList').innerHTML=productList(p,businessVocabulary(currentBusiness().type)); bindInventoryActions(); };
    if ($('#openCamera')) {
       $('#openCamera').onclick=()=>startScanner((code) => {
          $('#productSearch').value = code;
          $('#productSearch').dispatchEvent(new Event('input'));
          stopScanner();
          $('#cameraPanel').classList.remove('show');
          toast('Buscando: ' + code);
       });
    }
    bindInventoryActions();
  }
  function bindInventoryActions(){
    $$('[data-edit]').forEach(b=>b.onclick=()=>openProductModal(state.products.find(p=>p.id===b.dataset.edit)));
    $$('[data-del]').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.del));
    $$('[data-label]').forEach(b=>b.onclick=()=>openLabelModal(state.products.find(p=>p.id===b.dataset.label)));
  }
  function openProductModal(product=null){
    const b=currentBusiness(), v=businessVocabulary(b.type);
    const p=product || {id:null,code:'',category:'',name:'',qty:0,cost:0,price:0,notes:'',imageData:''};
    showModal(`<div class="modalHeader"><h2>${product?'Editar':'Nuevo'} ${escapeHtml(v.singular)}</h2><button class="closeBtn" data-close>×</button></div>
      <form id="productForm" class="formGrid">
        <div class="field full productImageField">
          <label>Imagen del producto (opcional)</label>
          <div class="imagePicker">
            <div id="imagePreview">${p.imageData ? `<img src="${p.imageData}" alt="Imagen del producto">` : `<span>Sin imagen</span>`}</div>
            <div style="display:flex; gap:8px;">
               <label class="btn silver"><input type="file" id="pImageCam" accept="image/*" capture="environment" hidden>Tomar foto</label>
               <label class="btn silver"><input type="file" id="pImageGal" accept="image/*" hidden>Galería</label>
            </div>
            ${p.imageData ? '<button type="button" class="btn" id="removeImage">Quitar imagen</button>' : ''}
          </div>
        </div>
        <div class="field"><label>Código</label><input id="pCode" value="${escapeHtml(p.code)}" placeholder="Auto si vacío"></div>
        <div class="field"><label>${escapeHtml(v.category)}</label><input id="pCat" value="${escapeHtml(p.category)}" placeholder="${escapeHtml(v.examples)}"></div>
        <div class="field full"><label>Nombre</label><input id="pName" required value="${escapeHtml(p.name)}"></div>
        <div class="field"><label>Cantidad</label><input id="pQty" inputmode="numeric" value="${p.qty}"></div>
        <div class="field"><label>Costo</label><input id="pCost" inputmode="decimal" value="${String(p.cost||0).replace('.',',')}"></div>
        <div class="field"><label>Precio</label><input id="pPrice" inputmode="decimal" value="${String(p.price||0).replace('.',',')}"></div>
        <div class="field full"><label>Notas</label><textarea id="pNotes">${escapeHtml(p.notes||'')}</textarea></div>
        <button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button>
      </form>`);
    let imageData = p.imageData || '';
    const imgHandler = e => readImageInput(e.target, data => {
      imageData = data;
      $('#imagePreview').innerHTML = data ? `<img src="${data}" alt="Imagen del producto">` : '<span>Sin imagen</span>';
    });
    $('#pImageCam').onchange = imgHandler;
    $('#pImageGal').onchange = imgHandler;
    $('#removeImage')?.addEventListener('click',()=>{ imageData=''; $('#imagePreview').innerHTML='<span>Sin imagen</span>'; });
    $('#productForm').onsubmit=e=>{
      e.preventDefault();
      const name=$('#pName').value.trim();
      const qty=parseInt($('#pQty').value||'0',10);
      const cost=parseMoney($('#pCost').value);
      const price=parseMoney($('#pPrice').value);
      let code=($('#pCode').value.trim() || generateCode(name)).toUpperCase();
      if(!name) return toast('Falta el nombre','err');
      if(!Number.isFinite(qty)||qty<0) return toast('Cantidad inválida','err');
      if(!Number.isFinite(cost)||cost<0) return toast('Costo inválido','err');
      if(!Number.isFinite(price)||price<0) return toast('Precio inválido','err');
      if(codeExists(code, product?.id)) return toast('Ese código ya existe','err');
      if(product) Object.assign(product,{code,category:$('#pCat').value.trim(),name,qty,cost,price,notes:$('#pNotes').value.trim(),imageData, updatedBy: authUser().name});
      else state.products.push({id:uid('prod'),businessId:b.id,code,category:$('#pCat').value.trim(),name,qty,cost,price,notes:$('#pNotes').value.trim(),imageData,createdAt:new Date().toISOString(), createdBy: authUser().name});
      save(); closeModal(); renderApp('inventory'); toast(product?'Actualizado':'Producto creado');
    };
  }
  function deleteProduct(id){ if(confirm('¿Borrar este registro?')){ const p=state.products.find(x=>x.id===id); if(p) { state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),kind:'egreso',amount:0,note:`Eliminó producto: ${p.name}`, createdBy: authUser().name}); } state.products=state.products.filter(x=>x.id!==id); save(); renderApp('inventory'); toast('Eliminado'); } }

  function bindSell(){
    let cart=[];
    let currentIva = state.settings?.iva || 0;
    
    const renderCart=()=>{
      const subtotal=cart.reduce((a,i)=>a+i.price*i.qty,0), disc=parseMoney($('#discount')?.value||0);
      let base = Math.max(0, subtotal - (Number.isFinite(disc)?disc:0));
      let ivaAmount = 0;
      if (currentIva > 0) {
         ivaAmount = base * (currentIva / 100);
      }
      const total = base + ivaAmount;
      
      $('#cartTotal').textContent=fmt(total);
      
      const subView = $('#cartSubtotalView'), ivaView = $('#cartIvaView');
      if (currentIva > 0) {
         subView.style.display = 'flex'; ivaView.style.display = 'flex';
         subView.querySelector('b').textContent = fmt(base);
         ivaView.querySelector('b').textContent = fmt(ivaAmount);
      } else {
         subView.style.display = 'none'; ivaView.style.display = 'none';
      }

      $('#cartItems').innerHTML=cart.length?cart.map(i=>`<div class="cartItem cartWithImage">${i.imageData ? `<img class="productImg small" src="${i.imageData}" alt="${escapeHtml(i.name)}">` : '<div class="productImg small emptyImg">▧</div>'}<div><b>${escapeHtml(i.name)}</b><br><small>${fmt(i.price)} /u · ${escapeHtml(i.code)}</small></div><div class="qtyControls"><button type="button" data-minus="${i.id}">−</button><b>${i.qty}</b><button type="button" data-plus="${i.id}">＋</button><button type="button" class="iconBtn danger" data-remove="${i.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`).join(''):'<p class="empty">Vacío. Agrega productos para vender.</p>';
      $$('[data-minus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.minus); if(it.qty>1)it.qty--; else cart=cart.filter(x=>x.id!==it.id); renderCart();});
      $$('[data-plus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.plus); const p=state.products.find(p=>p.id===it.id); it.qty++; renderCart();});
      $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.remove); renderCart();});
      
      const method = $('#payMethod').value;
      const recF = $('#receivedField'), chgF = $('#changeField'), lblCustomer = $('#lblCustomer');
      
      if (method === 'Apartado' || method === 'Pendiente') {
        lblCustomer.innerHTML = 'Nombre y Teléfono del Cliente <b>*Obligatorio</b>';
      } else {
        lblCustomer.textContent = 'Cliente (opcional)';
      }

      if (method === 'Efectivo') {
        recF.style.display = 'grid'; chgF.style.display = 'grid';
        const rec = parseMoney($('#cashReceived').value);
        if(Number.isFinite(rec) && rec >= total) {
           $('#cashChange').value = fmt(rec - total);
        } else {
           $('#cashChange').value = '$0.00';
        }
      } else if(method === 'Apartado') {
        recF.style.display = 'grid'; chgF.style.display = 'grid';
        $('#receivedField label').textContent = 'Abono Inicial';
        $('#changeField label').textContent = 'Saldo Pendiente';
        const rec = parseMoney($('#cashReceived').value);
        if(Number.isFinite(rec)) {
           $('#cashChange').value = fmt(Math.max(0, total - rec));
        } else {
           $('#cashChange').value = fmt(total);
        }
      } else {
        recF.style.display = 'none'; chgF.style.display = 'none';
        $('#receivedField label').textContent = 'Efectivo Recibido';
        $('#changeField label').textContent = 'Vuelto';
      }
    };
    
    $('#payMethod').onchange = renderCart;
    $('#cashReceived').oninput = renderCart;

    const addProduct=(input)=>{
      const code=normalizeCode(input).toUpperCase().trim();
      let p=productsForBiz().find(x=>normalizeCode(x.code)===code);
      if(!p){
        const possible = String(input||'').toUpperCase().match(/[A-Z0-9_-]{3,17}/g) || [];
        p = productsForBiz().find(x=>possible.includes(normalizeCode(x.code)));
      }
      if(!p){ beep('err'); return toast(`Producto no encontrado: ${code || 'sin código'}`,'err'); }
      if(p.qty<=0){ beep('err'); return toast('Sin stock disponible','err'); }
      const it=cart.find(x=>x.id===p.id);
      if(it){ if(it.qty>=p.qty){ beep('err'); return toast('No hay más stock','err'); } it.qty++; }
      else cart.push({id:p.id,name:p.name,price:p.price,qty:1,code:p.code,imageData:p.imageData||''});
      renderCart(); beep(); toast(`${p.name} agregado`);
    };

    if($('#clearCartBtn')) {
       $('#clearCartBtn').onclick = () => {
          if(!cart.length) return;
          if(confirm('¿Limpiar todo el carrito?')) {
             cart = [];
             $('#discount').value = '0';
             $('#cashReceived').value = '';
             $('#customer').value = '';
             renderCart();
             toast('Carrito limpio');
          }
       };
    }

    $('#addCode').onclick=()=>{addProduct($('#manualCode').value); $('#manualCode').value='';};
    $('#manualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addCode').click();}});
    $('#sellSearch').oninput=()=>{ const q=$('#sellSearch').value.toLowerCase(); const list=productsForBiz().filter(p=>p.name.toLowerCase().includes(q)||p.code.toLowerCase().includes(q)).slice(0,8); $('#quickProducts').innerHTML=list.map(p=>`<button class="card bigRow quickProduct" data-quick="${p.code}">${imageThumb(p)}<span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.code)} · ${p.qty} disp.</small></span><b>${fmt(p.price)}</b></button>`).join(''); $$('[data-quick]').forEach(b=>b.onclick=()=>addProduct(b.dataset.quick)); };
    $('#discount').oninput=renderCart;
    $('#openCamera').onclick=()=>startScanner(addProduct);
    $('#chargeBtn').onclick=()=>{
      if(!cart.length){ beep('err'); return toast('El carrito está vacío','err'); }
      const disc=parseMoney($('#discount').value);
      if(!Number.isFinite(disc)||disc<0){ beep('err'); return toast('Descuento inválido','err'); }
      const subtotal=cart.reduce((a,i)=>a+i.price*i.qty,0);
      if(disc>subtotal){ beep('err'); return toast('El descuento supera el subtotal','err'); }
      
      let base = Math.max(0, subtotal - disc);
      let ivaAmount = 0;
      if (currentIva > 0) ivaAmount = base * (currentIva / 100);
      const total = base + ivaAmount;

      for(const i of cart){ const p=state.products.find(p=>p.id===i.id); if(!p||p.qty<i.qty){ beep('err'); return toast(`Stock insuficiente: ${i.name}`,'err'); } }
      
      const method = $('#payMethod').value;
      const rec = parseMoney($('#cashReceived').value);
      let received = 0; let change = 0; let balance = 0;
      let status = "paid";

      const customerName = $('#customer').value.trim();
      if ((method === 'Apartado' || method === 'Pendiente') && !customerName) {
         beep('err'); return toast('Debe ingresar el Nombre y Teléfono del Cliente para cuentas por cobrar','err');
      }

      if(method === 'Efectivo') {
         if(!Number.isFinite(rec) || rec < total) { beep('err'); return toast('Efectivo recibido es menor al total','err'); }
         received = rec; change = rec - total;
      } else if (method === 'Apartado') {
         if(!Number.isFinite(rec) || rec < 0) { beep('err'); return toast('Monto de abono inválido','err'); }
         received = rec; balance = total - rec; status = 'layaway';
      } else if (method === 'Pendiente') {
         status = 'pending_payment';
      } else {
         received = total;
      }

      const sale={id:uid('sale'),businessId:currentBusiness().id,date:today(),when:nowLabel(),items:cart.map(i=>({...i})),subtotal:base,iva:ivaAmount,discount:disc,total,method,customer:$('#customer').value.trim(),user:session.username, status, received, change, balance, createdBy: authUser().name};
      state.sales.push(sale);
      cart.forEach(i=>{ const p=state.products.find(p=>p.id===i.id); p.qty-=i.qty; });
      
      // Registramos movimiento de caja real (para ingresos y abonos)
      let movAmount = (method === 'Apartado') ? received : (method === 'Pendiente' ? 0 : total);
      if(movAmount > 0) {
        state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'ingreso',amount:movAmount,note:`Venta ${sale.method}`,user:session.username, saleId: sale.id, createdBy: authUser().name});
      }
      
      save(); cart=[]; renderCart(); $('#cashReceived').value=''; beep('sale'); toast(`Venta registrada · ${fmt(total)}`);
    };
  }


  function decodeLocalC360QR(imageData){
    const w=imageData.width,h=imageData.height,d=imageData.data;
    if(!w||!h||w<80||h<80) return null;
    const gray=new Uint8Array(w*h);
    let sum=0, min=255, max=0;
    for(let i=0,p=0;i<d.length;i+=4,p++){
      const g=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;
      gray[p]=g; sum+=g; if(g<min)min=g; if(g>max)max=g;
    }
    const threshold=(sum/(w*h))*0.85 + (min+max)*0.075;
    const black=(x,y)=>gray[y*w+x] < threshold;

    function ratioOK(r){
      const t=r.reduce((a,b)=>a+b,0); if(t<14) return false;
      const m=t/7;
      return Math.abs(r[0]-m)<m*.95 && Math.abs(r[1]-m)<m*.95 && Math.abs(r[2]-3*m)<3*m*.65 && Math.abs(r[3]-m)<m*.95 && Math.abs(r[4]-m)<m*.95;
    }
    const cands=[];
    const step=Math.max(1,Math.floor(h/240));
    for(let y=0;y<h;y+=step){
      let runs=[], colors=[], x=0, cur=black(0,y), len=0, start=0;
      for(x=0;x<w;x++){
        const b=black(x,y);
        if(b===cur) len++;
        else { runs.push(len); colors.push(cur); cur=b; len=1; }
      }
      runs.push(len); colors.push(cur);
      let pos=0;
      for(let i=0;i<runs.length-4;i++){
        const seq=runs.slice(i,i+5), cols=colors.slice(i,i+5);
        if(cols[0]&& !cols[1]&&cols[2]&&!cols[3]&&cols[4] && ratioOK(seq)){
          const total=seq.reduce((a,b)=>a+b,0);
          const cx=pos+seq[0]+seq[1]+seq[2]/2;
          const module=total/7;
          // vertical cross-check
          const ix=Math.max(0,Math.min(w-1,Math.round(cx)));
          let up=0,down=0;
          for(let yy=y;yy>=0 && black(ix,yy);yy--) up++;
          for(let yy=y+1;yy<h && black(ix,yy);yy++) down++;
          const centerRun=up+down;
          if(centerRun>module*1.5 && centerRun<module*4.8) cands.push({x:cx,y,module});
        }
        pos+=runs[i];
      }
    }
    if(cands.length<3) return null;
    const clusters=[];
    for(const c of cands){
      let found=null;
      for(const cl of clusters){
        const dx=cl.x/cl.n-c.x, dy=cl.y/cl.n-c.y;
        if(Math.hypot(dx,dy)<Math.max(8,c.module*3)){found=cl;break;}
      }
      if(found){found.x+=c.x; found.y+=c.y; found.module+=c.module; found.n++;}
      else clusters.push({x:c.x,y:c.y,module:c.module,n:1});
    }
    const pts=clusters.filter(c=>c.n>=2).map(c=>({x:c.x/c.n,y:c.y/c.n,module:c.module/c.n,n:c.n})).sort((a,b)=>b.n-a.n).slice(0,6);
    if(pts.length<3) return null;
    let best=null, bestArea=0;
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)for(let k=j+1;k<pts.length;k++){
      const a=pts[i],b=pts[j],c=pts[k];
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      if(area>bestArea){bestArea=area;best=[a,b,c];}
    }
    if(!best) return null;
    let [p0,p1,p2]=best;
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const d01=dist(p0,p1), d02=dist(p0,p2), d12=dist(p1,p2);
    let tl,tr,bl;
    if(d12>=d01 && d12>=d02){ tl=p0; tr=p1; bl=p2; }
    else if(d02>=d01 && d02>=d12){ tl=p1; tr=p0; bl=p2; }
    else { tl=p2; tr=p0; bl=p1; }
    const cross=(tr.x-tl.x)*(bl.y-tl.y)-(tr.y-tl.y)*(bl.x-tl.x);
    if(cross<0){ const tmp=tr; tr=bl; bl=tmp; }
    const vtr={x:tr.x-tl.x,y:tr.y-tl.y}, vbl={x:bl.x-tl.x,y:bl.y-tl.y};
    const distTR=Math.hypot(vtr.x,vtr.y), distBL=Math.hypot(vbl.x,vbl.y);
    if(distTR<40||distBL<40) return null;
    const size=29;
    const sample=(r,c)=>{
      const u=(c-3.5)/22, v=(r-3.5)/22;
      const x=Math.round(tl.x+vtr.x*u+vbl.x*v);
      const y=Math.round(tl.y+vtr.y*u+vbl.y*v);
      if(x<0||y<0||x>=w||y>=h) return false;
      let cnt=0,tot=0;
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
        const sx=x+xx, sy=y+yy;
        if(sx>=0&&sy>=0&&sx<w&&sy<h){tot++; if(black(sx,sy))cnt++;}
      }
      return cnt>tot/2;
    };
    const reserved=Array.from({length:size},()=>Array(size).fill(false));
    function reserveFinder(r,c){
      for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){
        const rr=r+y, cc=c+x;
        if(rr>=0&&cc>=0&&rr<size&&cc<size) reserved[rr][cc]=true;
      }
    }
    reserveFinder(0,0); reserveFinder(0,size-7); reserveFinder(size-7,0);
    for(let i=8;i<size-8;i++){reserved[6][i]=true;reserved[i][6]=true;}
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++) reserved[22+y][22+x]=true;
    for(let i=0;i<9;i++){ if(i!==6){reserved[8][i]=true;reserved[i][8]=true;} }
    for(let i=0;i<8;i++){reserved[8][size-1-i]=true;reserved[size-1-i][8]=true;}
    const bits=[];
    let upward=true;
    for(let right=size-1;right>=1;right-=2){
      if(right===6) right--;
      for(let vert=0;vert<size;vert++){
        const r=upward?size-1-vert:vert;
        for(let j=0;j<2;j++){
          const c=right-j;
          if(reserved[r][c]) continue;
          let bit=sample(r,c);
          if(((r+c)&1)===0) bit=!bit; // mask 0
          bits.push(bit?1:0);
        }
      }
      upward=!upward;
    }
    const read=(pos,len)=>{let v=0;for(let i=0;i<len;i++)v=(v<<1)|(bits[pos+i]||0);return v;};
    if(read(0,4)!==4) return null;
    const len=read(4,8);
    if(len<=0||len>80) return null;
    const bytes=[];
    let pos=12;
    for(let i=0;i<len;i++){ bytes.push(read(pos,8)); pos+=8; }
    let text;
    try{text=new TextDecoder().decode(new Uint8Array(bytes));}catch{return null;}
    return text ? text : null;
  }

  let currentFacingMode = 'environment';
  async function startScanner(onCode, toggleMode=false){
    if(toggleMode) currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    const panel=$('#cameraPanel'), video=$('#scanVideo'), status=$('#cameraStatus');
    panel.classList.add('show');
    if(!$('#scanUpload')){
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*'; input.id='scanUpload'; input.style.display='none';
      panel.appendChild(input);
      
      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex'; btnRow.style.gap = '10px'; btnRow.style.margin = '10px';
      
      const uploadBtn=document.createElement('button');
      uploadBtn.className='btn silver block';
      uploadBtn.id='scanUploadBtn';
      uploadBtn.textContent='📸 Foto';
      uploadBtn.onclick=()=>input.click();
      
      const toggleBtn=document.createElement('button');
      toggleBtn.className='btn silver block';
      toggleBtn.id='scanToggleBtn';
      toggleBtn.textContent='🔄 Girar';
      toggleBtn.onclick=()=>startScanner(onCode, true);

      const stopBtn=document.createElement('button');
      stopBtn.className='btn danger block';
      stopBtn.id='scanStopBtn';
      stopBtn.textContent='❌ Apagar';
      stopBtn.onclick=()=>{
         stopScanner();
         panel.classList.remove('show');
         toast('Cámara apagada');
      };
      
      btnRow.appendChild(uploadBtn);
      btnRow.appendChild(toggleBtn);
      btnRow.appendChild(stopBtn);
      panel.appendChild(btnRow);
      
      input.onchange=e=>scanImageFile(e.target.files?.[0], onCode);
    }
    status.textContent='Solicitando permiso de cámara...';
    try{
      stopScanner(false);
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('camera unavailable');
      scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:currentFacingMode}});
      video.srcObject=scanStream; await video.play();
      status.textContent='Apunta al QR de la etiqueta. Si no lo lee, escribe el código que aparece debajo.';
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d', { willReadFrequently:true });

      if('BarcodeDetector' in window){
        const detector=new BarcodeDetector({formats:['qr_code']});
        scanTimer=setInterval(async()=>{
          if(!video.videoWidth || Date.now()-lastScanAt<1000) return;
          const codes=await detector.detect(video).catch(()=>[]);
          if(codes?.length){
            lastScanAt=Date.now();
            const raw=codes[0].rawValue||'';
            onCode(raw);
          }
        },420);
      } else {
        scanTimer=setInterval(()=>{
          if(!video.videoWidth || Date.now()-lastScanAt<1000) return;
          canvas.width=video.videoWidth; canvas.height=video.videoHeight;
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const img=ctx.getImageData(0,0,canvas.width,canvas.height);
          let raw=null;
          if(window.jsQR){
            const qr=window.jsQR(img.data,img.width,img.height);
            raw=qr?.data||null;
          }
          if(!raw) raw=decodeLocalC360QR(img);
          if(raw){
            lastScanAt=Date.now();
            onCode(raw);
          }
        },300);
        status.textContent='Apunta al QR de la etiqueta. También puedes escribir el código debajo del QR.';
      }
    }catch(e){
      status.textContent='No se pudo activar la cámara. Escribe el código que aparece debajo del QR.';
      toast('No se pudo activar la cámara. Usa el código manual.','err');
    }
  }

  function scanImageFile(file,onCode){
    if(!file) return;
    const status=$('#cameraStatus');
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=async()=>{
        try{
          const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d',{willReadFrequently:true});
          canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
          ctx.drawImage(img,0,0);
          const data=ctx.getImageData(0,0,canvas.width,canvas.height);
          if(window.jsQR){
            const qr=window.jsQR(data.data,data.width,data.height);
            if(qr?.data){ onCode(qr.data); status.textContent='QR leído desde foto.'; return; }
          }
          const localRaw=decodeLocalC360QR(data);
          if(localRaw){ onCode(localRaw); status.textContent='QR leído desde foto.'; return; }
          if('BarcodeDetector' in window){
            const detector=new BarcodeDetector({formats:['qr_code']});
            const codes=await detector.detect(img).catch(()=>[]);
            if(codes?.length){ onCode(codes[0].rawValue); status.textContent='QR leído desde foto.'; return; }
          }
          status.textContent='No se pudo leer el QR de la foto. Escribe el código que aparece debajo del QR.';
          toast('No se pudo leer el QR. Escribe el código visible.','err');
        }catch(err){
          status.textContent='Error leyendo la foto. Usa el código manual.';
          toast('Error leyendo la foto','err');
        }
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  }
  function stopScanner(hide=true){ if(scanTimer) clearInterval(scanTimer); scanTimer=null; if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; } const p=$('#cameraPanel'); if(p&&hide)p.classList.remove('show'); }

  function bindCash(){
    $('#newMove').onclick=()=>{
      showModal(`<div class="modalHeader"><h2>Nuevo movimiento</h2><button class="closeBtn" data-close>×</button></div><form id="moveForm"><div class="field"><label>Tipo</label><select id="mKind"><option value="egreso">Gasto</option><option value="compra">Compra</option><option value="retiro">Retiro</option><option value="ingreso">Ingreso</option></select></div><div class="field"><label>Monto</label><input id="mAmount" inputmode="decimal" value="0"></div><div class="field"><label>Nota</label><input id="mNote" required></div><button type="submit" class="btn primary block">Guardar</button></form>`);
      $('#moveForm').onsubmit = (e) => {
        e.preventDefault();
        const k=$('#mKind').value, a=parseMoney($('#mAmount').value), n=$('#mNote').value.trim();
        if(!Number.isFinite(a)||a<=0) return toast('Monto inválido','err');
        state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),kind:k,amount:a,note:n, createdBy: authUser().name});
        save();
        closeModal(); renderApp('cash'); toast('Guardado');
      };
    };
    $('#closeDayBtn').onclick=()=>{
      showModal(`<div class="modalHeader"><h2>Cerrar día</h2><button class="closeBtn" data-close>×</button></div>
        <form id="closeDayForm" class="formGrid">
          <div class="field full"><label>Caja Inicial</label><input id="cajaInicial" value="0" inputmode="decimal"></div>
          <div class="field full"><label>Efectivo Físico (Contado)</label><input id="efectivoFisico" value="0" inputmode="decimal"></div>
          <div class="field full"><label>Observaciones</label><input id="cierreObs"></div>
          <button class="btn silver" type="button" data-close>Cancelar</button>
          <button class="btn primary block" type="submit">Generar Cierre</button>
        </form>`);
      $('#closeDayForm').onsubmit = (e) => {
         e.preventDefault();
         const cInicial = parseMoney($('#cajaInicial').value);
         const eFisico = parseMoney($('#efectivoFisico').value);
         if(!Number.isFinite(cInicial) || !Number.isFinite(eFisico)){ return toast('Montos inválidos', 'err'); }
         
         const mov=movementsForBiz().filter(m=>m.date===today());
         const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
         const out=mov.filter(m=>m.kind!=='ingreso').reduce((a,m)=>a+m.amount,0);
         const balanceCalculado = cInicial + income - out;
         const diferencia = eFisico - balanceCalculado;

         const sales = salesForBiz().filter(s=>s.date===today() && s.status!=='cancelled');
         const salesEfectivo = sales.filter(s=>s.method==='Efectivo').reduce((a,s)=>a+s.total,0);
         const salesTarjeta = sales.filter(s=>s.method==='Tarjeta').reduce((a,s)=>a+s.total,0);
         const salesTransf = sales.filter(s=>s.method==='Transferencia').reduce((a,s)=>a+s.total,0);
         const abonosApartado = sales.filter(s=>s.method==='Apartado').reduce((a,s)=>a+s.received,0);
         
         const totalIva = sales.reduce((a,s)=>a+(s.iva||0),0);
         let totalItems = 0;
         sales.forEach(s => s.items?.forEach(i => totalItems += i.qty));
         
         const ruc = state.settings?.ruc ? `<div style="text-align:center; font-size:10px;">RUC/ID: ${escapeHtml(state.settings.ruc)}</div>` : '';
         const phone = state.settings?.phone ? `<div style="text-align:center; font-size:10px;">Tel: ${escapeHtml(state.settings.phone)}</div>` : '';
         const logoUrl = state.settings?.logoUrl ? `<div style="text-align:center; margin-bottom:6px;"><img src="${escapeHtml(state.settings.logoUrl)}" style="max-width:80px; max-height:80px; object-fit:contain;"></div>` : '';

         const html = `
          <div style="font-family:monospace; color:#000; font-size:12px; margin:0; padding:10px; width:80mm; background:white;">
          ${logoUrl}
          <h2 style="font-size:16px; margin:0 0 2px; text-align:center;">${escapeHtml(currentBusiness().name)}</h2>
          ${ruc}${phone}
          <div style="text-align:center; margin:10px 0;">CIERRE DE CAJA<br>${nowLabel()}</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Caja Inicial:</span><span>${fmt(cInicial)}</span></div>
          <div style="border-top:1px dashed #000; margin:8px 0;"></div>
          <div style="text-align:center;font-weight:bold;margin-bottom:4px">RESUMEN VENTAS</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Productos Vendidos:</span><span>${totalItems}</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>IVA Recaudado:</span><span>${fmt(totalIva)}</span></div>
          <div style="border-top:1px dashed #000; margin:8px 0;"></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Efectivo:</span><span>${fmt(salesEfectivo)}</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tarjeta:</span><span>${fmt(salesTarjeta)}</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Transferencia:</span><span>${fmt(salesTransf)}</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Abonos Apartado:</span><span>${fmt(abonosApartado)}</span></div>
          <div style="border-top:1px dashed #000; margin:8px 0;"></div>
          <div style="text-align:center;font-weight:bold;margin-bottom:4px">MOVIMIENTOS DE CAJA</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Total Ingresos:</span><span>+${fmt(income)}</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Total Salidas:</span><span>-${fmt(out)}</span></div>
          <div style="border-top:1px dashed #000; margin:8px 0;"></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px;"><b>Balance Teórico:</b><b>${fmt(balanceCalculado)}</b></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Efectivo Declarado:</span><span>${fmt(eFisico)}</span></div>
          <div style="border-top:1px dashed #000; margin:8px 0;"></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:13px;"><b>Diferencia:</b><b>${fmt(diferencia)}</b></div>
          <div style="margin-top:10px;">Obs: ${escapeHtml($('#cierreObs').value)}</div>
          <div style="margin-top:10px; text-align:center;">Generado por: ${escapeHtml(currentUser()?.label || 'Usuario')}</div>
          </div>`;
         
         closeModal();
         const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
         root.innerHTML = html;
         setTimeout(()=>window.print(), 250);
         toast('Cierre del día generado');
      };
    };
  }
  function bindMore(){ 
     $$('[data-more]').forEach(b=>b.onclick=()=>renderApp(b.dataset.more)); 
     $('#logoutMore')?.addEventListener('click',()=>{
         if(window.click360Auth) window.click360Auth.signOut().then(()=>location.reload());
         else window.click360AppLogout();
     }); 
     $('#forceSyncCloud')?.addEventListener('click', ()=>{
         if(window.click360RefreshNow) window.click360RefreshNow();
         else toast('Nube no disponible en este entorno', 'err');
     });
  }

  async function bindWorkers() {
    const list = $('#workersList');
    if (!window.click360User || window.click360User.role !== 'owner') {
      list.innerHTML = '<p class="empty">Solo el dueño puede administrar trabajadores.</p>';
      const invBtn = $('#inviteWorkerBtn');
      const wEmail = $('#workerEmail');
      if(invBtn) invBtn.disabled = true;
      if(wEmail) wEmail.disabled = true;
      return;
    }

    const loadWorkers = async () => {
      try {
        const workers = await window.click360GetWorkers();
        if (workers.length === 0) {
           list.innerHTML = '<p class="empty">No hay trabajadores. Invita a uno.</p>';
           return;
        }
        list.innerHTML = workers.map(w => `
          <div class="movement" style="align-items:center;">
             <span><b>${escapeHtml(w.name || w.email)}</b><br><small>${escapeHtml(w.email)} · ${w.type === 'email' ? 'Invitado (Pendiente)' : 'Activo'}</small></span>
             <button class="btn danger" style="padding:4px 8px; font-size:12px;" data-revoke="${w.id}" data-rtype="${w.type}">Eliminar</button>
          </div>
        `).join('');

        $$('[data-revoke]').forEach(btn => {
           btn.onclick = async () => {
              if(!confirm('¿Eliminar este trabajador permanentemente?')) return;
              btn.textContent = '...';
              await window.click360RevokeWorker(btn.dataset.revoke, btn.dataset.rtype);
              toast('Trabajador eliminado');
              loadWorkers();
           };
        });
      } catch(e) {
        list.innerHTML = '<p class="empty">Error al cargar trabajadores o no es la versión conectada a la nube.</p>';
      }
    };

    loadWorkers();

    $('#inviteWorkerBtn').onclick = async () => {
       const email = $('#workerEmail').value.trim();
       if(!email) return toast('Ingresa un correo','err');
       $('#inviteWorkerBtn').textContent = '...';
       try {
         await window.click360InviteWorker(email);
         toast('Invitación creada exitosamente');
         $('#workerEmail').value = '';
         $('#inviteLinkBox').style.display = 'block';
         const link = window.location.origin + window.location.pathname;
         $('#inviteLinkVal').value = link;
         loadWorkers();
       } catch(e) {
         toast('Error al invitar (Asegúrate de ser el dueño y tener la Nube activa)', 'err');
       }
       $('#inviteWorkerBtn').textContent = 'Invitar';
    };

    $('#copyInviteLinkBtn').onclick = () => {
       const el = $('#inviteLinkVal');
       el.select();
       document.execCommand('copy');
       toast('Enlace copiado al portapapeles');
    };
  }

  function bindSettings(){
    let pendingLogoUrl = state.settings?.logoUrl || '';
    const logoUpload = $('#bizLogoUpload');
    if (logoUpload) {
      logoUpload.addEventListener('change', (e) => {
         const file = e.target.files[0];
         if(!file) return;
         const reader = new FileReader();
         reader.onload = (ev) => {
            pendingLogoUrl = ev.target.result;
            e.target.parentElement.previousElementSibling.innerHTML = `<img src="${pendingLogoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
         };
         reader.readAsDataURL(file);
      });
    }

    $('#saveBiz').onclick=()=>{
       const b=currentBusiness(); 
       b.name=$('#bizName').value.trim()||b.name; 
       b.type=$('#bizType').value; 
       state.settings = state.settings || {};
       state.settings.iva = parseFloat($('#bizIva').value) || 0;
       state.settings.ruc = $('#bizRuc') ? $('#bizRuc').value.trim() : '';
       state.settings.phone = $('#bizPhone') ? $('#bizPhone').value.trim() : '';
       if (pendingLogoUrl) state.settings.logoUrl = pendingLogoUrl;
       save(); renderApp('settings'); toast('Guardado');
    };
    $('#createBiz').onclick=()=>{const name=$('#newBizName').value.trim(); if(!name)return toast('Falta el nombre','err'); const b={id:uid('biz'),code:'EMPRESA-'+String(state.businesses.length+1).padStart(3,'0'),name,type:$('#newBizType').value,status:'activo',due:'2026-07-08'}; state.businesses.push(b); state.activeBusinessId=b.id; const user=currentUser(); if(user&&!user.businessIds.includes(b.id))user.businessIds.push(b.id); save(); renderApp('inventory'); toast('Negocio creado');};
  }

  function renderAdmin(){
    if(!checkAuth('admin'))return;
    const rows=state.businesses.map(b=>`<div class="card adminRow"><div><h3>${escapeHtml(b.name)} <span class="status ${b.status}">${escapeHtml(b.status)}</span></h3><p>Código: ${escapeHtml(b.code||b.id)} · Vence: ${escapeHtml(b.due||'')}</p></div><div class="actions"><button class="btn primary" data-admin-act="${b.id}">Activar</button><button class="btn" data-admin-pause="${b.id}">Pausar</button><button class="btn silver" data-admin-month="${b.id}">+ Mes</button></div></div>`).join('');
    app.innerHTML=`<div class="app"><header class="topbar" style="display:flex"><div class="logoMark"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360 · ADMIN</span><small>Panel de administración</small></div></div><button class="logoutBtn" id="adminLogout">↗</button></header><main class="main"><div class="pageHead"><div><h1>Clientes y negocios</h1><p>Gestiona acceso, estados y vencimientos.</p></div></div><section class="adminList">${rows}</section></main></div>`;
    $('#adminLogout').onclick=()=>window.click360AppLogout();
    $$('[data-admin-act]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminAct); b.status='activo'; save(); renderAdmin();});
    $$('[data-admin-pause]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminPause); b.status='pausado'; save(); renderAdmin();});
    $$('[data-admin-month]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminMonth); const d=new Date(b.due||Date.now()); d.setMonth(d.getMonth()+1); b.due=d.toISOString().slice(0,10); b.status='activo'; save(); renderAdmin();});
  }

  function showModal(html){ closeModal(); const root=document.createElement('div'); root.id='modalRoot'; root.innerHTML=`<div class="modalOverlay show"><div class="modal">${html}</div></div>`; document.body.appendChild(root); $$('[data-close]',root).forEach(b=>b.onclick=closeModal); }
  function closeModal(){ $('#modalRoot')?.remove(); }

  async function openLabelModal(product){
    showModal(`<div class="modalHeader"><h2>Etiqueta imprimible</h2><button class="closeBtn" data-close>×</button></div><div class="labelPreview"><div class="sticker" id="sticker"><div class="biz">${escapeHtml(currentBusiness().name)}</div><canvas id="qrCanvas"></canvas><div class="code">${escapeHtml(product.code)}</div><div class="pname">${escapeHtml(product.name)}</div><div class="price">${fmt(product.price)}</div></div><div class="labelButtons"><button class="btn primary" id="printOne">Imprimir etiqueta</button><button class="btn silver" id="downloadPng">Descargar Imagen</button><button class="btn" id="copyLabelCode">Copiar código ${escapeHtml(product.code)}</button><button class="btn" id="printStock">Imprimir según stock (${product.qty})</button><button class="btn" id="printAll">Imprimir todas</button></div></div>`);
    QR.draw($('#qrCanvas'), productPayload(product), 220);
    $('#printOne').onclick=()=>printLabels([{product,copies:1}]);
    $('#copyLabelCode').onclick=()=>{ navigator.clipboard?.writeText(product.code); toast('Código copiado'); };
    $('#printStock').onclick=()=>printLabels([{product,copies:Math.max(1,product.qty)}]);
    $('#printAll').onclick=()=>printLabels(productsForBiz().map(p=>({product:p,copies:1})));
    $('#downloadPng').onclick=()=>downloadLabelPng(product);
  }
  async function labelCanvas(product, scale=3){
    const w=260*scale,h=360*scale,c=document.createElement('canvas'); c.width=w; c.height=h;
    const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; roundRect(ctx,0,0,w,h,18*scale,true,false);
    ctx.fillStyle='#111'; ctx.textAlign='center'; ctx.font=`900 ${17*scale}px Arial`; ctx.fillText(currentBusiness().name.toUpperCase(),w/2,40*scale);
    const qr=document.createElement('canvas'); QR.draw(qr, productPayload(product), 190*scale); ctx.drawImage(qr,(w-190*scale)/2,62*scale);
    ctx.font=`${11*scale}px monospace`; ctx.fillText(product.code,w/2,270*scale);
    ctx.font=`900 ${19*scale}px Arial`; ctx.fillText(product.name,w/2,304*scale);
    ctx.font=`900 ${26*scale}px Arial`; ctx.fillText(fmt(product.price),w/2,340*scale); return c;
  }
  function roundRect(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();}
  async function downloadLabelPng(product){ const c=await labelCanvas(product,4); const a=document.createElement('a'); a.download=`etiqueta-${slug(product.name)}-${product.code}.png`; a.href=c.toDataURL('image/png'); a.click(); toast('Etiqueta descargada'); }
  async function printLabels(groups){
    const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root); root.innerHTML='<div class="printLabels"></div>'; const wrap=$('.printLabels',root);
    for(const g of groups) for(let i=0;i<Math.max(1,g.copies);i++){ const item=document.createElement('div'); item.className='printLabel'; item.innerHTML=`<canvas></canvas><div><div class="biz">${escapeHtml(currentBusiness().name)}</div><div class="pname">${escapeHtml(g.product.name)}</div><div class="price">${fmt(g.product.price)}</div><div class="code">${escapeHtml(g.product.code)}</div></div>`; wrap.appendChild(item); QR.draw($('canvas',item), productPayload(g.product), 160); }
    setTimeout(()=>window.print(),250);
  }

  function downloadBackup(){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})); a.download=`click360-respaldo-${today()}.json`; a.click(); toast('Respaldo guardado'); }
  function restoreBackup(e){ 
    const file=e.target.files[0]; if(!file)return; const reader=new FileReader(); reader.onload=()=>{try{state=normalizeState(JSON.parse(reader.result));save();renderApp('home');toast('Respaldo restaurado')}catch{toast('No se pudo restaurar','err')}}; reader.readAsText(file); 
  }
  function bindBackup(){ 
    $('#backupBtn').onclick=downloadBackup; 
    $('#restoreFile').onchange = (e) => {
        const file = e.target.files[0]; if(!file) return;
        const r = new FileReader();
        r.onload = (ev) => {
          try { const data = JSON.parse(ev.target.result); Object.assign(state, data); save(); location.reload(); }
          catch { toast('Error leyendo archivo', 'err'); }
        };
        r.readAsText(file);
    };
    const exp = $('#exportCsvBtn');
    if(exp) exp.onclick = () => {
      let csv = "FECHA,TIPO,MONTO,NOTA,USUARIO\n";
      const allMovs = [...state.movements].sort((a,b)=>a.date.localeCompare(b.date));
      allMovs.forEach(m => { csv += `${m.date},${m.kind},${m.amount},"${(m.note || '').replace(/"/g,'""')}","${m.createdBy || 'Sistema'}"\n`; });
      const a = document.createElement('a');
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = `contabilidad_click360_${today()}.csv`;
      a.click();
      toast('Reporte Contable Generado');
    };
    $('#cloudSoon').onclick=()=>toast('Preparado para CLICK 360 Cloud. Requiere backend real.'); 
  }

  window.cancelSale = function(saleId) {
    if(!confirm('¿Seguro que deseas anular esta venta? Esto no se puede deshacer y devolverá el stock.')) return;
    const sale = state.sales.find(s=>s.id === saleId);
    if(!sale) return toast('Venta no encontrada', 'err');
    
    // Devolver stock
    sale.items.forEach(i => {
       const p = state.products.find(prod=>prod.id === i.id);
       if(p) p.qty += i.qty;
    });
    
    sale.status = 'cancelled';
    
    // Anular movimiento si existe
    const mov = state.movements.find(m => m.saleId === sale.id);
    if(mov) mov.amount = 0; // Opcional: o borrarlo, pero es mejor ponerlo en 0 para registro
    
    state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'retiro',amount:0,note:`Venta anulada ${saleId}`,user:session.username});
    
    save();
    renderApp('reports');
    toast('Venta anulada y stock devuelto');
  };

  window.payLayaway = function(saleId) {
    const sale = state.sales.find(s=>s.id === saleId);
    if(!sale) return toast('Venta no encontrada', 'err');
    
    const amountStr = prompt(`Saldo pendiente: ${fmt(sale.balance)}\nIngrese el monto a abonar:`);
    if(!amountStr) return;
    const amount = parseMoney(amountStr);
    if(!Number.isFinite(amount) || amount <= 0) return toast('Monto inválido', 'err');
    if(amount > sale.balance) return toast('El abono no puede superar el saldo pendiente', 'err');
    
    sale.received = (sale.received || 0) + amount;
    sale.balance -= amount;
    
    if(sale.balance <= 0) {
       sale.status = 'paid';
       toast('Cuenta saldada en su totalidad');
    } else {
       toast(`Abono registrado. Nuevo saldo: ${fmt(sale.balance)}`);
    }
    
    state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'ingreso',amount:amount,note:`Abono a ticket ${saleId}`,user:session.username, saleId: sale.id});
    save(); renderApp(route);
  };

  window.printReceipt = function(id) {
    const s = state.sales.find(x=>x.id===id);
    if(!s) return;
    const ruc = state.settings?.ruc ? `<div style="text-align:center; font-size:10px;">RUC/ID: ${escapeHtml(state.settings.ruc)}</div>` : '';
    const phone = state.settings?.phone ? `<div style="text-align:center; font-size:10px;">Tel: ${escapeHtml(state.settings.phone)}</div>` : '';
    const logoUrl = state.settings?.logoUrl ? `<div style="text-align:center; margin-bottom:6px;"><img src="${escapeHtml(state.settings.logoUrl)}" style="max-width:80px; max-height:80px; object-fit:contain;"></div>` : '';
    
    const html=`
      <div style="font-family:monospace; color:#000; font-size:12px; margin:0; padding:10px; width:80mm; background:white;">
      ${logoUrl}
      <h2 style="font-size:16px; margin:0 0 2px; text-align:center;">${escapeHtml(currentBusiness().name)}</h2>
      ${ruc}${phone}
      <div style="text-align:center; margin-bottom:10px; margin-top:8px;">Ticket de Venta<br>${escapeHtml(s.when)}</div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ticket #</span><span>${s.id.slice(-6).toUpperCase()}</span></div>
      ${s.customer ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Cliente:</span><span>${escapeHtml(s.customer)}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Método:</span><span>${escapeHtml(s.method)}</span></div>
      <div style="border-top:1px dashed #000; margin:8px 0;"></div>
      ${s.items.map(i=>`<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>${i.qty}x ${escapeHtml(i.name)}</span><span>${fmt(i.price*i.qty)}</span></div>`).join('')}
      <div style="border-top:1px dashed #000; margin:8px 0;"></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Subtotal:</span><span>${fmt(s.subtotal)}</span></div>
      ${s.iva ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>IVA:</span><span>${fmt(s.iva)}</span></div>` : ''}
      ${s.discount ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Descuento:</span><span>-${fmt(s.discount)}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:16px; font-weight:bold;"><span>TOTAL:</span><span>${fmt(s.total)}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Pagado:</span><span>${fmt(s.received||s.total)}</span></div>
      ${s.balance ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Saldo pendiente:</span><span>${fmt(s.balance)}</span></div>` : ''}
      <div style="border-top:1px dashed #000; margin:8px 0;"></div>
      <div style="text-align:center; margin-top:10px;">¡Gracias por su compra!<br><small>Atendido por: ${escapeHtml(s.user)}</small></div>
      </div>`;
    const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
    root.innerHTML = html;
    setTimeout(()=>window.print(), 250);
  };

  window.printReports = function() {
    const sales = salesForBiz().filter(s => s.status!=='cancelled');
    const total = sales.reduce((a,s)=>a+(s.status==='layaway' ? (s.received||0) : s.total),0);
    const tickets = sales.length;
    const counts={}; sales.forEach(s=>s.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    
    const html = `
      <div style="font-family:sans-serif; color:#000; font-size:12px; margin:0; padding:20px; background:white;">
      <h2 style="font-size:20px; margin:0 0 10px;">${escapeHtml(currentBusiness().name)} - Reporte General</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Fecha:</span><span>${nowLabel()}</span></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ingreso Ventas:</span><strong>${fmt(total)}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tickets:</span><strong>${tickets}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Promedio por Ticket:</span><strong>${fmt(tickets?total/tickets:0)}</strong></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Productos Más Vendidos</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Producto</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Cant. Vendida</th></tr>
        ${top.map(([n,c])=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(n)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${c}</td></tr>`).join('')}
      </table>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Historial de Tickets Hoy</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Hora</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Vendedor</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Método</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Estado</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Total</th></tr>
        ${sales.slice().reverse().map(s=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.when.split(' ')[1] || s.when)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.createdBy || s.user || 'Sistema')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.method)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.status)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${fmt(s.total)}</td></tr>`).join('')}
      </table></div>`;
      
    const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
    root.innerHTML = html;
    setTimeout(()=>window.print(), 250);
  };

  function runQa(){
    const results=[]; const ok=(name,cond)=>results.push(`${cond?'PASS':'FAIL'} ${name}`);
    const oldState=state, oldSession=session;
    state=seed(); setSession(null); save();
    ok('parse 5,50', parseMoney('5,50')===5.5);
    ok('parse 12.99', parseMoney('12.99')===12.99);
    const p={id:'p1',businessId:state.businesses[0].id,code:'TEST01',name:'Buzo QA',category:'Prueba',qty:5,cost:2.25,price:5.5};
    state.products.push(p);
    ok('qr payload local', productPayload(p)==='TEST01');
    ok('normalize QR', normalizeCode(productPayload(p))==='TEST01');
    QR.make(productPayload(p)); ok('qr generator', true);
    const pre=document.createElement('pre'); pre.id='qa-results'; pre.textContent=results.join('\\n'); document.body.appendChild(pre);
    console.log(pre.textContent);
    state=oldState; session=oldSession; save();
  }

  function handleInitialScan(){
    const url = new URL(location.href);
    const scan = url.searchParams.get('scan') || (location.hash.startsWith('#scan=') ? decodeURIComponent(location.hash.slice(6)) : '');
    if(!scan || !session || currentUser()?.role === 'admin') return false;
    const code = normalizeCode(scan);
    if(!code) return false;
    const p = productsForBiz().find(x=>x.code.toUpperCase()===code.toUpperCase());
    renderApp('sell');
    setTimeout(()=>{
      const input = $('#manualCode');
      if(input) input.value = code;
      const btn = $('#addCode');
      if(btn) btn.click();
      history.replaceState({}, '', location.pathname);
    },200);
    return !!p;
  }
  window.click360Route=renderApp;
  window.click360SetSession = setSession;
  window.CLICK360_QA={parseMoney, normalizeCode, productPayload, QR, runQa};

  window.addEventListener('hashchange',()=>{ const h=location.hash.replace('#',''); if(['home','inventory','sell','cash','more','reports','settings','workers','backup','debtors'].includes(h)) renderApp(h); });
  if('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  if(location.search.includes('qa')) { renderLogin(); setTimeout(runQa,300); }
  else if(!session) renderLogin(); else if(session.role==='admin') renderAdmin(); else if(!handleInitialScan()) {
    const h = location.hash.replace('#','');
    if(['home','inventory','sell','cash','more','reports','settings','workers','backup','debtors'].includes(h)) renderApp(h);
    else renderApp('home');
  }
})();
