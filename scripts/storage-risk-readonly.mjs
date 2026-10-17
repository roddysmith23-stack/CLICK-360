import {connectAdmin} from './lib/firebase-admin-connect.mjs';
import {storageHealth} from './lib/storage-health.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const [k,...parts]=v.replace(/^--/,'').split('=');return [k,parts.length?parts.join('='):true];}));
if(args['read-only']!==true||!['click-360','click360-staging-7620168025'].includes(args.project))throw Error('EXPLICIT_READONLY_PROJECT_REQUIRED');
if(process.env.FIRESTORE_EMULATOR_HOST)throw Error('SERVER_CENSUS_CANNOT_USE_EMULATOR');
const db=await connectAdmin(args.project,'storage-risk-readonly');
const report={mode:'SERVER_READ_ONLY',capturedAt:new Date().toISOString(),projectId:args.project,rows:[],
  limitations:['Device pending/unknown operations are not visible from server.','Legacy counts are not modular collection counts.','GREEN is remote capacity risk only, not proof of cloud completeness.','This census enumerates legacy root state/main documents, not modular-only businesses without a legacy root.']};
// One bounded administrative census, never a PWA listener/polling loop. No
// writes, Auth listing, emails, commercial rows or document paths are emitted.
let cursor=null;
do{
  let query=db.collectionGroup('state').orderBy('__name__').limit(100);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const snapshot of page.docs){
    if(snapshot.id!=='main'||snapshot.ref.parent.parent?.parent.id!=='businesses')continue;
    const owner=snapshot.ref.parent.parent,ownerUid=owner.id;
    const [access,control]=await Promise.all([db.doc(`accountAccess/${ownerUid}`).get(),owner.collection('metadata').doc('storage').get()]);
    report.rows.push(storageHealth({ownerUid,state:snapshot.data(),access:access.exists?access.data():{},control:control.exists?control.data():null}));
  }
  cursor=page.size===100?page.docs.at(-1):null;
}while(cursor);
report.summary={total:report.rows.length,GREEN:0,YELLOW:0,RED:0};
for(const row of report.rows)report.summary[row.risk]++;
console.log(JSON.stringify(report,null,2));
