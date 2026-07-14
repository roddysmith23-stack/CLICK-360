# CLICK 360 Security

Fecha: 2026-07-13

## Controles P0

- Contexto obligatorio: `authUid`, `ownerUid`, `ownerId`, `businessId`, `tenantKey`, `schemaVersion`.
- Aprobación offline por UID con caducidad de 24 horas.
- Push, pull, listeners y scheduler ligados al epoch de Auth y al tenant capturado.
- Transacciones con revisión; no existe `STATE_DOC.set()` directo.
- Legacy, identidad inválida, caché corrupta y conflictos bloquean escrituras.
- El navegador no restaura backups legacy sin identidad.
- Actualizar desde nube exige backup, confirmación y frase exacta.
- Zona de peligro exige owner, backup y doble confirmación.
- Imágenes se validan, comprimen y limitan; SVG/data URLs peligrosas se rechazan.
- HTML de cierres se sanea y las fórmulas de Excel/CSV se neutralizan.
- Service Worker no cachea respuestas de Auth o Firestore y solo elimina cachés `click360-*`.
- Reglas niegan autoaprovisionamiento de owners, acceso cruzado, deletes sensibles y acceso cliente a backups legacy.
- Un remoto V10 válido reconcilia únicamente sus propios marcadores de cuarentena/legacy; nunca importa el estado legacy ni borra claves de otro tenant.
- `accountAccess/{uid}` permite al cliente crear una sola prueba Base de 7 días con timestamps de servidor. Trial o plan vencido puede leer, no escribir.
- Invitaciones V16 son exact-email, tenant-scoped, hash-only, expiran y se consumen una sola vez dentro de una transacción con membresía.
- Permisos de workers se aplican antes de persistir y en Firestore Rules; identidad, negocios, legal, onboarding, plan y administración son owner-only.
- `adminBackups` y `adminAuditLogs` son Admin SDK only. La consola está fijada a `click-360`, actor allowlisted, UID/email exactos, hash previo y confirmación fuerte.

## Reglas verificadas en emulador

Se probaron owner A/B, worker, usuario no aprobado, atacante, revocación atómica, perfiles limitados, invitación V16 y replay, payload inválido, backups legacy/admin, trial, plan pagado vencido, comprador histórico y denegación explícita de `demo-click360`.

## Riesgos residuales

- Datos offline quedan legibles en el almacenamiento del dispositivo; no hay cifrado por usuario.
- La revocación no puede conocerse mientras el dispositivo permanece desconectado; la aprobación offline expira a las 24 horas.
- El SDK compat de Firestore emite una advertencia de deprecación futura de persistencia multi-tab.
- El snapshot monolítico tiene límite de crecimiento y una inferencia de acción por diff/lista; la beta se limita a tenants pequeños mientras avanza el modelo por entidades.
- App Check y una CSP estricta son endurecimiento futuro; ninguna credencial administrativa vive en el bundle.
- Los intentos complejos denegados pueden alcanzar el límite de expresiones de Rules, pero fallan cerrados; todas las escrituras legítimas probadas pasan.
- `npm audit --omit=dev --audit-level=moderate` reporta 0 vulnerabilidades.
