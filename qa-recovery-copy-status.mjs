// Execute the actual view helper: a dated recovery copy is not operational sync.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('  function recoveryCopyStatusInfo()');
const end=source.indexOf('  function syncPillHtml(',start);
assert(start>0&&end>start);
const valid={ownerUid:'synthetic-owner',status:'RECOVERY_COPY_CLIENT_VERIFIED',serverReadVerified:true,
  operationalCloudConfirmed:false,captureHash:'a'.repeat(64),sourceHash:'b'.repeat(64),verifiedAt:'2026-10-16T00:29:37.484Z'};
const scope=vm.createContext({window:{click360Auth:{currentUser:{uid:'synthetic-owner'}},click360SparkRecoveryCopy:valid},Date,Intl});
vm.runInContext(source.slice(start,end),scope);
const result=scope.recoveryCopyStatusInfo();
assert(result.title.includes('15 oct 2026'),'Display the persisted server timestamp in Guayaquil, not the retry/device clock');
assert(result.detail.includes('No confirma cambios posteriores'));
assert(result.detail.includes('sincronización comercial'));
assert(!result.title.includes('sincronizada'));
for(const patch of [{ownerUid:'other-owner'},{status:'PENDING'},{serverReadVerified:false},
  {serverReadVerified:undefined},{verifiedAt:null},{verifiedAt:'invalid'},{captureHash:'invalid'},
  {sourceHash:''},{operationalCloudConfirmed:true}]){
  scope.window.click360SparkRecoveryCopy={...valid,...patch};assert.equal(scope.recoveryCopyStatusInfo(),null);
}
scope.window.click360SparkRecoveryCopy=valid;scope.window.click360Auth.currentUser=null;
assert.equal(scope.recoveryCopyStatusInfo(),null,'Logout must not expose the previous actor recovery date');
const backup=source.slice(source.indexOf('function backupView()'),source.indexOf('function backupView()')+3200);
assert(backup.includes('cloud.title')&&backup.includes('cloud.detail')&&backup.includes('recoveryCopy?.title'),
  'The commercial sync status remains visible independently of the recovery copy');
console.log('PASS recovery copy date, actor isolation, server-only receipt and independent commercial sync status');
