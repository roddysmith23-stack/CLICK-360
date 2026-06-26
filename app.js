
(() => {
  'use strict';

  const LS = 'click360_mvp_qa_final_state_v1';
  const SESSION = 'click360_mvp_qa_final_session_v1';
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const app = $('#app');
  const toastEl = $('#toast');
  
  window.onerror = function(msg, url, line) {
    const m = String(msg);
    if(m.includes('ResizeObserver')) return;
    const link = `https://wa.me/593969399562?text=${encodeURIComponent("Error en CLICK 360:\\n" + m + "\\nLínea: " + line)}`;
    if(toastEl) {
      toastEl.innerHTML = `Algo falló. <a href="${link}" target="_blank" style="color:var(--gold);text-decoration:underline;pointer-events:auto;">Reportar a CLICK</a>`;
      toastEl.className = 'toast show err';
      clearTimeout(toastEl._t);
    }
  };

  let state = loadState();
  let session = loadSession();
  let route = 'home';
  let scanStream = null;
  let scanTimer = null;
  let lastScanAt = 0;

  function uid(prefix='id') { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }
  function slug(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'negocio'; }
  let workingDate = null;
  function today() { return workingDate || new Date().toISOString().slice(0,10); }
  function setWorkingDate(d) {
    workingDate = d || null;
    renderApp(route);
  }
  function nowLabel() { return new Date().toLocaleString('es-EC', { dateStyle:'short', timeStyle:'medium' }); }
  function formattedTodaySpanish() {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const parts = today().split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayName = days[d.getDay()];
    const dayNum = d.getDate();
    const monthName = months[d.getMonth()];
    const year = d.getFullYear();
    return `${dayName}, ${dayNum} de ${monthName} de ${year}`;
  }
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
        const max = 400; // REDUCED TO PREVENT 1MB LIMIT
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        cb(canvas.toDataURL('image/jpeg', 0.6)); // LOWER QUALITY
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

  function save() { 
    try {
      localStorage.setItem(LS, JSON.stringify(state)); 
    } catch(e) {
      console.error(e);
      if(e.name === 'QuotaExceededError' || e.message.includes('quota')) {
        toast('Almacenamiento lleno. Elimina imágenes o productos viejos para liberar espacio.', 'err');
      } else {
        toast('Error al guardar datos.', 'err');
      }
    }
  }
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
    if (!out.users || out.users.length === 0) out.users = d.users;
    if (!out.businesses || out.businesses.length === 0) out.businesses = d.businesses;
    out.products ||= []; out.sales ||= []; out.movements ||= []; out.dailyReports ||= [];
    out.settings ||= {};
    out.settings.labelTemplates ||= [];
    out.settings.workers ||= [];
    
    // Migración para limpiar "sale_..." de movimientos antiguos
    out.movements.forEach(m => {
       if (m.note && m.note.includes('Venta anulada sale_')) {
          m.note = 'Venta anulada (Registro histórico)';
       }
    });
    
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
      dailyReports:[],
      settings:{ workers: [] }
    };
  }

  window.click360ReloadState = () => { 
    state = loadState(); 
    
    // Auto de-activate worker if not in settings list
    if (window.click360User && window.click360User.role === 'worker') {
      const workers = state.settings?.workers || [];
      const isStillApproved = workers.some(w => w.email.toLowerCase() === window.click360User.email.toLowerCase());
      if (!isStillApproved) {
        if (window.click360RemoveWorkerUid) {
          window.click360RemoveWorkerUid(window.click360User.uid).catch(()=>{});
        }
        window.click360AppLogout();
        return;
      }
      
      const match = workers.find(w => w.email.toLowerCase() === window.click360User.email.toLowerCase());
      if (match && !match.uid) {
        match.uid = window.click360User.uid;
        save();
      }
    }
  };

  function currentUser(){
    if (!session) return null;
    let localUser = state.users.find(u=>u.username===session.username);
    if (!localUser && session.username) {
      const role = session.role || (window.click360User ? window.click360User.role : 'owner');
      const label = window.click360User ? (window.click360User.name || window.click360User.email) : session.username;
      localUser = {
        username: session.username,
        role: role,
        label: label,
        businessIds: state.businesses.map(b => b.id)
      };
    }
    return localUser;
  }
  function authUser() {
    if (window.click360User) return window.click360User;
    const u = currentUser();
    if (u) {
      return {
        name: u.label || u.username,
        role: u.role,
        email: ''
      };
    }
    return { name: 'Sistema', role: 'owner', email: '' };
  }
  function currentBusiness(){ 
    return state.businesses.find(b=>b.id===state.activeBusinessId) 
      || state.businesses[0] 
      || { id:'biz_main', code:'EMPRESA-001', name:'Mi Negocio', type:'ropa', status:'activo', due:'2026-07-08', settings:{} }; 
  }
  function productsForBiz(bid=currentBusiness()?.id){ return state.products.filter(p=>p.businessId===bid); }
  function salesForBiz(bid=currentBusiness()?.id){ return state.sales.filter(s=>s.businessId===bid); }
  function movementsForBiz(bid=currentBusiness()?.id){ return state.movements.filter(m=>m.businessId===bid); }
  function isDayStarted() {
    const bid = currentBusiness()?.id;
    if (!bid) return true;
    return state.movements.some(m => m.businessId === bid && m.date === today() && m.kind === 'apertura');
  }
  function isDayClosed() {
    const bid = currentBusiness()?.id;
    if (!bid) return false;
    return (state.dailyReports || []).some(r => r.businessId === bid && r.date === today());
  }
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
    function draw(canvas,text,size=280,margin=5,fgColor='#000000',bgColor='#ffffff'){
      const mat=make(text), n=mat.length;
      canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle=bgColor; ctx.fillRect(0,0,size,size);
      const cell=size/(n+margin*2);
      ctx.fillStyle=fgColor;
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
    const isWorkingDateActive = !!workingDate;
    const badgeBorder = isWorkingDateActive ? 'border:2px solid var(--gold); background:rgba(244,196,49,0.25);' : 'border:1px solid rgba(244,196,49,0.25); background:rgba(244,196,49,0.12);';
    const clearDateBtn = isWorkingDateActive ? `<button type="button" id="clearWorkingDateBtn" style="background:none; border:none; color:#ff4d4d; cursor:pointer; font-size:14px; margin-left:6px; padding:0; display:inline-flex; align-items:center;" title="Volver a hoy">✕</button>` : '';

    const dateBadgeHtml = `<div style="display:inline-flex; align-items:center; gap:8px; margin-bottom:14px;">
        <label style="position:relative; display:inline-flex; align-items:center; gap:8px; ${badgeBorder} padding:6px 14px; border-radius:20px; font-size:13px; color:var(--gold); font-weight:600; cursor:pointer;" title="Cambiar fecha de trabajo">
          📅 ${formattedTodaySpanish()}
          <input type="date" id="workingDateInput" value="${today()}" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;">
        </label>
        ${clearDateBtn}
      </div>`;

    const b=currentBusiness();
    const bizOptions=state.businesses.map(x=>`<option value="${x.id}" ${x.id===b?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');
    const logoIconSide = b?.settings?.logoUrl 
      ? `<img src="${escapeHtml(b.settings.logoUrl)}" style="width:48px;height:48px;object-fit:cover;border-radius:10px;">`
      : `<div class="logoIcon" style="width:48px;height:48px;"></div>`;
    const logoIconTop = b?.settings?.logoUrl 
      ? `<img src="${escapeHtml(b.settings.logoUrl)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">`
      : `<div class="logoIcon" style="width:44px;height:44px;"></div>`;
    const avatarHtml = authUser().photoURL 
      ? `<img src="${escapeHtml(authUser().photoURL)}" style="width:100%;height:100%;object-fit:cover;">`
      : (b?.settings?.logoUrl 
        ? `<img src="${escapeHtml(b.settings.logoUrl)}" style="width:100%;height:100%;object-fit:cover;">`
        : (authUser().name || 'U').charAt(0).toUpperCase());

    return `<div class="app"><div class="desktopLayout">
      <aside class="sidebar flex-sidebar">
        <div>
          <div class="logoMark" onclick="window.location.hash='#home'" style="cursor:pointer;">${logoIconSide}<div class="logoText" style="font-size:28px;"><b>CLICK</b><span>360</span><small>Control total de tu negocio</small></div></div>
          <div class="field"><label>Negocio activo</label><select id="businessPickerSide">${bizOptions}</select></div>
          <nav class="sideNav">${navButtons(active, true)}</nav>
        </div>
        <div style="margin-top:auto; padding-top:20px; border-top:1px solid var(--line); display:flex; align-items:center; gap:10px;">
          <div class="profileAvatar" onclick="window.location.hash='#settings'" style="background:#1a1a1a; color:var(--gold); width:32px; height:32px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-weight:bold; border: 1px solid var(--gold); overflow:hidden;" title="Ajustes">${avatarHtml}</div>
          <button class="logoutBtn" id="logoutSide" title="Cerrar sesión" style="flex:1;">Cerrar sesión ↗</button>
        </div>
      </aside>
      <div>
        <header class="topbar">
          <div class="logoMark" onclick="window.location.hash='#home'" style="cursor:pointer;">${logoIconTop}<div class="logoText" style="font-size:24px;"><b>CLICK</b><span>360</span><small>Control total</small></div></div>
          <div style="flex:1; display:flex; justify-content:center; min-width:0; padding:0 8px;">
            <select class="businessSelect" id="businessPickerTop" style="font-size:13px; padding:8px; min-height:36px; max-width:140px; margin:0 auto;">${bizOptions}</select>
          </div>
          <div class="profileAvatar" onclick="window.location.hash='#settings'" style="background:#1a1a1a; color:var(--gold); width:32px; height:32px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-weight:bold; margin-right:8px; border: 1px solid var(--gold); overflow:hidden;" title="Ajustes">${avatarHtml}</div>
          <button class="logoutBtn" id="logoutTop" title="Cerrar sesión" style="width:36px; height:36px; border-radius:10px;">↗</button>
        </header>
        <main class="main">
          ${dateBadgeHtml}
          ${content}
        </main>
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
    $('#logoutSide')?.addEventListener('click',()=>window.click360AppLogout());

    const dateInput = $('#workingDateInput');
    if (dateInput) {
       dateInput.onchange = () => {
          setWorkingDate(dateInput.value);
       };
    }
    const clearDateBtn = $('#clearWorkingDateBtn');
    if (clearDateBtn) {
       clearDateBtn.onclick = (e) => {
          e.preventDefault();
          setWorkingDate(null);
       };
    }
  }
  function renderApp(r='home') {
    try {
      if(!checkAuth('business')) return;
      if(!can(r)) r='home';
      stopScanner(); route=r;
      history.replaceState(null, '', '#' + r);
      const views={home:homeView,inventory:inventoryView,sell:sellView,cash:cashView,more:moreView,reports:reportsView,settings:settingsView,workers:workersView,backup:backupView,debtors:debtorsView};
      app.innerHTML=shell((views[r]||homeView)(), r);
      bindShell(); bindView(r);
    } catch(e) {
      console.error("Error al renderizar la app:", e);
      app.innerHTML = `<div style="padding:24px; color:#ff4444; background:#110000; border:1px solid #ff4444; border-radius:16px; margin:20px; font-family:sans-serif;">
        <h2 style="margin-top:0;">⚠️ Error de Renderizado</h2>
        <p>Ocurrió un error al cargar la vista principal:</p>
        <pre style="background:#000; padding:12px; border-radius:8px; overflow-x:auto; color:#ff8888; font-size:13px;">${escapeHtml(e.stack || e.message)}</pre>
        <button class="btn primary" onclick="location.reload()" style="margin-top:12px;">Reintentar / Recargar</button>
      </div>`;
      throw e;
    }
  }

  function homeView() {
    const b=currentBusiness(), products=productsForBiz(), sales=salesForBiz().filter(s=>s.date===today() && s.status!=='cancelled'), mov=movementsForBiz().filter(m=>m.date===today() && m.status!=='cancelled');
    const apertura=mov.find(m=>m.kind==='apertura')?.amount||0;
    const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
    const expenses=mov.filter(m=>m.kind==='egreso').reduce((a,m)=>a+m.amount,0);
    const compras=mov.filter(m=>m.kind==='compra').reduce((a,m)=>a+m.amount,0);
    const retiros=mov.filter(m=>m.kind==='retiro').reduce((a,m)=>a+m.amount,0);
    const out=expenses+compras+retiros;
    const saldo=apertura+income-out;
    const low=products.filter(p=>p.qty<=3).length;
    const motivationalPhrases = [
      '"El éxito no es casualidad, es constancia."',
      '"Cada venta es un paso más hacia tu sueño."',
      '"Tu negocio crece contigo. \u00a1Sigue adelante!"',
      '"La disciplina vence al talento."',
      '"Hoy es un gran día para vender."',
      '"El mejor momento para crecer es ahora."',
      '"Controla tu negocio, controla tu futuro."',
      '"Los grandes negocios empiezan con peque\u00f1os pasos."'
    ];
    const todayPhrase = motivationalPhrases[new Date().getDate() % motivationalPhrases.length];

    return `<div class="pageHead"><div><h1>Hola, ${escapeHtml(authUser().name || 'Usuario')} \uD83D\uDC4B</h1><p>${escapeHtml(b.name)}</p></div></div>
      <section class="grid kpis">
        <div class="card kpi gold"><div class="icon">\u2197</div><small>Ventas de hoy</small><strong class="goldText">${fmt(income)}</strong></div>
        <div class="card kpi"><div class="icon">\u25A3</div><small>Caja</small><strong>${fmt(saldo)}</strong></div>
        <div class="card kpi"><div class="icon">\u25A7</div><small>Inventario</small><strong>${products.length}</strong></div>
        <div class="card kpi"><div class="icon">\u26A0</div><small>Stock bajo</small><strong>${low}</strong></div>
      </section>
      <section class="card sectionCard" style="margin-top:14px;background:linear-gradient(135deg,#1a1500 0%,#0d0d0d 100%);border:1px solid rgba(244,196,49,0.18);overflow:hidden;position:relative;">
        <div style="position:absolute;top:0;right:0;width:120px;height:120px;background:radial-gradient(circle,rgba(244,196,49,0.08) 0%,transparent 70%);pointer-events:none;"></div>
        <h3 style="color:var(--gold);margin-bottom:12px;">📢 TU NEGOCIO CLICK 260</h3>
        <img src="assets/banner-motivacional.png" alt="Banner motivacional CLICK 360" style="width:100%;border-radius:12px;margin-bottom:12px;max-height:160px;object-fit:cover;" onerror="this.style.display='none'">
        <p style="font-style:italic;color:var(--muted);font-size:14px;line-height:1.5;margin-bottom:12px;text-align:center;">${todayPhrase}</p>
        <a href="https://wa.me/593969399562?text=${encodeURIComponent('Hola CLICK 360, necesito informaci\u00f3n')}" target="_blank" class="btn" style="border:1px solid #25D366;color:#25D366;background:transparent;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;">\uD83D\uDCAC Contactar Soporte CLICK 360</a>
      </section>
      <section class="split" style="margin-top:14px">
        <div class="card sectionCard"><h3>\u00DAltimas ventas</h3>${sales.slice(-3).reverse().map(s=>`<div class="movement"><span>${s.items.map(i=>escapeHtml(i.name)).join(', ')}</span><b class="pos">${fmt(s.total)}</b></div>`).join('') || '<p class="empty">A\u00fan no hay ventas hoy.</p>'}</div>
        <div class="card sectionCard"><h3>Acciones r\u00e1pidas</h3><div class="split"><button class="btn primary" onclick="window.click360Route('sell')">Vender</button><button class="btn silver" onclick="window.click360Route('inventory')">Inventario</button></div></div>
      </section>`;
  }

  function inventoryView() {
    const b=currentBusiness(), v=businessVocabulary(b.type), products=productsForBiz();
    const templates = state.settings?.labelTemplates || [];
    
    let templatesHtml = '';
    if (templates.length > 0) {
      templatesHtml = `
        <div class="card sectionCard" style="margin-top:20px;">
          <h3>Plantillas de Etiquetas QR</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px; margin-top:10px;">
            ${templates.map(t => `
              <div class="card" style="background:#171717; border:1px solid #333; padding:12px; border-radius:12px; display:flex; flex-direction:column; gap:8px;">
                <div style="font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:var(--text);">${escapeHtml(t.name)}</span>
                  <button class="iconBtn danger small-del-btn" data-del-tpl="${t.id}" title="Eliminar plantilla" style="font-size:12px; padding:4px 8px; border:none; cursor:pointer;">✕</button>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${t.bgColor}; border:1px solid #555;" title="Fondo de Etiqueta"></span>
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${t.qrBgColor || t.bgColor}; border:1px solid #555;" title="Fondo de QR"></span>
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${t.fgColor}; border:1px solid #555;" title="Texto/QR"></span>
                  <span style="font-size:11px; color:#aaa; margin-left:4px;">Colores</span>
                </div>
                ${t.social ? `<div style="font-size:12px; color:#ccc;">📱 ${escapeHtml(t.social)}</div>` : ''}
                ${t.address ? `<div style="font-size:12px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${escapeHtml(t.address)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      templatesHtml = `
        <div class="card sectionCard" style="margin-top:20px;">
          <h3>Plantillas de Etiquetas QR</h3>
          <p class="empty" style="margin:0; padding:10px 0;">No has creado plantillas de etiquetas aún. Diseña una etiqueta en cualquier producto y guárdala como plantilla para verla aquí.</p>
        </div>
      `;
    }

    return `<div class="pageHead"><div><h1>Inventario</h1><p>Registra, controla y genera etiquetas.</p></div><div class="toolbar"><button class="btn primary" id="newProduct">＋ Nuevo</button></div></div>
      <div class="searchBox" style="display:flex; gap:10px;">
         <input id="productSearch" placeholder="Buscar por nombre o código..." style="flex:1;" />
         <button type="button" class="iconBtn" id="openCamera" title="Escanear QR">
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
         </button>
      </div>
      <div id="cameraPanel" class="cameraPanel" style="margin-bottom:14px;"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para cámara.</div></div>
      <section id="productList" class="productList" style="margin-top:14px">${productList(products,v)}</section>
      ${templatesHtml}`;
  }
  function productList(products,v) {
    if(!products.length) return `<div class="card empty">Aún no hay ${escapeHtml(v.plural)}. Crea el primero con Nuevo.</div>`;
    return products.map(p=>`<article class="card productCard hasImage" data-pid="${p.id}">
      ${imageThumb(p)}
      <div class="productInfo"><h3>${escapeHtml(p.name)}</h3><div class="meta"><span>${escapeHtml(p.category||'General')}</span><span class="badge">${escapeHtml(p.code)}</span><span>Stock: <b>${p.qty}</b></span><span class="badge gold">${fmt(p.price)}${p.cardPrice && p.cardPrice !== p.price ? ' / ' + fmt(p.cardPrice) + ' 💳' : ''} <span style="font-size:10px; opacity:0.8;">(incluye IVA)</span></span></div></div>
      <div class="actions"><button class="iconBtn gold" data-label="${p.id}" title="Etiqueta QR">▦</button><button class="iconBtn" data-edit="${p.id}" title="Editar">✎</button><button class="iconBtn danger" data-del="${p.id}" title="Borrar">🗑</button></div>
    </article>`).join('');
  }

  function sellView() {
    if (!isDayStarted()) {
      return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; min-height:50vh;">
        <div style="font-size:48px; margin-bottom:16px;">🔑</div>
        <h2>Jornada no Iniciada</h2>
        <p style="color:var(--muted); max-width:320px; margin-bottom:24px;">Debes iniciar el día desde la sección de Caja Diaria antes de poder realizar ventas.</p>
        <button class="btn primary" onclick="window.click360Route('cash')">Ir a Caja Diaria</button>
      </div>`;
    }
    if (isDayClosed()) {
      return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; min-height:50vh;">
        <div style="font-size:48px; margin-bottom:16px;">🔒</div>
        <h2>Caja Cerrada</h2>
        <p style="color:var(--muted); max-width:320px; margin-bottom:24px;">El día de hoy ya fue cerrado. Las ventas están deshabilitadas.</p>
        <button class="btn primary" onclick="window.click360Route('home')">Ir al Inicio</button>
      </div>`;
    }
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
            <div class="field"><label id="lblCustomer">Cliente (opcional)</label><input id="customer" placeholder="Ej. Juan Pérez" /></div>
            <div class="field"><label>Cédula/RUC del Cliente</label><input id="customerCedula" placeholder="Ej. 1712345678" /></div>
            <div class="field"><label id="lblCustomerPhone">Teléfono (WhatsApp)</label><input id="customerPhone" placeholder="Ej. 593969399562" /></div>
            <div class="field" id="layawayDueDateField" style="display:none;"><label>Fecha Límite de Retiro</label><input type="date" id="layawayDueDate" /></div>
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
    const aperture=mov.find(m=>m.kind==='apertura')?.amount || 0;
    const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
    const expenses=mov.filter(m=>m.kind==='egreso').reduce((a,m)=>a+m.amount,0);
    const compras=mov.filter(m=>m.kind==='compra').reduce((a,m)=>a+m.amount,0);
    const retiros=mov.filter(m=>m.kind==='retiro').reduce((a,m)=>a+m.amount,0);
    const out=expenses+compras+retiros;
    const saldo = aperture + income - out;

    let topCard = '';
    if (!isDayStarted()) {
      topCard = `
       <div class="card" style="text-align:center; padding:24px; margin-bottom:16px; border:1px dashed var(--gold);">
         <h3 style="margin-bottom:8px;">🔑 Iniciar Jornada de Hoy</h3>
         <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">Ingresa el monto de caja inicial con el que ingresa el negocio.</p>
         <div style="max-width:240px; margin: 0 auto 16px;">
            <label style="display:block; text-align:left; font-size:12px; margin-bottom:4px; font-weight:bold;">Monto de Apertura ($)</label>
            <input type="text" id="apertureAmountInput" class="full" style="text-align:center; font-size:18px; font-weight:bold;" placeholder="0.00" value="0.00">
         </div>
         <button class="btn primary block" id="startDayBtnCash" style="width:100%;">Iniciar Día (Apertura)</button>
       </div>
      `;
    } else if (isDayClosed()) {
      topCard = `
       <div class="card" style="text-align:center; padding:24px; margin-bottom:16px; border: 1px solid var(--gold);">
         <h3 style="margin-bottom:8px; color:var(--gold);">🔒 Caja Cerrada</h3>
         <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">La jornada de hoy ha sido cerrada. No se permiten más transacciones.</p>
         <button class="btn primary" id="reopenCashBtn" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">🔓 Abrir nueva caja diaria</button>
       </div>
      `;
    } else {
      topCard = `
       <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap: 10px;">
         <button class="btn primary" id="newMove">＋ Movimiento</button>
         <button class="btn silver" id="closeDayBtn">Cerrar día</button>
       </div>
       <section class="grid cashGrid">
         <div class="card kpi"><small>Caja Inicial</small><strong class="goldText">${fmt(aperture)}</strong></div>
         <div class="card kpi"><small>Ingresos (Ventas)</small><strong class="goldText">${fmt(income)}</strong></div>
         <div class="card kpi"><small>Egresos</small><strong>${fmt(out)}</strong></div>
         <div class="card kpi"><small>Saldo Actual</small><strong class="goldText">${fmt(saldo)}</strong></div>
         <div class="card kpi"><small>Gastos</small><strong>${fmt(expenses)}</strong></div>
         <div class="card kpi"><small>Compras</small><strong>${fmt(compras)}</strong></div>
         <div class="card kpi"><small>Retiros</small><strong>${fmt(retiros)}</strong></div>
       </section>
      `;
    }

    const showMovementsList = isDayStarted();

    return `<div class="pageHead">
        <div>
          <h1>Caja diaria</h1>
          <p>Ingresos, egresos y cierre del día.</p>
        </div>
      </div>
      ${topCard}
      ${showMovementsList ? `
      <section class="card sectionCard" style="margin-top:14px">
         <h3>Movimientos de hoy</h3>
         <div class="movementList">
           ${mov.slice().reverse().map(m=>{
              const isCancelled = m.status === 'cancelled';
              const editDeleteButtons = (authUser().role === 'owner' && !isCancelled) ? `
                <div style="display:flex; gap:6px; margin-top:6px; justify-content:flex-end;">
                  <button class="btn silver" style="padding:2px 8px; font-size:11px; min-height:24px; font-weight:bold;" onclick="window.editMovement('${m.id}')">✎ Editar</button>
                  <button class="btn danger" style="padding:2px 8px; font-size:11px; min-height:24px; font-weight:bold;" onclick="window.deleteMovement('${m.id}')">🗑 Anular</button>
                </div>
              ` : '';
              const cancelledLabel = isCancelled ? `<br><span style="font-size:11px;color:#ff4d4d;font-weight:bold;">🚫 ANULADO por ${escapeHtml(m.cancelledBy || 'owner')} a las ${escapeHtml(m.cancelledAt || '')}</span>` : '';
              const textStyle = isCancelled ? 'text-decoration: line-through; opacity: 0.5;' : '';
              const amtDisplay = isCancelled ? `<span style="text-decoration:line-through;color:var(--muted);font-weight:normal;font-size:12px;margin-right:6px;">${fmt(m.originalAmount || 0)}</span><span style="color:#ff4d4d;">$0.00</span>` : `<span class="${m.kind==='ingreso'||m.kind==='apertura'?'pos':'neg'}">${m.kind==='ingreso'||m.kind==='apertura'?'+':'−'}${fmt(m.amount)}</span>`;

              return `<div class="movement" style="flex-direction:column; align-items:stretch; gap:4px; padding:10px 0; border-bottom:1px solid var(--line); ${textStyle}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span><b>${escapeHtml(labelKind(m.kind))}</b><br><small>${escapeHtml(m.note||'')}</small>${cancelledLabel}<br><span style="font-size:10px;color:var(--gold);opacity:0.8;">🧑‍💻 ${escapeHtml(m.createdBy||m.user||'Sistema')} • 🕒 ${escapeHtml(m.when || m.date || '')}</span></span>
                  <div style="text-align:right; font-weight:bold;">
                    ${amtDisplay}
                  </div>
                </div>
                ${editDeleteButtons}
              </div>`;
           }).join('') || '<p class="empty">No hay movimientos.</p>'}
         </div>
      </section>
      ` : ''}
      <section class="card sectionCard" style="margin-top:14px"><h3>Historial de Cierres</h3><div class="movementList">
         ${(state.dailyReports || []).filter(r=>r.businessId===currentBusiness().id).slice().reverse().slice(0,5).map(r=>`<div class="movement"><span>Cierre ${escapeHtml(r.date)}<br><small>Caja F.: ${fmt(r.closeCash)}</small></span><button class="btn silver" onclick="window.viewDailyReport('${r.id}')">Ver Imagen</button></div>`).join('') || '<p class="empty">No hay cierres previos.</p>'}
      </div></section>`;
  }
  function labelKind(k){ return ({apertura:'Apertura',ingreso:'Ingreso',egreso:'Gasto',compra:'Compra',retiro:'Retiro'})[k]||k; }

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

  function labelStatus(s) {
    if(s==='paid')return'Pagado';
    if(s==='pending_payment')return'Por cobrar';
    if(s==='layaway')return'Apartado';
    if(s==='cancelled')return'Anulado';
    return s;
  }

  function reportsView() {
    state.reportsFrom = state.reportsFrom || today();
    state.reportsTo = state.reportsTo || today();
    const allSales = salesForBiz();
    const sales = allSales.filter(s => s.date >= state.reportsFrom && s.date <= state.reportsTo);
    const tickets=sales.length;
    // Calculate total taking into account statuses
    const total=sales.filter(s=>s.status==='paid'||s.status==='layaway').reduce((a,s)=>a+(s.status==='layaway' ? (s.received||0) : s.total),0);
    const counts={}; sales.filter(s=>s.status!=='cancelled').forEach(s=>s.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return `<div class="pageHead"><div><h1>Reportes</h1><p>Resumen general de tu negocio.</p></div>
        <div style="display:flex; gap:8px;">
          <button class="btn silver" onclick="window.printReports('print')">Imprimir</button>
          <button class="btn primary" onclick="window.printReports('image')">Descargar Imagen (PNG)</button>
        </div>
      </div>
      <div class="card sectionCard" style="display:flex; gap:10px; margin-bottom:14px; align-items:center;">
        <div class="field full" style="margin:0;"><label>Desde</label><input type="date" id="repFrom" value="${state.reportsFrom}"></div>
        <div class="field full" style="margin:0;"><label>Hasta</label><input type="date" id="repTo" value="${state.reportsTo}"></div>
      </div>
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
            ${s.customerPhone ? `
            <button class="btn" style="min-height:32px; padding:6px 12px; font-size:12px; border:1px solid #25D366; color:#25D366; background:transparent;" onclick="window.sendWhatsAppReminder('${s.id}')">
               💬 Recordatorio
            </button>` : ''}
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
    return `<div class="pageHead"><div><h1>M\u00e1s</h1></div></div><section class="moreList">
      <button class="card bigRow" data-more="reports"><span>\u25A5 Reportes</span><b>\u203A</b></button>
      <button class="card bigRow" data-more="backup"><span>\u2601 Respaldo y nube</span><b>\u203A</b></button>
      <button class="card bigRow" data-more="workers">
        <span>\uD83D\uDC65 Trabajadores</span>
        <span style="display:flex; align-items:center; gap:6px;">
          <span id="pendingWorkersBadge" class="badge danger" style="display:none; padding:2px 6px; font-size:11px; border-radius:10px; background:#ff5c62; color:#fff;">0</span>
          <b>\u203A</b>
        </span>
      </button>
      <button class="card bigRow" data-more="settings"><span>\u2699 Ajustes</span><b>\u203A</b></button>
      <button class="card bigRow" id="helpBtn" style="border:1px solid rgba(244,196,49,0.2);"><span>\u2753 C\u00f3mo funciona CLICK 360</span><b>\u203A</b></button>
      <button class="btn block" id="logoutMore">Cerrar sesi\u00f3n</button>
    </section>`;
  }
  function backupView(){
    return `<div class="pageHead"><div><h1>Nube y Respaldo</h1><p>Sincronizaci\u00f3n y reportes contables.</p></div></div>
      <section class="card sectionCard">
        <h3>Nube CLICK 360</h3>
        <p class="cloudStatus" style="margin-bottom:10px; color:var(--gold);">\u2605 Sincronizaci\u00f3n en la nube Activa.</p>
        <p class="cloudStatus">Tus datos se guardan y protegen en tiempo real. Abre tu cuenta en cualquier dispositivo con tu correo y tendr\u00e1s la misma informaci\u00f3n.</p>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Reporte Contable General</h3>
        <p class="cloudStatus">Descarga el historial de ventas y movimientos de caja en Excel (CSV). Selecciona el rango de fechas.</p>
        <div class="formGrid" style="margin-bottom:12px;">
          <div class="field"><label>Desde</label><input type="date" id="csvDateFrom" value="${today()}"></div>
          <div class="field"><label>Hasta</label><input type="date" id="csvDateTo" value="${today()}"></div>
        </div>
        <button type="button" class="btn primary block" id="exportCsvBtn">\uD83D\uDCCA Descargar Historial (CSV)</button>
        <button type="button" class="btn block" id="sendReportBtn" style="margin-top:10px;border:1px solid #25D366;color:#25D366;background:transparent;">\uD83D\uDCE4 Enviar Reporte a Contadora (WhatsApp)</button>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Respaldo Manual (Copia de Seguridad)</h3><p class="cloudStatus">Guarda una copia de toda tu informaci\u00f3n en tu dispositivo o rest\u00e1urala si cambiaste de equipo.</p>
        <div class="split" style="gap:10px;"><button type="button" class="btn silver" id="backupBtn">\uD83D\uDCBE Guardar Respaldo</button><label class="btn silver" style="flex:1; text-align:center; display:flex; align-items:center; justify-content:center;"><input type="file" id="restoreFile" accept="application/json" hidden/>\uD83D\uDD04 Restaurar Respaldo</label></div>
      </section>`;
  }
  function workersView(){
    return `<div class="pageHead"><div><h1>Trabajadores</h1><p>Administra los accesos a tu negocio.</p></div></div>
      <section class="card sectionCard">
         <h3>Registrar Trabajador</h3>
         <form id="addWorkerForm" style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">
            <div class="field"><label>Nombre</label><input id="workerName" required placeholder="Ej. Juan Pérez"></div>
            <div class="field"><label>Correo de Google del Trabajador</label><input id="workerEmail" type="email" required placeholder="Ej. juan@gmail.com"></div>
            <button class="btn primary block" type="submit">➕ Registrar y Pre-Aprobar</button>
         </form>

         <div id="inviteLinkBox" style="display:none; margin-top:14px; background:rgba(55,213,126,0.1); border:1px solid rgba(55,213,126,0.3); padding:12px; border-radius:12px;">
            <small style="color:var(--green); display:block; margin-bottom:6px; font-weight:bold;">Enlace de Invitación:</small>
            <input type="text" id="inviteLinkVal" readonly style="width:100%; font-size:12px; margin-bottom:8px; background:#000; border:1px solid #444; color:#fff; padding:8px; border-radius:8px;">
            <button class="btn silver block" id="copyInviteLinkBtn" type="button">Copiar Enlace</button>
         </div>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
         <h3>Trabajadores Registrados</h3>
         <div id="workersList"></div>
      </section>`;
  }
  function settingsView(){
    const b=currentBusiness();
    const bizSettings = currentBusiness().settings || {};
    const iva = bizSettings.iva || 0;
    const ruc = bizSettings.ruc || '';
    const phone = bizSettings.phone || '';
    const address = bizSettings.address || '';
    const logoUrl = bizSettings.logoUrl || '';
    const bizOptions = state.businesses.map(x=>`<option value="${x.id}" ${x.id===b?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');

    return `<div class="pageHead"><div><h1>Ajustes</h1><p>Configura tu empresa.</p></div></div>
      <section class="card sectionCard">
        <h3>Datos del Negocio</h3>
        <div class="field" style="display:flex; flex-direction:column; align-items:center;">
          <div style="width:80px; height:80px; border-radius:50%; background:#222; border:1px solid #444; overflow:hidden; margin-bottom:10px; display:flex; justify-content:center; align-items:center;">
             ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" style="width:100%; height:100%; object-fit:cover;">` : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`}
          </div>
          <label class="btn silver" style="font-size:12px; padding:4px 8px; position:relative; display:inline-flex; justify-content:center; align-items:center; min-height:28px; gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Cambiar Logo
            <input type="file" id="bizLogoUpload" accept="image/*" hidden>
          </label>
        </div>
        <div class="field"><label>Nombre del Negocio</label><input id="bizName" value="${escapeHtml(b.name)}"></div>
        <div class="field"><label>RUC o Identificación</label><input id="bizRuc" value="${escapeHtml(ruc)}" placeholder="1234567890001"></div>
        <div class="field"><label>Teléfono</label><input id="bizPhone" type="tel" value="${escapeHtml(phone)}" placeholder="+593 999999999"></div>
        <div class="field"><label>Dirección del Local</label><input id="bizAddress" value="${escapeHtml(address)}" placeholder="Ej. Av. de los Shyris y Naciones Unidas"></div>
        <div class="field"><label>¿Cuál es tu negocio?</label><select id="bizType">${typeOptions(b.type)}</select></div>
        <div class="field"><label>IVA Global (%)</label><input type="number" inputmode="numeric" id="bizIva" value="${iva}" placeholder="0 para desactivar"></div>
        <button type="button" class="btn primary block" id="saveBiz">Guardar cambios</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px">
        <h3>Mi Perfil (Usuario)</h3>
        <div class="field" style="display:flex; flex-direction:column; align-items:center;">
          <div style="width:80px; height:80px; border-radius:50%; background:#222; border:1px solid #444; overflow:hidden; margin-bottom:10px; display:flex; justify-content:center; align-items:center;">
             ${authUser().photoURL ? `<img src="${escapeHtml(authUser().photoURL)}" style="width:100%; height:100%; object-fit:cover;">` : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" style="display:block; margin:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`}
          </div>
          <label class="btn silver" style="font-size:12px; padding:4px 8px; position:relative; display:inline-flex; justify-content:center; align-items:center; min-height:28px; gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Cambiar Foto de Perfil
            <input type="file" id="userPhotoUpload" accept="image/*" hidden>
          </label>
        </div>
        <div class="field"><label>Nombre de Usuario</label><input id="userName" value="${escapeHtml(authUser().name)}"></div>
        <button type="button" class="btn primary block" id="saveUser">Guardar Perfil</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px">
        <h3>Cambiar de Negocio</h3>
        <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">Selecciona el negocio que deseas ver y administrar actualmente.</p>
        <div class="field">
          <label>Negocio Activo</label>
          <select id="businessPickerSettings">${bizOptions}</select>
        </div>
      </section>

      <section class="card sectionCard" style="margin-top:14px">
        <h3>Agregar otro negocio</h3>
        <div class="field"><label>Nombre</label><input id="newBizName"></div>
        <div class="field"><label>Tipo</label><select id="newBizType">${typeOptions('otro')}</select></div>
        <div class="field"><label>RUC (Opcional)</label><input id="newBizRuc"></div>
        <div class="field"><label>Teléfono (Opcional)</label><input id="newBizPhone"></div>
        <button type="button" class="btn silver block" id="createBiz">Crear negocio</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px; border:1px solid #4a1c1c;">
        <h3 style="color:#d9534f;">Zona de Peligro</h3>
        <button type="button" class="btn danger block" id="resetInventoryBtn" style="margin-bottom:10px;">Reiniciar Inventario</button>
        <button type="button" class="btn danger block" id="resetSystemBtn">Borrar Todo el Sistema (Empezar de cero)</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px; text-align:center;">
        <h3>Soporte y Legales</h3>
        <button type="button" class="btn" style="border:1px solid #25D366; color:#25D366; background:transparent; width:100%; margin-bottom:12px;" onclick="window.open('https://wa.me/593969399562?text=Hola,%20necesito%20soporte%20con%20CLICK%20360', '_blank')">📱 Contactar Soporte (WhatsApp)</button>
        <p style="font-size:11px; color:#888; line-height:1.4;">Al usar el sistema, aceptas los <a href="#" id="showTerms" style="color:var(--gold); text-decoration:underline;">Términos y Condiciones</a>.</p>
      </section>`;
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
    if(r==='reports') bindReports();
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
    
    // Bind template deletion
    $$('[data-del-tpl]').forEach(btn => {
       btn.onclick = () => {
          if (confirm('¿Estás seguro de eliminar esta plantilla de etiquetas?')) {
             const tplId = btn.dataset.delTpl;
             state.settings ||= {};
             state.settings.labelTemplates = (state.settings.labelTemplates || []).filter(t => t.id !== tplId);
             save();
             renderApp('inventory');
             toast('Plantilla eliminada');
          }
       };
    });

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
    showModal(`<div class="modalHeader"><h2>${product?'Editar':(v.singular==='prenda'?'Nueva':'Nuevo')} ${escapeHtml(v.singular)}</h2><button class="closeBtn" data-close>×</button></div>
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
        <div class="field"><label>Precio (Efectivo)</label><input id="pPrice" inputmode="decimal" value="${String(p.price||0).replace('.',',')}"></div>
        <div class="field"><label>Precio con Tarjeta</label><input id="pCardPrice" inputmode="decimal" value="${String(p.cardPrice||p.price||0).replace('.',',')}"></div>
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

    // Restrict inputs to numeric values only
    const qtyIn = $('#pQty');
    if (qtyIn) qtyIn.oninput = () => { qtyIn.value = qtyIn.value.replace(/[^0-9]/g, ''); };
    const costIn = $('#pCost');
    if (costIn) costIn.oninput = () => { costIn.value = costIn.value.replace(/[^0-9.,]/g, ''); };
    const priceIn = $('#pPrice');
    if (priceIn) priceIn.oninput = () => { priceIn.value = priceIn.value.replace(/[^0-9.,]/g, ''); };
    const cardPriceIn = $('#pCardPrice');
    if (cardPriceIn) cardPriceIn.oninput = () => { cardPriceIn.value = cardPriceIn.value.replace(/[^0-9.,]/g, ''); };

    $('#productForm').onsubmit=e=>{
      e.preventDefault();
      const name=$('#pName').value.trim();
      const qty=parseInt($('#pQty').value||'0',10);
      const cost=parseMoney($('#pCost').value);
      const price=parseMoney($('#pPrice').value);
      const cardPrice=parseMoney($('#pCardPrice').value) || price;
      let code=($('#pCode').value.trim() || generateCode(name)).toUpperCase();
      if(!name) return toast('Falta el nombre','err');
      if(!Number.isFinite(qty)||qty<0) return toast('Cantidad inválida','err');
      if(!Number.isFinite(cost)||cost<0) return toast('Costo inválido','err');
      if(!Number.isFinite(price)||price<0) return toast('Precio inválido','err');
      if(!Number.isFinite(cardPrice)||cardPrice<0) return toast('Precio con tarjeta inválido','err');
      if(codeExists(code, product?.id)) return toast('Ese código ya existe','err');
      if(product) Object.assign(product,{code,category:$('#pCat').value.trim(),name,qty,cost,price,cardPrice,notes:$('#pNotes').value.trim(),imageData, updatedBy: authUser().name});
      else state.products.push({id:uid('prod'),businessId:b.id,code,category:$('#pCat').value.trim(),name,qty,cost,price,cardPrice,notes:$('#pNotes').value.trim(),imageData,createdAt:new Date().toISOString(), createdBy: authUser().name});
      save(); closeModal(); renderApp('inventory'); toast(product?'Producto actualizado con éxito':'Producto creado con éxito', 'ok');
    };
  }
  function deleteProduct(id){ if(confirm('¿Borrar este registro?')){ const p=state.products.find(x=>x.id===id); if(p) { state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'egreso',amount:0,note:`Eliminó producto: ${p.name}`, createdBy: authUser().name}); } state.products=state.products.filter(x=>x.id!==id); save(); renderApp('inventory'); toast('Eliminado'); } }

  function bindSell(){
    if(!$('#payMethod')) return;
    let cart=[];
    let currentIva = (currentBusiness().settings || {}).iva || 0;
    
    const renderCart=()=>{
      const method = $('#payMethod').value;
      const isCard = method === 'Tarjeta';
      const subtotal=cart.reduce((a,i)=>a+(isCard ? i.cardPrice : i.price)*i.qty,0), disc=parseMoney($('#discount')?.value||0);
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

      $('#cartItems').innerHTML=cart.length?cart.map(i=>`<div class="cartItem cartWithImage">${i.imageData ? `<img class="productImg small" src="${i.imageData}" alt="${escapeHtml(i.name)}">` : '<div class="productImg small emptyImg">▧</div>'}<div><b>${escapeHtml(i.name)}</b><br><small>${fmt(isCard ? i.cardPrice : i.price)} /u · ${escapeHtml(i.code)}</small></div><div class="qtyControls"><button type="button" data-minus="${i.id}">−</button><b>${i.qty}</b><button type="button" data-plus="${i.id}">＋</button><button type="button" class="iconBtn danger" data-remove="${i.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`).join(''):'<p class="empty">Vacío. Agrega productos para vender.</p>';
      $$('[data-minus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.minus); if(it.qty>1)it.qty--; else cart=cart.filter(x=>x.id!==it.id); renderCart();});
      $$('[data-plus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.plus); const p=state.products.find(p=>p.id===it.id); it.qty++; renderCart();});
      $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.remove); renderCart();});
      
      const recF = $('#receivedField'), chgF = $('#changeField'), lblCustomer = $('#lblCustomer');
      
      if (method === 'Apartado' || method === 'Pendiente') {
        lblCustomer.innerHTML = 'Cliente (Nombre) <b>*Obligatorio</b>';
      } else {
        lblCustomer.textContent = 'Cliente (opcional)';
      }

      const dueField = $('#layawayDueDateField');
      if (method === 'Apartado') {
         if (dueField) {
            dueField.style.display = 'grid';
            const dueInput = $('#layawayDueDate');
            if (dueInput && !dueInput.value) {
               const future = new Date();
               future.setDate(future.getDate() + 30);
               dueInput.value = future.toISOString().slice(0, 10);
            }
         }
      } else {
         if (dueField) dueField.style.display = 'none';
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
    
    const discIn = $('#discount'), cashRecIn = $('#cashReceived');
    if (discIn) { discIn.oninput = () => { discIn.value = discIn.value.replace(/[^0-9.,]/g, ''); renderCart(); }; }
    if (cashRecIn) { cashRecIn.oninput = () => { cashRecIn.value = cashRecIn.value.replace(/[^0-9.,]/g, ''); renderCart(); }; }

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
      else cart.push({id:p.id,name:p.name,price:p.price,cardPrice:p.cardPrice||p.price,qty:1,code:p.code,imageData:p.imageData||''});
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
             $('#customerCedula').value = '';
             $('#customerPhone').value = '';
             renderCart();
             toast('Carrito limpio');
          }
       };
    }

    $('#addCode').onclick=()=>{ 
        const v = $('#manualCode').value.trim();
        if(v) { addProduct(v); $('#manualCode').value=''; }
        else {
            const name = prompt("Nombre del producto/servicio (Ej: Venta Libre):");
            if (!name) return;
            const priceRaw = prompt("Precio ($):");
            const price = parseMoney(priceRaw);
            if (!Number.isFinite(price) || price < 0) return toast("Precio inválido", "err");
            cart.push({ id: 'custom_'+Date.now(), name, price, cardPrice: price, qty: 1, isCustom: true, category: 'Venta Libre', code: 'MANUAL' });
            renderCart();
            toast('Producto manual agregado');
        }
    };
    $('#manualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addCode').click();}});
    $('#sellSearch').oninput=()=>{ const q=$('#sellSearch').value.toLowerCase(); const list=productsForBiz().filter(p=>p.name.toLowerCase().includes(q)||p.code.toLowerCase().includes(q)).slice(0,8); $('#quickProducts').innerHTML=list.map(p=>`<button class="card bigRow quickProduct" data-quick="${p.code}">${imageThumb(p)}<span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.code)} · ${p.qty} disp.</small></span><b>${fmt(p.price)}</b></button>`).join(''); $$('[data-quick]').forEach(b=>b.onclick=()=>addProduct(b.dataset.quick)); };
    $('#openCamera').onclick=()=>startScanner(addProduct);
    $('#chargeBtn').onclick=()=>{
      if(!cart.length){ beep('err'); return toast('El carrito está vacío','err'); }
      const disc=parseMoney($('#discount').value);
      if(!Number.isFinite(disc)||disc<0){ beep('err'); return toast('Descuento inválido','err'); }
      
      const method = $('#payMethod').value;
      const isCard = method === 'Tarjeta';
      const subtotal=cart.reduce((a,i)=>a+(isCard ? i.cardPrice : i.price)*i.qty,0);
      if(disc>subtotal){ beep('err'); return toast('El descuento supera el subtotal','err'); }
      
      let base = Math.max(0, subtotal - disc);
      let ivaAmount = 0;
      if (currentIva > 0) ivaAmount = base * (currentIva / 100);
      const total = base + ivaAmount;

      for(const i of cart){ const p=state.products.find(p=>p.id===i.id); if(!p||p.qty<i.qty){ beep('err'); return toast(`Stock insuficiente: ${i.name}`,'err'); } }
      
      const rec = parseMoney($('#cashReceived').value);
      let received = 0; let change = 0; let balance = 0;
      let status = "paid";

      const customerName = $('#customer').value.trim();
      const customerCedulaVal = $('#customerCedula').value.trim();
      const customerPhoneVal = $('#customerPhone').value.trim();
      
      if ((method === 'Apartado' || method === 'Pendiente') && (!customerName || !customerPhoneVal || !customerCedulaVal)) {
         beep('err'); return toast('Debe ingresar el Nombre, Cédula y Teléfono del Cliente para cuentas por cobrar','err');
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

      const sale={
        id:uid('sale'),
        businessId:currentBusiness().id,
        date:today(),
        when:nowLabel(),
        items:cart.map(i=>({
          id: i.id,
          name: i.name,
          price: isCard ? i.cardPrice : i.price,
          qty: i.qty,
          code: i.code,
          category: i.category || 'General'
        })),
        subtotal:base,
        iva:ivaAmount,
        discount:disc,
        total,
        method,
        customer:customerName,
        customerCedula:customerCedulaVal,
        customerPhone:customerPhoneVal,
        dueDate: method === 'Apartado' ? $('#layawayDueDate').value : null,
        user:session.username,
        status,
        received,
        change,
        balance,
        createdBy: authUser().name
      };
      state.sales.push(sale);
      cart.forEach(i=>{ const p=state.products.find(p=>p.id===i.id); if(p) p.qty-=i.qty; });
      
      let movAmount = (method === 'Apartado') ? received : (method === 'Pendiente' ? 0 : total);
      if(movAmount > 0) {
        state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'ingreso',amount:movAmount,note:`Venta ${sale.method}`,user:session.username, saleId: sale.id, createdBy: authUser().name});
      }
      
      save(); cart=[]; renderCart(); $('#cashReceived').value='';
      $('#customer').value = '';
      $('#customerCedula').value = '';
      $('#customerPhone').value = '';
      beep('sale'); toast(`Venta registrada · ${fmt(total)}`);
      
      setTimeout(() => {
        if(window.printReceipt) window.printReceipt(sale.id);
      }, 500);
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
      try {
        scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:currentFacingMode}});
      } catch(e) {
        scanStream=await navigator.mediaDevices.getUserMedia({video:true});
      }
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
    const btnReopenCash = $('#reopenCashBtn');
    if (btnReopenCash) {
      btnReopenCash.onclick = () => {
        if (confirm('¿Estás seguro de que deseas abrir una nueva caja diaria para hoy?\nEsto anulará el cierre actual y te permitirá iniciar una nueva jornada.')) {
          const bid = currentBusiness()?.id;
          if (bid) {
            state.dailyReports = (state.dailyReports || []).filter(r => !(r.businessId === bid && r.date === today()));
            state.movements = (state.movements || []).filter(m => !(m.businessId === bid && m.date === today() && m.kind === 'apertura'));
            save();
            renderApp('cash');
            toast('Caja diaria reabierta exitosamente');
          }
        }
      };
    }

    if (!isDayStarted()) {
       const startBtn = $('#startDayBtnCash');
       const inputEl = $('#apertureAmountInput');
       if (inputEl) {
         inputEl.oninput = () => { inputEl.value = inputEl.value.replace(/[^0-9.,]/g, ''); };
       }
       if (startBtn) {
          startBtn.onclick = () => {
             const amt = parseMoney(inputEl.value);
             if (!Number.isFinite(amt) || amt < 0) return toast('Monto de apertura inválido', 'err');
             state.movements.push({
               id: uid('mov'),
               businessId: currentBusiness().id,
               date: today(),
               when: nowLabel(),
               kind: 'apertura',
               amount: amt,
               note: 'Apertura de caja diaria',
               createdBy: authUser().name
             });
             save();
             renderApp('cash');
             toast('Jornada iniciada exitosamente');
          };
       }
       return;
    }

    const btnNewMove = $('#newMove');
    if (btnNewMove) {
      btnNewMove.onclick=()=>{
        showModal(`<div class="modalHeader"><h2>Nuevo movimiento</h2><button class="closeBtn" data-close>×</button></div><form id="moveForm"><div class="field"><label>Tipo</label><select id="mKind"><option value="egreso">Gasto</option><option value="compra">Compra</option><option value="retiro">Retiro</option><option value="ingreso">Ingreso</option></select></div><div class="field"><label>Monto</label><input id="mAmount" inputmode="decimal" value="0"></div><div class="field"><label>Nota</label><input id="mNote" required></div><button type="submit" class="btn primary block">Guardar</button></form>`);
        
        const mAmountInput = $('#mAmount');
        if (mAmountInput) {
          mAmountInput.oninput = () => { mAmountInput.value = mAmountInput.value.replace(/[^0-9.,]/g, ''); };
        }

        $('#moveForm').onsubmit = (e) => {
          e.preventDefault();
          const k=$('#mKind').value, a=parseMoney($('#mAmount').value), n=$('#mNote').value.trim();
          if(!Number.isFinite(a)||a<=0) return toast('Monto inválido','err');
          state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:k,amount:a,note:n, createdBy: authUser().name});
          save();
          closeModal(); renderApp('cash'); toast('Guardado');
        };
      };
    }

    const btnCloseDay = $('#closeDayBtn');
    if (btnCloseDay) {
      btnCloseDay.onclick=()=>{
        const apertureMov = movementsForBiz().find(m => m.date === today() && m.kind === 'apertura');
        const lastCash = apertureMov ? apertureMov.amount : (currentBusiness().lastCashBalance || 0);
        showModal(`<div class="modalHeader"><h2>Cerrar día</h2><button class="closeBtn" data-close>×</button></div>
          <form id="closeDayForm" class="formGrid">
            <div class="field full"><label>Caja Inicial (Auto-cuadre)</label><input id="cajaInicial" value="${lastCash}" inputmode="decimal"></div>
            <div class="field full"><label>Efectivo Físico (Contado)</label><input id="efectivoFisico" value="0" inputmode="decimal"></div>
            <div class="field full"><label>Observaciones</label><input id="cierreObs"></div>
            <button class="btn silver" type="button" data-close>Cancelar</button>
            <button class="btn primary block" type="submit">Generar Cierre</button>
          </form>`);
        
        const cInicialInput = $('#cajaInicial'), eFisicoInput = $('#efectivoFisico');
        if (cInicialInput) cInicialInput.oninput = () => { cInicialInput.value = cInicialInput.value.replace(/[^0-9.,]/g, ''); };
        if (eFisicoInput) eFisicoInput.oninput = () => { eFisicoInput.value = eFisicoInput.value.replace(/[^0-9.,]/g, ''); };

        $('#closeDayForm').onsubmit = (e) => {
           e.preventDefault();
           const cInicial = parseMoney($('#cajaInicial').value);
           const eFisico = parseMoney($('#efectivoFisico').value);
           if(!Number.isFinite(cInicial) || !Number.isFinite(eFisico)){ return toast('Montos inválidos', 'err'); }
           
           const mov=movementsForBiz().filter(m=>m.date===today());
           const income=mov.filter(m=>m.kind==='ingreso').reduce((a,m)=>a+m.amount,0);
           const out=mov.filter(m=>m.kind!=='ingreso' && m.kind!=='apertura').reduce((a,m)=>a+m.amount,0);
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
           
           const bizSettings = currentBusiness().settings || {};
           const ruc = bizSettings.ruc ? `<div style="text-align:center; font-size:10px;">RUC/ID: ${escapeHtml(bizSettings.ruc)}</div>` : '';
           const phone = bizSettings.phone ? `<div style="text-align:center; font-size:10px;">Tel: ${escapeHtml(bizSettings.phone)}</div>` : '';
           const logoUrl = bizSettings.logoUrl ? `<div style="text-align:center; margin-bottom:6px;"><img src="${escapeHtml(bizSettings.logoUrl)}" style="max-width:80px; max-height:80px; object-fit:contain;"></div>` : '';

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
            <div style="margin-top:10px; text-align:center;">Generado por: ${escapeHtml(authUser().name || 'Usuario')}</div>
            </div>`;
           
           closeModal();
           showModal(`<div class="modalHeader"><h2>Resumen de Cierre</h2><button class="closeBtn" data-close>×</button></div>
             <div style="background:#fff; border-radius:8px; border:1px solid #ccc; max-height:40vh; overflow-y:auto; margin-bottom:15px; padding:10px; display:flex; justify-content:center;">
               <div id="pdfContentPreview" style="transform: scale(0.85); transform-origin: top center;">
                 ${html}
               </div>
             </div>
             <div style="display:flex; gap:10px;">
                 <button class="btn silver block" id="printCierreBtn">Imprimir</button>
                 <button class="btn primary block" id="downloadImgCierreBtn">Descargar Imagen (PNG)</button>
             </div>
           `);
           
           $('#printCierreBtn').onclick = () => {
               const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
               root.innerHTML = html;
               setTimeout(()=>window.print(), 250);
           };
           
           $('#downloadImgCierreBtn').onclick = () => {
                toast('Generando Imagen...');
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                wrapper.style.position = 'fixed'; wrapper.style.top = '0'; wrapper.style.left = '0'; wrapper.style.width = '480px'; wrapper.style.zIndex = '-9999'; wrapper.style.pointerEvents = 'none';
                document.body.appendChild(wrapper);
                
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                script.onload = () => {
                  window.html2canvas(wrapper.firstElementChild, { scale: 2 }).then(canvas => {
                    const a = document.createElement('a');
                    a.href = canvas.toDataURL('image/png');
                    a.download = `Cierre_Caja_${today()}.png`;
                    a.click();
                    document.body.removeChild(wrapper);
                    toast('Imagen descargada');
                  });
                };
                document.head.appendChild(script);
            };
           
           const repId = uid('rep');
           state.dailyReports.push({ id: repId, businessId: currentBusiness().id, date: today(), closeCash: eFisico, html });
           currentBusiness().lastCashBalance = eFisico;
           save();
           renderApp('cash');
           
           toast('Cierre del día generado');
        };
      };
    }
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
     
     $('#helpBtn')?.addEventListener('click', () => {
       showModal(`<div class="modalHeader"><h2>\u00bfC\u00f3mo funciona CLICK 360?</h2><button class="closeBtn" data-close>\u00d7</button></div>
         <div style="max-height:60vh;overflow-y:auto;padding:4px;">
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83C\uDFE0 Inicio</h3>
             <p>Ve un resumen de tus ventas, caja, inventario y stock bajo del d\u00eda.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCE6 Inventario</h3>
             <p>Registra productos con nombre, c\u00f3digo, precio, stock e imagen. Genera etiquetas QR personalizables para imprimir. Busca por nombre o escanea c\u00e1digos QR con la c\u00e1mara.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDED2 Vender</h3>
             <p>Escanea QR o busca productos para vender. Selecciona m\u00e9todo de pago (efectivo, tarjeta, transferencia, apartado). Genera comprobantes de venta imprimibles en formato t\u00e9rmico 80mm.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCB0 Caja Diaria</h3>
             <p>Inicia el d\u00eda con un monto de apertura. Registra ingresos, egresos, gastos y compras. Al final del d\u00eda, cierra caja con un reporte completo.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCCA Reportes</h3>
             <p>Ve el historial de ventas por d\u00eda con detalles de cada transacci\u00f3n. Identifica productos m\u00e1s vendidos y ventas anuladas.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">☁️ Nube y Respaldo</h3>
             <p>Descarga reportes contables en CSV con filtro por fecha. Envía reportes a tu contadora por WhatsApp. Guarda y restaura respaldos manuales.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDC65 Trabajadores</h3>
             <p>Registra trabajadores por correo. Envía enlaces de invitación. Controla el acceso de cada persona a tu negocio.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">⚙️ Ajustes</h3>
             <p>Configura nombre, RUC, teléfono, dirección, logo e IVA de tu negocio. Estos datos se reflejan en los comprobantes de venta y cierre de caja.</p>
           </div>
           <div style="background:rgba(244,196,49,0.08);padding:12px;border-radius:12px;border:1px solid rgba(244,196,49,0.2);">
             <p style="margin:0;font-size:13px;"><b style="color:var(--gold);">🔒 Seguridad:</b> Los datos se protegen en la nube.</p>
           </div>
         </div>`);
     });
     
     // Check for pending workers in background to toggle badge
     if (window.click360User && window.click360User.role === 'owner') {
        const workers = state.settings?.workers || [];
        const pendingCount = 0; // Simplified for this iteration
        const badge = $('#pendingWorkersBadge');
        if (badge) {
            badge.style.display = 'none';
        }
     }
  }

  async function bindWorkers() {
    const list = $('#workersList');
    if (!window.click360User || window.click360User.role !== 'owner') {
      list.innerHTML = '<p class="empty">Solo el dueño puede administrar trabajadores.</p>';
      const form = $('#addWorkerForm');
      if (form) form.style.display = 'none';
      return;
    }

    const loadWorkers = () => {
      const workers = state.settings?.workers || [];
      if (workers.length === 0) {
        list.innerHTML = '<p class="empty">No hay trabajadores registrados.</p>';
        return;
      }
      
      list.innerHTML = workers.map(w => {
        const avatarHtml = `<div style="width:32px; height:32px; border-radius:50%; background:#222; border:1px solid #444; display:flex; justify-content:center; align-items:center; font-weight:bold; color:var(--gold); font-size:12px;">${(w.name || 'W').charAt(0).toUpperCase()}</div>`;
        return `
          <div class="movement" style="align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--line);">
             ${avatarHtml}
             <div style="flex:1;">
               <b>${escapeHtml(w.name)}</b>
               <span class="badge green" style="margin-left:6px; font-size:10px; padding:2px 6px;">Activo</span>
               <br><small style="color:#aaa;">${escapeHtml(w.email)}</small>
             </div>
             <div>
                <button class="btn danger" style="padding:4px 8px; font-size:12px; min-height:28px;" data-del-worker="${escapeHtml(w.email)}">Eliminar</button>
             </div>
          </div>
        `;
      }).join('');

      // Bind delete handlers
      $$('[data-del-worker]').forEach(btn => {
        btn.onclick = async () => {
          const email = btn.dataset.delWorker.toLowerCase();
          if (!confirm(`¿Estás seguro de eliminar el acceso para ${email}?`)) return;
          
          btn.textContent = '...';
          btn.disabled = true;
          
          // Find UID if worker has logged in
          const workersList = state.settings?.workers || [];
          const match = workersList.find(w => w.email.toLowerCase() === email);
          
          // Remove from local list
          state.settings.workers = (state.settings.workers || []).filter(w => w.email.toLowerCase() !== email);
          save();
          
          // Cancel invite in Firestore if worker hasn't registered yet
          if (window.click360CancelInviteEmail) {
             await window.click360CancelInviteEmail(email);
          }
          
          // Try to remove worker doc in approvedUsers if worker already registered
          if (match && match.uid && window.click360RemoveWorkerUid) {
             await window.click360RemoveWorkerUid(match.uid);
          }
          
          toast('Acceso removido');
          renderApp('workers');
        };
      });
    };

    loadWorkers();

    $('#addWorkerForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#workerName').value.trim();
      const email = $('#workerEmail').value.trim().toLowerCase();
      
      const workers = state.settings?.workers || [];
      const activeCount = workers.length;
      if (activeCount >= 2) {
         return toast('Límite de 2 trabajadores activos alcanzado en plan gratuito.', 'err');
      }
      
      if (workers.some(w => w.email.toLowerCase() === email)) {
         return toast('Este correo ya está registrado', 'err');
      }

      const submitBtn = $('#addWorkerForm button[type="submit"]');
      submitBtn.textContent = 'Procesando...';
      submitBtn.disabled = true;

      try {
         // 1. Write invite to Firestore approvedUsersByEmail
         if (window.click360InviteWorkerEmail) {
            await window.click360InviteWorkerEmail(email, name);
         }
         
         // 2. Add to local storage settings list
         state.settings ||= {};
         state.settings.workers ||= [];
         state.settings.workers.push({ email, name, status: 'active' });
         save();
         
         // 3. Display invite link PWA-compatible
         $('#inviteLinkBox').style.display = 'block';
         const inviteLink = window.location.origin + window.location.pathname + "?invite=true&ownerId=" + window.click360User.uid;
         $('#inviteLinkVal').value = inviteLink;
         
         toast('Trabajador registrado y pre-aprobado', 'ok');
         loadWorkers();
         
         // Reset fields
         $('#workerName').value = '';
         $('#workerEmail').value = '';
      } catch(err) {
         toast('Error al registrar: ' + err.message, 'err');
      } finally {
         submitBtn.textContent = '➕ Registrar y Pre-Aprobar';
         submitBtn.disabled = false;
      }
    };

    $('#copyInviteLinkBtn').onclick = () => {
       const el = $('#inviteLinkVal');
       el.select();
       document.execCommand('copy');
       toast('Enlace copiado al portapapeles');
    };
  }

  function bindReports(){
      $('#repFrom').onchange = (e) => { state.reportsFrom = e.target.value; save(); renderApp('reports'); };
      $('#repTo').onchange = (e) => { state.reportsTo = e.target.value; save(); renderApp('reports'); };
  }

  function bindSettings(){
    let pendingLogoUrl = (currentBusiness().settings || {}).logoUrl || '';
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

    let pendingUserPhotoUrl = authUser().photoURL || '';
    const userPhotoUpload = $('#userPhotoUpload');
    if (userPhotoUpload) {
      userPhotoUpload.addEventListener('change', (e) => {
         readImageInput(e.target, (data) => {
            if (data) {
              pendingUserPhotoUrl = data;
              e.target.parentElement.previousElementSibling.innerHTML = `<img src="${data}" style="width:100%; height:100%; object-fit:cover;">`;
            }
         });
      });
    }

    $('#saveUser').onclick = async () => {
       const newName = $('#userName').value.trim();
       if(!newName) return toast('Falta el nombre de usuario', 'err');
       
       if (window.click360User) {
         window.click360User.name = newName;
         window.click360User.photoURL = pendingUserPhotoUrl;
         
         // Update in Firestore approvedUsers if DB available
         if (window.click360Db && window.click360User.uid) {
           try {
             $('#saveUser').textContent = 'Guardando...';
             $('#saveUser').disabled = true;
             await window.click360Db.collection("approvedUsers").doc(window.click360User.uid).update({
               name: newName,
               photoURL: pendingUserPhotoUrl
             });
             toast('Perfil actualizado en la nube');
           } catch(e) {
             console.error("Error actualizando perfil en nube:", e);
             toast('Error al actualizar en la nube', 'err');
           } finally {
             $('#saveUser').textContent = 'Guardar Perfil';
             $('#saveUser').disabled = false;
           }
         } else {
           toast('Perfil guardado localmente');
         }
       } else {
         toast('Perfil guardado localmente');
       }
       renderApp('settings');
    };

    $('#saveBiz').onclick=()=>{
       const b=currentBusiness(); 
       b.name=$('#bizName').value.trim()||b.name; 
       b.type=$('#bizType').value; 
       currentBusiness().settings = currentBusiness().settings || {};
       currentBusiness().settings.iva = parseFloat($('#bizIva').value) || 0;
       currentBusiness().settings.ruc = $('#bizRuc') ? $('#bizRuc').value.trim() : '';
       currentBusiness().settings.phone = $('#bizPhone') ? $('#bizPhone').value.trim() : '';
       currentBusiness().settings.address = $('#bizAddress') ? $('#bizAddress').value.trim() : '';
       if (pendingLogoUrl) currentBusiness().settings.logoUrl = pendingLogoUrl;
       save(); renderApp('settings'); toast('Guardado');
    };
    $('#createBiz').onclick=()=>{
      const name=$('#newBizName').value.trim(); 
      if(!name)return toast('Falta el nombre','err'); 
      const b={id:uid('biz'),code:'EMPRESA-'+String(state.businesses.length+1).padStart(3,'0'),name,type:$('#newBizType').value,status:'activo',due:'2026-07-08', settings:{}}; 
      b.settings.ruc = $('#newBizRuc').value.trim();
      b.settings.phone = $('#newBizPhone').value.trim();
      b.settings.address = '';
      state.businesses.push(b); 
      state.activeBusinessId=b.id; 
      const user=currentUser(); 
      if(user&&!user.businessIds.includes(b.id))user.businessIds.push(b.id); 
      save(); renderApp('settings'); toast('Negocio creado');
    };

    const pickSettings = $('#businessPickerSettings');
    if (pickSettings) {
      pickSettings.onchange = () => {
        state.activeBusinessId = pickSettings.value;
        save();
        renderApp('settings');
        toast('Cambiaste de negocio');
      };
    }

    $('#resetInventoryBtn').onclick = async () => {
       const backupFirst = confirm('⚠️ ADVERTENCIA DE SEGURIDAD ⚠️\nSe borrará todo el inventario de esta empresa. Esta acción no se puede deshacer.\n\n¿Deseas descargar un respaldo en tu computadora antes de borrar? (Se recomienda presionar Aceptar para descargar el respaldo de seguridad, o Cancelar si quieres borrar directamente).');
       if (backupFirst) {
          downloadBackup();
       }
       const confirmWord = prompt('Para confirmar que deseas borrar TODO el inventario del negocio actual, escribe la palabra "BORRAR":');
       if (confirmWord !== 'BORRAR') {
          return toast('Acción cancelada', 'err');
       }
       state.products = state.products.filter(p => p.businessId !== currentBusiness().id);
       save();
       if (window.click360SyncNow) {
         toast('Sincronizando...');
         await window.click360SyncNow();
       }
       toast('Inventario reiniciado.');
       renderApp('settings');
    };

    $('#resetSystemBtn').onclick = async () => {
       if (authUser().role !== 'owner') {
         return toast('Solo el dueño de la cuenta puede borrar el sistema.', 'err');
       }
       const backupFirst = confirm('🚨 ALERTA CRÍTICA DE SEGURIDAD 🚨\nSe eliminarán de forma permanente e irreversible TODOS los datos del negocio (prendas, ventas, movimientos y reportes diarios).\n\n¿Deseas descargar un respaldo de seguridad en tu computadora antes de borrar? (Se recomienda presionar Aceptar para descargar el respaldo, o Cancelar si deseas borrar directamente).');
       if (backupFirst) {
          downloadBackup();
       }
       const confirmWord = prompt('Para confirmar el borrado total e irreversible de todo el sistema, escribe la palabra "REINICIAR TODO":');
       if (confirmWord !== 'REINICIAR TODO') {
          return toast('Acción cancelada', 'err');
       }
       state.products = [];
       state.sales = [];
       state.dailyReports = [];
       state.movements = [{
         id: uid('mov'),
         businessId: currentBusiness().id,
         date: today(),
         when: nowLabel(),
         kind: 'retiro',
         amount: 0,
         note: `Sistema reiniciado por: ${authUser().name}`,
         createdBy: authUser().name
       }];
       save();
       if (window.click360SyncNow) {
         toast('Sincronizando...');
         await window.click360SyncNow();
       }
       toast('Sistema reiniciado.');
       window.location.reload();
    };

    $('#showTerms').onclick = (e) => {
       e.preventDefault();
       showModal(`<div class="modalHeader"><h2>Términos y Condiciones</h2><button class="closeBtn" data-close>×</button></div>
       <div style="padding:16px; font-size:13px; line-height:1.5; color:#ccc;">
         <p>Al usar el sistema, aceptas los Términos y Condiciones. El usuario reconoce y acepta que el software está sujeto a cambios o a ediciones, y que ha sido entregado, revisado y aprobado por el cliente final.</p>
       </div>`);
    };
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

  async function drawLabelOnCanvas(canvas, product, options) {
    const scale = options.scale || 3;
    const w = 260 * scale;
    const h = 380 * scale;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    
    // Background color
    ctx.fillStyle = options.bgColor || '#ffffff';
    roundRect(ctx, 0, 0, w, h, 18 * scale, true, false);
    
    // Text and QR color
    const fg = options.fgColor || '#000000';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    
    // Business name
    ctx.font = `900 ${16 * scale}px Arial`;
    ctx.fillText(currentBusiness().name.toUpperCase(), w / 2, 35 * scale);
    
    // Local address (under name, small)
    let yOffset = 52 * scale;
    if (options.address) {
       ctx.font = `${9 * scale}px Arial`;
       ctx.fillText(options.address, w / 2, yOffset);
       yOffset += 14 * scale;
    }
    
    // QR Code (centered)
    const qrCanvas = document.createElement('canvas');
    QR.draw(qrCanvas, productPayload(product), 170 * scale, 5, fg, options.qrBgColor || options.bgColor || '#ffffff');
    ctx.drawImage(qrCanvas, (w - 170 * scale) / 2, yOffset);
    
    // QR Footer text ("Sistema contable Click 360")
    yOffset += 185 * scale;
    ctx.font = `${8 * scale}px Arial`;
    ctx.fillText("Sistema contable Click 360", w / 2, yOffset);
    
    // Barcode Code text
    yOffset += 18 * scale;
    ctx.font = `${10 * scale}px monospace`;
    ctx.fillText(product.code, w / 2, yOffset);
    
    // Product Name
    yOffset += 24 * scale;
    ctx.font = `900 ${16 * scale}px Arial`;
    ctx.fillText(product.name, w / 2, yOffset);
    
    // Prices with legend (incluye IVA)
    yOffset += 28 * scale;
    ctx.font = `900 ${18 * scale}px Arial`;
    
    const priceText = product.cardPrice && product.cardPrice !== product.price ? 
      `Efectivo: ${fmt(product.price)} / Tarjeta: ${fmt(product.cardPrice)}` : 
      fmt(product.price);
    
    ctx.fillText(priceText, w / 2, yOffset);
    
    yOffset += 14 * scale;
    ctx.font = `900 ${9 * scale}px Arial`;
    ctx.fillText("(incluye IVA)", w / 2, yOffset);
    
    // Social / Instagram or Phone (very bottom, centered)
    if (options.social) {
       yOffset += 18 * scale;
       ctx.font = `900 ${9 * scale}px Arial`;
       ctx.fillText(options.social, w / 2, yOffset);
    }
  }

  async function openLabelModal(product){
    const bizSettings = currentBusiness().settings || {};
    const address = bizSettings.address || '';
    
    const templates = state.settings?.labelTemplates || [];
    const templateOptions = templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

    showModal(`<div class="modalHeader"><h2>Etiqueta imprimible</h2><button class="closeBtn" data-close>×</button></div>
      <style>
        @media(min-width:600px){
          .labelCustomizerLayout {
             grid-template-columns: 1fr 1fr !important;
          }
        }
      </style>
      <div class="labelCustomizerLayout" style="display:grid; grid-template-columns: 1fr; gap:16px; align-items:start; padding:10px;">
        <div style="display:flex; justify-content:center; background:#111; padding:20px; border-radius:12px; border:1px solid #333;">
           <canvas id="labelPreviewCanvas" style="max-width:100%; height:auto; box-shadow:0 8px 24px rgba(0,0,0,0.5); border-radius:10px;"></canvas>
        </div>
        <div class="labelControls" style="display:flex; flex-direction:column; gap:12px;">
           <div class="field">
              <label>Aplicar Plantilla</label>
              <select id="applyTemplateSelect" style="width:100%; padding:8px; border-radius:8px; background:#222; color:#fff; border:1px solid #444;">
                 <option value="">-- Seleccionar plantilla --</option>
                 ${templateOptions}
              </select>
           </div>
           <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
              <div class="field">
                 <label style="font-size:11px;">Fondo Etiqueta</label>
                 <input type="color" id="labelBgColor" value="#ffffff" style="width:100%; height:36px; padding:2px; cursor:pointer;">
              </div>
              <div class="field">
                 <label style="font-size:11px;">Fondo QR</label>
                 <input type="color" id="qrBgColor" value="#ffffff" style="width:100%; height:36px; padding:2px; cursor:pointer;">
              </div>
              <div class="field">
                 <label style="font-size:11px;">Texto / QR</label>
                 <input type="color" id="labelFgColor" value="#000000" style="width:100%; height:36px; padding:2px; cursor:pointer;">
              </div>
           </div>
           <div class="field">
              <label>Red Social / Contacto (opcional)</label>
              <input id="labelSocial" placeholder="Ej. @click360" value="">
           </div>
           <div class="field">
              <label>Dirección del Local (opcional)</label>
              <input id="labelAddress" placeholder="Dirección para la etiqueta" value="${escapeHtml(address)}">
           </div>
           <div class="field">
              <label>Cantidad de Copias</label>
              <input type="number" id="labelCopies" min="1" value="1" style="text-align:center;">
           </div>
           <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
              <button class="btn primary block" id="printOne">🖨️ Imprimir Etiquetas</button>
              <button class="btn silver block" id="saveTemplateBtn" style="border:1px solid var(--green); color:var(--green);">💾 Guardar Plantilla</button>
              <button class="btn silver block" id="downloadLabelPng">🖼️ Descargar Imagen (PNG)</button>
              <button class="btn block" id="printStock" style="border:1px solid var(--gold); color:var(--gold);">🖨️ Imprimir según Stock (${product.qty})</button>
              <button class="btn block" id="printAll" style="border:1px solid var(--muted); color:var(--muted);">🖨️ Imprimir Catálogo Completo</button>
              <button class="btn silver block" id="copyLabelCode">Copiar código: ${escapeHtml(product.code)}</button>
           </div>
        </div>
      </div>`);

    const canvas = $('#labelPreviewCanvas');
    
    const updatePreview = () => {
       const options = {
          scale: 2,
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       drawLabelOnCanvas(canvas, product, options);
    };

    // Auto sync qrBgColor to labelBgColor if they were matching
    let lastBgColor = $('#labelBgColor').value;
    $('#labelBgColor').oninput = () => {
       const currentBg = $('#labelBgColor').value;
       const currentQrBg = $('#qrBgColor').value;
       if (currentQrBg === lastBgColor) {
          $('#qrBgColor').value = currentBg;
       }
       lastBgColor = currentBg;
       updatePreview();
    };

    $('#qrBgColor').oninput = updatePreview;
    $('#labelFgColor').oninput = updatePreview;
    $('#labelSocial').oninput = updatePreview;
    $('#labelAddress').oninput = updatePreview;
    
    // Apply template logic
    $('#applyTemplateSelect').onchange = (e) => {
       const tplId = e.target.value;
       if (!tplId) return;
       const tpl = (state.settings.labelTemplates || []).find(t => t.id === tplId);
       if (tpl) {
          $('#labelBgColor').value = tpl.bgColor;
          $('#qrBgColor').value = tpl.qrBgColor || tpl.bgColor;
          $('#labelFgColor').value = tpl.fgColor;
          $('#labelSocial').value = tpl.social || '';
          $('#labelAddress').value = tpl.address || '';
          lastBgColor = tpl.bgColor;
          updatePreview();
       }
    };

    // Save template logic
    $('#saveTemplateBtn').onclick = () => {
       const name = prompt("Nombre de la plantilla:", "Mi Plantilla QR");
       if (!name) return;
       const tpl = {
          id: uid('tpl'),
          name: name.trim(),
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       state.settings ||= {};
       state.settings.labelTemplates ||= [];
       state.settings.labelTemplates.push(tpl);
       save();
       toast('Plantilla guardada con éxito', 'ok');
       
       // Reload select dropdown options
       const updatedTemplates = state.settings.labelTemplates;
       $('#applyTemplateSelect').innerHTML = `<option value="">-- Seleccionar plantilla --</option>` +
          updatedTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    };
    
    updatePreview();

    $('#printOne').onclick = () => {
       const copies = parseInt($('#labelCopies').value || '1', 10) || 1;
       const options = {
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       printLabels([{ product, copies }], options);
    };

    $('#printStock').onclick = () => {
       const copies = Math.max(1, product.qty);
       const options = {
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       printLabels([{ product, copies }], options);
    };

    $('#printAll').onclick = () => {
       const options = {
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       printLabels(productsForBiz().map(p => ({ product: p, copies: 1 })), options);
    };

    $('#downloadLabelPng').onclick = async () => {
       const exportCanvas = document.createElement('canvas');
       const options = {
          scale: 4,
          bgColor: $('#labelBgColor').value,
          qrBgColor: $('#qrBgColor').value,
          fgColor: $('#labelFgColor').value,
          social: $('#labelSocial').value.trim(),
          address: $('#labelAddress').value.trim()
       };
       await drawLabelOnCanvas(exportCanvas, product, options);
       const a = document.createElement('a');
       a.download = `etiqueta-${slug(product.name)}-${product.code}.png`;
       a.href = exportCanvas.toDataURL('image/png');
       a.click();
       toast('Imagen de etiqueta descargada');
    };

    $('#copyLabelCode').onclick = () => {
       navigator.clipboard?.writeText(product.code);
       toast('Código copiado');
    };
  }
  function roundRect(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();}
  async function printLabels(groups, options = {}){
    const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
    root.innerHTML='<div class="printLabels"></div>';
    const wrap=$('.printLabels',root);
    for(const g of groups) for(let i=0;i<Math.max(1,g.copies);i++){
       const item=document.createElement('div');
       item.className='printLabel';
       const canvas=document.createElement('canvas');
       item.appendChild(canvas);
       wrap.appendChild(item);
       
       const opt = {
          scale: 3,
          bgColor: options.bgColor || '#ffffff',
          qrBgColor: options.qrBgColor || options.bgColor || '#ffffff',
          fgColor: options.fgColor || '#000000',
          social: options.social || '',
          address: options.address || ''
       };
       await drawLabelOnCanvas(canvas, g.product, opt);
    }
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
        r.onload = async (ev) => {
          try {
             const data = JSON.parse(ev.target.result);
             state = normalizeState(data);
             save();
             if (window.click360SyncNow) {
                await window.click360SyncNow();
             }
             toast('Respaldo restaurado exitosamente');
             setTimeout(() => location.reload(), 1200);
          }
          catch(err) {
             toast('Error leyendo archivo de respaldo', 'err');
          }
        };
        r.readAsText(file);
    };
    const exp = $('#exportCsvBtn');
    if(exp) exp.onclick = () => {
      const dateFrom = $('#csvDateFrom')?.value || '';
      const dateTo = $('#csvDateTo')?.value || today();
      const BOM = "\ufeff";
      let csv = BOM + "FECHA_HORA,CATEGORIA,DETALLE,MONTO,CLIENTE,ATENDIDO_POR,ESTADO\n";
      
      const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = [];
      const inRange = (d) => { const date = (d || '').slice(0,10); return (!dateFrom || date >= dateFrom) && date <= dateTo; };
      
      // 1. Process Sales (only active business)
      state.sales.filter(s => s.businessId === currentBusiness().id && inRange(s.date)).forEach(s => {
         s.items.forEach(item => {
            rows.push({
               date: s.when || s.date,
               category: `Venta - ${item.category || 'General'}`,
               detail: `${item.qty}x ${item.name} [${item.code}]`,
               amount: item.price * item.qty,
               customer: s.customer || '',
               user: s.createdBy || s.user || 'Sistema',
               status: s.status === 'cancelled' ? 'ANULADA' : 'OK'
            });
         });
      });
      
      // 2. Process Movements (only active business)
      state.movements.filter(m => m.businessId === currentBusiness().id && inRange(m.date)).forEach(m => {
         const isOutflow = m.kind !== 'ingreso' && m.kind !== 'apertura';
         const signedAmount = isOutflow ? -m.amount : m.amount;
         const linkedSale = m.saleId ? state.sales.find(x => x.id === m.saleId) : null;
         
         rows.push({
            date: m.when || m.date,
            category: m.saleId ? `Pago Venta - ${m.kind.toUpperCase()}` : `Caja - ${m.kind.toUpperCase()}`,
            detail: m.note || (m.saleId ? `Pago de venta ${m.saleId}` : 'Movimiento de caja'),
            amount: signedAmount,
            customer: linkedSale ? (linkedSale.customer || '') : '',
            user: m.createdBy || m.user || 'Sistema',
            status: m.status === 'cancelled' ? `ANULADO por ${m.cancelledBy || '?'} ${m.cancelledAt || ''}` : 'OK'
         });
      });
      
      // Sort all by date/time
      rows.sort((a, b) => a.date.localeCompare(b.date));
      
      // Build CSV string
      rows.forEach(r => {
         csv += `${escapeCsv(r.date)},${escapeCsv(r.category)},${escapeCsv(r.detail)},${r.amount},${escapeCsv(r.customer)},${escapeCsv(r.user)},${escapeCsv(r.status)}\n`;
      });

      const a = document.createElement('a');
      const filename = dateFrom ? `contabilidad_click360_${dateFrom}_a_${dateTo}.csv` : `contabilidad_click360_${dateTo}.csv`;
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = filename;
      a.click();
      toast(`Reporte generado: ${rows.length} registros`);
    };

    const sendBtn = $('#sendReportBtn');
    if (sendBtn) sendBtn.onclick = () => {
      const dateFrom = $('#csvDateFrom')?.value || today();
      const dateTo = $('#csvDateTo')?.value || today();
      const bizName = currentBusiness().name;
      const salesCount = state.sales.filter(s => s.businessId === currentBusiness().id && s.date >= dateFrom && s.date <= dateTo && s.status !== 'cancelled').length;
      const movCount = state.movements.filter(m => m.businessId === currentBusiness().id && m.date >= dateFrom && m.date <= dateTo && m.status !== 'cancelled').length;
      const totalVentas = state.sales.filter(s => s.businessId === currentBusiness().id && s.date >= dateFrom && s.date <= dateTo && s.status !== 'cancelled').reduce((a,s) => a + s.total, 0);
      
      const text = `📊 *Reporte Contable — ${bizName}*\n📅 Periodo: ${dateFrom} al ${dateTo}\n\n💰 Total Ventas: $${totalVentas.toFixed(2)}\n🧾 Transacciones de venta: ${salesCount}\n📋 Movimientos de caja: ${movCount}\n\n_Reporte generado por CLICK 360_\n_Por favor descarga el archivo CSV adjunto para los detalles completos._`;
      
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      toast('Abre WhatsApp y selecciona el contacto de tu contadora');
    };

    const cloudBtn = $('#cloudSoon');
    if (cloudBtn) {
       cloudBtn.onclick = () => {
          if (window.click360SyncNow) {
             window.click360SyncNow().then(() => toast('Sincronizado con la nube')).catch(() => toast('Error al sincronizar', 'err'));
          } else {
             toast('Preparado para CLICK 360 Cloud. Requiere backend real.');
          }
       };
    }
  }

  window.cancelSale = function(saleId) {
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede anular ventas', 'err');
    }
    if(!confirm('\u00bfSeguro que deseas anular esta venta? Esto no se puede deshacer y devolver\u00e1 el stock.')) return;
    const sale = state.sales.find(s=>s.id === saleId);
    if(!sale) return toast('Venta no encontrada', 'err');
    
    // Devolver stock
    sale.items.forEach(i => {
       const p = state.products.find(prod=>prod.id === i.id);
       if(p) p.qty += i.qty;
    });
    
    sale.status = 'cancelled';
    sale.cancelledBy = authUser().name || 'Usuario';
    sale.cancelledAt = nowLabel();
    
    // Anular movimiento si existe
    const mov = state.movements.find(m => m.saleId === sale.id);
    if(mov) {
       mov.status = 'cancelled';
       mov.cancelledBy = authUser().name || 'Usuario';
       mov.cancelledAt = nowLabel();
       mov.originalAmount = mov.amount;
       mov.amount = 0;
    }
    
    state.movements.push({
       id:uid('mov'),
       businessId:currentBusiness().id,
       date:today(),
       when:nowLabel(),
       kind:'retiro',
       amount:0,
       originalAmount:sale.total,
       note:`Venta anulada`,
       user:session.username,
       saleId:sale.id,
       createdBy:authUser().name,
       status:'cancelled',
       cancelledBy:authUser().name || 'Usuario',
       cancelledAt:nowLabel()
    });
    
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
    
    state.movements.push({
      id: uid('mov'),
      businessId: currentBusiness().id,
      date: today(),
      when: nowLabel(),
      kind: 'ingreso',
      amount: amount,
      note: `Abono a ticket ${saleId}`,
      user: session.username,
      saleId: sale.id
    });
    save(); 
    renderApp(route);
  };

  window.showSaleCompleteModal = function(id) {
    const s = state.sales.find(x=>x.id===id);
    if(!s) return;
    const bizSettings = currentBusiness().settings || {};
    const ruc = bizSettings.ruc ? `<div style="text-align:center; font-size:10px;">RUC/ID: ${escapeHtml(bizSettings.ruc)}</div>` : '';
    const phone = bizSettings.phone ? `<div style="text-align:center; font-size:10px;">Tel: ${escapeHtml(bizSettings.phone)}</div>` : '';
    const logoUrl = bizSettings.logoUrl ? `<div style="text-align:center; margin-bottom:6px;"><img src="${escapeHtml(bizSettings.logoUrl)}" style="max-width:80px; max-height:80px; object-fit:contain;"></div>` : '';
    const currentIva = bizSettings.iva || 0;
    
    const receiptHtml = `
      <div style="font-family:monospace; color:#000; font-size:12px; margin:0; padding:15px; width:80mm; background:white; line-height:1.4;">
        ${logoUrl}
        <h2 style="font-size:16px; margin:0 0 2px; text-align:center; font-weight:bold;">${escapeHtml(currentBusiness().name)}</h2>
        ${ruc}${phone}
        <div style="text-align:center; margin:8px 0; font-weight:bold; font-size:13px; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:4px 0;">COMPROBANTE DE VENTA</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>No. Ticket:</span><span>${s.id.slice(-6).toUpperCase()}</span></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Fecha/Hora:</span><span>${escapeHtml(s.when)}</span></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Método:</span><span>${escapeHtml(s.method)}</span></div>
        ${s.customer ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Cliente:</span><span>${escapeHtml(s.customer)}</span></div>` : ''}
        ${s.customerCedula ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Cédula/RUC:</span><span>${escapeHtml(s.customerCedula)}</span></div>` : ''}
        ${s.customerPhone ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Teléfono:</span><span>${escapeHtml(s.customerPhone)}</span></div>` : ''}
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Vendedor:</span><span>${escapeHtml(s.createdBy || s.user || 'Sistema')}</span></div>
        <div style="border-top:1px dashed #000; margin:8px 0;"></div>
        <table style="width:100%; font-size:11px; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #000;"><th style="text-align:left;">Detalle</th><th style="text-align:center;">Cant</th><th style="text-align:right;">Total</th></tr>
          </thead>
          <tbody>
            ${s.items.map(i=>`<tr><td style="padding:4px 0;">${escapeHtml(i.name)}</td><td style="text-align:center;">${i.qty}</td><td style="text-align:right;">${fmt(i.price*i.qty)}</td></tr>`).join('')}
          </tbody>
        </table>
        <div style="border-top:1px dashed #000; margin:8px 0;"></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Subtotal:</span><span>${fmt(s.subtotal)}</span></div>
        ${s.iva ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>IVA (${currentIva}%):</span><span>${fmt(s.iva)}</span></div>` : ''}
        ${s.discount ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Descuento:</span><span>-${fmt(s.discount)}</span></div>` : ''}
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px; font-weight:bold; border-top:1px solid #000; padding-top:4px;"><span>TOTAL:</span><span>${fmt(s.total)}</span></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Pagado:</span><span>${fmt(s.received||s.total)}</span></div>
        ${s.balance ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px; color:#d9534f; font-weight:bold;"><span>Saldo Pendiente:</span><span>${fmt(s.balance)}</span></div>` : ''}
        ${s.dueDate ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:bold;"><span>Fecha Retiro:</span><span>${escapeHtml(s.dueDate)}</span></div>` : ''}
        <div style="border-top:1px dashed #000; margin:10px 0 6px 0;"></div>
        <div style="text-align:center; font-size:10px;">¡Gracias por su compra!<br><small>CLICK 360 - Control de Negocios</small></div>
      </div>
    `;
 
    showModal(`
      <div class="modalHeader"><h2>Venta Completada</h2><button class="closeBtn" data-close>×</button></div>
      <p style="color:var(--green); text-align:center; font-weight:bold; margin-bottom:12px;">✓ Guardado exitosamente</p>
      
      <div style="display:flex; justify-content:center; margin-bottom:16px;">
        <div style="max-height:220px; overflow-y:auto; border:1px solid #444; border-radius:12px; background:#fff; padding:4px;">
          ${receiptHtml}
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <button class="btn primary" id="printReceiptBtn">🖨️ Imprimir Ticket</button>
        <button class="btn silver" id="downloadImgBtn">🖼️ Descargar Imagen (PNG)</button>
        ${s.customerPhone ? `<button class="btn" style="grid-column: 1 / -1; border:1px solid #25D366; color:#25D366; background:transparent;" id="whatsappReminderBtn">💬 Recordatorio WhatsApp</button>` : ''}
      </div>
      <button class="btn block" id="doneSaleBtn" style="border:1px solid var(--gold); color:var(--gold);">Listo / Nueva Venta</button>
    `);
    
    const waBtn = $('#whatsappReminderBtn');
    if (waBtn) {
       waBtn.onclick = () => {
         const phone = s.customerPhone || '';
         const bizName = currentBusiness().name;
         const text = `Hola ${s.customer}, te saludamos de ${bizName}. Queremos recordarte que tienes un apartado de prendas por un total de ${fmt(s.total)}, con un abono de ${fmt(s.received)} y un saldo pendiente de ${fmt(s.balance)}. La fecha límite de pago y retiro es el ${s.dueDate || ''}. ¡Muchas gracias!`;
         const url = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
         window.open(url, '_blank');
       };
    }

    $('#printReceiptBtn').onclick = () => {
      const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
      root.innerHTML = receiptHtml;
      setTimeout(()=>window.print(), 250);
    };

    $('#downloadImgBtn').onclick = () => {
      toast('Generando Imagen...');
      const wrapper = document.createElement('div');
      wrapper.innerHTML = receiptHtml;
      wrapper.style.position = 'fixed'; wrapper.style.top = '0'; wrapper.style.left = '0'; wrapper.style.zIndex = '-9999'; wrapper.style.pointerEvents = 'none';
      document.body.appendChild(wrapper);
      
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => {
        window.html2canvas(wrapper.firstElementChild, { scale: 2 }).then(canvas => {
          const a = document.createElement('a');
          a.href = canvas.toDataURL('image/png');
          a.download = `Recibo_${s.id.slice(-6).toUpperCase()}.png`;
          a.click();
          document.body.removeChild(wrapper);
          toast('Imagen descargada');
        });
      };
      document.head.appendChild(script);
    };

    $('#doneSaleBtn').onclick = () => {
      closeModal();
    };
  };

  window.editMovement = function(id) {
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede editar transacciones', 'err');
    }
    const m = state.movements.find(x => x.id === id);
    if (!m) return toast('Movimiento no encontrado', 'err');
    
    showModal(`<div class="modalHeader"><h2>Editar movimiento</h2><button class="closeBtn" data-close>×</button></div>
      <form id="editMoveForm">
        <div class="field">
          <label>Tipo</label>
          <select id="emKind">
            <option value="ingreso" ${m.kind==='ingreso'?'selected':''}>Ingreso</option>
            <option value="egreso" ${m.kind==='egreso'?'selected':''}>Gasto</option>
            <option value="compra" ${m.kind==='compra'?'selected':''}>Compra</option>
            <option value="retiro" ${m.kind==='retiro'?'selected':''}>Retiro</option>
            <option value="apertura" ${m.kind==='apertura'?'selected':''}>Apertura</option>
          </select>
        </div>
        <div class="field">
          <label>Monto</label>
          <input id="emAmount" type="text" inputmode="decimal" value="${String(m.amount).replace('.',',')}">
        </div>
        <div class="field">
          <label>Nota</label>
          <input id="emNote" required value="${escapeHtml(m.note || '')}">
        </div>
        <button type="submit" class="btn primary block">Guardar cambios</button>
      </form>`);
      
    const emAmountInput = $('#emAmount');
    if (emAmountInput) {
       emAmountInput.oninput = () => { emAmountInput.value = emAmountInput.value.replace(/[^0-9.,]/g, ''); };
    }
    
    $('#editMoveForm').onsubmit = (e) => {
       e.preventDefault();
       const k = $('#emKind').value;
       const a = parseMoney($('#emAmount').value);
       const n = $('#emNote').value.trim();
       if (!Number.isFinite(a) || a < 0) return toast('Monto inválido', 'err');
       
       m.kind = k;
       m.amount = a;
       m.note = n;
       m.updatedBy = authUser().name;
       save();
       closeModal();
       renderApp('cash');
       toast('Movimiento actualizado');
    };
  };

  window.deleteMovement = function(id) {
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede anular transacciones', 'err');
    }
    if (!confirm('\u00bfSeguro que deseas anular este movimiento? Se conservar\u00e1 el registro.')) return;
    
    const mov = state.movements.find(x => x.id === id);
    if (!mov) return toast('Movimiento no encontrado', 'err');
    
    // Soft delete: mark as cancelled with audit trail
    mov.status = 'cancelled';
    mov.cancelledBy = authUser().name || 'Propietario';
    mov.cancelledAt = nowLabel();
    mov.originalAmount = mov.amount;
    mov.amount = 0;
    
    save();
    renderApp('cash');
    toast(`Movimiento anulado por ${mov.cancelledBy} a las ${mov.cancelledAt}`);
  };

  window.printReceipt = function(id) {
    window.showSaleCompleteModal(id);
  };

  window.sendWhatsAppReminder = function(id) {
    const s = state.sales.find(x => x.id === id);
    if (!s) return;
    const phone = s.customerPhone || '';
    const bizName = currentBusiness().name;
    const text = `Hola ${s.customer}, te saludamos de ${bizName}. Queremos recordarte que tienes un apartado de prendas por un total de ${fmt(s.total)}, con un abono de ${fmt(s.received)} y un saldo pendiente de ${fmt(s.balance)}. La fecha límite de pago y retiro es el ${s.dueDate || ''}. ¡Muchas gracias!`;
    const url = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  window.viewDailyReport = function(id) {
     const r = state.dailyReports?.find(x=>x.id===id);
     if(!r) return;
     showModal(`<div class="modalHeader"><h2>Resumen de Cierre</h2><button class="closeBtn" data-close>×</button></div>
       <div style="background:#fff; border-radius:8px; border:1px solid #ccc; max-height:40vh; overflow-y:auto; margin-bottom:15px; padding:10px; display:flex; justify-content:center;">
         <div id="pdfContentPreview" style="transform: scale(0.85); transform-origin: top center;">
           ${r.html}
         </div>
       </div>
       <div style="display:flex; gap:10px;">
           <button class="btn silver block" id="printCierreBtn">Imprimir</button>
           <button class="btn primary block" id="downloadImgCierreBtn">Descargar Imagen (PNG)</button>
       </div>
     `);
     $('#printCierreBtn').onclick = () => {
         const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
         root.innerHTML = r.html;
         setTimeout(()=>window.print(), 250);
     };
     $('#downloadImgCierreBtn').onclick = () => {
          toast('Generando Imagen...');
          const wrapper = document.createElement('div'); wrapper.innerHTML = r.html; 
          wrapper.style.position = 'fixed'; wrapper.style.top = '0'; wrapper.style.left = '0'; wrapper.style.width = '480px'; wrapper.style.zIndex = '-9999'; wrapper.style.pointerEvents = 'none';
          document.body.appendChild(wrapper); 
          
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          script.onload = () => {
            window.html2canvas(wrapper.firstElementChild, { scale: 2 }).then(canvas => {
              const a = document.createElement('a');
              a.href = canvas.toDataURL('image/png');
              a.download = `Cierre_Caja_${r.date}.png`;
              a.click();
              document.body.removeChild(wrapper);
              toast('Imagen descargada');
            });
          };
          document.head.appendChild(script);
      };
  };

  window.printReports = function(mode = 'print') {
    state.reportsFrom = state.reportsFrom || today();
    state.reportsTo = state.reportsTo || today();
    const allSales = salesForBiz();
    const sales = allSales.filter(s => s.date >= state.reportsFrom && s.date <= state.reportsTo);
    const validSales = sales.filter(s => s.status!=='cancelled');
    const total = validSales.reduce((a,s)=>a+(s.status==='layaway' ? (s.received||0) : s.total),0);
    const tickets = validSales.length;
    const counts={}; validSales.forEach(s=>s.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    
    // Anulados
    const cancelled = sales.filter(s => s.status==='cancelled');
    
    const html = `
      <div style="font-family:sans-serif; color:#000; font-size:12px; margin:0; padding:20px; background:white;">
      <h2 style="font-size:20px; margin:0 0 10px;">${escapeHtml(currentBusiness().name)} - Reporte General</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Periodo:</span><span>${state.reportsFrom} a ${state.reportsTo}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Impreso:</span><span>${nowLabel()}</span></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      
      <div style="width:100%; max-width:400px; margin:0 auto 20px;">
        <h3 style="margin-top:10px; text-align:center;">Crecimiento de Ventas (7 días)</h3>
        ${buildChartHtml(allSales).replace(/var\\(--gold\\)/g, '#D4AF37').replace(/var\\(--line\\)/g, '#ddd').replace(/var\\(--muted\\)/g, '#666')}
      </div>
      
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ingreso Ventas:</span><strong>${fmt(total)}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tickets Exitosos:</span><strong>${tickets}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Promedio por Ticket:</span><strong>${fmt(tickets?total/tickets:0)}</strong></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Productos Más Vendidos</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Producto</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Cant. Vendida</th></tr>
        ${top.map(([n,c])=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(n)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${c}</td></tr>`).join('')}
      </table>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Historial de Tickets</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Fecha/Hora</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Vendedor</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Método</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Estado</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Total</th></tr>
        ${sales.slice().reverse().map(s=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.when)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.createdBy || s.user || 'Sistema')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.method)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(labelStatus(s.status))}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${fmt(s.total)}</td></tr>`).join('')}
      </table>
      
      ${cancelled.length > 0 ? `
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px; color:#d9534f;">Anulaciones</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Fecha Anulación</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Anulado por</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Vendedor Orig.</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Total</th></tr>
        ${cancelled.slice().reverse().map(s=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.cancelledAt || s.when)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee; color:#d9534f;">${escapeHtml(s.cancelledBy || 'Desconocido')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.createdBy || s.user || 'Sistema')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${fmt(s.total)}</td></tr>`).join('')}
      </table>
      ` : ''}
      
      </div>`;
      
    if (mode === 'print') {
        const root=$('#printRoot') || document.createElement('div'); root.id='printRoot'; root.className='printSheet'; document.body.appendChild(root);
        root.innerHTML = html;
        setTimeout(()=>window.print(), 250);
    } else if (mode === 'image') {
        toast('Generando Imagen...');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        wrapper.style.position = 'fixed'; wrapper.style.top = '0'; wrapper.style.left = '0'; wrapper.style.width = '800px'; wrapper.style.zIndex = '-9999'; wrapper.style.pointerEvents = 'none';
        document.body.appendChild(wrapper);
        
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          window.html2canvas(wrapper.firstElementChild, { scale: 2, useCORS: true }).then(canvas => {
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `Reporte_Ventas_${state.reportsFrom}.png`;
            a.click();
            document.body.removeChild(wrapper);
            toast('Imagen descargada');
          });
        };
        document.head.appendChild(script);
    }
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
  window.click360ReloadState = () => { state = loadState(); };

  // Auto-save safety net: force save every 30s to ensure cloud sync
  let _lastAutoSaveHash = '';
  setInterval(() => {
    if (!session) return;
    try {
      const currentHash = JSON.stringify(state);
      if (currentHash !== _lastAutoSaveHash) {
        _lastAutoSaveHash = currentHash;
        save();
        console.log('[CLICK360] Auto-save ejecutado');
      }
    } catch(e) {}
  }, 30000);
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
