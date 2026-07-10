# CLICK 360 Production Audit

Fecha: 2026-07-10
Rama: `hotfix/p0-account-data-isolation`
Resultado: **NO-GO**

## Alcance

Revisión de app, autenticación, Firestore, reglas, migraciones, PWA, Service Worker, cachés, localStorage, multi-tab, concurrencia, perfiles, imágenes, inventario, ventas, caja, reportes, facturas, backups, UX, dependencias y CI.

## Hallazgos corregidos

1. Seed fresco podía competir con remoto v10: ahora una caché ausente aplica remoto y nunca se considera edición local.
2. Resultado asíncrono de A podía escribir revisión/hash de B: scheduler y metadatos están ligados al epoch/contexto capturado.
3. Documento remoto ausente podía recrearse sobre caché previa: ahora queda bloqueado.
4. Caché con identidad correcta pero estructura corrupta podía abrir: ahora se valida el payload completo.
5. Modo QA por URL podía mutar estado: eliminado del cliente.
6. `localStorage.setItem` estaba modificado globalmente: reemplazado por evento explícito de guardado tenant.
7. Perfil local podía ocultar una versión remota nueva: resolución por fecha y cola pendiente.
8. Almacenamiento lleno eliminaba contenido: ahora revierte al último snapshot confirmado sin poda automática.
9. Actualizar desde nube no protegía cambios locales: backup y doble confirmación obligatorios.
10. Efectivo entregado incluía vuelto en “cobrado”: separado en `tendered`, `received` y `change`.
11. Borrar factura dejaba el egreso: cancelación trazable de factura y movimiento.
12. Excel/CSV aceptaba fórmulas de texto: neutralización de formula injection.
13. Service Worker no esperaba escrituras y recargaba durante operaciones: caché confirmada y actualización no interruptiva.
14. Clasificador legacy aceptaba ruta/UID o estructura dudosa: Auth, ruta canónica y forma válida son obligatorios.
15. Código muerto de admin, controles cloud y rutas antiguas eliminado.

## Rendimiento y límites

- No se encontraron listeners duplicados persistentes; se cancelan al cambiar de cuenta.
- Escáner y AudioContext liberan recursos.
- Escrituras se agrupan con debounce y scheduler por tenant.
- Imágenes se comprimen antes de persistir.
- El snapshot completo sigue causando escrituras grandes y crecimiento O(n); es un bloqueo de arquitectura, no un detalle optimizable.

## Decisión

El hotfix mejora sustancialmente seguridad e integridad, pero no puede certificarse vendible en producción mientras un trabajador autorizado pueda modificar el snapshot entero y los registros financieros no sean entidades protegidas/append-only. Mantener PR Draft y completar la arquitectura objetivo antes de GO.
