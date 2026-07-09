# CLICK 360 P0 - Auditoria de aislamiento de cuentas

Fecha: 2026-07-09

## Causa confirmada

La version anterior usaba una sola llave local, `click360_mvp_qa_final_state_v1`, para todos los usuarios de un navegador. Tambien sincronizaba un mapa amplio de `localStorage`. Al cambiar de Google A a Google B, ese mapa podia conservar el estado de A mientras el destino remoto ya era B. Los atajos `local_newer` y `local_richer` podian entonces subir datos locales al documento de B.

## Correccion aplicada

- La app no carga estado empresarial hasta resolver Firebase Auth y el perfil aprobado.
- El contexto activo contiene `authUid`, `ownerUid`, `ownerId`, `businessId`, `tenantKey` y `schemaVersion: 10`.
- `tenantKey` usa `owner:{ownerId}:business:{businessId}`.
- El estado se guarda solo como `CLICK360_STATE:{tenantKey}`.
- La sesion de interfaz se guarda solo como `CLICK360_SESSION:{uid}`.
- El snapshot remoto ahora contiene identidad declarada y un `payload` con una lista explicita de datos de negocio. No se sincronizan claves Firebase, sesiones, perfiles de otros usuarios, cachés, depuracion ni claves desconocidas.
- Push, pull y listener remoto validan el tenant completo. Una incoherencia se bloquea, conserva el estado local y crea un registro local de cuarentena.
- Al cambiar de cuenta o cerrar sesion se cancelan listeners, se bloquea sync, se borra solo la memoria activa y se limpia el DOM. Las caches namespaced de la cuenta anterior se conservan intactas.
- Los mecanismos `local_newer` y `local_richer` fueron retirados. Un conflicto del mismo tenant conserva ambas versiones en cuarentena antes de una nueva escritura.

## Migracion legacy

La llave antigua nunca se carga como estado de la cuenta actual. Si existe, se conserva y se copia a `CLICK360_QUARANTINE:{deviceId}:...:legacy_local_state` junto con candidatos de negocio y la identidad detectada. No se asigna automaticamente a la primera cuenta que inicie sesion.

Los documentos remotos sin `schemaVersion: 10` activan el estado bloqueante `LEGACY_MIGRATION_REQUIRED`. La app no se desbloquea, no habilita editar/vender/borrar, y `STATE_DOC.set()` no puede ejecutarse para ese tenant. El documento remoto original se mantiene intacto.

La única migración disponible es explícita y exige la confirmación administrativa `MIGRATE_LEGACY_V9_TO_V10`. Antes de escribir v10, valida de forma inequívoca el UID autenticado, ownerId, businessId/ruta, autor histórico y contenido del estado. La migración crea un snapshot remoto en `businesses/{businessId}/legacyBackups`, re-lee el documento dentro de una transacción para impedir carreras, compara los conteos de negocios, productos, ventas, movimientos, facturas, reportes, trabajadores y plantillas, y solo entonces habilita sync v10.

## Auditoria de contaminacion remota

No se borraron, modificaron ni desplegaron reglas de Firestore durante este hotfix. El entorno de trabajo no tiene credenciales de lectura administrativa para enumerar documentos de produccion, por lo que no se puede afirmar que una auditoria remota este completa.

Pendiente con una cuenta autorizada: revisar cada `businesses/{businessId}/state/main`, registrar path, identidad declarada, `updatedBy`, `updatedByEmail`, negocios internos, productos, ventas, revision y fecha. Los documentos legacy o con identidad incongruente deben quedar en cuarentena y revisarse manualmente, nunca reasignarse por email o nombre visible.

## Pruebas incluidas

- Verificacion estatica de cache namespaced, sesion por UID, payload permitido, guards de push/pull, logout y cuarentena.
- Verificacion de sintaxis JavaScript y de cache PWA.
- Prueba visual de gate de autenticacion antes de desbloquear datos, en desktop y movil.
- Prueba A/B local repetida 10 veces en el mismo navegador: A mantuvo `A-001`, B mantuvo `B-001`; cada uno uso una llave `CLICK360_STATE` diferente y no hubo lectura cruzada.
- Harness ejecutable `node qa-p0-isolation-harness.cjs`: cubre A -> logout -> B -> logout -> A durante 10 ciclos y confirma que la barrera usada por el push real nunca invoca `STATE_DOC.set()` mientras el tenant está en legacy no migrado.

## Riesgo pendiente

La migracion de datos remotos legacy y la prueba con dos cuentas reales requieren acceso autorizado a Firebase. Las reglas preparadas en el repositorio no fueron desplegadas, de acuerdo con la instruccion P0. Hasta completar esa auditoria, los documentos legacy permanecen protegidos y sin migracion automatica.
