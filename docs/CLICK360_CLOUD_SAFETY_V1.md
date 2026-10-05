# Cloud safety v1 — protección universal sin escrituras comerciales

Base: `21409a1d2dc710315ab8c3c27e5da566f004cc8e`. Rama: `codex/cloud-safety-backup-20261005`.

## Contrato

No sustituye sincronización operacional, no migra, no restaura y no reejecuta operaciones. Conserva el registro durable completo de IndexedDB: snapshot, revisión, operaciones pendientes y metadatos. Un contador de operaciones desconocidas no disponible permanece `null`, nunca cero por inferencia.

La copia local mantiene 8 MiB; `state/main` mantiene 850000 bytes. Founder adquirido conserva 2 negocios / 2 trabajadores / 2000 productos; esta pieza no altera cuotas ni precios ni activa 100 MiB sobre legacy.

Firestore fragmentado fue elegido porque las dos denominaciones del bucket de producción inspeccionadas devolvieron 404. No se introduce un bucket ni permisos de Storage innecesarios. Cada fragmento tiene como máximo 180000 bytes crudos; su documento codificado permanece por debajo de 300000 bytes. El manifiesto está acotado a 60000 bytes y 96 fragmentos.

La revisión contra el catálogo congelado encontró y reprodujo un guard inicial de 16 scopes incompatible con Enterprise (25 negocios incluidos). Se corrigió a un máximo de 96 scopes, derivado del mismo presupuesto de 96 partes, no de una cuota comercial nueva. Se prueba Enterprise completo con 7 MiB mediante Rules cliente y verificador HTTP. El archivo conserva los límites de tamaño anteriores; nunca aumenta la capacidad de `state/main` ni modifica derechos adquiridos.

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

Pasaron clientes de Rules del emulador, retención/concurrencia y reconstrucción de servidor; QA general, simulador completo e integración completa (incluidos etiquetas/QR/impresión, caja, stock, conflictos y fallos de arranque). El CI del primer commit `676aba8` terminó íntegramente verde; los cambios posteriores requieren su propio CI antes de merge.

La función HTTP real del emulador pasó con Auth real sintético y Rules cliente: sin autenticación deniega; ignora propietario forjado; reconstruye/verifica servidor; reconcilia respuesta perdida; rechaza partes faltantes y no escribe datos comerciales. El build real servido pasó en WebKit iPhone emulado, Chromium móvil y escritorio: al reiniciar captura automáticamente un estado durable de 1.77 MB con una venta exclusivamente local y dos operaciones pendientes, lo reconstruye idéntico en servidor y conserva todo tras otro reinicio. No reproduce la venta en legacy ni cambia su stock remoto. La actualización desde el build productivo `21409a1` pasó en Chromium/WebKit: rechaza instalación con assets mezclados y conserva todos los campos del snapshot, outbox y localStorage. Son pruebas automatizadas, no físicas.

El transporte del fixture necesitó long polling por el proxy de pruebas y enlace directo del endpoint demo al emulador: las peticiones controladas por Service Worker no pasan por Playwright routing. Se mantuvo Service Worker activo; no se simuló la respuesta del verificador ni se cambió el endpoint productivo para resolverlo.

Staging completo, CI del nuevo head y despliegue aún pendientes. Bloqueo de infraestructura observado: `billingEnabled=false` tanto en `click-360` como en `click360-staging-7620168025`; Cloud Functions no habilitada en staging. El verificador requiere habilitación autorizada de facturación. No hay despliegue nuevo de Hosting/Rules/Functions ni cutover realizado por esta rama.

Lectura fresca del 05/10: revisión comercial remota `1791072715866`, 463 productos / 30 ventas / 107 movimientos / 24 sesiones / 22 reportes. Respaldo nativo nuevo SHA-256 `944ebe6778448c86d5ecf9a8a7f21fae1a10d531556c5f81ff8a8c70232eb8f2`. Comparación con respaldo post-#93: payload y campos nativos `state/main` idénticos; venta $30 una, movimiento uno, sesión cerrada y reporte uno; cero IDs/operationIds de venta duplicados; stock/qty consistentes. Hubo nuevos documentos de auditoría externa, no modificaciones comerciales. No prueba que incluya operaciones nuevas del iPhone. No usarlo como única fuente del shadow.

Hosting productivo conservado: versión `09ba0331bd84b5eb`, 58 archivos descargados y verificados; copia `https://click-360--rollback-pre94b-20261005-hgycboy9.web.app`, ensayo no-live `https://click-360--rehearse-pre94b-20261005-9ax5n7ms.web.app`, manifiesto SHA-256 `ef147e8485c360b6cd78dcb8417b65bf0276b7d35fd521c81fe2be707e6edbc6`. Live siguió en `21409a1`. Rules desplegadas `cdfd4ffc-2ef3-4ae3-92b0-21a082e6040b`, SHA-256 `38b504d5d0806071c6d29b1787d8261aa2dc8026ecdba891352158b8147a448b`: coincidencia byte por byte con la base sin el bloque aditivo candidato.

Antes de cutover: último archivo COMPLETE del dispositivo, conciliación de operaciones pendientes/desconocidas, igualdad semántica independiente, Rules modulares, write fence, prueba old/new PWA, rollback forward-safe y respaldo fresco. Cualquier gate ausente mantiene cutover bloqueado, no justifica repetir operaciones de la clienta.
