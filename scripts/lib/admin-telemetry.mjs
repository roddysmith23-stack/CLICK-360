/**
 * Server-side telemetry writes for the orchestrator scripts
 * (worker-boundary-activate-tenant.mjs / worker-boundary-deactivate-tenant.mjs).
 * These go through the Admin SDK, which bypasses firestore.rules entirely
 * (unlike the client-side recordTelemetry() in firebase-service.js), so
 * they are not subject to the client eventType allowlist -- but the shape
 * mirrors it for consistent querying by worker-boundary-monitor.mjs.
 */
export async function writeAdminTelemetry(db, { eventType, ownerId, businessId, detail = '', errorCode = '', operator = 'AIIA-admin' }) {
  const ref = db.collection('telemetryEvents').doc();
  await ref.set({
    eventId: ref.id,
    eventType,
    ownerId,
    businessId,
    tenantKey: `owner:${ownerId}:business:${businessId}`,
    source: 'admin-script',
    operator,
    detail: String(detail).slice(0, 500),
    errorCode: String(errorCode).slice(0, 80),
    createdAt: new Date().toISOString()
  });
  return ref.id;
}
