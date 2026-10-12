// Shared DEV UI boundary. Not loaded by legacy production and no auto-cutover.
(function(root){
  'use strict';
  const paidMethods=new Set(['Efectivo','Tarjeta','Transferencia']);
  function saleCommand({sale,cartLines,identity,cashSessionId,workingDate}){
    if(!identity?.ownerUid||!identity.businessId||sale?.businessId!==identity.businessId
      ||!sale.operationId||!cashSessionId||sale.cashSessionId!==cashSessionId
      ||sale.date!==workingDate||!/^\d{4}-\d{2}-\d{2}$/.test(workingDate||''))throw Error('MODULAR_COMMAND_CONTEXT_INVALID');
    if(!Array.isArray(sale.items)||!sale.items.length||!Array.isArray(cartLines)
      ||cartLines.length!==sale.items.length)throw Error('MODULAR_COMMAND_CART_REQUIRED');
    // Reject the certified transaction envelope limit before the PWA pins
    // a local stock delta/journal row. The kernel and Rules remain strict.
    if(sale.items.length>12)throw Error('MODULAR_COMMAND_LINE_BUDGET_EXCEEDED');
    const translated=structuredClone(sale);
    translated.items=sale.items.map((line,index)=>{
      const cart=cartLines[index],id=cart?.productId||cart?.id,lineId=line.productId||line.id;
      if(!id||lineId!==id||cart.qty!==line.qty||!Number.isSafeInteger(line.qty)||line.qty<1
        ||(cart.businessId!==undefined&&cart.businessId!==identity.businessId)
        ||(line.businessId!==undefined&&line.businessId!==identity.businessId))throw Error('MODULAR_COMMAND_LINE_CONFLICT');
      // The real cart contains isCustom; receipt calculation lines can omit it.
      // Never infer non-stock status from a name, barcode or ID prefix.
      return {...structuredClone(line),productId:id,isCustom:cart.isCustom===true};
    });
    return {operationId:sale.operationId,sale:translated};
  }
  function liveSaleCommand(input){
    const command=saleCommand(input);
    if(!paidMethods.has(command.sale.method)||command.sale.received!==command.sale.total
      ||command.sale.status!=='paid')throw Error('MODULAR_PAID_SALE_INVALID');
    return command;
  }
  function manualSaleCommand(input){
    if(!Array.isArray(input.cartLines)||!input.cartLines.length||input.cartLines.some(line=>line.isCustom!==true))
      throw Error('MODULAR_MANUAL_SALE_REQUIRES_EXPLICIT_CUSTOM_LINES');
    return liveSaleCommand(input);
  }
  function pendingPaymentCommand(input){
    const command=saleCommand(input);
    if(command.sale.method!=='Pendiente'||command.sale.status!=='pending_payment'
      ||command.sale.received!==0||command.sale.balance!==command.sale.total)throw Error('MODULAR_PENDING_PAYMENT_INVALID');
    return command;
  }
  function layawayCommand(input){
    const command=saleCommand(input),layaway=structuredClone(input.layaway);
    if(command.sale.method!=='Apartado'||command.sale.status!=='layaway'||!paidMethods.has(input.initialPaymentMethod)
      ||!layaway?.id||layaway.businessId!==input.identity.businessId||layaway.saleId!==command.sale.id
      ||layaway.total!==command.sale.total||layaway.paid!==command.sale.received
      ||layaway.balance!==Math.round((layaway.total-layaway.paid)*100)/100)throw Error('MODULAR_LAYAWAY_COMMAND_INVALID');
    // The initial movement is the deposit received, never the full sale total.
    return {...command,paymentMethod:input.initialPaymentMethod,layaway};
  }
  function productMutationCommand({product,previous,identity,operationId,date}){
    if(!operationId||!product?.id||product.businessId!==identity?.businessId
      ||(previous&&(previous.id!==product.id||previous.businessId!==identity.businessId)))throw Error('MODULAR_PRODUCT_COMMAND_CONTEXT_INVALID');
    const stock=product.stock??product.qty;
    if(typeof stock!=='number'||!Number.isSafeInteger(stock)||stock<0
      ||(product.qty!==undefined&&product.qty!==stock))throw Error('MODULAR_PRODUCT_STOCK_INVALID');
    if(!previous)return {kind:'product_create',input:{operationId,date,product:structuredClone(product)}};
    const fields=['code','name','category','cost','price','cardPrice','taxMode','notes','imageData'];
    const changes=Object.fromEntries(fields.filter(key=>product[key]!==previous[key]).map(key=>[key,product[key]]));
    const delta=stock-(previous.stock??previous.qty);
    // One form means one immutable command and atomic stock/movement/metadata
    // commit. Never split an edit into two independently retryable operations.
    const revision=previous.recordVersion===undefined?{}:{expectedRecordVersion:previous.recordVersion};
    return delta?{kind:'inventory_adjust',input:{operationId,productId:product.id,quantityDelta:delta,changes,date,reason:'Ajuste de inventario',...revision}}
      :{kind:'product_edit',input:{operationId,productId:product.id,changes,...revision}};
  }
  function productDeleteCommand({product,identity,operationId}){
    if(!operationId||!product?.id||product.businessId!==identity?.businessId||product.deleted===true)
      throw Error('MODULAR_PRODUCT_DELETE_CONTEXT_INVALID');
    if(!Number.isSafeInteger(product.recordVersion)||product.recordVersion<1)
      throw Error('MODULAR_PRODUCT_DELETE_REVISION_REQUIRED');
    return {kind:'product_delete',input:{operationId,productId:product.id,expectedRecordVersion:product.recordVersion}};
  }
  function cashReportView(report){
    const fields=['openingAmount','declaredCash','theoreticalCash','difference','saleCount','total','totalItems','totalIva','incomeCash','expenseCash'];
    if(!report?.cashSessionId||report.status!=='closed'||!report.paymentTotals
      ||fields.some(key=>typeof report[key]!=='number'||!Number.isFinite(report[key]))
      ||['cash','card','transfer','receivablePayments'].some(key=>typeof report.paymentTotals[key]!=='number'||!Number.isFinite(report.paymentTotals[key])))
      throw Error('MODULAR_REPORT_AUTHORITATIVE_SUMMARY_REQUIRED');
    return {...report,productQuantity:report.totalItems,taxTotal:report.totalIva,
      expectedCash:report.theoreticalCash,countedCash:report.declaredCash,
      income:Math.round((report.paymentTotals.cash+report.incomeCash)*100)/100,expenses:report.expenseCash,
      paymentTotals:{...report.paymentTotals,layawayPayments:report.paymentTotals.receivablePayments,receivableIncluded:true}};
  }
  function customerMutationCommand({customer,previous,identity,operationId,deleting=false}){
    if(!operationId||!identity?.ownerUid||!customer?.id||customer.businessId!==identity.businessId
      ||(previous&&(previous.id!==customer.id||previous.businessId!==identity.businessId)))throw Error('MODULAR_CUSTOMER_CONTEXT_INVALID');
    if(deleting){
      if(!previous||previous.deleted===true||!Number.isSafeInteger(previous.recordVersion)||previous.recordVersion<1)
        throw Error('MODULAR_CUSTOMER_DELETE_REVISION_REQUIRED');
      return {kind:'customer_delete',input:{operationId,customerId:customer.id,expectedRecordVersion:previous.recordVersion}};
    }
    const changes={name:customer.name,phone:customer.phone,notes:customer.notes};
    if(typeof changes.name!=='string'||!changes.name.trim()
      ||typeof changes.phone!=='string'||typeof changes.notes!=='string')throw Error('MODULAR_CUSTOMER_FIELDS_INVALID');
    if(previous&&(!Number.isSafeInteger(previous.recordVersion)||previous.recordVersion<1))throw Error('MODULAR_CUSTOMER_REVISION_REQUIRED');
    return {kind:previous?'customer_edit':'customer_create',input:{operationId,customerId:customer.id,changes,
      ...(previous?{expectedRecordVersion:previous.recordVersion}:{})}};
  }
  function receivablePaymentCommand({sale,layaway,identity,operationId,cashSessionId,workingDate,amount,method}){
    if(!identity?.ownerUid||sale?.businessId!==identity.businessId||!sale.storageRecordId
      ||!operationId||!cashSessionId||!/^\d{4}-\d{2}-\d{2}$/.test(workingDate||'')
      ||!['layaway','pending_payment'].includes(sale.status))throw Error('MODULAR_PAYMENT_CONTEXT_INVALID');
    if(!Number.isSafeInteger(sale.recordVersion)||sale.recordVersion<1)throw Error('MODULAR_PAYMENT_REVISION_REQUIRED');
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>sale.balance
      ||Math.abs(amount*100-Math.round(amount*100))>0.000001||!paidMethods.has(method))throw Error('MODULAR_PAYMENT_AMOUNT_INVALID');
    if(sale.method==='Apartado'&&(!layaway?.id||layaway.businessId!==identity.businessId||layaway.saleId!==sale.id
      ||sale.layawayId!==layaway.id))throw Error('MODULAR_PAYMENT_LAYAWAY_CONFLICT');
    if(sale.method!=='Apartado'&&layaway)throw Error('MODULAR_PAYMENT_LAYAWAY_CONFLICT');
    return {kind:'receivable_payment',input:{operationId,saleId:sale.storageRecordId,
      expectedRecordVersion:sale.recordVersion,cashSessionId,date:workingDate,amount,method,
      ...(layaway?{layawayId:layaway.id}:{})}};
  }
  function create({repository,journal,deviceId,resolveIdentity,isOnline=()=>root.navigator?.onLine!==false,onStatus=()=>{},onConfirmed}){
    const identity=repository?.identity;
    if(!identity||typeof resolveIdentity!=='function')throw Error('MODULAR_UI_IDENTITY_REQUIRED');
    if(typeof onConfirmed!=='function'||typeof journal?.markProjected!=='function'
      ||typeof journal.listProjectionPending!=='function'||typeof journal.countProjectionPending!=='function'
      ||typeof journal.countPending!=='function')
      throw Error('MODULAR_UI_DURABLE_PROJECTION_REQUIRED');
    const coordinator=root.CLICK360_MODULAR_COORDINATOR.create({repository,journal,deviceId});
    const inFlight=new Map();
    const assertContext=()=>{
      const active=resolveIdentity();
      if(active?.ownerUid!==identity.ownerUid||active?.businessId!==identity.businessId||active?.tenantKey!==identity.tenantKey)throw Error('MODULAR_UI_CONTEXT_CHANGED');
    };
    const emit=(operationId,status,reason=null)=>{
      assertContext();
      // No UID/email/request contents in support-facing status events.
      const detail={operationId,status,reason,operationalCloudConfirmed:status==='CONFIRMED'};
      onStatus(detail);return detail;
    };
    async function confirm(row){
      assertContext();
      const evidence=await repository.lookupOperation(row.operationId,row.payload.kind,row.payloadHash);
      assertContext();
      if(evidence.source!=='server'||!evidence.exists)throw Error('MODULAR_UI_SERVER_CONFIRMATION_REQUIRED');
      // A locally confirmed journal row is not by itself cloud evidence.
      // Projection must be idempotent by operation ID and resolve only after
      // local durable persistence. A crash/failure leaves recovery indexed.
      try{
        await onConfirmed({operationId:row.operationId,kind:row.payload.kind,evidence});
        assertContext();
        await journal.markProjected(identity,row.operationId,row.payloadHash);
      }catch(error){
        assertContext();
        return emit(row.operationId,'LOCAL_RECOVERY_PENDING',error.message==='SPARK_UI_PENDING_OVERLAY_REQUIRED'
          ?'confirmed_waiting_for_pending_operations':'confirmed_operation_local_projection_pending');
      }
      assertContext();return emit(row.operationId,'CONFIRMED');
    }
    async function settle(row){
      assertContext();
      if(!isOnline())return emit(row.operationId,row.state==='unknown'||row.state==='inflight'?'UNKNOWN':'PENDING','offline');
      try{
        const result=await coordinator.process(row.operationId);
        assertContext();
        if(result.status==='confirmed')return await confirm(await journal.get(identity,row.operationId));
        return emit(row.operationId,'UNKNOWN','server_reconciliation_required');
      }catch(error){
        // Context changes never project another tenant's operation into this UI.
        assertContext();
        return emit(row.operationId,'UNKNOWN',String(error.code||'server_confirmation_unavailable'));
      }
    }
    async function submit(kind,input){
      assertContext();
      const candidate=root.CLICK360_MODULAR_JOURNAL.validatePayload(structuredClone(input));
      const prepared=await repository.prepareOperation(kind,candidate);
      assertContext();
      const pending=inFlight.get(prepared.operationId);
      if(pending){
        if(pending.hash!==prepared.payloadSha256)throw Error('OPERATION_ID_PAYLOAD_CONFLICT');
        return pending.promise;
      }
      const promise=(async()=>{
        const row=await coordinator.enqueue(kind,candidate);
        assertContext();emit(row.operationId,'PENDING');
        return settle(row);
      })();
      inFlight.set(prepared.operationId,{hash:prepared.payloadSha256,promise});
      try{return await promise;}finally{if(inFlight.get(prepared.operationId)?.promise===promise)inFlight.delete(prepared.operationId);}
    }
    async function replay({limit=25}={}){
      assertContext();
      if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_REPLAY_LIMIT');
      // A projection cannot replace a newer pending device candidate. Starting
      // every replay with that projection deadlocks recovery forever. Settle
      // the bounded financial queue first; indexed projections remain durable.
      const counts=await journal.countPending(identity);
      assertContext();
      const projections=counts.total===0?await journal.listProjectionPending(identity,limit):[],results=[];
      assertContext();
      for(const row of projections){
        const result=await settle(row);results.push(result);
        if(result.status!=='CONFIRMED')return results;
      }
      if(results.length===limit)return results;
      const rows=await journal.listPending(identity,limit-results.length);
      assertContext();
      for(const row of rows){
        const result=await settle(row);results.push(result);
        // Continue only for the explicit local-overlay barrier. Network,
        // issuer, revision, durability and UNKNOWN failures still stop replay.
        if(result.status!=='CONFIRMED'&&!(result.status==='LOCAL_RECOVERY_PENDING'
          &&result.reason==='confirmed_waiting_for_pending_operations'))break;
      }
      return results;
    }
    async function health(){
      assertContext();
      if(journal.countPending){const counts=await journal.countPending(identity);assertContext();
        const projectionPendingCount=await journal.countProjectionPending(identity);assertContext();
        return {...counts,projectionPendingCount,online:isOnline(),activeRequests:inFlight.size};}
      const rows=await journal.listPending(identity,100);assertContext();
      return {pendingCount:rows.filter(row=>row.state==='queued').length,
        unknownCount:rows.filter(row=>row.state==='unknown'||row.state==='inflight').length,
        countIsBounded:true,maxObserved:100,online:isOnline(),activeRequests:inFlight.size};
    }
    async function reconcileOperation(operationId){
      assertContext();const row=await journal.get(identity,operationId);assertContext();
      if(!row)throw Error('MODULAR_UI_OPERATION_NOT_JOURNALED');
      // Settle only this immutable operation. The coordinator checks the
      // authoritative ledger before any resend; unrelated rows are untouched.
      return settle(row);
    }
    return Object.freeze({submit,replay,health,reconcileOperation});
  }
  root.CLICK360_MODULAR_UI_ADAPTER=Object.freeze({create,liveSaleCommand,manualSaleCommand,layawayCommand,pendingPaymentCommand,productMutationCommand,productDeleteCommand,customerMutationCommand,receivablePaymentCommand,cashReportView});
})(typeof window==='undefined'?globalThis:window);
