import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const [app,firebase]=await Promise.all(['app.js','firebase-service.js'].map(f=>readFile(f,'utf8')));
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i);return s.slice(i,j);};
const legacy=between(firebase,'function writeGateStatus()','function publishAccessState(')
 .replace('function writeGateStatus()','function legacyWriteGateStatus()');
const access=between(firebase,'window.click360SparkAccessGate=()=>{','// Read-only identity proof');
const ui=between(app,'function writeGateStatus()','window.click360SparkMutationGate=');
function scenario(delta={}){
 const c=vm.createContext({AUTH_APPROVED:true,PULL_COMPLETE:true,MODULAR_MODE:false,ACTIVE_CONTEXT:{},
  ONLINE_ONLY_SAFE:false,uiPreferencePending:false,deviceSavePending:false,legacyReads:0,
  effectiveReadOnly:false,identityValid:true,guardAllowed:true,legalBlocked:false,mixed:false,
  ...delta,navigator:{onLine:true},window:{click360SparkOperationalSession:delta.noWriter?null:{},
   click360SparkBootstrapState:{phase:delta.phase||'READY'},click360AccessState:{readOnly:false}}});
 vm.runInContext(`
 function isEffectiveReadOnly(){return effectiveReadOnly;}
 function activeIdentityIsValid(){return identityValid;}
 function legacyMigrationRequired(){return false;}
 function legalMutationGateActive(){return legalBlocked;}
 function accessInfo(){return {readOnly:effectiveReadOnly};}
 function getSyncState(){legacyReads++;return {status:'real_conflict',reason:'remote_revision_conflict',blocking:true};}
 function pendingRemoteSyncGateStatus(){return {allowed:true};}
 const tenantGuard={canWrite(){return guardAllowed;}};const auth={currentUser:{}};
 window.click360IsMixedBuild=()=>mixed;
 ${legacy}\n${access}\nwindow.click360WriteGate=()=>legacyWriteGateStatus();\n${ui}
 `,c);
 return {result:JSON.parse(JSON.stringify(vm.runInContext('writeGateStatus()',c))),legacyReads:c.legacyReads};
}
const connected=scenario();
assert.equal(connected.result.allowed,true,'A READY Spark writer must not be rejected by the unrelated legacy revision marker');
assert.equal(connected.legacyReads,0,'The modular gate must not read or clean a legacy conflict marker');
const old=scenario({noWriter:true});assert.equal(old.result.allowed,false);assert.equal(old.result.reason,'sync_conflict');assert.equal(old.legacyReads,1);
for(const delta of [{effectiveReadOnly:true},{AUTH_APPROVED:false},{PULL_COMPLETE:false},{identityValid:false},
 {uiPreferencePending:true},{deviceSavePending:true},{mixed:true},{phase:'INSTALLING_UI'},{phase:'BLOCKED'},{legalBlocked:true}]){
 const r=scenario(delta);assert.equal(r.result.allowed,false,JSON.stringify(delta));assert.equal(r.legacyReads,0);}
for(const marker of ["if (!writeGateStatus().allowed) return toast('No se puede guardar el cliente",'const gate = writeGateStatus();',
 "if (!writeGateStatus().allowed) return toast('No se puede registrar el abono"])
 assert(app.includes(marker),'The actual UI prechecks must remain covered by the common access gate');
console.log('PASS actual PWA command prechecks: READY Spark uses verified modular access; legacy conflict preserved, non-Spark still blocked, Auth/read-only/identity/legal/install/busy-device guards retained');
