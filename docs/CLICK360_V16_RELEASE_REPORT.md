# CLICK 360 V16 Release Report

Fecha: 2026-07-13
Build: `mvp-launch-v16-r2`

## Alcance

V16 convierte la beta privada en beta comercial controlada. Incluye bootstrap remoto-first, `ONLINE_ONLY_SAFE`, trial de 7 días, planes y activación, onboarding/legal, CRM/recordatorios, IVA, apartados, cierre auditable, workers seguros, editor de etiquetas profesional, PWA/SEO y administración IAM.

## Protección de datos

- V10 continúa como contrato canónico.
- Ningún tenant legítimo fue reescrito durante preparación.
- Shary se recuperó por UID con backup y auditoría; su estado comercial no existía y no fue inventado/importado.
- `demo-click360` permanece bloqueado y sin cambios.
- No se ejecutaron operaciones comerciales en datos reales.

## Git y publicación

La rama de release es `feat/v16-commercial-beta`. Los identificadores de commit, PR, merge, CI, despliegue de Rules y URL final se completan en el cierre operativo después de que todos los gates permanezcan verdes.

## Decisión

GO técnico para release controlado. No hay P0/P1 funcional abierto. La granularización del snapshot y Cloud Storage para imágenes son evolución de escala documentada; el límite de 850 KB protege la beta actual.
