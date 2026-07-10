# CLICK 360 Architecture

Fecha: 2026-07-10

## Arquitectura actual

- Frontend estático/PWA: `index.html`, `styles.css`, `app.js`, `service-worker.js`.
- Firebase Auth Google y Firestore compat, servidos desde `vendor/` para funcionamiento offline del shell.
- Identidad: `approvedUsers/{uid}`; trabajadores vinculados al owner mediante invitación activa por email.
- Documento canónico: `businesses/{ownerId}/state/main`.
- Estado v10: identidad estricta, revisión, dispositivo, payload explícito y máximo de 850 KB.
- Estado local: caché por `tenantKey`, perfil y aprobación por UID, backups por tenant.
- Sincronización: transacciones por revisión, scheduler por epoch de autenticación y bloqueo conservador de conflictos.

`activeBusinessId` selecciona uno de los negocios internos del owner; no cambia el tenant Firestore.

## Garantías implementadas

- Un callback, listener o escritura de A no puede aplicar estado ni metadatos a B.
- Una caché ausente, corrupta, extranjera o legacy no desbloquea un tenant.
- Un documento legacy nunca se migra desde el navegador.
- Un seed nuevo solo se crea si no existe documento remoto y tampoco existe caché local previa.
- Varias pestañas reciben cambios válidos del mismo tenant mediante el evento `storage`.
- Una actualización del Service Worker no recarga la app en mitad de una venta.

## Bloqueo arquitectónico

Productos, ventas, caja, cierres, facturas, trabajadores y reportes viven dentro de un solo snapshot. Firestore Rules puede aislar el tenant, pero no puede impedir que un trabajador autorizado altere otra sección del mapa. Tampoco existe inmutabilidad por registro financiero, y el límite de 1 MiB de Firestore impide crecimiento sostenido; el cliente bloquea antes, a 850 KB.

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

La transición debe ser aditiva: backfill verificado, lectura dual, escritura dual, comparación y retiro final del snapshot. No se implementó dentro de este hotfix porque sería un cambio de contrato y de producción no autorizado.
