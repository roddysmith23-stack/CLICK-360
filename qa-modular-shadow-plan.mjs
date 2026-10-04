import assert from 'node:assert/strict';
import {planShadow,nativeHash} from './scripts/lib/modular-shadow-importer.mjs';
const ownerUid='synthetic-large-owner',businessId='synthetic-large-business';
const row=(id,fields)=>({mapValue:{fields:{id:{stringValue:id},businessId:{stringValue:businessId},...fields}}});
const data={products:{arrayValue:{values:Array.from({length:2000},(_,i)=>row(`p-${i}`,{stock:{integerValue:'10'},qty:{integerValue:'10'}}))}},
  sales:{arrayValue:{values:Array.from({length:5000},(_,i)=>row(`s-${i}`,{total:{doubleValue:30},productId:{stringValue:`p-${i%2000}`}}))}},
  movements:{arrayValue:{values:Array.from({length:5000},(_,i)=>row(`m-${i}`,{amount:{doubleValue:30},saleId:{stringValue:`s-${i}`}}))}},
  auditLogs:{arrayValue:{values:Array.from({length:5000},(_,i)=>row(`a-${i}`,{operationId:{stringValue:`s-${i}`}}))}},
  cashSessions:{arrayValue:{values:[]}},dailyReports:{arrayValue:{values:[]}},settings:{mapValue:{fields:{timeZone:{stringValue:'America/Guayaquil'}}}}};
const before=nativeHash(data);const plan=planShadow({ownerUid,businessId,revision:123,data});
assert.equal(plan.records.length,17001);assert.equal(nativeHash(data),before);
const replay=planShadow({ownerUid,businessId,revision:123,data});assert.deepEqual(plan,replay);
assert.equal(new Set(plan.records.map(r=>`${r.module}:${r.id}`)).size,plan.records.length);
const duplicate=structuredClone(data);duplicate.products.arrayValue.values.push(duplicate.products.arrayValue.values[0]);
assert.throws(()=>planShadow({ownerUid,businessId,revision:123,data:duplicate}),/DUPLICATE/);
const oversized={settings:{stringValue:'x'.repeat(810000)}};
assert.throws(()=>planShadow({ownerUid,businessId,revision:123,data:oversized}),/TOO_LARGE/);
console.log('PASS native shadow planner: 2000 products + 5000 sales/movements/audits, deterministic IDs, source immutable, duplicate/oversized rejected');
