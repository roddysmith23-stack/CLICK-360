# CLICK 360 V16.1.1 Hotfix Report

Fecha: 2026-07-14

Build: `mvp-launch-v16-1-1-r1`

## Causa

La cadena `__firefox__` no existe en el código propio, historial Git, dependencias instaladas ni en los 16 assets de V16.1 servidos por GitHub Pages. El `ReferenceError` de línea 1 fue producido por código externo o inyectado que esperaba una constante global de build, o por una copia obsoleta ajena al payload actual. CLICK 360 no dependía de esa variable, por lo que la aplicación continuaba funcionando.

La sesión limpia de producción solicitó 19 recursos, todos desde el mismo origen de GitHub Pages, y no produjo errores de consola. No apareció ningún script remoto adicional de Firebase Auth antes del login. Por tanto, el token no procede del HTML publicado ni de una constante de compilación pendiente en CLICK 360.

## Corrección

- `runtime-guard.js` se carga antes de todas las librerías.
- La compatibilidad Firefox se define solo después de `typeof globalThis.__firefox__ === "undefined"` y se calcula desde `navigator.userAgent`.
- Los errores y promesas rechazadas guardan archivo, línea, columna, stack, navegador, versión y URL sin parámetros sensibles.
- La pantalla muestra un mensaje amigable y un código de reporte, nunca el error técnico crudo.
- Los reportes se limitan a 12 y se aíslan por sesión pública o UID/tenant autenticado.
- La caché V16.1 anterior se reemplaza durante la activación del Service Worker.

## Protección de datos

- Sin cambios IAM.
- Sin cambios de UID.
- Sin escrituras comerciales.
- Sin modificaciones de Firestore Rules.
- `demo-click360` permanece bloqueado.
- La inspección de Shary se ejecuta exclusivamente en modo lectura.

## QA previo al release

- Suite `npm run qa`: PASS.
- Firestore Emulator: PASS.
- Dependencias de producción: 0 vulnerabilidades.
- Safari iPhone mediante WebKit móvil 26.5: PASS, 0 errores, sin overflow.
- Chrome iPhone mediante WebKit con user agent `CriOS`: PASS, 0 errores, sin overflow.
- Chrome Android 151 sobre Pixel móvil: PASS, 0 errores, sin overflow.
- Firefox desktop 152: PASS, `__firefox__ === true`, 0 errores, sin overflow.
- PWA offline y reconexión: PASS.
- Actualización desde `click360-mvp-launch-v16-1-r1`: PASS; solo permanece `click360-mvp-launch-v16-1-1-r1`.
- Error inyectado de regresión: atribuido como `external_or_injected`, URL sanitizada y mensaje amigable.
- Almacenamiento local lleno: el informe usa sessionStorage namespaced como fallback.
- No hay `STATE_DOC.set` y el bootstrap online-only sigue siendo transaccional.

## Shary antes del release

- Auth activo: sí.
- Email: `shary10mmvv@gmail.com`.
- UID: `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`.
- Acceso: `paid_base`, plan Base.
- `businessId`: el mismo UID.
- Tenant remoto: todavía no existe; no se creó administrativamente porque la misión exige solo lectura.
- Primer ingreso: si localStorage o IndexedDB fallan, la cuenta entra en `ONLINE_ONLY_SAFE` y crea su documento V10 solo mediante la transacción protegida. Un documento concurrente nunca se reemplaza.

## Línea base Firestore

- 3 tenants `CLEAN_V10`.
- `demo-click360`: `CROSS_TENANT_SUSPECT`, hash `659729806cb62a3581dc2c99da6ead64a6f6e92604857b92ab9e4b1d53f75da1`, sin modificaciones.

## Resultado operativo

- Commit: `0183a76`.
- PR: [#9](https://github.com/roddysmith23-stack/CLICK-360/pull/9).
- CI del PR: PASS, run `29353206351`.
- Merge a `main`: `68acecdb0e6fd1dfe9bc8322995a81e6c33e9007`.
- CI de `main`: PASS, run `29353274165`.
- GitHub Pages: PASS, run `29353272941`.
- URL: <https://roddysmith23-stack.github.io/CLICK-360/?v=mvp-launch-v16-1-1-r1&release=68acecd>.
- Firestore Rules: sin cambios y sin redeploy; el contrato vigente pasó emulador y CI.

## Smoke de producción

- HTTP 200 y versión visible `V16.1.1`.
- Guard `16.1.1` cargado antes de las librerías.
- 19 referencias al nuevo asset version y 0 a V16.1.
- 0 constantes Firefox inseguras en assets públicos.
- 0 errores inesperados de consola.
- Sin overflow horizontal.
- Service Worker activo y una única caché: `click360-mvp-launch-v16-1-1-r1`.
- Carga offline y reconexión: PASS.

## Auditoría posterior

- Los tres tenants legítimos conservaron exactamente hash, revisión, clasificación y conteos.
- `demo-click360` conservó exactamente hash, revisión, fecha y conteos; sigue `CROSS_TENANT_SUSPECT` y bloqueado.
- Shary conserva Auth activo, `paid_base`, UID y `businessId` exactos.
- Shary no tiene todavía un tenant remoto. La ausencia es un estado inicial protegido, no legacy ni contaminación; su primer ingreso puede crear exclusivamente su tenant V10 mediante la transacción segura.
- El `lastSeenAt` de Shary avanzó a `2026-07-14T17:01:18.158Z` por una sesión cliente anterior al despliegue del hotfix. La inspección administrativa no realizó esa escritura.
- La automatización no pudo conectarse al Chrome del usuario porque la extensión no expuso ese navegador al controlador. No se declara un login interactivo no observado.

## Decisión

`GO V16.1.1 PUBLICADO`. No apareció un criterio técnico de rollback. Shary ya puede intentar entrar con `shary10mmvv@gmail.com`; si el dispositivo no permite copia local, la aplicación usa `ONLINE_ONLY_SAFE` y conserva la nube como fuente principal.
