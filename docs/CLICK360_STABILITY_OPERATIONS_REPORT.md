# CLICK 360 Stability Operations

## Veredicto

`NOT_READY_WORKER_DATA_BOUNDARY`

El candidate mejora y prueba impresion, comprobantes, Apartados, caja, auditoria, aislamiento y compatibilidad, pero no cumple aun el escenario obligatorio de trabajador con cuenta propia. El estado comercial sigue almacenado en un documento monolitico `businesses/{ownerUid}/state/main`; permitir su lectura a un trabajador revelaria modulos y datos fuera de sus permisos. Las Rules actuales lo bloquean correctamente. Habilitar la UI sin resolver ese limite seria inseguro.

`NO_PRODUCTION_DEPLOY_PERFORMED`

## Baseline congelado

- SHA: `dccee527fc310cd6e17c8e0c58f308c27e2338fb`
- Identidad: `WEDNESDAY_RECOVERY_1`
- Rama de trabajo: `stabilization/1.0.5-stability-operations`
- Worktree aislado: `/Users/roddysmith23hotmail.com/Documents/CLICK360_STABILITY_OPERATIONS`
- Commit funcional candidate: `987bd7c5ef75c5f4468694c3b1648be9f330b055`
- Version candidate: `1.0.5-stability.1`
- Asset/cache candidate: `commercial-1-0-5-stability-ops-r1`
- Build SHA probado: `987bd7c5ef75` (el commit posterior solo agrega este informe)

La verificacion read-only final confirma que produccion sigue sirviendo exactamente el baseline:

| Elemento | Produccion | Baseline | Resultado |
|---|---|---|---|
| `index.html` SHA-256 | `e2363c9da56b11f4316a2c51be1b9879ecaae8633d5c95f26669b6faefd44549` | igual | PASS |
| `service-worker.js` SHA-256 | `8440f48a7f20baf6de02388b33362114aa21301c2e8341b8571e35883278f962` | igual | PASS |
| Hosting | solo canal `live` | `click-360.web.app` | PASS |

## Forense y recuperacion selectiva

Se estudiaron los cambios posteriores R30-R34 sin fusionar ramas completas:

- R30: cantidad/start slot, coherencia de version y estabilizacion movil.
- `834dd17`, `ee20136`, `d04fec5`, `d9b33f7`: motor canonico, contrato Firestore `16.2.0`, gates y catalogo.
- `356a430`, `03998d1`: crash temporal del preview y regresion.
- `c71a640`, `ae985a4`: geometria fisica y prueba end-to-end.
- `009dee5`: fixture golden 40x60, dos columnas.

Se recuperaron conceptos, no commits completos: preparacion y ejecucion canonica de quick-print, lectura previa al cierre del modal, fixture golden y validacion geometrica. Se rechazaron la heuristica R33 que podia sustituir medidas persistidas y la activacion historica de workers sobre `state/main`.

## Causas raiz y correcciones

### Quick-print

La confirmacion cerraba el modal antes de leer cantidad y casilla inicial; ademas coexistian rutas de impresion. Ahora `prepareLabelPrintJob()` conserva producto, plantilla, formato de precio, cantidad y `startSlot`, y `executeCanonicalLabelPrint()` realiza un unico handoff para PDF o impresora.

### Comprobantes fragmentados

El contenido se insertaba en una caja fisica fija con recorte. Ahora el contenido continuo no tiene alto fijo y el papel con celdas usa segmentacion semantica paginada. No se ocultan lineas ni se invaden columnas.

### Apartados

No existia una ruta visible completa y cancelar podia alterar una caja cerrada o reponer stock de una entrega. Se agregaron listado, filtros, detalle, pagos con metodo real, listo/entregado, comprobante e historial. Se bloquea cancelacion de entregados y de movimientos vinculados a caja cerrada. Las operaciones usan ID durable para evitar dobles abonos.

### Auditoria

El log local era editable y faltaban eventos. Se agrego `auditEvents` separado, append-only por Rules candidate, con tenant, actor, rol, entidad, correlacion y timestamp de servidor. La UI Actividad ofrece filtros por fecha, trabajador, modulo y accion. Productos, venta/apartado, caja, comprobantes e invitaciones emiten eventos.

### Version de datos

Escrituras protegidas enviaban la version comercial `1.0.5` donde Rules esperan contrato `16.x`. Se separo `FIRESTORE_SCHEMA_VERSION = '16.2.0'` de la version visible.

### Mobile Label Wizard

Varias capas CSS hacian crecer el cuerpo fuera de su fila y WebKit recortaba `Continuar`. El modal ahora tiene una sola region desplazable y un footer de dos filas con los tres botones medidos dentro del viewport.

## Cambios por modulo

- `app.js`: quick-print, recibos, Apartados, auditoria visible, operaciones idempotentes y pausa segura de workers.
- `v16-domain.js`: decisiones puras de abono/transicion/caja e idempotencia.
- `firebase-service.js`: contrato Firestore separado y emisor sanitizado append-only.
- `firestore.rules`: ruta candidate `auditEvents`; no desplegada.
- `styles.css`: layout movil, Apartados, Actividad y quick-print.
- Version/cache: `index.html`, `manifest.webmanifest`, `service-worker.js`, `runtime-guard.js`, `smart-print-core.js`, `package*.json` y contratos QA.
- QA: harness operativo, fixture receipt fragmentado, fixture golden Shary y medicion de botones del wizard.

## Gates ejecutados

| Gate | Resultado |
|---|---|
| `npm run qa` | PASS |
| `npm run qa:rules` | PASS |
| `npm run qa:simulator:quick` | PASS, 240 acciones |
| `npm run qa:simulator:full` | PASS, 2600 acciones y 100 reportes |
| `npm run qa:labels:e2e` | PASS |
| `npm run qa:artifact:e2e` | PASS Chromium/WebKit |
| `npm audit --omit=dev` | PASS, 0 vulnerabilidades |
| `git diff --check` | PASS |

## Evidencia clave

### Golden Shary

Chromium, WebKit y Firefox pasan con 40x60 mm, dos columnas, cantidad 3, `startSlot=2`, precio `Ef./Tj.`, QR no vacio, PDF raster no vacio y exactamente un handoff.

- `output/playwright/stability-operations/golden-shary-40x60-2col.pdf`
- `output/playwright/stability-operations/golden-shary-40x60-2col.png`

### Comprobante fisico

Chromium y WebKit generan 10 paginas y 18 celdas ocupadas; cada bloque permanece dentro de su `receiptBox` y de su columna.

- `output/playwright/stability-operations/receipt-2-column-chromium.png`
- `output/playwright/stability-operations/receipt-2-column-webkit.png`

### Aislamiento y Rules

El emulador confirma:

- owner/worker solo crean audit event en tenant autorizado;
- worker no lee auditoria;
- otro tenant y `demo-click360` son DENY;
- audit event no puede actualizarse ni borrarse;
- worker sigue sin acceso al snapshot monolitico;
- primer tenant pagado solo puede crearse en UID canonico.

### Compatibilidad, upgrade y offline

La suite conserva namespaces UID/tenant, evita `localStorage.clear()`, valida cache del tenant, bloquea legacy ambiguo, prueba A-B-A, dos tabs, telefono/reconexion, borrado sin reaparicion, cola pendiente, locks stale y reintentos idempotentes. El simulador full no detecto corrupcion ni mezcla.

## Matriz navegador/movil

| Caso | Chromium | WebKit | Firefox |
|---|---|---|---|
| Golden 40x60 / 2 columnas | PASS | PASS | PASS |
| Wizard 320/360/390/430/tablet/desktop | PASS | PASS | PASS |
| PDF/print provider | PASS | PASS | cubierto por golden |
| Receipt fragmentado | PASS | PASS | no requerido |
| Artefacto construido | PASS | PASS | no requerido |

La impresion fisica en hardware real permanece pendiente del owner; no se presenta como certificada.

## Staging

No se creo ni desplego staging. La configuracion local solo contiene el proyecto productivo `click-360` y el site `click-360`; usarlo como sustituto violaria la mision. Para continuar se necesita un proyecto/site separado, Auth QA y datos sinteticos autorizados.

## Bloqueo de trabajadores

El flujo invitacion/aceptacion/revocacion y su aislamiento pasan a nivel de Rules. El E2E comercial no puede habilitarse sin una frontera de datos que permita leer/escribir solo modulos autorizados. Opciones seguras:

1. colecciones modulares por negocio con Rules por modulo/accion;
2. backend de comandos y vistas filtradas por rol;
3. migracion progresiva con `state/main` como rollback, sin dual-write indefinido.

Hasta entonces `WORKER_TENANT_ACCESS_ENABLED=false` y la UI lo comunica como pausa de seguridad. Este es un bloqueo real, no una tarea cosmética.

## Rollback

No hay rollback productivo porque no se modifico produccion. Para descartar el candidate basta retirar la rama; el baseline `dccee527...` y Hosting permanecen intactos. Para una futura prueba en staging, conservar la revision anterior de Hosting/Rules de staging, desplegar ambos desde un unico SHA y revertirlos juntos si falla golden o aislamiento.

## Siguiente GO/NO_GO

No desplegar este candidate a clientes. El siguiente gate requiere:

1. resolver workers con frontera modular/backend en entorno separado;
2. repetir Rules + E2E con cuenta worker QA;
3. crear staging no productivo;
4. smoke humano de impresora real;
5. volver a ejecutar toda la matriz.

Hasta entonces: `NOT_READY_WORKER_DATA_BOUNDARY`.
