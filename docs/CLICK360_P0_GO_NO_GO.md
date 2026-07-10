# CLICK 360 P0 GO / NO-GO

Fecha: 2026-07-10

## Decisión: NO-GO

El hotfix queda listo para revisión, no para producción. PR #1 debe permanecer Draft.

## P0 resuelto

- Dos tenants legítimos están migrados y verificados como `CLEAN_V10`.
- `demo-click360` sigue intacto y bloqueado como `CROSS_TENANT_SUSPECT`.
- Tenant, caché, sesión, aprobación, listeners y escrituras están aislados.
- Legacy, seed vacío, caché corrupta y documento remoto ausente con datos locales quedan bloqueados.
- Perfiles persisten localmente, se reintentan y resuelven versiones entre dispositivos.
- Almacenamiento lleno revierte el último cambio sin borrar imágenes ni estado confirmado.
- Concurrencia usa transacciones, revisiones y cuarentena de conflictos.
- Ventas en efectivo ya no cuentan el vuelto como ingreso; facturas anuladas neutralizan su movimiento.
- Reglas reales pasan en emulador y dependencias de producción tienen 0 vulnerabilidades conocidas por `npm audit`.

## Bloqueos para GO

1. Migrar el snapshot único a colecciones por entidad o a un command layer que haga efectivos los permisos por rol y preserve registros financieros.
2. Desplegar las reglas solo después de revisión y autorización expresa.
3. Ejecutar A → B → A con dos cuentas Google reales durante diez alternancias.
4. Ejecutar computadora ↔ teléfono con crear, editar, eliminar y confirmar que no reaparece.
5. Ejecutar offline/reconexión autenticado en dispositivos físicos.
6. Revalidar CI y observabilidad después de la arquitectura por entidades.

## Acciones prohibidas en este cierre

No merge, no GitHub Pages, no despliegue de reglas y ninguna modificación de producción. Este hotfix no tocó `demo-click360` ni volvió a ejecutar migraciones.
