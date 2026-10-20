import assert from 'node:assert/strict';
import './qa-spark-imported-cash-summaries.mjs';
import './qa-spark-print-settings-contract.mjs';
import './qa-spark-manual-compensation-view.mjs';
import './qa-spark-imported-receivable-links.mjs';
import './modular-ui-adapter.js';
const api=globalThis.CLICK360_MODULAR_UI_ADAPTER;
const deletingProduct={id:'catalog-product',businessId:'alpha',recordVersion:3,stock:8,qty:8,name:'Historical product'};
const deleteInput={product:deletingProduct,identity:{ownerUid:'synthetic-owner',businessId:'alpha'},operationId:'catalog-delete'};
assert.deepEqual(api.productDeleteCommand(deleteInput),{kind:'product_delete',input:{operationId:'catalog-delete',productId:'catalog-product',expectedRecordVersion:3}});
assert.equal(deletingProduct.stock,8,'Deletion command never zeroes stock');
assert.throws(()=>api.productDeleteCommand({...deleteInput,product:{...deletingProduct,recordVersion:undefined}}),/REVISION_REQUIRED/);
assert.throws(()=>api.productDeleteCommand({...deleteInput,product:{...deletingProduct,businessId:'foreign'}}),/CONTEXT_INVALID/);
assert.throws(()=>api.productDeleteCommand({...deleteInput,product:{...deletingProduct,deleted:true}}),/CONTEXT_INVALID/);
const identity={ownerUid:'synthetic-owner',businessId:'alpha'};
const manualCorrectionInput={identity,actorUid:identity.ownerUid,operationId:'manual-correction',reason:'Correct amount',
  movement:{id:'manual-original',businessId:identity.businessId,cashSessionId:'exact-session',date:'2026-09-03',
    recordVersion:2,kind:'egreso',amount:3},replacement:{kind:'egreso',amount:4,note:'Replacement'}};
const manualCorrectionBefore=structuredClone(manualCorrectionInput);
assert.equal(api.manualMovementCorrectionCommand(manualCorrectionInput).kind,'manual_movement_correct');
assert.deepEqual(manualCorrectionInput,manualCorrectionBefore);
for(const delta of [{actorUid:'worker'},{identity:{...identity,businessId:'foreign'}},
  ...['saleId','paymentType','productId','compensationSign','compensatedByOperationId'].map(key=>({movement:{...manualCorrectionInput.movement,[key]:'forbidden'}})),
  {movement:{...manualCorrectionInput.movement,recordVersion:undefined}},
  {replacement:{kind:'egreso',amount:Infinity,note:'Invalid'}}])
  assert.throws(()=>api.manualMovementCorrectionCommand({...manualCorrectionInput,...delta}),/MODULAR_MANUAL_CORRECTION_/);
const settingsInput={identity,actorUid:identity.ownerUid,operationId:'settings-op',moduleName:'config',
  record:{id:'alpha',businessId:'alpha',name:'Synthetic',type:'ropa',settings:{ruc:'000',workers:['must-not-send']}},
  previous:{id:'alpha',businessId:'alpha',recordVersion:3}};
const settingsBefore=structuredClone(settingsInput),settings=api.scopedSettingsCommand(settingsInput);
assert.deepEqual(settings.input,{operationId:'settings-op',moduleName:'config',recordId:'main',expectedRecordVersion:3,
  changes:{name:'Synthetic',type:'ropa',settings:{ruc:'000'}}});
assert.deepEqual(settingsInput,settingsBefore);
for(const delta of [{actorUid:'worker'},{moduleName:'operationLedger'},{identity:{...identity,businessId:'foreign'}},
  {previous:{id:'alpha'}}])assert.throws(()=>api.scopedSettingsCommand({...settingsInput,...delta}),/MODULAR_SETTINGS_/);
const printCommand=api.scopedSettingsCommand({...settingsInput,moduleName:'labelTemplates',previous:undefined,
  record:{id:'template',businessId:'alpha',name:'Label',recordVersion:10,ownerUid:'fake',createdAt:'old'}});
assert.deepEqual(printCommand.input.changes,{id:'template',businessId:'alpha',name:'Label'});
const previousClose={id:'previous-report',cashSessionId:'previous-session',businessId:'alpha',date:'2026-09-03',status:'closed',recordVersion:2,
  openingAmount:0,declaredCash:5,closeCash:5,theoreticalCash:5,difference:0,saleCount:1,total:30,totalItems:1,totalIva:0,incomeCash:0,expenseCash:0,
  paymentTotals:{cash:5,card:0,transfer:25,receivablePayments:0}};
const successorInput={report:previousClose,identity,operationId:'reopen-operation',cashSessionId:'new-session',date:previousClose.date,reason:'Continuar jornada'};
const successorBefore=structuredClone(successorInput),successor=api.cashSuccessorCommand(successorInput);
assert.equal(successor.kind,'cash_open');assert.equal(successor.input.openingAmount,5);
assert.equal(successor.input.previousReportId,previousClose.id);assert.deepEqual(successorInput,successorBefore);
assert.equal(api.cashReportView({...previousClose,status:'reopened'}).total,30);
for(const delta of [{cashSessionId:previousClose.cashSessionId},{date:'2026-09-04'},{reason:'x'},
  {report:{...previousClose,status:'reopened'}},{report:{...previousClose,recordVersion:undefined}},
  {report:{...previousClose,closeCash:6}},{identity:{...identity,businessId:'foreign'}}])
  assert.throws(()=>api.cashSuccessorCommand({...successorInput,...delta}),/MODULAR_CASH_SUCCESSOR_/);
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
const statusSale={id:'legacy-visible-sale',storageRecordId:'canonical-sale',businessId:identity.businessId,
  method:'Apartado',status:'paid',layawayId:'paid-reservation',total:30,received:30,balance:0,recordVersion:4};
const statusLayaway={id:'paid-reservation',businessId:identity.businessId,saleId:statusSale.id,
  status:'paid',total:30,paid:30,balance:0,recordVersion:3};
const statusInput={identity,operationId:'ready-operation',sale:statusSale,layaway:statusLayaway,
  nextStatus:'ready_for_pickup',changedAt:'2026-10-16T12:00:00.000Z'};
const statusBefore=structuredClone(statusInput),statusCommand=api.layawayStatusCommand(statusInput);
assert.equal(statusCommand.kind,'layaway_status');assert.equal(statusCommand.input.saleId,'canonical-sale');
assert.equal(statusCommand.input.expectedSaleVersion,4);assert.equal(statusCommand.input.expectedLayawayVersion,3);
assert.deepEqual(statusInput,statusBefore);
assert.equal(api.layawayStatusCommand({...statusInput,nextStatus:'picked_up'}).kind,'layaway_status');
assert.equal(api.layawayStatusCommand({...statusInput,layaway:{...statusLayaway,status:'partially_paid'}}).kind,'layaway_status');
for(const delta of [{nextStatus:'cancelled'},{nextStatus:'paid'},{changedAt:'yesterday'},
  {sale:{...statusSale,received:29,balance:1}},{sale:{...statusSale,recordVersion:undefined}},
  {layaway:{...statusLayaway,balance:1}},{layaway:{...statusLayaway,status:'picked_up'}},
  {layaway:{...statusLayaway,pickedUpAt:'2026-10-15T12:00:00.000Z'}},
  {layaway:{...statusLayaway,status:'cancelled'}},{layaway:{...statusLayaway,status:'ready_for_pickup'}},
  {layaway:{...statusLayaway,saleId:'other'}},{identity:{...identity,businessId:'other'}}])
  assert.throws(()=>api.layawayStatusCommand({...statusInput,...delta}),/MODULAR_LAYAWAY_STATUS_/);
