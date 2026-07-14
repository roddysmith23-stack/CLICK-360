# CLICK 360 Firebase Cost And Sync Audit V16

Fecha: 2026-07-13

## Patrón actual

Cada tenant usa un documento canónico `businesses/{ownerId}/state/main`. Una edición local se agrupa durante 1,2 segundos y luego ejecuta una transacción: lectura de revisión y una escritura si no existe conflicto. Hay un listener de estado y uno de acceso/aprobación por sesión; se descargan al cerrar sesión o cambiar cuenta.

## Métricas observadas

- 3 tenants legítimos `CLEAN_V10`.
- Tamaño serializado aproximado: 24 KB, 62 KB y 123 KB.
- Límite preventivo cliente/nube: 850.000 bytes.
- `demo-click360` ronda 996 KB, está bloqueado y no participa en sincronización.
- Dependencias de producción: 0 vulnerabilidades reportadas.

## Mejoras V16

- Un solo scheduler por epoch/tenant evita pushes paralelos.
- Debounce de 1,2 s agrupa ediciones cercanas.
- Revisión transaccional impide last-write-wins silencioso.
- Listener remoto no rerenderiza sobre modal o campo activo.
- IndexedDB guarda snapshots grandes; localStorage mantiene compatibilidad y metadatos.
- Imágenes se comprimen, validan y limitan.
- `ONLINE_ONLY_SAFE` evita duplicar o borrar datos cuando el navegador rechaza almacenamiento.
- Service Worker no intercepta Auth/Firestore y solo gestiona assets CLICK 360.

## Riesgo y costo

Una edición pequeña aún lee y escribe el documento completo. El costo por operación es predecible en beta, pero crece con el tamaño y la concurrencia. El documento de Firestore no puede superar 1 MiB; por eso V16 bloquea antes y conserva el último estado confirmado.

## Evolución recomendada

1. Cloud Storage para fotos y logos con referencias, no base64.
2. Colecciones por productos, ventas, movimientos, caja, CRM y recordatorios.
3. Ledger append-only para ventas, pagos, cierres y anulaciones.
4. Cloud Functions/command layer para cierres y operaciones sensibles.
5. Telemetría agregada sin documentos comerciales ni secretos.
6. Medición mensual de lecturas, escrituras, bytes y conflictos antes de subir límites.

La transición debe usar backfill, hashes/conteos, lectura dual y rollback; no una reescritura directa de producción.
