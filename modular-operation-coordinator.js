// DEV only. Couples the durable outbox to the atomic repository; no auto-start,
// credentials, global tenant activation or production transport is provided.
(function (root) {
  'use strict';
  function create({ journal, repository, deviceId }) {
    const identity = repository?.identity;
    if (!identity || !journal || !deviceId || !repository.prepareOperation || !repository.lookupOperation) throw Error('COORDINATOR_INCOMPLETE');
    async function enqueue(kind, input) {
      const validated = root.CLICK360_MODULAR_JOURNAL.validatePayload(input);
      const prepared = await repository.prepareOperation(kind, validated);
      const row = await journal.enqueue(identity, prepared.operationId, prepared.envelope);
      if (row.payloadHash !== prepared.payloadSha256) throw Error('OUTBOX_REPOSITORY_HASH_DIVERGENCE');
      return row;
    }
    async function process(operationId) {
      let row = await journal.get(identity, operationId);
      if (!row) throw Error('OPERATION_NOT_FOUND');
      if (row.state === 'confirmed') return { status:'confirmed', operationId };
      if (row.payload.tenantKey !== identity.tenantKey || row.payload.schemaVersion !== 2) throw Error('OUTBOX_TENANT_SCHEMA_CONFLICT');
      const kind = row.payload.kind;
      if (!['sale', 'cash_close'].includes(kind)) throw Error('MODULAR_OPERATION_KIND_UNSUPPORTED');
      // Prepare again on restart to independently verify the stored request hash.
      const prepared = await repository.prepareOperation(kind, row.payload.payload);
      if (prepared.operationId !== operationId || prepared.payloadSha256 !== row.payloadHash) throw Error('OUTBOX_REPOSITORY_HASH_DIVERGENCE');
      const lookup = () => repository.lookupOperation(operationId, kind, row.payloadHash);
      let ownedRevision = null;
      try {
        if (row.state === 'unknown' || row.state === 'inflight') {
          // Never re-send an uncertain operation before a fresh server lookup.
          // An active writer may still finish: replay remains protected by the
          // server's same-ID, same-payload atomic ledger contract.
          row = await journal.reconcile(identity, operationId, row.revision, await lookup());
          if (row.state === 'confirmed') return { status:'confirmed', operationId };
        }
        row = await journal.claim(identity, operationId, deviceId);
        if (row.state !== 'inflight') return { status:'unknown', operationId };
        ownedRevision = row.revision;
        const before = await lookup();
        if (before.exists) {
          await journal.reconcile(identity, operationId, row.revision, before);
          return { status:'confirmed', operationId };
        }
        if (kind === 'sale') await repository.commitSale(row.payload.payload);
        else await repository.closeCashSession(row.payload.payload);
        const after = await lookup();
        if (!after.exists) throw Error('MODULAR_COMMIT_NOT_CONFIRMED');
        await journal.reconcile(identity, operationId, row.revision, after);
        return { status:'confirmed', operationId };
      } catch (error) {
        const latest = await journal.get(identity, operationId);
        if (latest?.state === 'confirmed') return { status:'confirmed', operationId };
        if (latest?.state === 'inflight' && latest.claimedBy === deviceId && latest.revision === ownedRevision) {
          try { await journal.markUnknown(identity, operationId, latest.revision); } catch {}
        }
        try {
          const pending = await journal.get(identity, operationId);
          const evidence = await lookup();
          if (evidence.exists && ['unknown', 'inflight'].includes(pending?.state)) {
            await journal.reconcile(identity, operationId, pending.revision, evidence);
            return { status:'confirmed', operationId };
          }
        } catch {} // Unavailable/conflicting server evidence is never a retry grant.
        // No rollback of a sale/stock candidate and no delete of its request.
        // Network failures/conflicts remain durable for supervised reconciliation.
        return { status:'unknown', operationId, reason:String(error.code || error.message || 'confirmation_failed') };
      }
    }
    async function replay({limit=25}={}) {
      const pending=await journal.listPending(identity,limit);
      const results=[];
      for(const row of pending){
        const result=await process(row.operationId);results.push(result);
        // An unavailable/ambiguous server must not turn reconnection into a
        // burst of retries. Keep all following requests durable and untouched.
        if(result.status!=='confirmed')break;
      }
      return results;
    }
    return Object.freeze({ enqueue, process, replay });
  }
  root.CLICK360_MODULAR_COORDINATOR = Object.freeze({ create });
})(typeof window === 'undefined' ? globalThis : window);

