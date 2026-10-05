# Cloud safety v1 — protección universal sin escrituras comerciales

Base: `21409a1d2dc710315ab8c3c27e5da566f004cc8e`. Rama: `codex/cloud-safety-backup-20261005`.

## Contrato

No sustituye sincronización operacional, no migra, no restaura y no reejecuta operaciones. Conserva el registro durable completo de IndexedDB: snapshot, revisión, operaciones pendientes y metadatos. Un contador de operaciones desconocidas no disponible permanece `null`, nunca cero por inferencia.

La copia local mantiene 8 MiB; `state/main` mantiene 850000 bytes. Founder adquirido conserva 2 negocios / 2 trabajadores / 2000 productos; esta pieza no altera cuotas ni precios ni activa 100 MiB sobre legacy.

Firestore fragmentado fue elegido porque las dos denominaciones del bucket de producción inspeccionadas devolvieron 404. No se introduce un bucket ni permisos de Storage innecesarios. Cada fragmento tiene como máximo 180000 bytes crudos; su documento codificado permanece por debajo de 300000 bytes. El manifiesto está acotado a 60000 bytes y 96 fragmentos.

## Identidad y privacidad

`businesses/{ownerUid}/safetyBackups/{backupId}/parts/{partId}`. Las filas se separan por negocio, manteniendo sus posiciones originales; configuraciones compartidas y filas huérfanas no se descartan. Como el snapshot legacy puede incluir varios negocios, el archivo completo es privado del propietario. Un trabajador no obtiene acceso a los negocios hermanos. El journal modular necesita autorización separada por negocio; no se amplían permisos legacy para resolverlo.

ID determinístico: SHA-256 de propietario / tenant / dispositivo / secuencia durable / hash del registro. Reintentos reutilizan secuencia y fragmentos; un payload diferente no puede reemplazar el anterior. Una captura antigua no puede asignarse después de un guardado más nuevo: CAS en la misma transacción IndexedDB. La confirmación tampoco modifica el snapshot ni limpia el outbox.

## Confirmación independiente

El cliente crea `UPLOADING` y partes inmutables. Las Rules deniegan actualizaciones, eliminaciones y creación de `COMPLETE`. `finalizeCloudSafetyBackup`, autenticada y fijada al UID del llamador, vuelve a leer las partes desde servidor, reconstruye el registro y verifica SHA-256, identidad, conteos, revisión, metadatos y equivalencia antes de la transacción de `COMPLETE` con timestamp servidor.

Los punteros son por dispositivo, no una falsa fuente multi-device. Una secuencia antigua no reemplaza una posterior. Retención conserva al menos tres versiones reales completas por negocio cuando existen, además de todos los heads de dispositivos. No fabrica tres versiones idénticas al inicializar. La eliminación de versiones sobrantes es atómica con la lectura de heads; nunca elimina uploads incompletos ni el último respaldo protegido.

La PWA encola automáticamente el estado durable capacity-blocked ya existente al arrancar/reconectar, sin necesitar una venta nueva. Solo indica «respaldo de seguridad en nube confirmado» para el hash local efectivamente confirmado. Nunca lo denomina «Nube sincronizada». Actualizar/reparar/restaurar legacy queda protegido mientras existan operaciones capacity-pending.

## Soporte y despliegue

`scripts/cloud-safety-readonly.mjs`: listar / reconstruir / verificar en directorio privado, exclusivamente lectura. No incluye restore. `scripts/tenant-storage-risk-readonly.mjs`: clasificación sanitizada observada; pending/unknown autoritativos permanecen desconocidos sin conciliación física.

Despliegue candidato: CI completo → staging Functions/Rules → build real servido → E2E → respaldo Hosting y Rules actuales → revisión de diff exacto → merge/CI merge → Functions/Rules/Hosting exactos. La función usa codebase `cloud-safety`, no despliega ni elimina otras funciones. El bundle servidor copia el codec canónico mediante predeploy; no existe una segunda implementación de hashing.

Reversión: conservar Hosting anterior y Rules anteriores; detener el cliente nuevo si falla la verificación, mantener IndexedDB y todos los archivos completos. No restaurar documentos comerciales ni eliminar archivos al revertir. Ningún cutover modular está incluido en este release.

## Evidencia y gates pendientes

Pasaron reconstrucciones de 850 KB, 860 KB, 1 MiB, 1.2 MiB, 3 MiB y 7 MiB; interrupción/reanudación, repetición, respuesta perdida, corrupción, parte faltante, hash incorrecto. Pasaron WebKit iPhone emulado, Chromium Android emulado, Chromium escritorio y Firefox: IndexedDB real, cold restart, CAS y preservación del outbox/stock. No son aceptación física.

Pasaron clientes de Rules del emulador y reconstrucción de servidor; QA general, simulador completo y suites anteriores conservadas. Retención ampliada, runner automático completo, HTTP callable, actualización PWA con nuevos assets, staging y CI exactos todavía deben certificarse antes de producción. No hay despliegue nuevo ni cutover realizado por esta rama.

Lectura fresca del 05/10: revisión comercial remota `1791072715866`, 463 productos / 30 ventas / 107 movimientos / 24 sesiones / 22 reportes. Respaldo nativo nuevo SHA-256 `944ebe6778448c86d5ecf9a8a7f21fae1a10d531556c5f81ff8a8c70232eb8f2`. No prueba que incluya operaciones nuevas del iPhone. No usarlo como única fuente del shadow.

Antes de cutover: último archivo COMPLETE del dispositivo, conciliación de operaciones pendientes/desconocidas, igualdad semántica independiente, Rules modulares, write fence, prueba old/new PWA, rollback forward-safe y respaldo fresco. Cualquier gate ausente mantiene cutover bloqueado, no justifica repetir operaciones de la clienta.
