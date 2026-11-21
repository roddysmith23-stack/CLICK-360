'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='7155238b4e0097c136d9ae9f4be291f25697f012';
for(const file of ['firestore.rules','worker-data-boundary.js','v16-domain.js','p0-tenant-guard.js',
  'p2-restaurant-domain.js','p2-logistics-domain.js','safe-update.js','access-flow.js',
  'universal-label-canvas.js','universal-label-editor.js','printing-service.js','vendor/qrcode-generator.js']){
  let actual=fs.readFileSync(file);
  if(file==='firestore.rules'){
    // Owner-authorized P0A addition only. Every byte of the pre-existing
    // commercial Rules still has to match the frozen source below.
    const s=actual.toString(),a=s.indexOf('    match /storageRollout/{policyId}'),z=s.indexOf('    function signedIn()',a);
    assert(a>0&&z>a,'Explicit P0A-only Rules addition required');
    actual=Buffer.from(s.slice(0,a)+s.slice(z));
  }
  const expected=execFileSync('git',['show',`${base}:${file}`]);
  if(file==='printing-service.js'){
    // The label PDF encoder and rasterizer may paginate. Keep the system
    // dialog, job mounting, and all unrelated provider code frozen.
    const outsidePdfRendering=bytes=>bytes.toString()
      .replace(/  function (?:singleImagePdfBlob|imagePdfBlob)\([^]*?(?=  function downloadBlob\()/,'');
    const boundary="      ].join(';');\n";
    const protect=bytes=>{
      const source=bytes.toString();
      const pdfStart=source.indexOf('  class PdfExportProvider');
      const captureStart=source.indexOf(boundary,pdfStart)+boundary.length;
      const captureEnd=source.indexOf('        downloadBlob(blob,',captureStart);
      assert(pdfStart>=0&&captureStart>pdfStart&&captureEnd>captureStart);
      return outsidePdfRendering(Buffer.from(source.slice(0,captureStart)+source.slice(captureEnd)));
    };
    assert.equal(protect(actual),protect(expected),'Printing changes must be limited to PDF generation');
    continue;
  }
  assert(actual.equals(expected),`Frozen commercial system changed: ${file}`);
}
const changes=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split('\n');
assert(!changes.some(p=>p.startsWith('functions/')||p.startsWith('tools/admin/')),'No incidental server/admin changes');
const config=JSON.parse(fs.readFileSync('firebase.staging.json','utf8'));
assert.equal(config.hosting.site,'click360-staging-7620168025');
assert.equal(config.hosting.public,'dist');
console.log('PASS frozen Sentinel: Rules, tenant boundary, Auth/access, financial domain, Restaurant/Logistics, Safe Update, QR artwork and print providers outside PDF rendering match modern main');
