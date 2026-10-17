import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {assertPortsAvailable,waitForOwnedServices,stopOwnedProcessTree} from './qa/emulator-process-lifecycle.mjs';
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;
await assert.rejects(assertPortsAvailable([port]),new RegExp(`QA_LISTENER_UNAVAILABLE:${port}:EADDRINUSE`));
assert(listener.listening,'Preflight must not kill a foreign listener');
await new Promise(resolve=>listener.close(resolve));
for(let run=0;run<2;run++){
  await assertPortsAvailable([port]);
  const child=spawn(process.execPath,['-e',`require('http').createServer((q,s)=>s.end('ready')).listen(${port},'127.0.0.1')`],{detached:true,stdio:'ignore'});
  try{await waitForOwnedServices([child],[`http://127.0.0.1:${port}/`]);}
  finally{await stopOwnedProcessTree(child);}
  await assertPortsAvailable([port]);
}
// Mirrors Firebase CLI + Java: the listening descendant shares our detached
// process group but can outlive the parent CLI's exit event.
{
  const grandchild=`require('http').createServer((q,s)=>s.end('descendant-ready')).listen(${port},'127.0.0.1')`;
  const parent=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['-e',parent],{detached:true,stdio:'ignore'});
  try{await waitForOwnedServices([child],[`http://127.0.0.1:${port}/`]);}
  finally{await stopOwnedProcessTree(child);}
  await assertPortsAvailable([port]);
}
const child=spawn(process.execPath,['-e','process.exit(7)'],{detached:true,stdio:'ignore'});
await assert.rejects(waitForOwnedServices([child],[`http://127.0.0.1:${port}/`],{readLog:()=> 'EXACT_STARTUP_FAILURE'}),/QA_OWNED_SERVICE_EXIT:7:.*\nEXACT_STARTUP_FAILURE/);
await stopOwnedProcessTree(child);
console.log('PASS emulator lifecycle: occupied port fails without killing owner, two starts/awaited descendant teardown, child exit cancels readiness with exact log');
