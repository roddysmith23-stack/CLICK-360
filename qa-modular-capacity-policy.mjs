import assert from 'node:assert/strict';
import './modular-capacity-policy.js';
const {FOUNDER_LEGACY:p,inspect}=globalThis.CLICK360_MODULAR_CAPACITY_POLICY;
assert.deepEqual([p.businesses,p.workers,p.productsActive,p.structuredStorageBytes],[2,2,2000,104857600]);
for(const [count,level]of [[0,'normal'],[1199,'normal'],[1200,'growth'],[1599,'growth'],[1600,'capacity_warning'],[1900,'commercial_review'],[1999,'commercial_review'],[2000,'included_capacity_reached'],[2001,'expansion_required']]) {
  const v=inspect({productsActive:count});assert.equal(v.catalogLevel,level);
  assert.equal(v.canAddWithinIncludedCapacity,count<2000);
  assert.equal(v.cashBlocked,false);assert.equal(v.syncBlocked,false);assert.equal(v.storageEnforced,false);
}
for(const [MiB,level]of [[74,'normal'],[75,'tracking'],[90,'warning'],[100,'included_capacity_reached']]) {
  const usage={bytes:MiB*1024*1024,measurementVersion:1,certified:true};
  assert.equal(inspect({productsActive:463,structuredUsage:usage}).storageLevel,level);
  assert.equal(inspect({productsActive:463,structuredUsage:{...usage,certified:false}}).storageLevel,'unverified');
}
assert.throws(()=>inspect({productsActive:NaN}),/INVALID/);
console.log('PASS modular Founder 2/2/2000 + 100MiB: 1200/1600/1900 advisory only, unverified storage never enforced, cash/sync never add-ons');

