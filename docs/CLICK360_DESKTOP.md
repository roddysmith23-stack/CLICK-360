# CLICK 360 Desktop And PWA

## Estado PWA

- `manifest.webmanifest` tiene `id`, `lang`, `display: standalone`, `orientation: any`, iconos y shortcuts.
- `service-worker.js` cachea shell, assets, QR, Firebase, Excel, PDF y html2canvas.
- JS/CSS/manifest usan network-first para recibir versiones nuevas cuando hay internet.
- Cache version: `mvp-final-platform-safe-v9`.

## Instalacion

La app puede instalarse como PWA desde Chrome/Edge/Android y Safari iOS cuando se abre desde HTTPS en GitHub Pages.

## Limites

- iPhone PWA puede requerir iniciar sesion primero desde Safari normal por restricciones de Google OAuth.
- Primera autenticacion y primera aprobacion requieren internet.
- Una app nativa macOS/Windows/iOS/Android todavia requiere wrapper dedicado (Capacitor/Tauri/Electron) y firma.

## Recomendacion

Mantener PWA para MVP vendible y preparar una fase separada para wrapper nativo si se requiere publicacion en tiendas.
