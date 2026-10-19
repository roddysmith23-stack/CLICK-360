import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-handoff.js';
import './modular-ui-adapter.js';
const migration=CLICK360_SPARK_MIGRATION,codec=CLICK360_SPARK_RECORD_CODEC,ui=CLICK360_MODULAR_UI_ADAPTER;
const identity={ownerUid:'synthetic-receivable-owner',businessId:'synthetic-retail'},hash='a'.repeat(64);
const sale={id:'legacy-sale',businessId:identity.businessId,method:'Apartado',status:'layaway',total:30,received:5,balance:25,payments:[]};
const layaway={id:'legacy-reservation',businessId:identity.businessId,saleId:sale.id,status:'partially_paid',total:30,paid:5,balance:25,payments:[]};
const snapshot={businesses:[{id:identity.businessId}],sales:[sale],layaways:[layaway]};
const before=structuredClone(snapshot);
const raw=async(moduleName,data)=>({id:data.id,...identity,schemaVersion:2,module:moduleName,sourceHash:hash,
  sourcePath:[moduleName,0],data:structuredClone(data),dataHash:await migration.hash(data)});
const saleRaw=await raw('sales',sale),layawayRaw=await raw('layaways',layaway);
const scope={identity,moduleName:'sales',recordId:sale.id};
const projected=await codec.unpack(saleRaw,scope);projected.storageRecordId=projected.id;
const linked=await codec.unpack(layawayRaw,{identity,moduleName:'layaways',recordId:layaway.id});
const input={sale:projected,layaway:linked,identity,operationId:'new-payment',cashSessionId:'new-session',workingDate:'2026-10-19',amount:1,method:'Efectivo'};
assert.equal(ui.receivablePaymentCommand(input).input.saleId,sale.id);
assert.equal(projected.storageImportedSourceHash,hash);
assert(CLICK360_SPARK_HANDOFF.validateReceivableLinks(snapshot));
assert.deepEqual(snapshot,before,'Relationship verification must not add a missing forward ID or modify balances');
for(const change of [s=>s.layaways.push({...s.layaways[0],id:'ambiguous'}),s=>s.layaways[0].paid++,
  s=>s.layaways[0].saleId='missing',s=>s.sales[0].layawayId='wrong',s=>s.layaways[0].businessId='foreign']){
  const bad=structuredClone(snapshot);change(bad);
  assert.throws(()=>CLICK360_SPARK_HANDOFF.validateReceivableLinks(bad),/ACTIVE_RECEIVABLE_RELATIONSHIP_CONFLICT/);
}
for(const delta of [{sale:{...projected,storageImportedSourceHash:undefined}},
  {sale:{...projected,layawayId:'conflicting-explicit-link'}},
  {layaway:{...linked,storageImportedSourceHash:'b'.repeat(64)}},
  {layaway:{...linked,saleId:'different-sale'}},{layaway:{...linked,businessId:'foreign'}}])
  assert.throws(()=>ui.receivablePaymentCommand({...input,...delta}),/LAYAWAY_CONFLICT/);
const forgedData={...sale,storageImportedSourceHash:hash};
const forged=await codec.unpack({id:sale.id,...identity,schemaVersion:2,module:'sales',data:forgedData,dataHash:await migration.hash(forgedData)},scope);
assert(!Object.hasOwn(forged,'storageImportedSourceHash'),'A client data field is never trusted provenance');
const packed=await codec.pack({...projected,received:6,balance:24,recordVersion:2},{...scope,previous:saleRaw});
assert(!Object.hasOwn(packed.data,'storageImportedSourceHash'));
assert(!Object.hasOwn(packed.data,'layawayId'),'Payment cannot rewrite an imported commercial relationship');
assert.equal(packed.sourceHash,hash);assert.equal(packed.data.balance,24);
const paidSale={...projected,status:'paid',received:30,balance:0};
const paidLayaway={...linked,status:'paid',paid:30,balance:0};
assert.equal(ui.layawayStatusCommand({sale:paidSale,layaway:paidLayaway,identity,operationId:'pickup',nextStatus:'picked_up',changedAt:'2026-10-19T12:00:00.000Z'}).kind,'layaway_status');
console.log('PASS imported receivable reverse links: exact source provenance, immutable original IDs, duplicate/mismatched links fail closed, payment/status adapters, no payload-provenance trust');
