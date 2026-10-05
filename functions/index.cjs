const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const verifier=require('./safety-verifier.cjs');
initializeApp();
exports.finalizeCloudSafetyBackup=onCall({region:'us-central1',memory:'512MiB',timeoutSeconds:60,minInstances:0,maxInstances:3,concurrency:1},async request=>{
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','Se necesita una sesión verificada.');
  try{
    return await verifier.complete(getFirestore(),request.auth.uid,String(request.data?.backupId||''));
  }catch(error){
    // Never log snapshots, owner identifiers, tokens or commercial details.
    throw new HttpsError('failed-precondition','No se pudo confirmar el respaldo íntegro.',{reason:String(error.code||'backup-verification-failed').slice(0,80)});
  }
});
