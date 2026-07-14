# CLICK 360 V16.1.2 - Informe de release

Fecha: 2026-07-14

Rama: `hotfix/v16-1-2-auth-responsive-printing`

Build: `mvp-launch-v16-1-2-r1`

## Gates

| Gate | Resultado |
| --- | --- |
| Sintaxis y harnesses (`npm run qa`) | PASS |
| Reglas Firestore en emulador (`npm run qa:rules`) | PASS |
| Build estático allowlist | PASS, 17 entradas |
| Caché V16.1.1 -> V16.1.2 | PASS |
| PWA offline | PASS |
| WebKit móvil | PASS, 0 errores |
| Chrome móvil | PASS, 0 errores |
| Firefox desktop | PASS, 0 errores |
| Responsive 320-1920 px | PASS, sin overflow horizontal |
| Auditoría producción previa | PASS, solo lectura |
| M02X física | NO EJECUTADA, proveedor directo desactivado |

La configuración pública de Firebase Auth confirmó `click-360.firebaseapp.com`, `click-360.web.app` y `roddysmith23-stack.github.io` entre los dominios autorizados. El código usa `authDomain: click-360.firebaseapp.com` y `projectId: click-360`.

La prueba dinámica de impresión confirmó una sola entrega al diálogo, liberación del DOM/listener después de `afterprint` y PDF de etiqueta 50 x 30 mm con tres copias y limpieza final.

## Publicación

El build se genera mediante una allowlist para impedir que scripts administrativos, fixtures, informes privados o archivos de desarrollo entren a Hosting. `index.html` y Service Worker usan `no-cache`; assets versionados usan caché larga. Firebase Auth y Firestore continúan apuntando exclusivamente a `click-360`.

Metadatos finales de PR, CI, merge, despliegue y smoke público se completan en este mismo documento antes del merge.

## Decisión provisional

`GO` para el hotfix P0 y fallbacks de impresión. La compatibilidad Bluetooth directa con M02X queda `NO GO` hasta hardware real. No se modifica IAM, no se toca `demo-click360` y no se generan operaciones comerciales.
