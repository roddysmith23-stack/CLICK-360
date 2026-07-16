# Changelog

## 1.0.1-p0 - 2026-07-16

- Recupera el primer bootstrap V10 para cuentas válidas online sin `state/main`, preparando un snapshot inicial validado sin pasar por `save()` antes de `AUTH_APPROVED`.
- Sincroniza en fuente la compatibilidad PRO Lifetime limitada para `status=active`, `lifetime=true`, `plan=pro`, `planCode=pro_lifetime` y `billingStatus=lifetime`, sin incorporar reglas V17.
- Rechaza registros `pro_lifetime` incompletos para que no pasen por la rama genérica de plan activo.
- Corrige "Nuevo recordatorio" en móvil con fecha y hora separadas, responsivas y sin overflow horizontal.
- Separa Galeria y Tomar foto con inputs y handlers independientes; Galeria no usa `capture` y Camara usa `capture="environment"`.
- Actualiza asset cache, runtime guard, manifest y service worker a `mvp-launch-v16-2-p0-r1`.

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
