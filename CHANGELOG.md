# Changelog

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
