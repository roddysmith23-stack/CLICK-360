# CLICK 360 V17 - Runbook de preflight y rollback

## Estado actual

La rama solo permite auditoría y preparación. Los tres comandos V17 rechazan `--apply`, `--write` y `--migrate`; `admin-access-v17.mjs` acepta exclusivamente `--command prepare`.

Candados vigentes:

- proyecto único `click-360`;
- PR #14 Draft;
- cero merge, Rules o Hosting;
- cero escrituras a Auth/Firestore;
- cero acciones sobre `businesses/*/state/main`;
- orden fijo Shary, Sr. Smith, Debby y Lía.

## Auditoría

```bash
node scripts/audit-v17-access.mjs \
  --project click-360 \
  --out artifacts/v17-access-audit-YYYY-MM-DD
```

Un resultado válido exige `FIREBASE_READ_ONLY`, `productionWriteOperations: 0`, `allReadbacksUnchanged: true` y el proyecto exacto.

## Plan

```bash
node scripts/plan-v17-access.mjs \
  --audit artifacts/v17-access-audit-YYYY-MM-DD/CLICK360_V17_AUDIT.json \
  --out artifacts/v17-access-plan-YYYY-MM-DD
```

El plan queda ligado a `auditReportHash`, `auditInventoryHash` y `planHash`. Cualquier cambio invalida la aprobación previa.

## Ejecutor administrativo dry-run

```bash
npm run admin:v17 -- \
  --command prepare \
  --project click-360 \
  --plan artifacts/v17-access-plan-YYYY-MM-DD/CLICK360_V17_DRY_RUN.json \
  --actor-uid iESlWpF92JXaGDoYTQ28ThWs93y1 \
  --actor-auth-email roddysmith23@hotmail.com \
  --actor-admin-email roddysmithceo@gmail.com \
  --reason "motivo aprobado" \
  --reauthenticated \
  --out artifacts/v17-access-executor-YYYY-MM-DD
```

El ejecutor verifica:

- hash y estado bloqueado del plan;
- actor super admin, ambas direcciones de correo, motivo y reautenticación;
- identidad Auth de cada UID;
- hash/updateTime de documentos existentes y ausencia de documentos create-only;
- allowlist de rutas y alcance por UID/organización;
- hashes y conteos de todos los tenants protegidos;
- backup y rollback previstos por acción.

El resultado siempre mantiene `applyEnabled: false` y `productionWriteOperations: 0`.

## QA

```bash
npm run qa:v17
npm run qa:rules
npm run qa
```

## Aplicación futura

No hay comando de aplicación en esta fase. Cualquier intento falla con `V17_APPLY_NOT_AUTHORIZED`.

Después de una autorización expresa deberá implementarse y revisarse por separado una ruta de apply que consuma el plan aprobado y mantenga estas garantías:

1. Repetir la auditoría y aceptar únicamente hashes iguales o diferencias revisadas.
2. Crear y releer `adminBackups/{backupId}` antes de la primera escritura.
3. Crear `provisioningJobs/{jobId}` con clave idempotente.
4. Aplicar un sujeto a la vez en el orden Shary, Smith, Debby, Lía.
5. Usar create-only para ausentes y hash precondition para merges.
6. Nunca escribir `businesses/*/state/main`.
7. Refrescar claims después de la transacción, preservando claims no relacionados.
8. Ejecutar `bootstrapSession() == READY`, login/logout y segundo dispositivo.
9. Recalcular todos los hashes y conteos.
10. Crear `auditLogs/{auditId}` y cerrar el job.

Debby recibe acceso de plataforma primero. Su membership `co_owner` solo se crea cuando exista una organización explícitamente autorizada. Lía solo entra en esta secuencia cuando Auth entregue su UID real.

## Rollback

Ante cualquier diferencia de identidad, hash, conteo, alcance o claims:

1. Detener el job y no avanzar al siguiente sujeto.
2. No tocar tenants ajenos, el sandbox interno ni `demo-click360`.
3. Restaurar documentos fusionados solo desde el backup completo y con precondición sobre el hash posterior.
4. Eliminar documentos nuevos solo si el mismo job los creó y siguen sin cambios.
5. Restaurar los custom claims exactos del backup si su estado posterior no cambió.
6. Recalcular los cuatro hashes V10 protegidos.
7. Registrar `ROLLED_BACK` o `MANUAL_REVIEW` en la auditoría.

Nunca se copia o restaura un snapshot comercial de un UID sobre otro UID.
