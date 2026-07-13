# CLICK 360 QA Report

Fecha: 2026-07-09

## Checks ejecutados

- `node --check app.js`
- `node --check firebase-service.js`
- `node --check service-worker.js`
- `python3 -m json.tool manifest.webmanifest`
- `node qa-check.cjs`
- `git diff --check`
- Browser local: `http://127.0.0.1:4173/?qa&nosw`
- Playwright CLI screenshots:
  - `/tmp/click360-desktop.png` en 1280x720
  - `/tmp/click360-mobile.png` en 390x844

## Resultado

- Sintaxis JS: PASS.
- Manifest JSON: PASS.
- QA interna QR/PWA/perfil/storage: PASS.
- Diff whitespace: PASS.
- Desktop auth gate: PASS, centrado sin pantalla blanca.
- Mobile auth gate: PASS, centrado sin recorte critico.
- Librerias locales: PASS, scripts de Firebase/Excel/PDF/html2canvas cargan desde `vendor/`.

## Observaciones

- La consola muestra advertencia de Firebase sobre futura deprecacion de `enableMultiTabIndexedDbPersistence`; no es error de ejecucion.
- Los flujos completos con datos reales requieren login Google y usuario aprobado en Firebase.
- No se conecto Vercel.
