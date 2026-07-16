# CLICK 360 V17 - Informe preflight confirmado

Fecha de auditoría: `2026-07-16T07:28:39.404Z`

Fecha del ejecutor dry-run: `2026-07-16T07:43:50.809Z`

Proyecto: `click-360`

Rama: `feat/v17-founders-lifetime-access`

PR: `#14` en estado Draft

Base V16.2: `693ed5947a6944af0e3811081c263650a53f08c9`

## Veredicto

**APPLY** para el plan preparado, sujeto a una autorización expresa posterior.

Este veredicto no ejecuta cambios. El estado sigue siendo `LOCKED_DRY_RUN`, `applyEnabled` es `false`, el ejecutor no contiene primitivas de escritura y las operaciones de producción registradas son `0`. No se modificaron Auth, claims, Firestore, Rules, Hosting ni `businesses/*/state/main`.

No hay bloqueos técnicos en el plan de Shary, Sr. Smith y Debby. Lía permanece correctamente en `PENDING_ACTIVATION_ONLY` hasta que Firebase Auth entregue su UID real. El smoke autenticado y el segundo dispositivo son verificaciones obligatorias posteriores a un futuro apply autorizado.

## Evidencia encadenada

| Evidencia | Valor |
| --- | --- |
| Documentos Firestore inspeccionados | 138 |
| Tenants inspeccionados | 4 |
| Hash global de inventario | `1f3cbefb5e53deac093ff9c756c3555900be9ef40f3aa8916eff72f308c16228` |
| Hash de auditoría | `08602dcc7e968c4df9c51185a412bc5725bd61280c36c35313b2968dffdae1a2` |
| Hash del plan | `e95c038115be1b7571674ca9e3f3a33782cc2cf3ec2cf91b1ed8214d9a62e9ef` |
| Hash del manifiesto de backup | `bd701e3cf7eb6d7c7721b7f07d92d2f64d6126f28ba63615ce23482671d6c16d` |
| Hash del informe del ejecutor | `92eb749d913f2908422f981731971cfc8be8b78dcb6fd332ba31916ca9848851` |
| Precondiciones | 20 PASS, 2 DEFERRED de Lía, 0 FAIL |
| Relectura sin cambios | PASS |
| Integridad de hashes y conteos | PASS |
| Escrituras de producción | 0 |

El hash de inventario coincide con los preflights anteriores. La producción no cambió entre auditorías.

## Identidades y estado actual

| Persona | Firebase Auth confirmado | Estado y rutas actuales | Preparación V17 |
| --- | --- | --- | --- |
| Sr. Smith | `roddysmith23@hotmail.com`, UID `iESlWpF92JXaGDoYTQ28ThWs93y1`, activo. `roddysmithceo@gmail.com` queda como correo administrativo, no como segunda cuenta Auth. | No existe `accountAccess/{uid}`. `approvedUsers/{uid}` coincide con Auth, hash `20423441769dc97a8b15310c96bd1583f4846adffb6511da3cd441e684cd74b4`. Claims actuales vacíos. | `platform_founder`, `super_admin`, `founder_unlimited`, `internal`, lifetime. Modo plataforma sin inventar una organización nueva. |
| Debby | `debbya632@gmail.com`, UID `g9e8NjJjrDS3ldvNxHLlhqvzm3E3`, activo. | No existe `accountAccess/{uid}`. `approvedUsers/{uid}` tiene correo histórico inconsistente; hash exacto `25addd7196eb4135312d42405f4d4313c9b58fe40cec7a09c7c3d0bf8350fe0f`. Claims actuales vacíos. | `platform_founder`, `founder_admin`, `founder_unlimited`, `internal`, lifetime. La membresía `co_owner` queda diferida hasta identificar una organización autorizada; no se inventa ni se transfiere una. |
| Shary | `shary10mmvv@gmail.com`, UID `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`, activo. | `accountAccess/{uid}` está en `paid_base/base`, revisión 1, hash `f39e08da6af4109983bdda059c3e2458c4e39953fc1374e93b42e4ef7b45450c`. No existe estado V10 canónico ni datos comerciales históricos exactos. | `customer`, membership `owner`, `pro_lifetime`, `lifetime`, `founding_customer`. Los campos trial heredados se conservan, pero no participan en la precedencia de acceso. |
| Lía | No existe Auth para `liavero_zambrano@hotmail.com`; no existe UID confirmado. | Sin `accountAccess`, entitlement, membership ni organización canónica. | Solicitud pendiente y código aleatorio de un uso guardado solo como SHA-256. No se crea contraseña, UID ni organización antes de autenticar. |

## Tenants protegidos

| Ruta | Clasificación | Hash y conteos |
| --- | --- | --- |
| `businesses/cPy0PqLSHGO6Ei3xlRc2DHufQ5B3/state/main` | `internal_demo` / `sales_sandbox`. Contiene “Lía Perfumería” y “PEPTIDOS”. No transferir ni borrar. Una importación futura solo podrá considerar branding, catálogo y configuración; nunca ventas, caja, movimientos o auditorías. | `9f7dad5afe6bdd444bdcf3da7f1b57bfa088550fd99cd1e70b566740912f7a80`; 2 negocios, 2 productos, 3 ventas, 7 movimientos, 1 reporte, 2 trabajadores, 3 plantillas, 1 eliminado y 8 logs. |
| `businesses/demo-click360/state/main` | `cross_tenant_suspect` / `blocked_demo`; intocable. | `bf1c622c0cd91d03489b0c2d9807343f5baaa6efc794cf8563ac6c7cb0e3c6a0`; 2 negocios, 4 productos, 4 ventas y 6 movimientos. |
| `businesses/g9e8NjJjrDS3ldvNxHLlhqvzm3E3/state/main` | Tenant V10 de Debby, solo referencia de integridad. | `f89c160d3a74a0235ccabcbf47ac3766b66afdd769f40add66d64680e5bd2ee9`; 2 negocios, 2 productos, 7 ventas, 19 movimientos, 2 reportes, 1 caja y 6 logs. |
| `businesses/iESlWpF92JXaGDoYTQ28ThWs93y1/state/main` | Tenant V10 de Sr. Smith, solo referencia de integridad. | `1428ae7f06ac4c5b566e95342a74e711ded2a614066a6fd8cb2d36ee86944d5f`; 1 negocio, 1 producto, 1 venta, 3 movimientos, 1 plantilla y 5 logs. |

Todos se releyeron con hash y conteos idénticos. El ejecutor rechaza cualquier acción dirigida a `businesses/*/state/main`.

## Efectos exactos propuestos

Orden obligatorio: **Shary -> Sr. Smith -> Debby -> Lía**.

### Catálogo

- Crear `plans/founder_unlimited`, `plans/pro` y `plans/base` únicamente si están ausentes.
- Cada creación usa precondición create-only. Los hashes deseados son `27cdc241...`, `9d4304d3...` y `9bfc1e75...` respectivamente.

### Shary

- Crear solo si faltan: `users/{uid}`, `entitlements/{uid}`, `organizations/org_6ac74bfaacbf493f2987709b`, membership owner, índice `userOrganizations` y `subscriptions/org_6ac74bfaacbf493f2987709b`.
- Hacer merge de `accountAccess/{uid}` solo si el documento completo sigue teniendo hash `f39e08da...`.
- Mantener `businessId` de compatibilidad y no crear `businesses/{uid}/state/main`.
- Cambiar el acceso efectivo a PRO Lifetime, revisión 2, `expiresAt: null`, y refrescar claims solo después de la transacción.

### Sr. Smith

- Crear solo si faltan `users/{uid}`, `entitlements/{uid}` y `accountAccess/{uid}`.
- Guardar `roddysmith23@hotmail.com` como identidad Auth y `roddysmithceo@gmail.com` solo como metadato administrativo.
- No crear una segunda cuenta Auth y no modificar su `approvedUsers` ni su estado V10.
- Refrescar claims Founder después de la transacción.

### Debby

- Crear solo si faltan `users/{uid}`, `entitlements/{uid}` y `accountAccess/{uid}`.
- Corregir `approvedUsers/{uid}` mediante merge transaccional solo si el hash completo sigue siendo `25addd719...`.
- El merge cambia exclusivamente `email` a `debbya632@gmail.com` y `updatedAt` a tiempo de servidor; conserva nombre, rol, owner, estado y cualquier otro campo.
- No crear una membership `co_owner` sin una organización autorizada y no tocar su estado V10.

### Lía

- Mantener dos acciones diferidas: `activationRequests/{requestId}` y `activationCodes/{codeHash}`.
- El código tendrá entropía criptográfica, expiración, un solo uso y almacenamiento hash-only.
- Cuando Auth entregue el UID real se repite auditoría, se liga el código a ese UID y solo entonces se prepara organización, membership owner, entitlement y subscription PRO Lifetime.
- El sandbox “Lía Perfumería” no se copia ni se transfiere automáticamente.

## Backups y precondiciones

No se creó un backup V17 en producción porque esta fase prohíbe escrituras. El dry-run preparó el manifiesto que deberá materializarse en `adminBackups/{backupId}` después de una autorización futura y antes de la primera mutación.

El backup deberá contener:

- identidad Auth exacta y custom claims completos;
- valor completo, hash y `updateTime` de cada documento objetivo;
- hashes y conteos de los cuatro tenants protegidos;
- hashes de auditoría, inventario, plan y manifiesto;
- actor, reautenticación, motivo y aprobación del owner;
- rutas creadas/modificadas y rollback por acción.

También deberán crearse `provisioningJobs/{jobId}` y `auditLogs/{auditId}`. Esas rutas son destinos futuros, no documentos creados en este preflight. El backup histórico de Shary `adminBackups/iPNGKV3QHLNww0Tkq4uJ` se conserva, pero no sustituye un backup V17 fresco.

Precondiciones obligatorias:

- proyecto exacto `click-360`;
- plan hash `e95c0381...` sin alteraciones;
- identidad Auth UID/correo exacta y cuenta activa;
- actor super admin reautenticado, correo Auth y correo administrativo coincidentes, motivo no vacío;
- create-only para documentos ausentes;
- hash completo coincidente para cada merge;
- allowlist de rutas V17 y alcance UID/organización por sujeto;
- backup creado, releído y verificado antes de escribir;
- hashes y conteos de tenants intactos antes y después;
- abortar el sujeto completo ante cualquier diferencia.

## Comandos reproducibles

Auditoría real de solo lectura:

```bash
node scripts/audit-v17-access.mjs \
  --project click-360 \
  --out artifacts/v17-confirmed-identities-audit-2026-07-16
```

Plan determinista:

```bash
node scripts/plan-v17-access.mjs \
  --audit artifacts/v17-confirmed-identities-audit-2026-07-16/CLICK360_V17_AUDIT.json \
  --out artifacts/v17-confirmed-identities-plan-2026-07-16
```

Ejecutor administrativo bloqueado en dry-run:

```bash
node scripts/admin-access-v17.mjs \
  --command prepare \
  --project click-360 \
  --plan artifacts/v17-confirmed-identities-plan-2026-07-16/CLICK360_V17_DRY_RUN.json \
  --actor-uid iESlWpF92JXaGDoYTQ28ThWs93y1 \
  --actor-auth-email roddysmith23@hotmail.com \
  --actor-admin-email roddysmithceo@gmail.com \
  --reason "V17 confirmed identities preflight" \
  --reauthenticated \
  --out artifacts/v17-confirmed-identities-executor-2026-07-16
```

No existe un comando de aplicación habilitado. `--command apply`, `--apply`, `--write` y `--migrate` fallan con `V17_APPLY_NOT_AUTHORIZED`.

## Rollback preparado

- Documento creado: eliminarlo solo si la auditoría demuestra que lo creó el mismo job y su hash actual sigue igual al hash posterior registrado.
- Documento fusionado: restaurar el documento completo del backup únicamente si el hash actual aún coincide con el hash posterior del job.
- Claims: restaurar exactamente el backup de claims solo si su hash posterior no cambió.
- Activación diferida: no hay rollback mientras no exista documento.
- Cualquier discrepancia: detener el sujeto, no avanzar al siguiente, recalcular los cuatro tenants y registrar `ROLLED_BACK` o `MANUAL_REVIEW`.

Nunca se restaura o copia un snapshot comercial entre UIDs.

## Riesgos residuales

- La organización donde Debby será `co_owner` aún no fue identificada. Esto no bloquea su grant de plataforma, pero sí bloquea esa membership específica.
- Lía no puede provisionarse hasta crear Auth y validar el código con su UID real.
- El smoke autenticado, logout/login y segundo dispositivo solo pueden ejecutarse después de un apply aprobado.
- Las Rules V17 candidatas siguen sin desplegar y Hosting no fue publicado.

## Estado de entrega

- Veredicto técnico: **APPLY**.
- Ejecución de producción: **NO AUTORIZADA Y NO REALIZADA**.
- PR #14: **Draft**.
- Merge: **no realizado**.
- Rules/Hosting: **no desplegados**.
- Datos comerciales y tenants: **intactos**.
