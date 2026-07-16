# CLICK 360 V17 - Runbook de preflight, aplicación y rollback

## Estado actual

Esta rama es de preflight. Los comandos `audit-v17-access.mjs` y `plan-v17-access.mjs` rechazan `--apply`, `--write` y `--migrate`. No existe una ruta accidental de escritura desde estas herramientas.

## Repetir auditoría

```bash
node scripts/audit-v17-access.mjs \
  --project click-360 \
  --out artifacts/v17-access-audit-YYYY-MM-DD
```

El resultado válido debe indicar:

- `mode: FIREBASE_READ_ONLY`
- `productionWriteOperations: 0`
- `allReadbacksUnchanged: true`
- proyecto exacto `click-360`

## Repetir dry-run

```bash
node scripts/plan-v17-access.mjs \
  --audit artifacts/v17-access-audit-YYYY-MM-DD/CLICK360_V17_AUDIT.json \
  --out artifacts/v17-access-plan-YYYY-MM-DD
```

El plan queda ligado a `auditReportHash`, `auditInventoryHash` y `planHash`. Si cambia cualquiera, la aprobación anterior deja de ser válida.

## QA

```bash
npm run qa:v17
npm run qa:rules
npm run qa
```

## Aplicación futura

No hay un comando de aplicación habilitado en esta fase. `node scripts/plan-v17-access.mjs --apply ...` falla deliberadamente con `V17_APPLY_NOT_AUTHORIZED`.

Después de aprobación expresa, el comando administrativo revisado deberá consumir el JSON aprobado y exigir, como mínimo:

```text
--project click-360
--subject <smith|debby|shary|lia>
--approved-plan-hash <sha256>
--expected-audit-hash <sha256>
--expected-before-hash <sha256>
--actor-uid <uid-super-admin>
--reason <motivo-no-vacio>
--reauthenticated
--confirm APPLY:CLICK360:V17:<subject>:<planHash>
```

Orden obligatorio, un sujeto a la vez:

1. Repetir auditoría y revisar cualquier diferencia.
2. Confirmar UID y correo exactos. Para Debby, confirmar también la organización autorizada.
3. Guardar en `adminBackups/{backupId}` Auth/claims, documentos objetivo completos, hashes, conteos y manifiesto de rollback.
4. Releer el backup y comparar sus hashes antes de escribir.
5. Crear `provisioningJobs/{jobId}` con clave idempotente.
6. Ejecutar una transacción Firestore con create-only para ausentes y hash precondition para existentes.
7. No escribir `businesses/*/state/main`.
8. Refrescar claims después de la transacción.
9. Verificar `bootstrapSession() == READY` y ejecutar smoke autenticado.
10. Recalcular todos los hashes y conteos; crear `auditLogs/{auditId}`.

## Rollback

Ante cualquier diferencia de identidad, hash, conteo o claims:

1. Detener el job antes del siguiente sujeto.
2. No tocar tenants ajenos ni `demo-click360`.
3. Restaurar solo documentos incluidos en el backup verificado, con precondiciones sobre su estado actual.
4. Eliminar un documento V17 nuevo únicamente si el audit demuestra que fue creado por ese mismo job y sigue sin cambios.
5. Restaurar los custom claims anteriores sin borrar claims no relacionados.
6. Recalcular los cuatro hashes V10 protegidos.
7. Registrar el rollback en `auditLogs` y dejar el job en `ROLLED_BACK` o `MANUAL_REVIEW`.

Nunca se restaura un snapshot comercial de un UID sobre otro UID.
