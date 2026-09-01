/** Deterministic intrinsic validation. No normalization, SDK or writes. */
import {createHash} from 'node:crypto';
import {validV10StateShape,domainCounts} from '../lib/click360-data-core.mjs';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const close=(a,b)=>finite(a)&&typeof b==='number'&&Number.isFinite(b)&&Math.abs(a-b)<0.011;
export function validateRecoveredData(data,{production=false}={}){
  const errors=[];
  const check=(condition,code)=>{if(!condition)errors.push(code);};
  check(validV10StateShape(data),'REQUIRED_V10_STRUCTURES');
  if(!validV10StateShape(data))return {valid:false,errors};
  const businessIds=data.businesses.map(b=>b.id),businesses=new Set(businessIds);
  // Physical legacy business ID differs from the owner/state document ID.
  // Pin the proven logical scope, do not rewrite it into the owner UID.
  if(production)check(createHash('sha256').update(JSON.stringify([...businessIds].sort())).digest('hex')
    ==='cdf5e3a7acdc81dd6b308208551ede5d80403121566648d180bf46f98d185008','SHARY_LOGICAL_BUSINESS_SCOPE');
  check(businesses.has(data.activeBusinessId),'ACTIVE_BUSINESS_REFERENCE');
  const domains=['businesses','products','sales','movements','layaways','cashSessions','dailyReports','deletedProducts','auditLogs'];
  for(const domain of domains){
    const rows=data[domain];check(Array.isArray(rows),'ARRAY_'+domain);if(!Array.isArray(rows))continue;
    check(new Set(rows.map(r=>r.id)).size===rows.length,'UNIQUE_IDS_'+domain);
    for(const row of rows){
      check(typeof row.id==='string'&&row.id.length>0,'ENTITY_ID_'+domain);
      if(domain!=='businesses')check(businesses.has(row.businessId),'ENTITY_BUSINESS_'+domain);
      if(production)check(!/^(?:synthetic-|fixture-|qa-mvp-r38-)/i.test(row.id)&&!row.qaFixture,'SYNTHETIC_RECORD_'+domain);
    }
  }
  const products=new Map(data.products.map(p=>[p.id,p])),deleted=new Set(data.deletedProducts.map(p=>p.id));
  const sales=new Map(data.sales.map(s=>[s.id,s])),cash=new Map((data.cashSessions||[]).map(s=>[s.id,s]));
  check(new Set(data.products.map(p=>p.businessId+'|'+String(p.code||'').trim().toUpperCase())).size===data.products.length,'UNIQUE_PRODUCT_CODES');
  for(const p of data.products){
    check(['stock','qty','price','cardPrice','cost'].every(k=>finite(p[k])),'PRODUCT_NUMERIC');
    check(p.stock===p.qty,'STOCK_QTY');check(!!String(p.code||'').trim()&&!!String(p.name||'').trim(),'PRODUCT_NAME_CODE');
  }
  const paymentIds=new Set(),saleOperations=new Set();
  for(const sale of data.sales){
    check(Array.isArray(sale.items)&&sale.items.length>0,'SALE_ITEMS');
    for(const item of sale.items||[]){
      check(item.isCustom===true||products.has(item.productId||item.id)||deleted.has(item.productId||item.id),'SALE_PRODUCT_REFERENCE');
      check(finite(item.qty)&&item.qty>0&&finite(item.price)&&finite(item.total),'SALE_ITEM_NUMERIC');
    }
    check(['total','received','balance'].every(k=>finite(sale[k])),'SALE_NUMERIC');
    if(sale.cashSessionId)check(cash.has(sale.cashSessionId),'SALE_CASH_REFERENCE');
    if(sale.operationId){check(!saleOperations.has(sale.operationId),'DUPLICATE_SALE_OPERATION');saleOperations.add(sale.operationId);}
    for(const payment of sale.payments||[]){
      check(finite(payment.amount),'PAYMENT_AMOUNT');
      if(payment.id){check(!paymentIds.has(payment.id),'DUPLICATE_PAYMENT');paymentIds.add(payment.id);}
    }
    if(sale.payments?.length)check(close(sale.received,sale.payments.reduce((n,p)=>n+p.amount,0)),'SALE_PAYMENT_RECONCILIATION');
  }
  for(const movement of data.movements){
    check(finite(movement.amount),'MOVEMENT_AMOUNT');
    if(movement.saleId)check(sales.has(movement.saleId),'MOVEMENT_SALE_REFERENCE');
    if(movement.cashSessionId)check(cash.has(movement.cashSessionId),'MOVEMENT_CASH_REFERENCE');
  }
  for(const layaway of data.layaways||[]){
    check(finite(layaway.total)&&finite(layaway.paid)&&finite(layaway.balance),'LAYAWAY_NUMERIC');
    check(close(layaway.total,layaway.paid+layaway.balance),'LAYAWAY_BALANCE');
    check(close(layaway.paid,(layaway.payments||[]).reduce((n,p)=>n+p.amount,0)),'LAYAWAY_PAYMENTS');
    check(sales.has(layaway.saleId)&&close(layaway.balance,sales.get(layaway.saleId)?.balance),'LAYAWAY_SALE');
    if(['paid','ready_for_pickup','picked_up'].includes(layaway.status))check(layaway.balance===0,'LAYAWAY_TERMINAL_BALANCE');
  }
  for(const report of data.dailyReports||[]){
    const session=cash.get(report.cashSessionId);
    check(session?.reportId===report.id&&session.status==='closed','CASH_CLOSURE_LINK');
    for(const key of ['expectedCash','countedCash','difference'])check(typeof report[key]==='number'&&Number.isFinite(report[key])&&report[key]===session?.[key],'CASH_CLOSURE_'+key);
    check(Math.abs(report.countedCash-report.expectedCash-report.difference)<0.011,'CASH_DIFFERENCE');
  }
  for(const group of ['labelTemplates','labelProfiles']){
    check(Array.isArray(data.settings[group]),'PRINT_ARRAY_'+group);
    for(const item of data.settings[group]||[]){check(businesses.has(item.businessId),'PRINT_BUSINESS');
      const paper=item.universalDocument?.paper||item;
      for(const key of ['rows','columns','widthMm','heightMm'])if(paper[key]!=null)check(finite(paper[key])&&paper[key]>0,'PRINT_GEOMETRY_'+key);
    }
  }
  return {valid:errors.length===0,errors:[...new Set(errors)],counts:domainCounts(data)};
}
