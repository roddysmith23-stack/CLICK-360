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

- Commit funcional: `3c9801e`.
- Commit de dependencias reproducibles Node 22: `056b3c0`.
- PR: [#7](https://github.com/roddysmith23-stack/CLICK-360/pull/7).
- CI del PR: PASS, run `29320335861`.
- Merge a `main`: `9b28c69f89db9e06b48d4d571e2d47987deea89f`.
- CI de `main`: PASS, run `29320423945`.
- GitHub Pages: PASS, run `29320422786`.
- URL publicada: <https://roddysmith23-stack.github.io/CLICK-360/>.
- URL con cache busting: <https://roddysmith23-stack.github.io/CLICK-360/?v=mvp-launch-v16-1-r1&release=9b28c69>.
- Firestore Rules: sin cambios en V16.1; no se redeplegaron. El contrato vigente paso el emulador y CI.

## Smoke posterior al release

- Landing, H1, nueve FAQ visibles y estructuradas, tres planes e invitacion: PASS.
- Responsive sin overflow horizontal: PASS.
- Service Worker activo: `mvp-launch-v16-1-r1`.
- Carga offline y reconexion: PASS.
- Errores inesperados de consola: 0.
- Auditoria final: 3 `CLEAN_V10`, 1 `CROSS_TENANT_SUSPECT`.
- `demo-click360`: hash, revision y fecha sin cambios; permanece bloqueado.
- Conteos de los tres tenants legitimos: sin degradacion.
- Shary: Auth activo, acceso `paid_base`, UID y `businessId` exactos, hash administrativo sin cambios.

## Decision

`GO TECNICO PUBLICADO`. Codigo, CI, Pages, PWA, reglas vigentes, aislamiento y auditoria cloud pasan. No hubo criterio tecnico de rollback.

El smoke autenticado interactivo de Shary no fue observado porque el entorno Codex no expuso el navegador Chrome ni sus sesiones abiertas al controlador; solo estaba disponible el navegador interno sin esas sesiones. Esta es una limitacion de automatizacion, no un fallo de codigo, Rules, Pages o aislamiento. El checklist manual conserva esas casillas pendientes y no se declara que Shary haya ingresado cuando no pudo observarse.
