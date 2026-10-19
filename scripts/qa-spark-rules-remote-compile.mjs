// Read-only backend compilation, required before a Spark staging promotion.
// Does not create a ruleset/release or mutate Firestore/Hosting.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GoogleAuth} from 'google-auth-library';
const project='click360-staging-7620168025';
if(process.argv[2]!==`--project=${project}`)throw Error('EXPLICIT_STAGING_PROJECT_REQUIRED');
const content=await readFile('firestore.spark.rules','utf8');
const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
const {token}=await client.getAccessToken();if(!token)throw Error('STAGING_COMPILER_AUTH_REQUIRED');
const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({source:{files:[{name:'firestore.rules',content}]},testSuite:{testCases:[]}})
});
const result=await response.json();
const errors=(result.issues||[]).filter(i=>i.severity==='ERROR'||/Invalid function name/i.test(i.description||''));
if(!response.ok||errors.length)throw Error('SPARK_REMOTE_COMPILATION_FAILED: '+JSON.stringify({httpStatus:response.status,error:result.error,errors}));
console.log(JSON.stringify({status:'PASS',project,sourceSha256:createHash('sha256').update(content).digest('hex'),
  backendCompilation:true,warnings:result.issues||[],deploy:false,productionWrites:0}));
