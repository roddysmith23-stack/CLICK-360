# CLICK 360 Migration Plan

## Fase aplicada

Fase segura y compatible:

- Mantener snapshot existente.
- Agregar metadatos de revision/dispositivo.
- Agregar tombstones para productos eliminados.
- Proteger reglas Firestore por tenant.
- Vendorizar librerias para PWA offline.

## Siguiente fase recomendada

Migracion aditiva por colecciones:

- `businesses/{ownerId}/products/{productId}`
- `businesses/{ownerId}/sales/{saleId}`
- `businesses/{ownerId}/movements/{movementId}`
- `businesses/{ownerId}/cashSessions/{date}`
- `businesses/{ownerId}/dailyReports/{reportId}`
- `businesses/{ownerId}/invoices/{invoiceId}`
- `businesses/{ownerId}/customers/{customerId}`

## Reglas de migracion

- No borrar snapshot hasta tener backfill probado.
- Mantener backup automatico antes de cada importacion/restauracion.
- Migrar primero lectura dual, luego escritura dual, y al final apagar snapshot.
- Usar IDs estables y `updatedAtMs` por entidad.
- Deletes con tombstone, no ausencia silenciosa.
