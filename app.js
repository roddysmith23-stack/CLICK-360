
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
  function setSession(s) { session=s; s ? localStorage.setItem(SESSION, JSON.stringify(s)) : localStorage.removeItem(SESSION); }
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
  function currentBusiness(){ return state.businesses.find(b=>b.id===state.activeBusinessId) || state.businesses[0]; }
  function productsForBiz(bid=currentBusiness()?.id){ return state.products.filter(p=>p.businessId===bid); }
  function salesForBiz(bid=currentBusiness()?.id){ return state.sales.filter(s=>s.businessId===bid); }
  function movementsForBiz(bid=currentBusiness()?.id){ return state.movements.filter(m=>m.businessId===bid); }
  function can(section) {
    const role = currentUser()?.role;
    if (role === 'owner') return true;
    if (role === 'cashier') return ['home','sell','cash','more','reports'].includes(section);
    if (role === 'inventory') return ['home','inventory','more','reports','settings'].includes(section);
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

  // -------- QR GENERATOR: local QR Code Version 3-L, byte mode, no CDN --------
  const QR = (() => {
    const GF_EXP = new Array(512), GF_LOG = new Array(256);
    let x = 1;
    for (let i=0;i<255;i++){ GF_EXP[i]=x; GF_LOG[x]=i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i=255;i<512;i++) GF_EXP[i]=GF_EXP[i-255];
    const mul=(a,b)=> a&&b ? GF_EXP[GF_LOG[a]+GF_LOG[b]] : 0;
    const polyMul=(p,q)=>{ const r=Array(p.length+q.length-1).fill(0); for(let i=0;i<p.length;i++) for(let j=0;j<q.length;j++) r[i+j]^=mul(p[i],q[j]); return r; };
    const generator=(degree)=>{ let g=[1]; for(let i=0;i<degree;i++) g=polyMul(g,[1,GF_EXP[i]]); return g; };
    const ecc=(data, ecLen)=>{ const gen=generator(ecLen); const rem=Array(ecLen).fill(0); for(const b of data){ const factor=b^rem.shift(); rem.push(0); for(let i=0;i<ecLen;i++) rem[i]^=mul(gen[i+1],factor); } return rem; };
    function bitsToBytes(bits){
      const out=[]; for(let i=0;i<bits.length;i+=8){ let v=0; for(let j=0;j<8;j++) v=(v<<1)|(bits[i+j]||0); out.push(v); } return out;
    }
    function pushBits(bits,val,len){ for(let i=len-1;i>=0;i--) bits.push((val>>>i)&1); }
    function encodeBytes(text){
      const bytes = [...new TextEncoder().encode(text)];
      if (bytes.length > 45) throw new Error('Texto QR demasiado largo');
      const bits=[];
      pushBits(bits,0b0100,4); pushBits(bits,bytes.length,8);
      bytes.forEach(b=>pushBits(bits,b,8));
      const dataCw=55, totalBits=dataCw*8;
      const terminator=Math.min(4,totalBits-bits.length); pushBits(bits,0,terminator);
      while(bits.length%8) bits.push(0);
      let data=bitsToBytes(bits);
      for(let pad=0; data.length<dataCw; pad^=1) data.push(pad?0x11:0xEC);
      return data.concat(ecc(data,15));
    }
    function formatBits(mask){
      let data = (1<<3) | mask; // L = 01
      let bits = data << 10;
      const poly = 0x537;
      for(let i=14;i>=10;i--) if((bits>>>i)&1) bits ^= poly << (i-10);
      return ((data<<10)|bits) ^ 0x5412;
    }
    function make(text){
      const size=29; const m=Array.from({length:size},()=>Array(size).fill(null)); const res=Array.from({length:size},()=>Array(size).fill(false));
      const set=(r,c,val,fun=true)=>{ if(r<0||c<0||r>=size||c>=size) return; m[r][c]=!!val; if(fun) res[r][c]=true; };
      function finder(r,c){
        for(let y=-1;y<=7;y++) for(let x=-1;x<=7;x++){
          const rr=r+y, cc=c+x;
          if(rr<0||cc<0||rr>=size||cc>=size) continue;
          const inside=x>=0&&x<=6&&y>=0&&y<=6;
          const dark=inside && (x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4));
          set(rr,cc,dark,true);
        }
      }
      finder(0,0); finder(0,size-7); finder(size-7,0);
      for(let i=8;i<size-8;i++){ set(6,i,i%2===0,true); set(i,6,i%2===0,true); }
      // alignment pattern v3 at 22,22
      const ar=22, ac=22;
      for(let y=-2;y<=2;y++) for(let x=-2;x<=2;x++) set(ar+y,ac+x,Math.max(Math.abs(x),Math.abs(y))!==1,true);
      set(size-8,8,true,true);
      // reserve format areas
      for(let i=0;i<9;i++){ if(i!==6){ res[8][i]=true; res[i][8]=true; } }
      for(let i=0;i<8;i++){ res[8][size-1-i]=true; res[size-1-i][8]=true; }
      const words=encodeBytes(text); const bits=[];
      words.forEach(b=>pushBits(bits,b,8));
      let k=0, upward=true;
      for(let right=size-1; right>=1; right-=2){
        if(right===6) right--;
        for(let vert=0; vert<size; vert++){
          const r = upward ? size-1-vert : vert;
          for(let j=0;j<2;j++){
            const c=right-j;
            if(res[r][c]) continue;
            let bit = k<bits.length ? bits[k++]===1 : false;
            if(((r+c)&1)===0) bit=!bit; // mask 0
            m[r][c]=bit;
          }
        }
        upward=!upward;
      }
      const fb=formatBits(0);
      const bit=i=>((fb>>>i)&1)!==0;
      for(let i=0;i<=5;i++) set(8,i,bit(i),true);
      set(8,7,bit(6),true); set(8,8,bit(7),true); set(7,8,bit(8),true);
      for(let i=9;i<15;i++) set(14-i,8,bit(i),true);
      for(let i=0;i<8;i++) set(size-1-i,8,bit(i),true);
      for(let i=8;i<15;i++) set(8,size-15+i,bit(i),true);
      return m.map(row=>row.map(v=>!!v));
    }
    function draw(canvas,text,size=220,margin=3){
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
    const b = state.businesses.find(x=>x.id===product.businessId) || currentBusiness();
    return `C360|${b.code || b.id}|${product.code}`;
  }
  function normalizeCode(input) {
    const s = String(input||'').trim();
    if (!s) return '';
    if (s.includes('C360|')) return s.split('|').pop().trim();
    if (s.includes('CLICK360|PRODUCT|')) return s.split('|').pop().trim();
    try {
      const u = new URL(s);
      const scan = u.hash.startsWith('#scan=') ? decodeURIComponent(u.hash.slice(6)) : '';
      if (scan) return normalizeCode(scan);
    } catch {}
    return s;
  }

  function renderLogin(message='') {
    stopScanner();
    app.innerHTML = `
      <main class="loginPage">
        <section class="loginShell">
          <div class="loginBrand">
            <div class="logoIcon"></div>
            <div class="logoText"><b>CLICK</b><span>360</span></div>
            <p>Control total de tu negocio</p>
          </div>
          <form id="loginForm" class="card loginCard">
            <div class="roleTabs">
              <button type="button" data-role="business" class="active">▣ Negocio</button>
              <button type="button" data-role="admin">⬡ Admin</button>
            </div>
            <input type="hidden" id="loginRole" value="business" />
            <div class="field"><label>Usuario</label><input id="user" autocomplete="username" /></div>
            <div class="field"><label>Contraseña</label><input id="pass" type="password" autocomplete="current-password" /></div>
            <div id="loginError" class="errorBox ${message ? 'show':''}">${escapeHtml(message || 'Datos incorrectos. Revisa tu usuario o contraseña.')}</div>
            <button class="btn primary block" type="submit">Entrar</button>
            <p class="hint">Acceso interno de prueba. Para clientes finales se crean usuarios propios.</p>
          </form>
        </section>
      </main>`;
    $$('.roleTabs button').forEach(btn => btn.onclick = () => {
      $$('.roleTabs button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); $('#loginRole').value = btn.dataset.role;
    });
    $('#loginForm').onsubmit = e => {
      e.preventDefault();
      const username=$('#user').value.trim(), password=$('#pass').value, selected=$('#loginRole').value;
      const user=state.users.find(u=>u.username===username && u.password===password);
      if(!user || (selected==='admin' && user.role!=='admin') || (selected==='business' && user.role==='admin')) {
        beep('err'); $('#loginError').classList.add('show'); return;
      }
      setSession({username:user.username, role:user.role});
      if(user.role==='admin') renderAdmin();
      else {
        const allowed=state.businesses.find(b=>user.businessIds.includes(b.id)) || state.businesses[0];
        state.activeBusinessId=allowed.id; save();
        renderApp('home');
      }
    };
  }

  function renderPaused(b) {
    app.innerHTML = `<main class="pausedPage"><section class="card"><div class="logoMark" style="justify-content:center;margin-bottom:18px"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360</span></div></div><h1>Cuenta ${escapeHtml(b.status)}</h1><p>Tu cuenta está ${escapeHtml(b.status)}. Contacta a CLICK 360 para reactivar tu servicio.</p><button class="btn primary block" id="logoutPaused">Cerrar sesión</button></section></main>`;
    $('#logoutPaused').onclick=()=>{setSession(null);renderLogin();};
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
    const items=[['home','⌂','Inicio'],['inventory','▧','Inventario'],['sell','🛒','Vender'],['cash','▣','Caja'],['more','⋯','Más']].filter(x=>allowedRoutes().includes(x[0]));
    return items.map(([key,ico,label])=>`<button class="${side?'btn':'navBtn'} ${active===key?'active':''}" data-route="${key}">${side?ico+' ':`<span class="navIcon">${ico}</span>`}<span>${label}</span></button>`).join('');
  }
  function bottomNav(active){ return `<nav class="bottomNav">${navButtons(active)}</nav>`; }
  function bindShell(){
    $$('[data-route]').forEach(b=>b.onclick=()=>renderApp(b.dataset.route));
    ['businessPickerTop','businessPickerSide'].forEach(id=>{ const el=$('#'+id); if(el) el.onchange=()=>{state.activeBusinessId=el.value;save();renderApp(route);}; });
    $('#logoutTop')?.addEventListener('click',()=>{setSession(null);renderLogin();});
  }
  function renderApp(r='home') {
    if(!checkAuth('business')) return;
    if(!can(r)) r='home';
    stopScanner(); route=r;
    const views={home:homeView,inventory:inventoryView,sell:sellView,cash:cashView,more:moreView,reports:reportsView,settings:settingsView,workers:workersView,backup:backupView};
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
      <div class="searchBox"><input id="productSearch" placeholder="Buscar por nombre o código..." /></div>
      <section id="productList" class="productList" style="margin-top:14px">${productList(products,v)}</section>`;
  }
  function productList(products,v) {
    if(!products.length) return `<div class="card empty">Aún no hay ${escapeHtml(v.plural)}. Crea el primero con Nuevo.</div>`;
    return products.map(p=>`<article class="card productCard" data-pid="${p.id}">
      <div class="productInfo"><h3>${escapeHtml(p.name)}</h3><div class="meta"><span>${escapeHtml(p.category||'General')}</span><span class="badge">${escapeHtml(p.code)}</span><span>Stock: <b>${p.qty}</b></span><span class="badge gold">${fmt(p.price)}</span></div></div>
      <div class="actions"><button class="iconBtn gold" data-label="${p.id}" title="Etiqueta QR">▦</button><button class="iconBtn" data-edit="${p.id}" title="Editar">✎</button><button class="iconBtn danger" data-del="${p.id}" title="Borrar">🗑</button></div>
    </article>`).join('');
  }

  function sellView() {
    return `<div class="pageHead"><div><h1>Vender</h1><p>Escanea QR o ingresa el código.</p></div></div>
      <section class="sellWrap">
        <div class="card scanBox">
          <div class="scanRows">
            <div class="searchBox"><input id="sellSearch" placeholder="Buscar por nombre..." /></div>
            <div class="manualRow"><input id="manualCode" placeholder="Código manual / QR" /><button class="btn silver" id="addCode">Agregar</button><button class="iconBtn" id="openCamera" title="Escanear QR">📷</button></div>
            <div id="quickProducts" class="productList"></div>
            <div id="cameraPanel" class="cameraPanel"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para solicitar cámara.</div></div>
          </div>
        </div>
        <div class="card cartPanel"><h3>Carrito</h3><div id="cartItems"><p class="empty">Vacío. Agrega productos para vender.</p></div>
          <div class="formGrid"><div class="field"><label>Descuento</label><input id="discount" value="0" inputmode="decimal" /></div><div class="field"><label>Método</label><select id="payMethod"><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Crédito</option></select></div><div class="field full"><label>Cliente (opcional)</label><input id="customer" /></div></div>
          <div class="totalRow"><div><small>Total</small><strong id="cartTotal">$0.00</strong></div><button class="btn primary" id="chargeBtn">Cobrar</button></div>
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
      <section class="card sectionCard" style="margin-top:14px"><h3>Movimientos de hoy</h3><div class="movementList">${mov.slice().reverse().map(m=>`<div class="movement"><span>${escapeHtml(labelKind(m.kind))}<br><small>${escapeHtml(m.note||'')}</small></span><b class="${m.kind==='ingreso'?'pos':'neg'}">${m.kind==='ingreso'?'+':'−'}${fmt(m.amount)}</b></div>`).join('') || '<p class="empty">No hay movimientos.</p>'}</div></section>
      <button class="btn silver block" style="margin-top:14px" id="closeDay">Cerrar día / imprimir</button>`;
  }
  function labelKind(k){ return ({ingreso:'Ingreso',egreso:'Gasto',compra:'Compra',retiro:'Retiro'})[k]||k; }

  function reportsView() {
    const sales=salesForBiz(), total=sales.reduce((a,s)=>a+s.total,0), tickets=sales.length;
    const counts={}; sales.forEach(s=>s.items.forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return `<div class="pageHead"><div><h1>Reportes</h1><p>Resumen general de tu negocio.</p></div><button class="btn silver" onclick="window.print()">▣ Imprimir</button></div>
      <section class="grid cashGrid"><div class="card kpi"><small>Ventas</small><strong class="goldText">${fmt(total)}</strong></div><div class="card kpi"><small>Tickets</small><strong>${tickets}</strong></div><div class="card kpi"><small>Promedio</small><strong>${fmt(tickets?total/tickets:0)}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Más vendidos</h3>${top.map(([n,c])=>`<div class="movement"><span>${escapeHtml(n)}</span><b class="goldText">${c}</b></div>`).join('') || '<p class="empty">Sin ventas.</p>'}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Historial</h3>${sales.slice().reverse().map(s=>`<div class="movement"><span>${escapeHtml(s.when)}<br><small>${s.items.length} items · ${escapeHtml(s.method)} ${s.customer?'· '+escapeHtml(s.customer):''}</small></span><b class="goldText">${fmt(s.total)}</b></div>`).join('') || '<p class="empty">Sin ventas.</p>'}</section>`;
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
    return `<div class="pageHead"><div><h1>Respaldo</h1><p>Protege la información del negocio.</p></div></div>
      <section class="card sectionCard">
        <h3>Respaldo local</h3><p class="cloudStatus">Guarda un archivo para recuperar datos si cambias de celular o navegador.</p>
        <div class="split"><button class="btn primary" id="backupBtn">Guardar respaldo</button><label class="btn silver"><input type="file" id="restoreFile" accept="application/json" hidden/>Restaurar respaldo</label></div>
      </section>
      <section class="card sectionCard cloudBox" style="margin-top:14px"><h3>Nube CLICK 360</h3><p class="cloudStatus">Modo preparado para conectar base de datos real. Para clientes finales no se mostrará lenguaje técnico; solo “Código de empresa” y “PIN de empresa”.</p><button class="btn silver block" id="cloudSoon">Ver estado</button></section>`;
  }
  function workersView(){
    const b=currentBusiness();
    const users=state.users.filter(u=>u.businessIds?.includes(b.id) && u.role!=='admin');
    return `<div class="pageHead"><div><h1>Trabajadores</h1><p>Usuarios internos del negocio.</p></div></div>
      <section class="card sectionCard"><h3>Accesos de prueba</h3>${users.map(u=>`<div class="movement"><span><b>${escapeHtml(u.label)}</b><br><small>Usuario: ${escapeHtml(u.username)}</small></span><b>${u.role}</b></div>`).join('')}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Nota</h3><p class="cloudStatus">Esta versión controla roles básicos localmente. Para varios celulares con datos sincronizados se necesita activar CLICK 360 Cloud con backend real.</p></section>`;
  }
  function settingsView(){
    const b=currentBusiness();
    return `<div class="pageHead"><div><h1>Ajustes</h1><p>Negocios y perfil.</p></div></div>
      <section class="card sectionCard"><h3>Negocio actual</h3><div class="field"><label>Nombre</label><input id="bizName" value="${escapeHtml(b.name)}"></div><div class="field"><label>¿Cuál es tu negocio?</label><select id="bizType">${typeOptions(b.type)}</select></div><button class="btn primary block" id="saveBiz">Guardar cambios</button></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Agregar otro negocio</h3><div class="field"><label>Nombre</label><input id="newBizName"></div><div class="field"><label>Tipo</label><select id="newBizType">${typeOptions('otro')}</select></div><button class="btn silver block" id="createBiz">Crear negocio</button></section>`;
  }
  function typeOptions(selected){ return [['ropa','Ropa'],['restaurante','Restaurante'],['barberia','Barbería'],['ganaderia','Ganadería'],['ferreteria','Ferretería'],['otro','Otro']].map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join(''); }

  function bindView(r){
    if(r==='inventory') bindInventory();
    if(r==='sell') bindSell();
    if(r==='cash') bindCash();
    if(r==='more') bindMore();
    if(r==='backup') bindBackup();
    if(r==='settings') bindSettings();
  }
  function bindInventory(){
    $('#newProduct').onclick=()=>openProductModal();
    $('#productSearch').oninput=()=>{ const q=$('#productSearch').value.toLowerCase(); const p=productsForBiz().filter(x=>x.name.toLowerCase().includes(q)||x.code.toLowerCase().includes(q)); $('#productList').innerHTML=productList(p,businessVocabulary(currentBusiness().type)); bindInventoryActions(); };
    bindInventoryActions();
  }
  function bindInventoryActions(){
    $$('[data-edit]').forEach(b=>b.onclick=()=>openProductModal(state.products.find(p=>p.id===b.dataset.edit)));
    $$('[data-del]').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.del));
    $$('[data-label]').forEach(b=>b.onclick=()=>openLabelModal(state.products.find(p=>p.id===b.dataset.label)));
  }
  function openProductModal(product=null){
    const b=currentBusiness(), v=businessVocabulary(b.type);
    const p=product || {id:null,code:'',category:'',name:'',qty:0,cost:0,price:0,notes:''};
    showModal(`<div class="modalHeader"><h2>${product?'Editar':'Nuevo'} ${escapeHtml(v.singular)}</h2><button class="closeBtn" data-close>×</button></div>
      <form id="productForm" class="formGrid">
        <div class="field"><label>Código</label><input id="pCode" value="${escapeHtml(p.code)}" placeholder="Auto si vacío"></div>
        <div class="field"><label>${escapeHtml(v.category)}</label><input id="pCat" value="${escapeHtml(p.category)}" placeholder="${escapeHtml(v.examples)}"></div>
        <div class="field full"><label>Nombre</label><input id="pName" required value="${escapeHtml(p.name)}"></div>
        <div class="field"><label>Cantidad</label><input id="pQty" inputmode="numeric" value="${p.qty}"></div>
        <div class="field"><label>Costo</label><input id="pCost" inputmode="decimal" value="${String(p.cost||0).replace('.',',')}"></div>
        <div class="field"><label>Precio</label><input id="pPrice" inputmode="decimal" value="${String(p.price||0).replace('.',',')}"></div>
        <div class="field full"><label>Notas</label><textarea id="pNotes">${escapeHtml(p.notes||'')}</textarea></div>
        <button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button>
      </form>`);
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
      if(product) Object.assign(product,{code,category:$('#pCat').value.trim(),name,qty,cost,price,notes:$('#pNotes').value.trim()});
      else state.products.push({id:uid('prod'),businessId:b.id,code,category:$('#pCat').value.trim(),name,qty,cost,price,notes:$('#pNotes').value.trim(),createdAt:new Date().toISOString()});
      save(); closeModal(); renderApp('inventory'); toast(product?'Actualizado':'Producto creado');
    };
  }
  function deleteProduct(id){ if(confirm('¿Borrar este registro?')){ state.products=state.products.filter(p=>p.id!==id); save(); renderApp('inventory'); toast('Eliminado'); } }

  function bindSell(){
    let cart=[];
    const renderCart=()=>{
      const subtotal=cart.reduce((a,i)=>a+i.price*i.qty,0), disc=parseMoney($('#discount')?.value||0);
      const total=Math.max(0, subtotal - (Number.isFinite(disc)?disc:0));
      $('#cartTotal').textContent=fmt(total);
      $('#cartItems').innerHTML=cart.length?cart.map(i=>`<div class="cartItem"><div><b>${escapeHtml(i.name)}</b><br><small>${fmt(i.price)} /u · ${escapeHtml(i.code)}</small></div><div class="qtyControls"><button data-minus="${i.id}">−</button><b>${i.qty}</b><button data-plus="${i.id}">＋</button><button class="iconBtn danger" data-remove="${i.id}">🗑</button></div></div>`).join(''):'<p class="empty">Vacío. Agrega productos para vender.</p>';
      $$('[data-minus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.minus); if(it.qty>1)it.qty--; else cart=cart.filter(x=>x.id!==it.id); renderCart();});
      $$('[data-plus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.plus); const p=state.products.find(p=>p.id===it.id); if(it.qty>=p.qty)return toast('No hay más stock','err'); it.qty++; renderCart();});
      $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.remove); renderCart();});
    };
    const addProduct=(input)=>{
      const code=normalizeCode(input).toUpperCase();
      const p=productsForBiz().find(x=>x.code.toUpperCase()===code);
      if(!p){ beep('err'); return toast('Producto no encontrado en este negocio','err'); }
      if(p.qty<=0){ beep('err'); return toast('Sin stock disponible','err'); }
      const it=cart.find(x=>x.id===p.id);
      if(it){ if(it.qty>=p.qty){ beep('err'); return toast('No hay más stock','err'); } it.qty++; }
      else cart.push({id:p.id,name:p.name,price:p.price,qty:1,code:p.code});
      renderCart(); beep(); toast(`${p.name} agregado`);
    };
    $('#addCode').onclick=()=>{addProduct($('#manualCode').value); $('#manualCode').value='';};
    $('#manualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addCode').click();}});
    $('#sellSearch').oninput=()=>{ const q=$('#sellSearch').value.toLowerCase(); const list=productsForBiz().filter(p=>p.name.toLowerCase().includes(q)||p.code.toLowerCase().includes(q)).slice(0,6); $('#quickProducts').innerHTML=list.map(p=>`<button class="card bigRow" data-quick="${p.code}"><span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.code)} · ${p.qty} disp.</small></span><b>${fmt(p.price)}</b></button>`).join(''); $$('[data-quick]').forEach(b=>b.onclick=()=>addProduct(b.dataset.quick)); };
    $('#discount').oninput=renderCart;
    $('#openCamera').onclick=()=>startScanner(addProduct);
    $('#chargeBtn').onclick=()=>{
      if(!cart.length){ beep('err'); return toast('El carrito está vacío','err'); }
      const disc=parseMoney($('#discount').value);
      if(!Number.isFinite(disc)||disc<0){ beep('err'); return toast('Descuento inválido','err'); }
      const subtotal=cart.reduce((a,i)=>a+i.price*i.qty,0);
      if(disc>subtotal){ beep('err'); return toast('El descuento supera el subtotal','err'); }
      for(const i of cart){ const p=state.products.find(p=>p.id===i.id); if(!p||p.qty<i.qty){ beep('err'); return toast(`Stock insuficiente: ${i.name}`,'err'); } }
      const total=Math.max(0, subtotal-disc);
      const sale={id:uid('sale'),businessId:currentBusiness().id,date:today(),when:nowLabel(),items:cart.map(i=>({...i})),subtotal,discount:disc,total,method:$('#payMethod').value,customer:$('#customer').value.trim(),user:session.username};
      state.sales.push(sale);
      cart.forEach(i=>{ const p=state.products.find(p=>p.id===i.id); p.qty-=i.qty; });
      state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'ingreso',amount:total,note:`Venta ${sale.method}`,user:session.username});
      save(); cart=[]; renderCart(); beep('sale'); toast(`Venta registrada · ${fmt(total)}`);
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
    return (text.includes('C360|')||text.includes('CLICK360|')) ? text : null;
  }

  async function startScanner(onCode){
    const panel=$('#cameraPanel'), video=$('#scanVideo'), status=$('#cameraStatus');
    panel.classList.add('show');
    if(!$('#scanUpload')){
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*'; input.id='scanUpload'; input.style.display='none';
      panel.appendChild(input);
      const uploadBtn=document.createElement('button');
      uploadBtn.className='btn silver block';
      uploadBtn.id='scanUploadBtn';
      uploadBtn.textContent='Leer QR desde foto';
      uploadBtn.style.margin='10px';
      panel.appendChild(uploadBtn);
      uploadBtn.onclick=()=>input.click();
      input.onchange=e=>scanImageFile(e.target.files?.[0], onCode);
    }
    status.textContent='Solicitando permiso de cámara...';
    try{
      stopScanner(false);
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('camera unavailable');
      scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      video.srcObject=scanStream; await video.play();
      status.textContent='Cámara activa. Apunta al QR de CLICK 360.';
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
            if(!raw.includes('C360|')&&!raw.includes('CLICK360|')) return toast('Este QR no pertenece a CLICK 360','err');
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
            if(!raw.includes('C360|')&&!raw.includes('CLICK360|')) return toast('Este QR no pertenece a CLICK 360','err');
            onCode(raw);
          }
        },300);
        status.textContent=window.jsQR ? 'Lector QR local activo.' : 'Lector QR local CLICK 360 activo. Apunta al QR de la etiqueta.';
      }
    }catch(e){
      status.textContent='No se pudo activar la cámara. Usa el ingreso manual de código o una foto del QR.';
      toast('No se pudo activar la cámara. Usa código manual o foto.','err');
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
          status.textContent='No se pudo leer el QR de la foto. Usa el código manual.';
          toast('No se pudo leer el QR de la foto','err');
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
    $('#newMove').onclick=()=>showModal(`<div class="modalHeader"><h2>Nuevo movimiento</h2><button class="closeBtn" data-close>×</button></div><form id="moveForm"><div class="field"><label>Tipo</label><select id="mKind"><option value="egreso">Gasto</option><option value="compra">Compra</option><option value="retiro">Retiro</option><option value="ingreso">Ingreso</option></select></div><div class="field"><label>Monto</label><input id="mAmount" inputmode="decimal" value="0"></div><div class="field"><label>Nota</label><input id="mNote"></div><button class="btn primary block">Guardar</button></form>`);
    document.addEventListener('submit', moveSubmit, {once:true});
    $('#closeDay').onclick=()=>{ window.print(); toast('Cierre listo para imprimir'); };
  }
  function moveSubmit(e){ if(e.target.id!=='moveForm')return; e.preventDefault(); const amount=parseMoney($('#mAmount').value); if(!Number.isFinite(amount)||amount<0)return toast('Monto inválido','err'); state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:$('#mKind').value,amount,note:$('#mNote').value.trim(),user:session.username}); save(); closeModal(); renderApp('cash'); toast('Movimiento registrado'); }
  function bindMore(){ $$('[data-more]').forEach(b=>b.onclick=()=>renderApp(b.dataset.more)); $('#logoutMore')?.addEventListener('click',()=>{setSession(null);renderLogin();}); }
  function bindBackup(){ $('#backupBtn').onclick=downloadBackup; $('#restoreFile').onchange=restoreBackup; $('#cloudSoon').onclick=()=>toast('Preparado para CLICK 360 Cloud. Requiere backend real.'); }
  function bindSettings(){
    $('#saveBiz').onclick=()=>{const b=currentBusiness(); b.name=$('#bizName').value.trim()||b.name; b.type=$('#bizType').value; save(); renderApp('settings'); toast('Guardado');};
    $('#createBiz').onclick=()=>{const name=$('#newBizName').value.trim(); if(!name)return toast('Falta el nombre','err'); const b={id:uid('biz'),code:'EMPRESA-'+String(state.businesses.length+1).padStart(3,'0'),name,type:$('#newBizType').value,status:'activo',due:'2026-07-08'}; state.businesses.push(b); state.activeBusinessId=b.id; const user=currentUser(); if(user&&!user.businessIds.includes(b.id))user.businessIds.push(b.id); save(); renderApp('inventory'); toast('Negocio creado');};
  }

  function renderAdmin(){
    if(!checkAuth('admin'))return;
    const rows=state.businesses.map(b=>`<div class="card adminRow"><div><h3>${escapeHtml(b.name)} <span class="status ${b.status}">${escapeHtml(b.status)}</span></h3><p>Código: ${escapeHtml(b.code||b.id)} · Vence: ${escapeHtml(b.due||'')}</p></div><div class="actions"><button class="btn primary" data-admin-act="${b.id}">Activar</button><button class="btn" data-admin-pause="${b.id}">Pausar</button><button class="btn silver" data-admin-month="${b.id}">+ Mes</button></div></div>`).join('');
    app.innerHTML=`<div class="app"><header class="topbar" style="display:flex"><div class="logoMark"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360 · ADMIN</span><small>Panel de administración</small></div></div><button class="logoutBtn" id="adminLogout">↗</button></header><main class="main"><div class="pageHead"><div><h1>Clientes y negocios</h1><p>Gestiona acceso, estados y vencimientos.</p></div></div><section class="adminList">${rows}</section></main></div>`;
    $('#adminLogout').onclick=()=>{setSession(null);renderLogin();};
    $$('[data-admin-act]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminAct); b.status='activo'; save(); renderAdmin();});
    $$('[data-admin-pause]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminPause); b.status='pausado'; save(); renderAdmin();});
    $$('[data-admin-month]').forEach(btn=>btn.onclick=()=>{const b=state.businesses.find(x=>x.id===btn.dataset.adminMonth); const d=new Date(b.due||Date.now()); d.setMonth(d.getMonth()+1); b.due=d.toISOString().slice(0,10); b.status='activo'; save(); renderAdmin();});
  }

  function showModal(html){ closeModal(); const root=document.createElement('div'); root.id='modalRoot'; root.innerHTML=`<div class="modalOverlay show"><div class="modal">${html}</div></div>`; document.body.appendChild(root); $$('[data-close]',root).forEach(b=>b.onclick=closeModal); }
  function closeModal(){ $('#modalRoot')?.remove(); }

  async function openLabelModal(product){
    showModal(`<div class="modalHeader"><h2>Etiqueta imprimible</h2><button class="closeBtn" data-close>×</button></div><div class="labelPreview"><div class="sticker" id="sticker"><div class="biz">${escapeHtml(currentBusiness().name)}</div><canvas id="qrCanvas"></canvas><div class="code">${escapeHtml(product.code)}</div><div class="pname">${escapeHtml(product.name)}</div><div class="price">${fmt(product.price)}</div></div><div class="labelButtons"><button class="btn primary" id="printOne">Imprimir etiqueta</button><button class="btn silver" id="downloadPng">Descargar PNG</button><button class="btn" id="printStock">Imprimir según stock (${product.qty})</button><button class="btn" id="printAll">Imprimir todas</button></div></div>`);
    QR.draw($('#qrCanvas'), productPayload(product), 220);
    $('#printOne').onclick=()=>printLabels([{product,copies:1}]);
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
  function restoreBackup(e){ const file=e.target.files[0]; if(!file)return; const reader=new FileReader(); reader.onload=()=>{try{state=normalizeState(JSON.parse(reader.result));save();renderApp('home');toast('Respaldo restaurado')}catch{toast('No se pudo restaurar','err')}}; reader.readAsText(file); }

  function runQa(){
    const results=[]; const ok=(name,cond)=>results.push(`${cond?'PASS':'FAIL'} ${name}`);
    const oldState=state, oldSession=session;
    state=seed(); setSession(null); save();
    ok('parse 5,50', parseMoney('5,50')===5.5);
    ok('parse 12.99', parseMoney('12.99')===12.99);
    const p={id:'p1',businessId:state.businesses[0].id,code:'TEST01',name:'Buzo QA',category:'Prueba',qty:5,cost:2.25,price:5.5};
    state.products.push(p);
    ok('qr payload local', productPayload(p).startsWith('C360|'));
    ok('normalize QR', normalizeCode(productPayload(p))==='TEST01');
    QR.make(productPayload(p)); ok('qr generator', true);
    const pre=document.createElement('pre'); pre.id='qa-results'; pre.textContent=results.join('\\n'); document.body.appendChild(pre);
    console.log(pre.textContent);
    state=oldState; session=oldSession; save();
  }
  window.click360Route=renderApp;
  window.CLICK360_QA={parseMoney, normalizeCode, productPayload, QR, runQa};

  window.addEventListener('hashchange',()=>{ const h=location.hash.replace('#',''); if(['home','inventory','sell','cash','more'].includes(h)) renderApp(h); });
  if('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  if(location.search.includes('qa')) { renderLogin(); setTimeout(runQa,300); }
  else if(!session) renderLogin(); else if(session.role==='admin') renderAdmin(); else renderApp('home');
})();
