// Real UI flows shared by emulator and synthetic authenticated staging.
export function commerceFlows({cloud,submitProduct,assertProduct,results=[],writePattern}){
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function cloudUntil(predicate,label){
  for(let i=0;i<100;i++){const document=await cloud();if(predicate(document.payload.data))return document;await new Promise(r=>setTimeout(r,300));}
  throw new Error('Authoritative server condition not reached: '+label);
}
async function sync(page){await page.waitForFunction(()=>window.click360SyncStatus?.status==='synced'
  &&Number(window.click360DebugCriticalActionGate?.().size||0)===0,null,{timeout:60000});}
async function route(page,name){await page.evaluate(name=>window.click360Route(name),name);}
async function closeReceipt(page){await page.locator('#doneSaleBtn').waitFor({state:'visible'});await page.locator('#doneSaleBtn').click();}
async function searchAndEdit(page,code,expectedName){
  await route(page,'inventory');
  await page.evaluate(()=>{
    window.R38_SEARCH_TRACE=[];
    document.querySelector('#productSearch').addEventListener('input',event=>window.R38_SEARCH_TRACE.push({query:event.target.value,cards:document.querySelectorAll('#productList [data-pid]').length}));
  });
  for(const query of [code,expectedName]){
    await page.locator('#productSearch').fill(query);
    // Access metadata can refresh while the user is searching. It must not
    // clear the search or return the matching card to the bottom of 437 items.
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('click360-access-changed')));
    assert(await page.locator('#productSearch').inputValue()===query,'search survives access-driven full re-render');
    const cards=page.locator('#productList [data-pid]');
    assert(await cards.count()===1,'search yields exactly the matching product');
    for(const attribute of ['data-label','data-quick-print','data-edit','data-del']){
      const button=cards.locator('['+attribute+']');
      assert(await button.isVisible(),`${attribute} visible after innerHTML re-render`);
      await button.locator('svg').waitFor({state:'visible'});
      const geometry=await button.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,color:s.color,bg:s.backgroundColor,svg:!!el.querySelector('svg')};});
      assert(geometry.x>=0&&geometry.y>=0&&geometry.right<=geometry.w+1&&geometry.bottom<=geometry.h,`no manual scroll required ${attribute}: ${JSON.stringify(geometry)}`);
      assert(geometry.svg,'action icon rendered (not blank)');
    }
    await cards.locator('[data-edit]').click();
    assert(await page.locator('#pCode').inputValue()===code,'correct edit product code');
    assert(await page.locator('#pName').inputValue()===expectedName,'correct edit product name');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('click360-access-changed')));
    assert(await page.locator('#pCode').inputValue()===code,'access refresh cannot dismiss or replace active product editor');
    await page.locator('#modalRoot .modalHeader [data-close]').click();
  }
}
async function editStock(page,product,stock){
  await page.locator('#productSearch').fill(product.code);
  await submitProduct(page,{id:product.id,code:product.code,name:product.name,stock});
  const authoritative=await cloud();
  const row=assertProduct(authoritative,product.id,stock,'r38 stock edit');
  assert(row.price===12&&row.cardPrice===12.5,'price/cardPrice preserved');
  for(const key of ['id','businessId','code','name','category','cost','price','cardPrice','taxMode','notes','imageData'])assert(JSON.stringify(row[key])===JSON.stringify(product[key]),'stock edit preserves '+key);
  const local=await page.evaluate(id=>window.click360GetTenantState().products.find(p=>p.id===id),product.id);
  assert(local.stock===stock&&local.qty===stock,'local canonical qty/stock');
  return authoritative;
}
async function charge(page,method){
  await route(page,'sell');await page.locator('#manualCode').fill('R38-CORE');await page.locator('#addCode').click();
  await page.locator('#payMethod').selectOption(method);
  const preservation=await page.evaluate(()=>{
    const snapshot=()=>({
      cart:Number(window.click360SellCartCount?.()||0),hash:location.hash,
      method:document.querySelector('#payMethod')?.value||'',businessId:document.querySelector('#payMethod')?.dataset.businessId||'',
      activeBusinessId:window.click360GetTenantState?.().activeBusinessId||'',hydrated:window.click360IsTenantDataHydrated?.(),
      cashOpen:(window.click360GetTenantState?.().cashSessions||[]).filter(item=>item.status==='open').map(item=>({id:item.id,date:item.date}))
    });
    const before=snapshot();window.dispatchEvent(new CustomEvent('click360-access-changed'));return {before,after:snapshot()};
  });
  assert(preservation.after.cart===1,'access refresh preserves active checkout cart: '+JSON.stringify(preservation));
  assert(await page.locator('#payMethod').inputValue()===method,'access refresh preserves selected tender');
  if(method==='Apartado'){
    await page.locator('#customer').fill('Cliente sintético R38');await page.locator('#customerCedula').fill('SYNTHETIC-ONLY');await page.locator('#customerPhone').fill('0000000000');
    await page.locator('#layawayTermsAccepted').check();await page.locator('#layawayInitialMethod').selectOption('Transferencia');await page.locator('#cashReceived').fill('2');
  }else if(method==='Efectivo'){
    const rejectedBefore=(await cloud()).payload.data;
    await page.locator('#cashReceived').fill('0');await page.locator('#chargeBtn').click();
    assert(await page.locator('#chargeBtn').isEnabled(),'invalid payment re-enables button');
    const rejectedAfter=(await cloud()).payload.data;
    assert(rejectedAfter.sales.length===rejectedBefore.sales.length&&rejectedAfter.movements.length===rejectedBefore.movements.length,'invalid payment has no server side effect');
    await page.locator('#cashReceived').fill('12');
  }
  const before=(await cloud()).payload.data;
  await page.route(writePattern,async route=>{if(route.request().method()==='POST')await new Promise(r=>setTimeout(r,180));return route.continue();});
  await page.evaluate(()=>{const b=document.getElementById('chargeBtn');for(let i=0;i<5;i++)b.click();});
  await closeReceipt(page);await sync(page);await page.unroute(writePattern);
  const after=(await cloud()).payload.data;
  assert(after.sales.length===before.sales.length+1,'five taps => exactly one server sale');
  assert(after.movements.length===before.movements.length+1,'five taps => exactly one server movement');
  const p=after.products.find(p=>p.code==='R38-CORE'),bp=before.products.find(p=>p.code==='R38-CORE');
  assert(p.stock===bp.stock-1&&p.qty===p.stock,'five taps => exactly one stock decrement');
  const sale=after.sales.find(s=>!before.sales.some(b=>b.id===s.id));
  assert(sale.payments[0].method===(method==='Apartado'?'Transferencia':method),'payment tender primitive correct');
  assert(await page.locator('#chargeBtn').isEnabled(),'checkout released');
  assert(await page.evaluate(()=>window.click360SellCartCount())===0,'successful checkout clears cart (no freeze)');
  assert(await page.locator('#doneSaleBtn').count()===0,'no duplicate receipt after closing');
  return sale;
}
async function payment(page,saleId,amount,method){
  const previous=(await cloud()).payload.data;
  await page.evaluate(saleId=>{void window.payLayaway(saleId);},saleId);
  await page.locator('#layawayPaymentAmount').fill(String(amount));await page.locator('#layawayPaymentMethod').selectOption(method);
  await page.evaluate(()=>{const b=document.getElementById('confirmLayawayPayment');for(let i=0;i<5;i++)b.click();});
  const after=(await cloudUntil(data=>data.movements.length===previous.movements.length+1,'one abono')).payload.data;
  await sync(page);
  const sale=after.sales.find(s=>s.id===saleId),before=previous.sales.find(s=>s.id===saleId);
  assert(sale.payments.length===before.payments.length+1,'abono duplicate clicks not duplicated');
  assert(sale.balance===before.balance-amount,'abono exact balance');
  assert(after.products.find(p=>p.code==='R38-CORE').stock===previous.products.find(p=>p.code==='R38-CORE').stock,'abono does not decrement reserved stock again');
  return sale;
}
async function commerce(page,label){
  await route(page,'cash');await page.locator('#apertureAmountInput').fill('50');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('click360-access-changed')));
  assert(await page.locator('#apertureAmountInput').inputValue()==='50','access refresh preserves typed opening amount');
  await page.locator('#startDayBtnCash').click();
  const opened=(await cloudUntil(data=>data.cashSessions.some(s=>s.status==='open'),'cash open')).payload.data;await sync(page);
  assert(opened.cashSessions.find(s=>s.status==='open').openingAmount===50,'server opening must be 50: '+JSON.stringify({sessions:opened.cashSessions,aperture:opened.movements.filter(m=>m.kind==='apertura')}));
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Jornada iniciada exitosamente');
  const sales=[];
  for(const method of ['Efectivo','Tarjeta','Transferencia','Apartado']){sales.push(await charge(page,method));console.log('PASS '+label+' charge '+method);}
  await route(page,'debtors');
  assert(await page.locator('.layawayRow').count()===1,'retail paid sales excluded from Apartados');
  const apart=sales[3];
  let sale=await payment(page,apart.id,3,'Transferencia');assert(sale.balance===7,'partial balance 12 - 2 - 3 = 7');
  sale=await payment(page,apart.id,7,'Transferencia');assert(sale.balance===0&&sale.status==='paid','fully paid');
  await page.locator('[data-layaway-filter="paid"]').click();assert(await page.locator('.layawayRow:visible').count()===1,'Pagados');
  await page.locator('.layawayRow:visible .layawayActions').getByRole('button',{name:'Listo',exact:true}).click();
  await cloudUntil(data=>data.layaways.some(l=>l.saleId===apart.id&&l.status==='ready_for_pickup'),'ready');await sync(page);
  await page.locator('[data-layaway-filter="ready_for_pickup"]').click();assert(await page.locator('.layawayRow:visible').count()===1,'Listos');
  await page.locator('.layawayRow:visible').getByRole('button',{name:'Entregar',exact:true}).click();
  await cloudUntil(data=>data.layaways.some(l=>l.saleId===apart.id&&l.status==='picked_up'),'delivered');await sync(page);
  await page.locator('[data-layaway-filter="picked_up"]').click();assert(await page.locator('.layawayRow:visible').count()===1,'Entregados');
  await page.locator('.layawayRow:visible').getByRole('button',{name:'Ver detalle',exact:true}).click();
  const detail=await page.locator('.layawayDetail').innerText();assert(detail.includes('Transferencia')&&detail.includes('Saldo: $0.00'),'payment history intact');
  await page.locator('#modalRoot .modalHeader [data-close]').click();
  await route(page,'cash');
  const data=(await cloud()).payload.data;
  const physicalIncome=data.movements.filter(m=>m.kind==='ingreso'&&m.paymentMethod==='Efectivo').reduce((s,m)=>s+m.amount,0);
  assert(physicalIncome===12,'transfers never count in physical drawer');
  await page.locator('#closeDayBtn').click();
  assert(await page.locator('#cajaInicial').inputValue()==='50','closing opening input preserves server aperture');
  await page.locator('#efectivoFisico').fill('62');await page.locator('#closeDaySubmitBtn').click();
  const closed=(await cloudUntil(data=>data.dailyReports.length===1&&data.cashSessions.some(s=>s.status==='closed'),'cash close')).payload.data;
  const report=closed.dailyReports[0],session=closed.cashSessions.find(s=>s.status==='closed');
  assert(report.expectedCash===62&&report.countedCash===62&&report.difference===0,'cash reconciliation authoritative: '+JSON.stringify({expected:report.expectedCash,counted:report.countedCash,difference:report.difference,opening:report.openingAmount,movements:closed.movements}));
  assert(session.expectedCash===62&&session.countedCash===62&&session.difference===0,'cash session matches voucher');
  assert(report.paymentTotals.cash===12&&report.paymentTotals.card===12.5&&report.paymentTotals.transfer===12&&report.paymentTotals.layawayPayments===12,'voucher separate tender totals');
  for(const [label,amount]of [['Efectivo','12.00'],['Tarjeta','12.50'],['Transferencia','12.00'],['Abonos Apartado','12.00']])assert(report.html.includes(`<span>${label}:</span><span>$${amount}</span>`),'voucher '+label);
  results.push({label,sales:4,newMovements:6,layaway:'picked_up',physicalIncome,expectedCash:62,stock:27});
}

return {cloudUntil,sync,route,searchAndEdit,editStock,charge,payment,commerce};
}
