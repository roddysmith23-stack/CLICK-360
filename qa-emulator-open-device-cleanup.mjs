import assert from 'node:assert/strict';
import {openSignedIn} from './qa/r38-emulator-support.mjs';

let closed=0;
const page={
  setDefaultTimeout(){},on(){},async route(){},
  async goto(){throw new Error('synthetic navigation failure');},
  async evaluate(){return {synthetic:true};}
};
const context={async addInitScript(){},async newPage(){return page;},async close(){closed++;}};
const browser={async newContext(){return context;}};
await assert.rejects(openSignedIn(browser,{width:390,height:844}),/openSignedIn step "goto" failed: synthetic navigation failure/);
assert.equal(closed,1,'a context that never reaches the caller must still be closed exactly once');
console.log('PASS owned emulator browser closes on bootstrap failure before caller assignment');
