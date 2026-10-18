import assert from 'node:assert/strict';
// Call from existing served synthetic journeys. Uses the page's authenticated
// Web SDK and deployed Rules; no Admin bypass, seed, mocked report, or commercial write.
export async function certifyRetailReport(page,{ownerUid,businessId,from,to}){
  await page.evaluate(()=>{location.hash='#reports';});
  await page.locator('#queryRetailReport').waitFor({state:'visible'});
  await page.locator('#repFrom').fill(from);await page.locator('#repFrom').dispatchEvent('change');
  await page.locator('#repTo').fill(to);await page.locator('#repTo').dispatchEvent('change');
  const commercial=()=>page.evaluate(()=>JSON.stringify(Object.fromEntries(['products','sales','movements','cashSessions','dailyReports','layaways','customers']
    .map(key=>[key,click360GetTenantState()[key]]))));
  const before=await commercial();
  const expected=await page.evaluate(async({ownerUid,businessId,from,to})=>{
    const result={sold:0,collected:0,tickets:0,records:0,pages:0},db=firebase.firestore();
    for(const module of ['sales','movements']){
      let after=null;
      do{
        let q=db.collection(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/${module}`)
          .where('data.date','>=',from).where('data.date','<=',to).orderBy('data.date','desc').orderBy('__name__','desc').limit(100);
        if(after)q=q.startAfter(...after);
        const snapshot=await q.get({source:'server'});
        if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)throw Error('RETAIL_TEST_SERVER_REQUIRED');result.pages++;
        for(const document of snapshot.docs){const row=document.data().data;result.records++;
          if(module==='sales'&&row.status!=='cancelled'){
            if(typeof row.total!=='number'||!Number.isFinite(row.total))throw Error('RETAIL_SYNTHETIC_TOTAL_MISSING');
            result.tickets++;result.sold+=Math.round(row.total*100);
          }else if(module==='movements'&&row.saleId&&row.status!=='cancelled'&&['ingreso','sale_cancellation'].includes(row.kind)){
            if(typeof row.amount!=='number'||!Number.isFinite(row.amount))throw Error('RETAIL_SYNTHETIC_RECEIPT_MISSING');
            if(row.kind==='sale_cancellation'&&row.compensationSign!==-1)throw Error('RETAIL_SYNTHETIC_REVERSAL_MISSING');
            result.collected+=Math.round(row.amount*100)*(row.compensationSign===-1?-1:1);
          }
        }
        const last=snapshot.docs.at(-1);after=snapshot.size===100?[last.data().data.date,last.id]:null;
      }while(after);
    }
    result.sold/=100;result.collected/=100;return result;
  },{ownerUid,businessId,from,to});
  await page.locator('#queryRetailReport').click();
  await page.waitForFunction(()=>document.querySelector('#app')?.textContent.includes('Período completo leído de la nube'));
  for(const field of ['sold','collected','tickets']){
    const text=await page.locator(`[data-retail-total="${field}"]`).textContent();
    const value=Number(text.replace(/[^\d.-]/g,''));
    assert.equal(value,expected[field],`Served report ${field} must equal authoritative complete date-range query`);
  }
  assert.equal(await commercial(),before,'Query/report must never mutate commercial arrays');
  assert(await page.locator('#app').textContent().then(text=>text.includes('Historial')));
  return {status:'PASS',retailReportServerRead:true,noCommercialWrites:true,...expected};
}
