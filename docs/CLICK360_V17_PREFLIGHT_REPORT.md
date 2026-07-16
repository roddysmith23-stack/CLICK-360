# CLICK 360 V17 - Informe preflight

Fecha de auditoría final: `2026-07-16T07:00:05.679Z`

Proyecto: `click-360`

Rama: `feat/v17-founders-lifetime-access`

Base V16.2: `693ed5947a6944af0e3811081c263650a53f08c9`

## Veredicto

**DO NOT APPLY**

La auditoría fue real y de solo lectura: 138 documentos, cuatro tenants, cero escrituras, hash de inventario `1f3cbefb5e53deac093ff9c756c3555900be9ef40f3aa8916eff72f308c16228` y relectura sin cambios. El informe final tiene hash `94cc7c095a59499b5fd1320363d8ddcabecd0dde37cb23f79fd8b091517bec36`; el dry-run tiene hash `f8fef94297f93163af4733e51042c6432337dcdf076b47ac2ff5698928b5fe09`.

Se ejecutaron dos auditorías finales consecutivas. Ambas produjeron el mismo hash de inventario y los mismos cuatro hashes de tenant; el auditor ordena las rutas antes de calcular el hash para que la evidencia sea reproducible.

No se modificaron Auth, claims, Firestore, Rules desplegadas, Hosting ni datos comerciales.

## Cuatro cuentas

| Persona | Auth observado | Estado actual | Tenant/rutas | Decisión |
| --- | --- | --- | --- | --- |
| Sr. Smith | No existe Auth para `roddysmithceo@gmail.com`. Candidato: `roddysmith23@hotmail.com`, UID `iESlWpF92JXaGDoYTQ28ThWs93y1`, nombre `RODDY MULLO`. | Sin `accountAccess`; `approvedUsers/iESl...` owner activo. Existe además una asociación legacy de ese correo como trabajador dentro del tenant de Sanya. | `businesses/iESl.../state/main`, V10, hash `1428ae7f...`; dos legacy backups. | `BLOCKED`: confirmar que el candidato es la persona administrativa exacta y revisar la asociación legacy. |
| Debby | Candidata: `debbya632@gmail.com`, UID `g9e8NjJjrDS3ldvNxHLlhqvzm3E3`, nombre Auth `Tania Rivera`. | Sin `accountAccess`; `approvedUsers/g9e...` contiene el correo distinto `sanyagullo1997@gmail.com`. | `businesses/g9e.../state/main`, V10, hash `f89c160d...`; un legacy backup. | `BLOCKED`: confirmar identidad y organización donde será `co_owner`. |
| Shary | `shary10mmvv@gmail.com`, UID confirmado `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`, Auth activo. | `paid_base/base`, entitlement 16, hash `f39e08da...`; contiene campos trial heredados que deben ignorarse. | No existe `businesses/3UT.../state/main`; no se halló estado comercial histórico exacto en los 138 documentos auditados. | `READY_FOR_APPROVAL` para PRO Lifetime, pero no aplicar mientras el preflight global esté bloqueado. |
| Lía | No existe Auth para `liavero_zambrano@hotmail.com`; cero hits exactos o fuzzy en Firestore. | Sin `accountAccess`, `approvedUsers`, entitlement ni organización. | Ninguna ruta canónica porque no existe UID. | `PENDING_ACTIVATION_ONLY`: solicitud y código hasheado; no UID, contraseña ni organización inventados. |

Los hits de Sr. Smith sobre el backup/auditoría de Shary son referencias como actor administrativo, no propiedad de esos datos.

## Integridad de tenants

| Ruta | Clasificación | Hash | Conteos principales |
| --- | --- | --- | --- |
| `businesses/cPy0PqLSHGO6Ei3xlRc2DHufQ5B3/state/main` | Sanya/Lía Perfumería, protegido | `9f7dad5afe6bdd444bdcf3da7f1b57bfa088550fd99cd1e70b566740912f7a80` | 2 negocios, 2 productos, 3 ventas, 7 movimientos, 1 reporte, 2 trabajadores, 3 plantillas, 1 eliminado, 8 logs |
| `businesses/demo-click360/state/main` | `CROSS_TENANT_SUSPECT`, bloqueado | `bf1c622c0cd91d03489b0c2d9807343f5baaa6efc794cf8563ac6c7cb0e3c6a0` | 2 negocios, 4 productos, 4 ventas, 6 movimientos |
| `businesses/g9e8NjJjrDS3ldvNxHLlhqvzm3E3/state/main` | candidato Debby, protegido | `f89c160d3a74a0235ccabcbf47ac3766b66afdd769f40add66d64680e5bd2ee9` | 2 negocios, 2 productos, 7 ventas, 19 movimientos, 2 reportes, 1 caja, 6 logs |
| `businesses/iESlWpF92JXaGDoYTQ28ThWs93y1/state/main` | candidato Sr. Smith, protegido | `1428ae7f06ac4c5b566e95342a74e711ded2a614066a6fd8cb2d36ee86944d5f` | 1 negocio, 1 producto, 1 venta, 3 movimientos, 1 plantilla, 5 logs |

Los cuatro hashes fueron releídos y permanecieron idénticos.

## Dry-run exacto

- Catálogo: crear con precondición create-only `plans/founder_unlimited`, `plans/pro` y `plans/base`.
- Sr. Smith: ninguna acción generada hasta confirmar Auth.
- Debby: ninguna acción generada hasta confirmar Auth y organización autorizada.
- Shary: organización opaca propuesta `org_6ac74bfaacbf493f2987709b`; crear `users`, `entitlements`, organización, membership owner, índice de usuario y subscription. Modificar `accountAccess/3UT...` solo si su hash sigue siendo `f39e08da...`. Refrescar claims al final.
- Lía: crear después de aprobación una solicitud pendiente y un código aleatorio de un uso guardado únicamente como hash. La organización se provisiona solo después de que Auth entregue el UID real.

Ninguna acción propuesta escribe `businesses/*/state/main`.

## Backup

Existe el backup histórico de Shary `adminBackups/iPNGKV3QHLNww0Tkq4uJ`, hash `c86db7db...`, y su auditoría `adminAuditLogs/ddp2uf6WoHNh1AcscXdj`, hash `0199ea12...`. No sustituyen el backup V17 fresco requerido.

Antes de aplicar se debe crear `adminBackups/{backupId}` por persona con:

- identidad Auth y custom claims previos;
- contenido completo y hash de cada documento objetivo;
- hash/conteos de los cuatro tenants protegidos;
- hash del inventario y del plan aprobado;
- rutas exactas creadas o modificadas;
- manifiesto de rollback.

Se debe releer y verificar el backup antes de la primera escritura.

## Causa del bloqueo de Shary

`enterApprovedApp()` llamaba `click360PersistTenantState()`, que entra en `save()`. `save()` exige `click360CanMutate()`, y este exige `AUTH_APPROVED`; sin embargo, `AUTH_APPROVED` solo se activaba después de ese guardado. El resultado era un bloqueo circular con almacenamiento sano y el mensaje genérico de preparación fallida.

La rama incorpora `click360PrepareInitialTenantState()`: valida snapshot e identidad, prepara localStorage/IndexedDB sin pasar por el permiso de edición ni disparar sincronización, y solo después permite el bootstrap remoto transaccional create-only. También reconoce `pro_lifetime` como PRO y `founder_unlimited` como Founder en la compatibilidad V16.

## Pruebas

- 23 escenarios V17 PASS, incluidos los 20 obligatorios.
- Emulador Firestore PASS para fundador, founder admin, cliente fundador, aislamiento organizacional, Control Center y códigos privados.
- Regresiones V16.2 de bootstrap, storage, cache y transacción create-only PASS.
- No se ejecutó un smoke autenticado real ni segundo dispositivo porque esta fase prohíbe modificar datos reales y todavía no existe un release V17 aprobado.

## Bloqueos para APPLY

1. Confirmar la identidad Auth exacta de Sr. Smith.
2. Confirmar la identidad Auth exacta de Debby y su organización autorizada.
3. Registrar aprobación expresa del owner sobre el plan hash.
4. Implementar y revisar el ejecutor administrativo de aplicación; el preflight actual bloquea toda escritura deliberadamente.
5. Ejecutar smoke autenticado y segundo dispositivo después de aplicar, antes de cualquier despliegue general.
6. Aprobar por separado las reglas candidatas; no han sido desplegadas.

Hasta entonces, la recomendación correcta es **DO NOT APPLY**.
