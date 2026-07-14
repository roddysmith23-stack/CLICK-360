# CLICK 360 V16 Data Migration

Fecha: 2026-07-13
Proyecto único: `click-360`

## Decisión

V16 conserva el envelope V10 y añade campos opcionales normalizados en memoria. No se reescribieron los tres snapshots legítimos solo para cambiar versión de aplicación. Esto evita una migración masiva sin beneficio de integridad.

## Inventario previo

- 4 documentos `businesses/*/state/main`.
- 3 `CLEAN_V10` con identidad canónica.
- 0 legacy pendientes.
- 1 `CROSS_TENANT_SUSPECT`: `demo-click360`.
- `demo-click360` permanece fuera de toda allowlist, regla de lectura/escritura y herramienta administrativa.

Conteos de los tenants legítimos se mantuvieron sin escrituras de migración. Sus tamaños serializados observados estuvieron aproximadamente entre 24 KB y 123 KB.

## Compatibilidad aditiva

Al cargar, `normalizeState()` añade únicamente valores por defecto faltantes para CRM, recordatorios, apartados, caja, notificaciones, políticas, plantillas y V16. Firestore sigue recibiendo `schemaVersion: 10`, la misma identidad y el mismo tenant. El primer cambio real del propietario guarda esos campos mediante la transacción normal con revisión; no existe un job destructivo.

## Cuenta compradora recuperada

La cuenta exacta `shary10mmvv@gmail.com` se resolvió por Firebase Auth UID. Antes de la operación tenía un entitlement self-service `trial`, sin `approvedUsers`, membresía ni estado remoto. No había payload comercial que reasignar o migrar.

Se ejecutó:

1. lectura Auth, acceso, membresías, invitaciones y estado;
2. dry-run `base/historical`;
3. verificación del hash previo;
4. creación y relectura de backup administrativo;
5. transacción de entitlement;
6. auditoría inmutable;
7. relectura y verificación posterior.

Resultado: `paid_base`, `planCode: base`, fuente `historical_buyer_recovery`, revisión 1. No se creó ni modificó `businesses/{uid}/state/main`; su primer arranque V16 lo creará idempotentemente si continúa ausente.

## Demo protegido

Hash de auditoría antes y después de la recuperación: `bd6a451ea23688a6c87a95a2470a7ce4d1eefe98cfdb2ff98970de1ac20c30a6`.

Categoría, fecha, contenido y conteos permanecieron idénticos: 2 negocios, 4 productos, 4 ventas y 6 movimientos. No fue migrado ni desbloqueado.

## Rollback

El entitlement puede restaurarse desde el backup administrativo mediante una operación IAM separada y auditada. Los snapshots V10 no necesitan rollback porque no fueron reescritos. Nunca se debe restaurar `demo-click360` sobre una cuenta real.
