// Owner-authorized Hosting archive and NON-LIVE rollback rehearsal only.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {requireAuth}=require('firebase-tools/lib/requireAuth');
const api=require('firebase-tools/lib/hosting/api');
const {Client}=require('firebase-tools/lib/apiv2');
const {hostingApiOrigin}=require('firebase-tools/lib/api');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const [project,site,expectedSha,checkpoint]=process.argv.slice(2);
  if(!/^[a-z0-9-]+$/.test(project||'')||!/^[a-z0-9-]+$/.test(site||'')||!/^[a-f0-9]{40}$/.test(expectedSha||'')||!/^[a-z0-9-]{8,40}$/.test(checkpoint||''))throw Error('INVALID_EXPLICIT_TARGET');
  await requireAuth({project,nonInteractive:true});
  const live=await api.getChannel(project,site,'live'),version=live.release.version.name;
  const release=await(await fetch(`${live.url}/release-manifest.json`,{cache:'no-store'})).json();
  if(!/^[a-f0-9]{12,40}$/.test(release.buildSha||'')||!expectedSha.startsWith(release.buildSha))throw Error('CURRENT_HOSTING_SHA_CHANGED');
  const archiveId=`rollback-${checkpoint}`,rehearsalId=`rehearse-${checkpoint}`;
  for(const id of [archiveId,rehearsalId]){
    const existing=await api.getChannel(project,site,id);
    if(existing?.release)throw Error('CHECKPOINT_ALREADY_EXISTS');
    if(!existing)await api.createChannel(project,site,id,30*86400000);
  }
  await api.createRelease(site,archiveId,version);
  const archive=await api.getChannel(project,site,archiveId);
  await api.createRelease(site,rehearsalId,archive.release.version.name);
  const rehearsal=await api.getChannel(project,site,rehearsalId);
  if(rehearsal.release.version.name!==version)throw Error('REHEARSAL_VERSION_MISMATCH');
  const client=new Client({urlPrefix:hostingApiOrigin(),apiVersion:'v1beta1',auth:true});
  let pageToken='',files=[];
  do{const response=await client.get(`/${version}/files`,{queryParams:{pageSize:1000,pageToken}});files.push(...(response.body.files||[]));pageToken=response.body.nextPageToken||'';}while(pageToken);
  if(!files.length)throw Error('EMPTY_BACKUP');
  const output=path.resolve('artifacts/private',`hosting-${checkpoint}`);
  await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});
  await fs.mkdir(output,{mode:0o700});
  const entries=[];
  for(const file of files){
    const relative=file.path.replace(/^\//,'');
    if(!relative||relative.split('/').includes('..'))throw Error('INVALID_PATH');
    const response=await fetch(`${archive.url}/${relative}`);
    if(!response.ok)throw Error('ARCHIVE_HTTP_FAILED');
    const bytes=Buffer.from(await response.arrayBuffer()),target=path.join(output,'files',relative);
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await fs.writeFile(target,bytes,{mode:0o600,flag:'wx'});
    entries.push({path:relative,bytes:bytes.length,sha256:digest(bytes),hostingHash:file.hash});
  }
  for(const key of ['release-manifest.json','app.js','firebase-service.js','tenant-quota-overrides.js','v16-storage.js','service-worker.js']){
    const response=await fetch(`${rehearsal.url}/${key}`);
    if(!response.ok||digest(Buffer.from(await response.arrayBuffer()))!==entries.find(file=>file.path===key)?.sha256)throw Error('REHEARSAL_BYTES_MISMATCH');
  }
  if((await api.getChannel(project,site,'live')).release.version.name!==version)throw Error('LIVE_CHANGED');
  const manifest={capturedAt:new Date().toISOString(),version,originalRelease:live.release.name,buildSha:expectedSha,backupUrl:archive.url,rehearsalUrl:rehearsal.url,rehearsalPassed:true,productionDataWrites:0,files:entries};
  const bytes=JSON.stringify(manifest,null,2);
  await fs.writeFile(path.join(output,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({version,buildSha:expectedSha,backupUrl:archive.url,rehearsalUrl:rehearsal.url,rehearsalPassed:true,files:entries.length,manifestSha256:digest(bytes),output}));
})().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
