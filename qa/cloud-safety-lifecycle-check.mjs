import assert from 'node:assert/strict';
import net from 'node:net';
const stage=process.argv[2];
assert(['before','after'].includes(stage));
const ports=[59099,58080,58081,55001,54400,54401];
async function occupied(port){
  return new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port});
    const done=value=>{socket.destroy();resolve(value);};
    socket.once('connect',()=>done(true));socket.once('error',()=>done(false));
    socket.setTimeout(1000,()=>done(true));
  });
}
const busy=[];
for(const port of ports)if(await occupied(port))busy.push(port);
assert.deepEqual(busy,[],`${stage}: emulator ports still occupied; do not kill or reuse another process`);
console.log(`PASS ${stage}: all six isolated emulator ports closed; no stale process reused`);
