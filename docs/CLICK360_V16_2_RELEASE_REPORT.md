# CLICK 360 V16.2 - Informe de release

Fecha: 2026-07-15

Rama: `release/v16-2-commercial-mvp`

Build: `mvp-launch-v16-2-r1`

Estado documental: `RELEASE CANDIDATE VALIDATED - NO GO FOR PUBLIC RELEASE`

## Decisión actual

`GO TÉCNICO PARA REVIEW OWNER-ONLY` y `NO GO PARA PUBLICACIÓN GENERAL`.

La suite local, las Rules en emulador, la auditoría de dependencias, el build allowlist, la actualización PWA y la matriz pública de navegadores pasaron el 15 de julio de 2026. No queda un defecto P0 conocido en el flujo del propietario. La publicación permanece bloqueada hasta ejecutar smoke autenticado de las cuentas legítimas sobre el SHA final y aceptar explícitamente que el acceso operativo de trabajadores queda pausado hasta la modularización P1.

## Alcance implementado

### Identidad, acceso y trial

- Firebase Auth UID es la identidad primaria.
- La precedencia es `accountAccess/{uid}` -> `approvedUsers/{uid}` -> registro histórico validado por UID -> invitación explícita -> trial.
- Un error o resultado incierto al consultar una aprobación histórica bloquea la creación automática del trial y solicita reconciliación; no convierte silenciosamente una cuenta existente en usuario nuevo.
- Fundadores, `paid_base`, `paid_pro` y lifetime conservan su entitlement. Los campos comerciales del plan no son editables por el cliente.
- El trial se crea una sola vez por UID y dura exactamente `7 * 24` horas desde tiempo confiable del servidor. La lectura defensiva normaliza Timestamp, segundos, milisegundos y microsegundos.
- Invitaciones caducadas o inválidas no sustituyen el acceso propio de una identidad válida.

### Shary y almacenamiento local

La auditoría administrativa previa, de solo lectura, confirmó para Shary una identidad Auth activa y un acceso `paid_base` coherente por UID/businessId. V16.2 resuelve esa cuenta por `accountAccess` antes de considerar trial o invitaciones.

La persistencia local usa una degradación comprobada: IndexedDB + localStorage, luego la copia local que continúe disponible y, solo si ambas fallan, `ONLINE_ONLY_SAFE`:

- Firestore remoto sigue siendo la fuente principal.
- No se crea un seed local ni se usa `STATE_DOC.set()` ciego.
- Las escrituras requieren conexión y solo se comunican como exitosas después de confirmación remota.
- La ausencia de caché local no debe bloquear una identidad pagada válida.

La entrada autenticada real de Shary continúa siendo un gate de smoke y no se da por ejecutada en este documento.

### Migración e integridad de datos

- El migrador V9 -> V10 solo acepta un owner UID inequívoco y un businessId coherente.
- Antes de escribir exige dry-run, backup administrativo verificado y hash del documento de origen sin cambios.
- Compara antes/después negocios, productos, ventas, movimientos, facturas, reportes, trabajadores, plantillas, eliminados, logs, apartados, sesiones de caja, notificaciones, aceptaciones legales, clientes, recordatorios y solicitudes de activación.
- Conserva perfiles de usuario, onboarding, políticas y metadatos comerciales compatibles.
- Después de escribir relee V10 y verifica `schemaVersion`, UID, ownerId, businessId, tenantKey, conteos y hash lógico.
- Un tenant ambiguo, huérfano o sospechoso se detiene sin reemplazar el original.
- `demo-click360` permanece bloqueado y excluido.

Este release amplía y prueba la herramienta; no afirma que se haya ejecutado una nueva migración de producción durante V16.2.

### Operaciones comerciales críticas

Las rutas críticas de producto, venta, anulación, pago, caja, cierre, movimientos, facturas, restauración y reinicio conservan una copia previa. Con conexión esperan sincronización y verificación del resultado; ante fallo restauran el estado anterior y muestran un mensaje no técnico. Los marcadores de eliminación quedan aislados por negocio para impedir reapariciones por reconciliación.

También se corrige la representación del subtotal antes del descuento y se respeta `IVA desactivado` como una decisión explícita del negocio.

### Trabajadores

El documento `businesses/{ownerId}/state/main` contiene hoy todo el negocio. Dar acceso parcial sobre ese snapshot expondría módulos no autorizados. Por seguridad, V16.2 lo restringe temporalmente al propietario tanto en cliente como en Rules.

Las invitaciones y membresías pueden conservarse, pero el trabajador recibe un estado informativo y no abre el snapshot operativo. La reactivación requiere la arquitectura P1 con módulos/records independientes y reglas verificables por operación. Esta limitación es explícita y no debe ocultarse como soporte multiusuario completo.

### PWA, caché y experiencia

- Service Worker, runtime guard, manifest y assets usan `mvp-launch-v16-2-r1` para desplazar cachés anteriores.
- Firebase Hosting es el origen canónico: `https://click-360.web.app/`.
- GitHub Pages permanece como respaldo controlado.
- La interfaz evita mostrar stacks, UID o mensajes internos al cliente y conserva reportes sanitizados para diagnóstico.
- Se reforzaron modales, teclado, foco, objetivos táctiles, banner responsive y estados de sincronización legibles.

## Límites conocidos

| Área | Estado | Consecuencia |
| --- | --- | --- |
| Trabajadores sobre snapshot V10 | Pausado por seguridad | Acceso operativo owner-only hasta modularización P1 |
| M02X Bluetooth directo | No habilitado | Requiere protocolo y hardware real; siguen disponibles sistema/PDF |
| Smoke con cuentas reales | Pendiente | No se afirma acceso real hasta ejecutar checklist sin datos comerciales |
| Publicación V16.2 | Pendiente | El build local no equivale a producción |

## Release gates

No cambiar `PENDING` a `PASS` sin enlace, log o evidencia reproducible.

| Gate | Estado | Evidencia |
| --- | --- | --- |
| `npm ci` | PASS | 2026-07-15, instalación limpia completada |
| `npm run qa` | PASS | 2026-07-15, P0 + finanzas + V16/V16.1/V16.2 + build, código 0 |
| `npm run qa:rules` sin límites de expresiones | PASS | 2026-07-15, emulador Firestore, código 0, sin límite de 1000 expresiones |
| Auditoría de dependencias | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades de producción |
| Build estático allowlist | PASS | 17 entradas públicas copiadas a `dist/`; herramientas administrativas y artefactos excluidos |
| QA responsive y navegadores | PASS PUBLIC SHELL | Chromium 320/740/1440, Chrome Android 360, WebKit iPhone 393 y Firefox 1280; 0 errores inesperados |
| PWA offline + actualización desde caché anterior | PASS PUBLIC SHELL | Shell servido con red bloqueada; caché V16.1.2 eliminada y solo `click360-mvp-launch-v16-2-r1` conservada |
| A -> B -> A y dos pestañas | PASS HARNESS | 10 ciclos, dos pestañas, teléfono/reconexión y aislamiento cubiertos por harness; repetición autenticada real pendiente |
| Smoke autenticado Shary/fundadores | PENDING | `[añadir fecha y resultado, sin operaciones reales]` |
| `demo-click360` intacto y bloqueado | PASS READ-ONLY | `artifacts/firebase-audit-final-release/CLICK360_FIREBASE_AUDIT.md`: 3 CLEAN_V10, demo CROSS_TENANT_SUSPECT |
| Revisión del PR | PENDING | `[añadir aprobación]` |
| CI de la revisión final | PENDING | `[añadir URL del run]` |
| Firestore Rules desplegadas | BLOCKED | No desplegar antes del GO final |
| Firebase Hosting publicado | BLOCKED | No publicar antes del GO final |
| Smoke público posterior | BLOCKED | Depende de publicación autorizada |

## Registro de publicación

- Commit de implementación: `[PENDING: SHA]`
- Commit de documentación: `[PENDING: SHA]`
- Pull Request: `[PENDING: URL]`
- CI: `[PENDING: URL]`
- Commit de merge: `[PENDING: SHA]`
- Firebase Rules release: `[PENDING: ID/HASH]`
- Firebase Hosting release: `[PENDING: ID/HASH]`
- URL principal con cache busting: `[PENDING: https://click-360.web.app/?v=mvp-launch-v16-2-r1]`
- URL GitHub Pages de respaldo: `[PENDING: URL]`
- Smoke público: `[PENDING: fecha, navegador y resultado]`

## Restricciones de cierre

- No añadir clientes a IAM ni cambiar UIDs.
- No copiar, borrar ni crear operaciones comerciales reales durante smoke.
- No modificar ni desbloquear `demo-click360`.
- No desplegar si falla identidad, aislamiento, reglas, migración o integridad comercial.
- Un HTTP 200, CI verde o PWA registrada no bastan por sí solos para declarar `GO`.

## Aprobación final

- Decisión: `NO GO PARA PUBLICACIÓN / GO PARA PR DRAFT`
- Responsable: `Codex - revisión técnica`
- Fecha/hora: `2026-07-15 America/Guayaquil`
- Motivo y evidencia: `QA automatizada y navegador público en verde; smoke autenticado pendiente y trabajadores owner-only hasta P1.`
