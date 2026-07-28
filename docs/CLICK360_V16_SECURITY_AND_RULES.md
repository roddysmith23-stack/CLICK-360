# CLICK 360 V16 Security And Rules

Fecha: 2026-07-13

## Fronteras

- Auth: Firebase Google, persistencia local y epoch por cambio de cuenta.
- Tenant: `authUid`, `ownerUid`, `ownerId`, `businessId`, `tenantKey` y `schemaVersion` deben coincidir.
- Nube: el V10 remoto coherente se lee antes de cualquier caché y es autoritativo.
- Local: estado, sesión, perfil, aprobación, cuarentena e IndexedDB usan UID/tenant exactos.
- Legacy: bloquea absolutamente seed, edición, venta, borrado y push hasta migración administrativa.
- Demo: `demo-click360` está denegado explícitamente.

## Entitlements

- El cliente solo puede crear una prueba Base, una vez por UID, con `request.time` y duración fija de 7 días.
- Trial vencido y suscripción con `expiresAt` vencido conservan lectura, pero `ownerUser()` niega escritura.
- Cada entrada refresca `lastSeenAt` con `request.time`; una sesión abierta programa revalidación y pasa a lectura al vencer, incluso antes de una nueva navegación.
- Fundador, lifetime y comprador histórico no dependen del trial.
- Plan, status, límites y suspensión solo cambian con Admin SDK/IAM.

## Hallazgo corregido durante QA

Una prueba adversarial demostró que `MapDiff.changedKeys()` no incluye campos recién añadidos. En una actualización de perfil, un cliente podía adjuntar un campo de entitlement sin que esa lista lo detectara. Todas las allowlists de actualización se cambiaron a `affectedKeys()`, que incluye campos añadidos, eliminados y modificados. El emulador confirma que nombre/foto y heartbeat legítimos pasan, mientras inyección de `expiresAt`, límites, rol o tenant se rechaza.

## Trabajadores

- Token aleatorio de 32 bytes; Firestore público conserva solo SHA-256.
- El secreto queda en `ownerInviteSecrets` y solo el owner puede leerlo.
- Email, tenant, rol, expiración y hash son exactos.
- Aceptación crea membresía, perfil worker y consumo de invitación en una transacción.
- Replay, escalación a owner, cambio de tenant y acceso sin permiso se deniegan.
- Diffs de estado permiten únicamente módulos/acciones otorgados y un evento de auditoría append-only.

## Administración

`tools/admin/scripts/admin-access-v16.mjs` no forma parte del frontend. Requiere ADC/IAM, proyecto exacto `click-360`, actor autorizado, email y UID exactos, hash de dry-run y confirmación textual. Cada cambio crea backup verificado y `adminAuditLogs`; ambas rutas son invisibles para clientes.

## Resultado del emulador

Pasaron lecturas/escrituras owner, A/B, trial, fundador, comprador histórico, heartbeat histórico, paid expirado read-only, invitación de un uso, worker autorizado, worker view-only, revocación, legal, activación y perfiles. Se rechazaron atacante, cross-tenant, auto-plan, inyección de campos, replay, admin backup/audit, legacy backup y demo.

Los mensajes de límite de expresiones observados pertenecen a casos deliberadamente denegados y terminan en `PERMISSION_DENIED`. Las rutas legítimas no alcanzaron ese límite.

## Riesgo residual aceptado

V16 mantiene el snapshot monolítico para compatibilidad. El límite preventivo de 850 KB, las revisiones transaccionales, la serialización de push y los permisos por diff reducen el riesgo durante la beta controlada. La migración por entidades será una evolución de escala, no un cambio de emergencia.
