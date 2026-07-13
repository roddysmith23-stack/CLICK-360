# CLICK 360 Architecture

## Estado actual

- Frontend estatico: `index.html`, `styles.css`, `app.js`.
- PWA/offline shell: `manifest.webmanifest`, `service-worker.js`.
- Auth y nube: Firebase Auth Google + Firestore compat SDK local en `vendor/`.
- Estado principal local: `click360_mvp_qa_final_state_v1`.
- Estado cloud compatible: `businesses/{ownerId}/state/main`.
- Identidad aprobada: `approvedUsers/{uid}`.
- Invitaciones por correo: `approvedUsersByEmail/{email}`.

## Regla de negocio

Misma cuenta + mismo negocio = mismos datos en todos los dispositivos.

Para sostener esa regla, la ruta canonica de nube es `ownerId`. El `activeBusinessId` dentro de la app representa el negocio seleccionado dentro de la cuenta, no el tenant de Firestore.

## Sincronizacion

El MVP mantiene el snapshot completo por compatibilidad, pero ahora agrega:

- `revision`
- `baseRevision`
- `deviceId`
- `updatedBy`
- `updatedByEmail`
- estado visible: offline, pending, syncing, synced, error

La sesion del dispositivo queda fuera de la nube. Los perfiles se mantienen en cache local protegida y tambien en `settings.userProfiles`.

## Offline/PWA

El service worker cachea shell, imagenes y librerias locales. Firebase/Excel/PDF/html2canvas ya no dependen de CDN para cargar despues de instalado.

Limite honesto: la primera autenticacion con Google y la primera aprobacion requieren internet.
