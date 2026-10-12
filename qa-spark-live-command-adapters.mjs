import assert from 'node:assert/strict';
import './qa-spark-imported-cash-summaries.mjs';
import './modular-ui-adapter.js';
const api=globalThis.CLICK360_MODULAR_UI_ADAPTER;
const identity={ownerUid:'synthetic-owner',businessId:'alpha'};
const sale={id:'live-id',operationId:'stable-operation',businessId:'alpha',cashSessionId:'exact-session',date:'2026-09-03',
  total:30,received:30,balance:0,method:'Transferencia',status:'paid',items:[{id:'p1',qty:1,name:'Synthetic',price:30}]};
const input={sale,identity,cashSessionId:'exact-session',workingDate:'2026-09-03',cartLines:[{id:'p1',qty:1}]};
const unchanged=structuredClone(input),command=api.liveSaleCommand(input);
const tooManyLines=Array.from({length:13},(_,i)=>({id:`product-${i}`,qty:1}));
assert.throws(()=>api.liveSaleCommand({...input,sale:{...sale,items:tooManyLines},cartLines:tooManyLines}),/LINE_BUDGET_EXCEEDED/);
assert.equal(command.sale.items[0].productId,'p1');assert.equal(command.sale.items[0].isCustom,false);
assert.equal(command.operationId,sale.operationId);assert.deepEqual(input,unchanged);
for(const change of [{cashSessionId:''},{cashSessionId:'other'},{workingDate:'2026-09-04'},
  {identity:{...identity,businessId:'beta'}},{cartLines:[{id:'other-product',qty:1}]},{cartLines:[{id:'p1',qty:2}]}])
  assert.throws(()=>api.liveSaleCommand({...input,...change}),/CONTEXT_INVALID|LINE_CONFLICT/);
const manual=api.manualSaleCommand({...input,cartLines:[{id:'p1',qty:1,isCustom:true}]});
assert.equal(manual.sale.items[0].isCustom,true);
assert.throws(()=>api.manualSaleCommand(input),/EXPLICIT_CUSTOM/);
assert.equal(api.liveSaleCommand({...input,sale:{...sale,items:[{...sale.items[0],id:'custom-not-proof'}]},
  cartLines:[{id:'custom-not-proof',qty:1}]}).sale.items[0].isCustom,false);
const pending=api.pendingPaymentCommand({...input,sale:{...sale,received:0,balance:30,method:'Pendiente',status:'pending_payment'}});
assert.equal(pending.sale.received,0);
assert.throws(()=>api.pendingPaymentCommand({...input,sale:{...pending.sale,received:1}}),/PENDING_PAYMENT_INVALID/);
const layawaySale={...sale,received:5,balance:25,method:'Apartado',status:'layaway'};
const layaway={id:'layaway-id',businessId:'alpha',saleId:sale.id,total:30,paid:5,balance:25};
const reserved=api.layawayCommand({...input,sale:layawaySale,layaway,initialPaymentMethod:'Efectivo'});
assert.equal(reserved.sale.total,30);assert.equal(reserved.sale.received,5);assert.equal(reserved.paymentMethod,'Efectivo');
assert.throws(()=>api.layawayCommand({...input,sale:layawaySale,layaway:{...layaway,paid:30},initialPaymentMethod:'Efectivo'}),/LAYAWAY_COMMAND_INVALID/);
assert.throws(()=>api.layawayCommand({...input,sale:layawaySale,layaway,initialPaymentMethod:'Apartado'}),/LAYAWAY_COMMAND_INVALID/);
console.log('PASS explicit live/manual/layaway/pending command translation: exact historical session/date, live id -> productId, explicit custom provenance, deposit not total, immutable inputs, cross-business rejection. Not public UI activation.');
const receivable={...sale,id:'legacy-id',storageRecordId:'canonical-id',status:'pending_payment',method:'Pendiente',received:0,balance:30,recordVersion:1};
const paymentInput={sale:receivable,identity,operationId:'receipt-operation',cashSessionId:'payment-session',workingDate:'2026-10-06',amount:5,method:'Transferencia'};
const paymentBefore=structuredClone(paymentInput),payment=api.receivablePaymentCommand(paymentInput);
assert.equal(payment.input.saleId,'canonical-id');assert.equal(payment.input.cashSessionId,'payment-session');
assert.equal(payment.input.date,'2026-10-06');assert.deepEqual(paymentInput,paymentBefore);
for(const delta of [{amount:0},{amount:31},{amount:NaN},{amount:'5'},{amount:0.001},{method:'Apartado'},
  {cashSessionId:''},{identity:{...identity,businessId:'other'}},{sale:{...receivable,storageRecordId:''}},
  {sale:{...receivable,recordVersion:undefined}},{sale:{...receivable,status:'paid'}}])assert.throws(()=>api.receivablePaymentCommand({...paymentInput,...delta}),/MODULAR_PAYMENT_/);
const reservedPayment={...paymentInput,sale:{...receivable,status:'layaway',method:'Apartado',layawayId:'reservation'},
  layaway:{id:'reservation',businessId:'alpha',saleId:'legacy-id'}};
assert.equal(api.receivablePaymentCommand(reservedPayment).input.layawayId,'reservation');
assert.throws(()=>api.receivablePaymentCommand({...reservedPayment,layaway:{...reservedPayment.layaway,saleId:'other'}}),/LAYAWAY_CONFLICT/);
const customer={id:'synthetic-customer',businessId:'alpha',name:'Synthetic',phone:'',notes:''};
const customerInput={customer,identity,operationId:'customer-command'},customerBefore=structuredClone(customerInput);
assert.equal(api.customerMutationCommand(customerInput).kind,'customer_create');
assert.deepEqual(customerInput,customerBefore);
assert.equal(api.customerMutationCommand({...customerInput,previous:{...customer,recordVersion:1}}).input.expectedRecordVersion,1);
assert.throws(()=>api.customerMutationCommand({...customerInput,identity:{...identity,businessId:'beta'}}),/CONTEXT_INVALID/);
assert.throws(()=>api.customerMutationCommand({...customerInput,previous:customer}),/REVISION_REQUIRED/);
assert.throws(()=>api.customerMutationCommand({...customerInput,customer:{...customer,name:'   '}}),/FIELDS_INVALID/);
const deleting={...customerInput,previous:{...customer,recordVersion:2},deleting:true};
assert.deepEqual(api.customerMutationCommand(deleting),{kind:'customer_delete',input:{operationId:'customer-command',customerId:customer.id,expectedRecordVersion:2}});
assert.equal(deleting.previous.deleted,undefined);
assert.throws(()=>api.customerMutationCommand({...deleting,previous:{...deleting.previous,deleted:true}}),/DELETE_REVISION_REQUIRED/);
assert.throws(()=>api.customerMutationCommand({...deleting,previous:undefined}),/DELETE_REVISION_REQUIRED/);
