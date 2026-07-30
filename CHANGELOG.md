# Changelog

## 1.0.5 - Release Candidate

### Added

- Universal Label Canvas as the primary label editor.
- Physical millimetre document model shared by print and PDF.
- Device-scoped paper profile and calibration restoration.
- Responsive release QA across Chromium, WebKit, and Firefox.
- Built-artifact smoke with version, manifest, console, and request checks.
- Explicit web release gate in CI.
- Restaurant tables now support movable/resizable 2D layouts, seats, current
  guests, direct products outside inventory, split bills and local recipe notes.
- Logistics adds local vehicles, routes, load sheets, route product sales,
  collections, returns, route settlement and route print summaries for
  minimarket/distribution workflows.

### Improved

- Mobile label editor keeps quantity and print actions visible.
- Buttons, headings, arrows, and long labels remain inside their containers.
- Label templates now default to clean PDF output, preserve the saved universal
  QR layout and delete through the guarded tenant save path.
- The universal editor keeps the preview visible while scrolling settings and
  exposes Simple Canvas / Advanced Assistant controls on mobile.
- The mobile QR wizard now scrolls to the active step controls, keeps the
  preview compact outside the preview step, and prevents the footer from
  covering cards on mobile or desktop.
- Logo, profile, navigation, and modal controls have improved semantics and
  touch targets.
- Cache identity is now `commercial-1-0-5-r9`.
- Table layout changes use a named non-commercial sync source so moving or
  resizing a table does not create a false blocking cloud conflict.

### Security

- `firebase-admin` is excluded from the production web package and static build.
- The production audit covers only the PWA runtime and remains independent from
  repository tooling that is not shipped to browsers.

### Gated

- P2 Workers and Owner Preview remain disabled until their multiuser backend
  and Rules contracts are approved.
- Restaurant and Logistics ship as guarded frontend/local modules only; no
  production Rules, Functions, Auth, claims or data migrations are changed.

## 1.0.4-p0 - 2026-07-22

- Añade escaneo desde cámara para QR, EAN, UPC y Code 128 con `BarcodeDetector`, fallback local ZXing y soporte de lectores físicos tipo teclado.
- Separa cantidad exacta de etiquetas de la opción explícita por stock; incorpora código de barras, presets de rollo/hoja, forma circular simple y prueba de alineación.
- Añade Mesas Lite para restaurantes, con stock reservado entre mesas, cobro integrado a la caja abierta y aislamiento por negocio.
- Añade finanzas manuales para pagos, préstamos, sobres y metas sin credenciales ni conexión bancaria.
- Añade Centro de ayuda interno, buscable y con soporte por WhatsApp.
- Mantiene las estructuras nuevas opcionales, aisladas por `businessId` y compatibles con snapshots existentes.
- Actualiza PWA, manifest, runtime y caché a `1.0.4-p0` / `mvp-launch-v16-2-p1-5a-r1`.

## 1.0.3-p4 - 2026-07-18

- Endurece el cierre de caja con etapas explícitas de acceso, sesión, cálculo, persistencia, verificación y exportación.
- Evita dobles cierres por doble toque y separa fallos de PDF/PNG/impresión de la escritura comercial ya confirmada.
- Agrega diagnóstico seguro de caja sin UID, correo ni datos comerciales completos, con códigos visibles y acción de reintento.
- Mantiene trabajadores pausados para el snapshot monolítico y muestra un bloqueo claro cuando el rol no puede cerrar caja.
- Añade harness P1.1d y simulador sintético quick/full para caja, negocios múltiples, usuarios y almacenamiento local falso.
- Actualiza versión, manifest, runtime guard y Service Worker a `1.0.3-p4` / `mvp-launch-v16-2-p1-r4`.

## 1.0.2-p0 - 2026-07-16

- Corrige el loop de login posterior al redirect de Google en iOS/Brave usando `authDomain` same-origin en la URL oficial `click-360.web.app`.
- Agrega verificación explícita de `getRedirectResult()` y marcador de redirect pendiente para distinguir `AUTH_REDIRECT_NO_RESULT`, `AUTH_USER_NULL_AFTER_REDIRECT` y `AUTH_PERSISTENCE_FAILED`.
- Agrega códigos visibles para rechazos de `accountAccess`, `approvedUsers`, Rules y bootstrap, evitando volver al inicio sin causa.
- Evita cerrar sesión automáticamente antes de abrir Google; el cambio/cierre de cuenta queda en el botón explícito.
- Actualiza asset cache, runtime guard, manifest y service worker a `mvp-launch-v16-2-p0-r2`.

## V16.2 - 2026-07-15

- Resolución de identidad UID-first con precedencia explícita: `accountAccess`, aprobación histórica validada, invitación intencional y trial solo para una identidad realmente nueva.
- Estados de acceso tipados para fundador, planes pagados, trial activo/expirado, reconciliación de identidad, migración legacy y `ONLINE_ONLY_SAFE`.
- Trial único de 7 x 24 horas basado en tiempo confiable del servidor y normalización defensiva de Timestamp, segundos, milisegundos y microsegundos.
- Primer tenant V10 transaccional y fallback `ONLINE_ONLY_SAFE` para cuentas pagadas como Shary cuando no queda ninguna persistencia local disponible, sin crear seed ni sobrescribir un remoto concurrente.
- Migración V9 -> V10 ampliada para conservar todos los módulos comerciales, perfiles y políticas, con dry-run, backup administrativo, hash de origen, conteos completos y verificación posterior.
- Confirmación remota y rollback para operaciones críticas de inventario, ventas, caja, cierres, anulaciones, restauraciones y facturas; la interfaz no anuncia éxito en línea antes de confirmar la nube.
- Tombstones y búsquedas comerciales aislados por negocio; comprobantes corrigen el subtotal previo al descuento y respetan la configuración explícita de IVA desactivado.
- Snapshot monolítico V10 restringido temporalmente al propietario. El acceso operativo de trabajadores queda pausado hasta la arquitectura modular P1 para evitar exposición del negocio completo.
- Reglas reforzadas para identidad canónica, precedencia de `accountAccess`, trial propio inmutable desde el cliente y bloqueo permanente de `demo-click360`.
- PWA, manifest, assets, runtime guard y Service Worker actualizados a `mvp-launch-v16-2-r1`; Firebase Hosting se mantiene como origen canónico.
- Harness V16.2 para trial, acceso, migración integral, operaciones críticas, owner-only, aislamiento y caché.
- Estado operativo: **pendiente de completar PR, CI, smoke autenticado y publicación**. Véanse `docs/CLICK360_V16_2_RELEASE_REPORT.md` y `docs/CLICK360_V16_2_QA_CHECKLIST.md`; esta entrada no afirma despliegue.

## V16.1.2 - 2026-07-14

- Resolución de acceso por Firebase Auth UID con `accountAccess` antes de compatibilidad legacy o invitaciones.
- Estados de acceso explícitos y opciones públicas siempre recuperables; se eliminó la lógica basada en textos.
- Invitaciones aceptadas solo después de una acción explícita de la sesión y limpieza completa de parámetros obsoletos.
- Primer tenant V10 transaccional para cuentas pagadas, sin `STATE_DOC.set()` ciego ni sobrescritura concurrente.
- `lastSeenAt` convertido en una operación secundaria que nunca decide si una cuenta existe.
- Caché de acceso aislada por UID y fallback `ONLINE_ONLY_SAFE` cuando falla el almacenamiento del dispositivo.
- Correcciones responsive de sidebar, nombres largos, selector de negocio, fecha/hora única y banner de Inicio.
- Centro de impresión con proveedores desacoplados para sistema, PDF, M02X y futuro puente nativo.
- M02X marcada como validación física pendiente; no se promete Bluetooth directo sin protocolo comprobado.
- Comprobantes limitados al negocio activo y rotulados como internos, no como factura electrónica.
- Build estático allowlist, Firebase Hosting, Service Worker y assets renovados con cache `mvp-launch-v16-1-2-r1`.
- Harnesses de acceso, impresión, runtime, caché, primer tenant pagado y reglas Firestore.

## V16.1.1 - 2026-07-14

- Guard de compatibilidad temprano para código externo que consulte `__firefox__`.
- Reportes de errores con archivo, stack, navegador, versión y URL sanitizada.
- Mensaje amigable al cliente con código de reporte, sin detalles técnicos crudos.
- Informes locales limitados y aislados por sesión pública o UID/tenant autenticado.
- Service Worker, manifest y todos los scripts renovados con cache `mvp-launch-v16-1-1-r1`.
- Regresiones para Firefox, Chrome Android, caché anterior y `ONLINE_ONLY_SAFE` de primer ingreso.

## V16.1 - 2026-07-14

- Acceso de compradores y primer negocio con fallback `ONLINE_ONLY_SAFE` sin sobrescribir remotos.
- Flujos publicos independientes para login, prueba, registro, invitacion, planes y WhatsApp.
- Landing comercial, FAQ estructurada, SEO, sitemap, robots y cache `mvp-launch-v16-1-r1`.
- Editor QR simplificado con presets, touch, IVA, redes, plantillas e impresion.
- Lista de plantillas actualizada inmediatamente y shell con un unico modal root.
- UX movil, selector de negocio, notificaciones, reloj por zona horaria e iconos Lucide.
- Calculadora integrada con Vender, Caja y Mas.
- Harness V16.1, QA responsive, PWA offline y documentacion de release.

## V16 - 2026-07-13

- Acceso remoto-first con almacenamiento V16 por UID/tenant y modo online-only seguro.
- Trial Base de 7 días por tiempo de Firestore, planes Base/Pro y activación administrativa auditada.
- Expiración automática en sesión y allowlists Firestore endurecidas contra campos añadidos no autorizados.
- Recuperación de comprador histórico sin modificar snapshots comerciales.
- Invitaciones hash-only, membresías y permisos de trabajador aplicados en reglas.
- CRM, WhatsApp, recordatorios, notificaciones y reloj.
- IVA global/por producto, apartados con términos y caja auditable.
- Editor profesional de etiquetas QR con capas, movimiento, tamaño e impresión.
- Landing, onboarding, legal, SEO, PWA y cache `mvp-launch-v16-r2`.
- Suite V16, emulador Firestore y documentación de seguridad/migración/costos.
