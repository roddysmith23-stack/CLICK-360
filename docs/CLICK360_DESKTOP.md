# CLICK 360 Desktop And PWA

Fecha: 2026-07-10

- Cache actual: `click360-p0-production-audit-v13`.
- Shell, Firebase compat, QR, Excel, PDF, html2canvas, iconos y banners están disponibles localmente.
- Auth y Firestore cross-origin son network-only en el Service Worker.
- Desktop 1440×960 y móvil 390×844 pasaron sin overflow horizontal ni errores de consola.
- El banner usa 16:9, `object-fit: contain`, `object-position: center` y bordes redondeados.
- La app se instala como PWA desde HTTPS. Primera autenticación/aprobación requiere internet.
- En iPhone instalado puede ser necesario autenticar primero desde Safari.

Una publicación en tiendas requiere un wrapper y firma en una fase separada. GitHub Pages no se publicó en este hotfix.
