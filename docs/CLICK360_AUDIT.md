# CLICK 360 Audit

Fecha: 2026-07-09
Rama: `feat/click360-platform-evolution`

## Hallazgos principales

1. La sincronizacion guardaba un snapshot completo de `localStorage` en `businesses/{ownerId}/state/main`. Eso era compatible con el MVP, pero podia pisar cambios entre dispositivos si un telefono viejo subia un estado anterior.
2. La sesion local (`click360_mvp_qa_final_session_v1`) se incluia en el snapshot de negocio. Eso mezclaba identidad del dispositivo con datos de negocio.
3. Firestore permitia leer/escribir cualquier negocio a cualquier usuario aprobado. Faltaba aislamiento por `ownerId`.
4. Un trabajador preaprobado podia crear un documento `approvedUsers/{uid}` sin validacion estricta de rol/owner desde reglas.
5. La revocacion de trabajadores intentaba borrar documentos, pero las reglas negaban deletes. El acceso podia quedar activo.
6. Reabrir caja eliminaba cierre/apertura del dia. Eso rompia auditoria contable.
7. Reportes mezclaban vendido, cobrado y pendiente. En deudas/apartados podia confundirse ingreso real con saldo por cobrar.
8. El recibo de una cuenta pendiente podia mostrar pagado el total cuando `received` era `0`.
9. La app dependia de CDN para Firebase, Excel, PDF e imagenes de reportes. Eso debilitaba el modo offline instalado.

## Cambios aplicados

- Se excluyo la sesion local del snapshot sincronizado.
- Se agregaron `revision`, `baseRevision`, `deviceId` y estado visible de sincronizacion.
- Se agregaron tombstones de productos eliminados para evitar reapariciones desde snapshots viejos.
- Se endurecieron reglas Firestore por tenant/ownerId.
- Se cambio revocacion de trabajadores a bloqueo/revocacion blanda.
- Se dejo la reapertura de caja como evento auditado, sin borrar cierres anteriores.
- Se separaron metricas: vendido, cobrado, pendiente.
- Se corrigio recibo para usar `received ?? 0` y mostrar recordatorios solo si hay saldo.
- Se vendorizaron librerias criticas en `vendor/`.

## Riesgos restantes

- El modelo de datos sigue siendo snapshot-first. La siguiente fase debe migrar ventas, productos, movimientos y cierres a colecciones Firestore por entidad.
- Las reglas nuevas deben publicarse en Firebase desde el proyecto real antes de considerarlas activas en produccion.
- El primer inicio de sesion y aprobacion siguen requiriendo internet.
