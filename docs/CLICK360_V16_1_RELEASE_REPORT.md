# CLICK 360 V16.1 Release Report

Fecha: 2026-07-14

Build: `mvp-launch-v16-1-r1`

Rama: `hotfix/v16-1-commercial-stability`

## Alcance

V16.1 estabiliza el acceso de compradores, los flujos publicos, el primer negocio cloud-only, el editor QR, el shell movil, notificaciones, selector, reloj, calculadora, SEO y PWA.

## QA automatizado

- `npm run qa`: PASS.
- `npm run qa:rules`: PASS.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades.
- A/B diez ciclos: PASS.
- 100 tenants y 1000 cambios rapidos: PASS.
- Cache corrupta, datos corruptos, offline y reconexion: PASS.
- Trial, fundador, Base, Pro y expirado: PASS.
- Integridad financiera y proteccion de formulas: PASS.
- Firestore deny-by-default y `demo-click360`: PASS.

## QA de navegador local

- Landing desktop/movil: PASS.
- Seis anchos responsive: PASS.
- Calculadora `7 + 5 = 12` y aplicar a efectivo: PASS.
- QR movil/desktop, drag, resize, IVA, red social y guardado: PASS.
- Plantilla visible inmediatamente sin recargar: PASS.
- Selector de negocio y notificaciones: PASS.
- PWA activa, carga offline y reconexion `200`: PASS.
- Errores de consola no esperados: 0. La solicitud de prueba offline produjo el error de red esperado.

## Proteccion de produccion

- No se borraron datos.
- No se modifico IAM.
- No se escribieron operaciones comerciales de clientes.
- No se modifico `demo-click360`.
- Los tres tenants V10 legitimos permanecen clasificados `CLEAN_V10`.
- La inspeccion de Shary fue solo lectura.

## Cierre operativo

Los campos de commit, PR, CI, merge, Rules, Pages, smoke de produccion y URL con cache busting se completan despues de ejecutar el release controlado. Hasta entonces la decision es `PENDING RELEASE`; no se declara GO interactivo de Shary antes de observar su ingreso real.
