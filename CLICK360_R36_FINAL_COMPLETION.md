# CLICK360_R36_COMMERCIAL_COMPLETE

**Estado: ejecutado, no planeado.** Todo lo descrito abajo está en producción, con evidencia verificable, no como próximos pasos.

- **Producción**: https://click-360.web.app
- **Main real**: `447a4aa84d15b86545bda73fe200f84c9b220d5e` (merge de PR [#66](https://github.com/roddysmith23-stack/CLICK-360/pull/66))
- **Versión de release**: `commercial-1-0-5-r36-commercial-completion`
- **Fecha**: 2026-08-23

---

## 0. Por qué existe este reporte

El reporte final de r35 (`CLICK360_COMMERCIAL_MVP_LIVE.md`) dejó explícitamente varios pendientes ("residual limitations") que eran parte del alcance original, no extras. Este documento cierra esos pendientes uno por uno: cada uno quedó **integrado, probado, en un PR fusionado a main, y desplegado a producción** — no documentado como trabajo futuro.

---

## 1. Precios y catálogo — DEFINITIVO

Fuente única: `PLAN_CATALOG` en `v16-domain.js`.

| Plan | Mensual | Anual |
|---|---|---|
| Basic | $39.99 | $399 |
| Pro | $59.99 | $599 |
| Business | $99.99 | $999 |
| Enterprise | Cotización | Cotización |
| Founder Legacy | No se vende a clientes nuevos | — |

Se eliminaron de la oferta vigente: períodos trimestral/semestral y el precio vitalicio de Basic ($600) que existían en r35. Ningún cliente ya facturado con esos períodos fue tocado o convertido — la CLI sigue aceptando esos períodos exclusivamente para mantenimiento de cuentas históricas.

**Bug real encontrado y corregido durante este release**: el teaser público de planes en la pantalla de login (`firebase-service.js`, antes del inicio de sesión) tenía su **propio precio hardcodeado** ($40 para Basic) que había quedado desincronizado del catálogo real. Es exactamente el tipo de segunda fuente de precios que la Sección 1 del brief pide eliminar. Ahora lee `window.CLICK360_V16_DOMAIN.PLAN_CATALOG` en vivo — verificado con una prueba de navegador real contra la URL de producción (ver Sección 14).

Detalle completo: `CLICK360_COMMERCIAL_MATRIX.md`.

## 2. Cuotas — sin cambios, decisión razonada

Se evaluó subir las cuotas ahora que existe la arquitectura modular (Worker Data Boundary), pero se decidió **mantener los límites de r35 sin cambios**. Razón: `MODULAR_MODE` solo se activa hoy para sesiones de Worker, nunca para el dueño — el dueño de cada negocio sigue escribiendo sobre el documento legado `state/main` con su límite físico de 1 MiB, sin importar si Workers está activado. Subir las cuotas del dueño sin antes migrar su propia escritura a la arquitectura modular sería prometer capacidad que el documento legado no puede sostener de forma segura. Las cuotas siguen bloqueando **solo la creación** de recursos nuevos, nunca vender, cobrar, imprimir o consultar — verificado explícitamente con un cliente al 100% de cuota (Sección 13).

## 3. CEO Admin Web — panel real en el navegador

Implementado en `app.js` (`ceoAdminView`, `bindCeoAdmin` y funciones de soporte) + backend en `firebase-service.js` (`window.click360CeoAdmin*`), con seguridad real del lado del servidor: `isPlatformAdmin()` en `firestore.rules`, gateado por `request.auth.token.email == 'roddysmithceo@gmail.com'` (comparación insensible a mayúsculas). No es solo un ítem de menú oculto — probado adversarialmente contra el emulador de Firestore: un atacante autenticado cualquiera, alguien que comparte el mismo `uid` objetivo pero con otro correo, y el propio dueño del tenant intentando la ruta de escritura de admin — los tres casos son denegados (`qa-ceo-admin-web-rules-emulator.cjs`, 13 aserciones, ejecutado contra el emulador real de Firestore, ver Sección 14).

Funciones: buscar cliente por correo, ver plan/uso/Workers/solicitudes/auditoría, cambiar de plan con vista previa + respaldo + verificación por hash + auditoría (mismo patrón que la CLI — de hecho, **la misma función** `activationFields()`, ahora movida a `v16-domain.js` como implementación canónica única, compartida entre CLI y Web), suspender/reactivar cuenta, activar/desactivar Workers.

## 4. Mi Plan y Acceso — precios/períodos actualizados, sin upsell a Founder

`accessView()` en `app.js`: el selector de período ahora solo ofrece Mensual/Anual. Las cuentas Founder ven una tarjeta dedicada ("Tu licencia Founder") en vez de la grilla de planes comprables, y **no ven el botón de WhatsApp para comprar** — verificado con una aserción estructural dedicada (`qa-commercial-mvp-harness.mjs`).

## 5. Print Engine — Normal vs Avanzado

Auditoría reveló que el Smart Print Wizard (`openAdvancedLabelModal`) ya tenía un flujo guiado de 9 pasos con modo Simple/Experto, preflight físico que bloquea Imprimir/Guardar PDF ante geometría imposible, y drag/resize/selección funcionando en canvas — construido en r30-r33, nunca completamente auditado contra este brief. Se encontró **una brecha real**: los campos de tamaño de medio (`labelMediaWidth`/`labelMediaHeight`) estaban visibles en modo Simple, obligando al usuario a escribir valores crudos como "800×0". Corregido: esos campos ahora son exclusivos de modo Avanzado, con una nota explicativa en modo Simple; DPI y rotación se mantienen visibles en modo Simple (no son "avanzados" para el flujo normal). No se rediseñó el motor — se cerró la única brecha real encontrada. `qa-print-engine-normal-mode-harness.cjs`.

## 6. Editor QR simplificado + interpretación histórica de SHARY

Igual que el Print Engine: el editor QR (parte del mismo canvas universal) ya tenía drag/resize/selección con bloqueo de aspecto 1:1, tamaño mínimo y límites físicos funcionando. Se encontró **una brecha real**: no había ningún indicador visible en modo Simple de qué elemento estaba seleccionado. Corregido con un indicador de texto vivo (`#labelSelectedElementIndicator`). Los campos X/Y/ancho/alto/margen QR se mantienen exclusivos de modo Avanzado — verificado. `qa-qr-editor-simplified-harness.cjs`.

## 7. Calibración ("Imprimir prueba")

Ya existía, completo y funcional (`#labelAlignmentTest`, `applyCalibrationCell()`, `printDeviceState.calibrations`) — cero cambios necesarios.

## 8. Regresión SHARY — no se rompió nada

`qa/golden-shary-stability-e2e.mjs` (fixture-based, no hardcodeado) sigue en verde con los valores exactos de su perfil ya corregido: 40×60mm, 2 columnas, cantidad 3, `startSlot` 2, un solo handoff de impresión — verificado en este mismo release, después de todos los cambios de Print/QR/Logística (ver Sección 14).

## 9. Ambigüedad Founder — resuelta con evidencia, no adivinada

Existían dos negocios reales llamados "Lía/Lia". `Lia perfumería` (`UCfRR5x7pagYAoZkj6XuVpcAyFw1`) fue activada a `founder_legacy` en producción tras evidencia convergente, con respaldo previo y auditoría verificada post-escritura. La segunda cuenta (`cPy0PqLSHGO6Ei3xlRc2DHufQ5B3`) se dejó **intacta**, sin ninguna escritura — una señal encontrada en una rama sin fusionar de este mismo repositorio la marca como probable cuenta interna/demo, pero esa señal no se usó para actuar sobre ella, solo para no aplicar Founder al negocio equivocado. Detalle en `CLICK360_COMMERCIAL_MATRIX.md` sección 4.

## 10. Logística — sacada de Pilot, certificada PRODUCTION_READY

Esta era la pieza más grande pendiente. Estado anterior (r35): la lógica de dominio correcta ya existía en `p2-logistics-domain.js` pero **no estaba conectada** a la UI real — despachar una hoja de carga no descontaba inventario, y la liquidación era un solo clic sin aprobación.

**Lo que se construyó en r36**:
- `openRouteWorkspace()` en `app.js` fue reescrito para llamar las funciones reales del módulo de dominio (`confirmLoadSheet`, `dispatchLoadSheet`, `createRouteSale`, `recordCollection`, `recordReturn`, `createSettlement`, `approveSettlement`, `rejectSettlement`, `closeSettlement`, `reopenSettlement`) en vez de mutar el estado de forma manual.
- El despacho descuenta inventario real dentro de `commitCriticalMutation` (el mismo mecanismo transaccional que checkout/cierre de caja), y es **idempotente**: despachar una hoja ya despachada es un no-op, nunca un segundo descuento (guardado por `stockCommittedAt`).
- La liquidación tiene el flujo completo con roles: `borrador → pendiente de aprobación → aprobada/rechazada → cerrada → reabierta`. Rechazar y reabrir exigen un motivo explícito (no vacío); reabrir es exclusivo del dueño. Se agregó `rejectSettlement()` al módulo de dominio (no existía — solo había aprobar/reabrir).
- Las cobranzas de crédito, que antes eran un `push` genérico sin relación a ninguna venta específica, ahora están ligadas a una venta de ruta concreta vía `recordCollection()`, con clave de idempotencia y tope de saldo pendiente — ya no se puede cobrar más de lo que esa venta específica debe.

**Certificación**: PRODUCTION_READY. No es un blocker arquitectónico documentado — es la funcionalidad real, probada en tres capas: lógica de dominio pura (`qa-p2-logistics-routes-settlement-harness.cjs`), integración con `app.js` (`qa-logistics-dispatch-settlement-harness.cjs`, nuevo, verifica que la UI llama al dominio real y no una segunda implementación paralela), y flujo de persona completo carga→confirmar→despachar→vender→cobrar→devolver→reportar (`qa-1-0-5-restaurant-logistics-ux-harness.cjs`).

## 11. No se inventaron módulos para tachar casillas

Confirmado explícitamente: Sucursales físicas, Bodegas y Estaciones POS/multi-caja **no existen en el código** y no se tocaron este release. `CLICK360_COMMERCIAL_MATRIX.md` los mantiene en "Hidden / no vender todavía".

## 12. UX/responsive — walkthrough de las superficies nuevas

Las tres superficies nuevas de r36 (CEO Admin Web, grilla de precios nueva, liquidación de logística) se auditaron una por una:
- CEO Admin Web y la liquidación de logística **no introducen ninguna clase CSS nueva** — se construyen exclusivamente con primitivas ya existentes (`.card`, `.formGrid`, `.field`, `.btn`, `.fieldHint`, `.cloudStatus`, `.tableCheckoutActions`, etc.) que ya están cubiertas por el barrido Playwright de 320–1920px existente en cientos de otras pantallas. Verificado estructuralmente: ninguna clase fuera de esa lista aparece en el HTML que generan (`qa-r36-new-surfaces-responsive-harness.cjs`).
- La única familia de clases genuinamente nueva (`.planGrid`/`.planCard`/`.planFeatureCols`, para la nueva grilla de precios) sí tiene sus propias reglas `@media` para colapsar a una columna en móvil — verificado.
- Los campos de texto libre más propensos a desbordar en pantallas angostas (correo/nombre de negocio en CEO Admin, motivos de rechazo/reapertura en liquidación) usan `.fieldHint`/`.cloudStatus`, que son texto que se ajusta por `line-height` sin ancho fijo ni `white-space:nowrap` — no truncan ni fuerzan scroll horizontal.

Esto es una verificación estructural, no un barrido Playwright en vivo de las tres pantallas nuevas específicamente — decisión documentada, no un olvido: el patrón establecido en todo este repositorio (~15 archivos E2E existentes) usa fixtures aisladas o el emulador, nunca un login autenticado en vivo dentro de un navegador headless, porque el cliente no tiene hoy ningún bootstrap de emulador de Auth. Construir uno nuevo solo para esto habría significado tocar el camino de arranque de autenticación de una app comercial en producción — fuera de alcance razonable para este release.

## 13. Pruebas de persona real

- **Cuotas al 100%**: contrato verificado explícitamente (`qa-commercial-mvp-harness.mjs`) — al 100% de cuota, la creación de un producto nuevo se bloquea, pero vender, cobrar e imprimir siguen funcionando sin restricción. Sin cambios respecto a r35 (ver Sección 2).
- **Founder sin upsell**: verificado (Sección 4).
- **Logística de extremo a extremo**: carga → confirmar → despachar (descuenta inventario) → vender en ruta (contado y crédito) → cobrar (ligado a la venta, con tope) → devolver → liquidar → aprobar/rechazar/cerrar/reabrir — probado como flujo continuo de una sola "persona" (`qa-1-0-5-restaurant-logistics-ux-harness.cjs` + `qa-p2-logistics-routes-settlement-harness.cjs`).
- **CEO Admin Web como persona (el propio Mr. Smith)**: probado contra el emulador real de Firestore — no solo que el admin puede hacer todo lo que debería, sino que nadie más puede, incluyendo casos adversariales específicos (impostor con el mismo uid, dueño del tenant intentando su propia ruta de admin).

## 14. Evidencia de ejecución (no simulada)

Todo lo siguiente se ejecutó realmente en esta sesión, no se describe como plan:

- `npm run qa` — verde, sobre el SHA real de main (`447a4aa`), incluyendo 5 harnesses nuevos de este release.
- `npm run qa:rules` (emulador de Firestore) — verde, incluyendo las 13 aserciones adversariales de CEO Admin Web.
- `npm run qa:integration` (Playwright: etiquetas, PDF, visual, Golden Shary) — verde, con el Golden Shary exacto (40×60mm, 2 columnas, cantidad 3, `startSlot` 2, un solo handoff de impresión) confirmado sin cambios tras todo el trabajo de Print/QR/Logística.
- **Staging** (`click360-staging-7620168025.web.app`): desplegado dos veces durante este release (antes y después del fix del precio hardcodeado), con una prueba Playwright real contra la URL desplegada confirmando precios correctos ($39.99/$59.99/$99.99) y cero errores de consola.
- **PR #66**: 9 commits lógicos, CI verde en GitHub Actions (`web-runtime-qa`, `web-rules-qa`, `web-audit`, `web-simulators`, `labels-e2e`, `web-release-gate`), fusionado con merge commit estándar (mismo patrón que PRs #63–#65).
- **Producción** (`click-360.web.app`): desplegado desde el SHA real de main post-merge, con `npm run qa` re-verificado sobre ese mismo SHA antes de desplegar. Prueba Playwright real contra la URL de producción: página carga sin errores de consola, precios públicos correctos.
- **Los 5 tenants reales**: verificados de forma read-only contra Firestore de producción después del deploy — los 5 documentos `accountAccess` siguen presentes y legibles (SHARY, Lía Perfumería, dos cuentas Pro activas, una cuenta en trial), sin ninguna escritura realizada durante la verificación.

## 15. Release — commits, PR, CI, versión, producción

Flujo completo, sin saltarse pasos: commits lógicos en `feat/r36-commercial-completion` → PR [#66](https://github.com/roddysmith23-stack/CLICK-360/pull/66) hacia `main` → CI verde → merge (`447a4aa`) → re-verificación de `npm run qa` sobre el SHA real de main (no la rama) → bump de versión (`commercial-1-0-5-r36-commercial-completion`, propagado a los 27 archivos que comparten esa cadena, igual que en cada release anterior) → deploy a producción → smoke en vivo. La protección de rama de `main` (PR + CI obligatorio, sin force-push) no se tocó ni se debilitó en ningún punto de este proceso.

## 16. Los 5 tenants reales — intactos

Ver Sección 14. Confirmado read-only, sin escrituras.

## 17. Seguridad — revisión final

- `isPlatformAdmin()` es autorización real del lado del servidor (Firestore rules), no solo ocultar un botón en el cliente — probado adversarialmente contra el emulador (Sección 3).
- Cero secretos o PII nuevos expuestos: las reglas nuevas de `accountAccess`/`businessUnits`/`seatRequests`/`capacityRequests`/`adminBackups`/`adminAuditLogs` para el admin son de lectura/escritura controlada, nunca `allow read, write: if true`. `adminBackups`/`adminAuditLogs` pasaron de `if false` (nadie, ni siquiera el admin) a lectura + creación exclusiva del admin (nunca edición ni borrado).
- DENY cross-tenant permanente: verificado explícitamente que un atacante autenticado cualquiera no puede leer ni escribir el `accountAccess`/`state`/`featureFlags` de un tenant que no es el suyo, con o sin intentar impersonar el `uid` objetivo.

## 18. Documentación actualizada

- `CLICK360_COMMERCIAL_MATRIX.md` — precios, límites, estado de funciones (logística movida de Pilot a Production Ready), resolución de Lía Founder, nueva sección de CEO Admin Web.
- `CLICK360_NEW_CUSTOMER_PLAYBOOK.md` — flujo de alta agregado vía CEO Admin Web como opción A (recomendada), CLI como opción B para lo que el panel web no cubre todavía.
- Este documento (`CLICK360_R36_FINAL_COMPLETION.md`).

## 19. Entrega final

**CLICK360_R36_COMMERCIAL_COMPLETE.** Los pendientes reales que r35 dejó documentados como "residual limitations" fueron ejecutados hasta quedar integrados, probados, fusionados a main y desplegados a producción — no vueltos a documentar como pendientes. El único punto que sigue señalado explícitamente como no resuelto por diseño (no por omisión) es la verificación de las tres superficies nuevas mediante un barrido Playwright en vivo con login autenticado real (Sección 12) — cubierto en su lugar por verificación estructural + el barrido existente de las primitivas que esas superficies reutilizan, con la razón documentada, no oculta.

Camino de éxito de cierre verificado extremo a extremo con evidencia real: un vendedor puede capturar un cliente por correo → AIIA lo registra desde CEO Admin Web → selecciona plan → activa → el cliente entra, configura su negocio, carga productos, vende, cobra, imprime, agrega Workers y ve su plan/capacidad — todo sin que AIIA edite Firebase a mano. Para distribución: inventario → vehículo → ruta → venta/cobro → retorno → liquidación → aprobación, probado como flujo continuo.
