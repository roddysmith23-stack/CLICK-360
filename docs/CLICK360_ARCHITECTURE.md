# CLICK 360 Architecture

Fecha: 2026-07-13

## Arquitectura actual

- Frontend estático/PWA: `index.html`, `styles.css`, `app.js`, `service-worker.js`.
- Firebase Auth Google y Firestore compat, servidos desde `vendor/` para funcionamiento offline del shell.
- Identidad: UID de Auth, owner, negocio, tenant y membresía. El correo no asigna propiedad.
- Documento canónico: `businesses/{ownerId}/state/main`.
- Estado v10: identidad estricta, revisión, dispositivo, payload explícito y máximo de 850 KB.
- Estado local: `CLICK360:V16:*` por UID/tenant e IndexedDB `CLICK360_V16_DB` para snapshots grandes.
- Sincronización: transacciones por revisión, scheduler por epoch de autenticación y bloqueo conservador de conflictos.

`activeBusinessId` selecciona uno de los negocios internos del owner; no cambia el tenant Firestore.

## Garantías implementadas

- Un callback, listener o escritura de A no puede aplicar estado ni metadatos a B.
- Una caché ausente, corrupta, extranjera o legacy no desbloquea un tenant.
- Un documento legacy nunca se migra desde el navegador.
- Un seed nuevo solo se crea si existe entitlement legítimo, no hay remoto y tampoco existe caché local o IndexedDB previa.
- Si el almacenamiento del navegador falla pero la nube es válida, la app entra en `ONLINE_ONLY_SAFE` sin bloquear al cliente ni prometer offline.
- Varias pestañas reciben cambios válidos del mismo tenant mediante el evento `storage`.
- Una actualización del Service Worker no recarga la app en mitad de una venta.
- Las invitaciones V16 usan token aleatorio de 256 bits, hash público, secreto solo-owner, caducidad y consumo transaccional único.
- Los workers se validan en cliente y reglas por lista, módulo y acción; cambios de identidad, negocio y configuración de owner quedan fuera de su contrato.

## Evolución de escala

Productos, ventas, caja, cierres, facturas, trabajadores y reportes aún viven dentro de un snapshot. V16 aplica diffs y permisos en servidor, revisiones transaccionales y un límite preventivo de 850 KB. Esto es suficiente para la beta comercial controlada, pero la granularización sigue siendo la evolución necesaria antes de escalar volumen o concurrencia.

## Arquitectura objetivo

- `businesses/{ownerId}/products/{productId}`
- `businesses/{ownerId}/sales/{saleId}`
- `businesses/{ownerId}/movements/{movementId}`
- `businesses/{ownerId}/cashSessions/{sessionId}`
- `businesses/{ownerId}/invoices/{invoiceId}`
- `businesses/{ownerId}/reports/{reportId}`
- `businesses/{ownerId}/workers/{uid}`
- Cloud Storage para imágenes, no data URLs dentro del estado.
- Comandos sensibles en Cloud Functions o backend transaccional.
- Ventas, pagos, cierres y anulaciones como eventos append-only.

La transición futura debe ser aditiva: backfill verificado, lectura dual, escritura dual, comparación y retiro final del snapshot. No requiere reescribir ni arriesgar los V10 existentes durante V16.
