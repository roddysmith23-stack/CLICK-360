import assert from 'node:assert/strict';
import {planShadow,createEmulatorShadowTransport,importShadow} from './scripts/lib/modular-shadow-importer.mjs';
import {compareShadow} from './scripts/lib/modular-shadow-compare.mjs';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48940')throw Error('EXACT_LOOPBACK_REQUIRED');
const projectId='demo-click360-modular-capacity';
const transport=createEmulatorShadowTransport({projectId,host:process.env.FIRESTORE_EMULATOR_HOST});
assert.throws(()=>createEmulatorShadowTransport({projectId:'click-360',host:'127.0.0.1:48940'}),/EXACT/);
const businessId='shadow-alpha',ownerUid='synthetic-shadow-owner';
const row=(id,fields)=>({mapValue:{fields:{id:{stringValue:id},businessId:{stringValue:businessId},...fields}}});
const data={products:{arrayValue:{values:[row('p-1',{stock:{integerValue:'10',valueType:'integerValue'},qty:{integerValue:'10'},valueType:{stringValue:'REAL_FIELD_NOT_UNION_TAG'},largeInt:{integerValue:'9223372036854775807'},createdAt:{timestampValue:'2026-10-04T00:00:00Z'},raw:{bytesValue:'AAH/'},location:{geoPointValue:{latitude:1.5,longitude:2.5}}})]}},
  sales:{arrayValue:{values:[row('s-1',{total:{doubleValue:30},productId:{stringValue:'p-1'}})]}},movements:{arrayValue:{values:[row('m-1',{saleId:{stringValue:'s-1'},amount:{doubleValue:30}})]}},
  cashSessions:{arrayValue:{values:[row('cash-1',{status:{stringValue:'closed'}})]}},dailyReports:{arrayValue:{values:[row('r-1',{cashSessionId:{stringValue:'cash-1'}})]}},auditLogs:{arrayValue:{values:[]}},config:{mapValue:{fields:{currency:{stringValue:'USD'}}}}};
const source={revision:123,data},plan=planShadow({ownerUid,businessId,...source});
const legacyPath=`businesses/${ownerUid}/state/main`;
await transport.create(legacyPath,{sentinel:{stringValue:'UNCHANGED'}});
let offset=0;
await Promise.all([importShadow({plan,transport,readSource:async()=>source,limit:2}),importShadow({plan,transport,readSource:async()=>source,limit:2})]);
while(offset<plan.records.length){const progress=await importShadow({plan,transport,readSource:async()=>source,offset,limit:2});offset=progress.nextOffset;}
await importShadow({plan,transport,readSource:async()=>source,limit:100}); // Replay after lost cursor.
const result=await compareShadow({plan,transport,sourceData:data});assert.equal(result.equivalent,true);
assert.equal(result.cutoverEligible,false);
assert.equal((await transport.read(legacyPath)).fields.sentinel.stringValue,'UNCHANGED');
await assert.rejects(()=>importShadow({plan,transport,readSource:async()=>({...source,revision:124})}),/SOURCE_CHANGED/);
const changed=structuredClone(data);changed.products.arrayValue.values[0].mapValue.fields.stock.integerValue='9';
await assert.rejects(()=>compareShadow({plan,transport,sourceData:changed}),/INTEGRITY/);
const foreign=structuredClone(data);foreign.products.arrayValue.values[0].mapValue.fields.businessId.stringValue='other-business';
assert.throws(()=>planShadow({ownerUid,businessId,revision:123,data:foreign}),/PARTITION/);
const media=structuredClone(data);media.config.mapValue.fields.photo={stringValue:'data:image/png;base64,AAAA'};
assert.throws(()=>planShadow({ownerUid,businessId,revision:123,data:media}),/INLINE_MEDIA/);
const module='products',extraPath=`businesses/${ownerUid}/businessUnits/${businessId}/migrationShadows/${plan.sourceHash}/modules/${module}/records/extra`;
await transport.create(extraPath,{unexpected:{booleanValue:true}});
await assert.rejects(()=>compareShadow({plan,transport,sourceData:data}),/COUNT_ID/);
console.log(JSON.stringify({status:'PASS',productionRequests:0,mode:'emulator-only isolated native shadow, not active modules',...result,scenarios:['incremental cursor','idempotent resume','native int64/timestamp/bytes/geopoint preservation','source revision stop','semantic stock/amount/reference equality','extra record rejected','tenant partition','inline media denied','legacy unchanged']}));

