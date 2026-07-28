import assert from 'node:assert/strict';
import {
  LIVE_READ_ACK,
  LIVE_WRITE_ACK,
  resolveAdminExecutionScope
} from '../lib/live-safety-guard.mjs';

assert.deepEqual(resolveAdminExecutionScope({ fixture:true }), { projectId:'click-360', mode:'FIXTURE' });
assert.throws(() => resolveAdminExecutionScope(), /--project click-360 is required/);
assert.throws(() => resolveAdminExecutionScope({ explicitProject:'other-project' }), /Refusing project/);
assert.throws(() => resolveAdminExecutionScope({ explicitProject:'click-360' }), /CLICK360_ADMIN_LIVE_ACK/);
assert.deepEqual(resolveAdminExecutionScope({
  explicitProject:'click-360',
  environment:{ CLICK360_ADMIN_LIVE_ACK:LIVE_READ_ACK }
}), { projectId:'click-360', mode:'LIVE_READ_ONLY' });
assert.throws(() => resolveAdminExecutionScope({
  explicitProject:'click-360',
  apply:true,
  environment:{ CLICK360_ADMIN_LIVE_ACK:LIVE_READ_ACK }
}), /CLICK360_ADMIN_WRITE_ACK/);
assert.deepEqual(resolveAdminExecutionScope({
  explicitProject:'click-360',
  apply:true,
  environment:{ CLICK360_ADMIN_LIVE_ACK:LIVE_READ_ACK, CLICK360_ADMIN_WRITE_ACK:LIVE_WRITE_ACK }
}), { projectId:'click-360', mode:'LIVE_WRITE' });

console.log('CLICK 360 admin live safety guard PASS');
