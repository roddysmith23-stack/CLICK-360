# CLICK 360 V17 - Apply controlado de Shary

## Alcance

Esta ruta administrativa acepta exclusivamente:

- proyecto `click-360`;
- sujeto `shary`;
- UID `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`;
- correo `shary10mmvv@gmail.com`;
- organización `org_6ac74bfaacbf493f2987709b`;
- plan hash `e95c038115be1b7571674ca9e3f3a33782cc2cf3ec2cf91b1ed8214d9a62e9ef`;
- actor `iESlWpF92JXaGDoYTQ28ThWs93y1`, con correo Auth `roddysmith23@hotmail.com` y correo administrativo `roddysmithceo@gmail.com`.

El ejecutor consulta Google OpenID `userinfo` con el mismo ADC que usará Admin SDK y aborta si el principal verificado no es `roddysmithceo@gmail.com`. El proyecto, el actor, la allowlist, los hashes de acciones y los identificadores de artefactos se vuelven a validar dentro del motor, no solo en el CLI.

No contiene rutas para Smith, Debby, Lía, catálogo de planes ni `businesses/*/state/main`.

## Artefactos idempotentes

- `adminBackups/v17-shary-backup-ebfec0fc6a8c6b41bb1241dd`
- `provisioningJobs/v17-shary-job-ebfec0fc6a8c6b41bb1241dd`
- `auditLogs/v17-shary-audit-ebfec0fc6a8c6b41bb1241dd`

El segundo run detecta el job `COMPLETE`, verifica todos los hashes y devuelve `NOOP_VERIFIED` sin crear otro backup, job, audit log, organización o membership.

## Auditoría fresca

Antes de preview y apply:

```bash
node scripts/audit-v17-access.mjs \
  --project click-360 \
  --out artifacts/v17-shary-fresh-audit
```

El ejecutor exige una auditoría menor a diez minutos, de solo lectura y con relectura íntegra. Antes del primer apply, su inventario debe coincidir exactamente con:

`1f3cbefb5e53deac093ff9c756c3555900be9ef40f3aa8916eff72f308c16228`

En un segundo run, reconstruye ese inventario reemplazando únicamente las rutas autorizadas con sus valores del backup. Cualquier cambio no autorizado mantiene el resultado bloqueado.

El backup también relee y conserva el estado ausente de `businesses/3UTjgHd1QNSvqlcXNKQ6tL79X7u2/state/main` y los dos rastros administrativos históricos identificados por la auditoría aprobada. Son rutas de respaldo, nunca rutas de escritura.

## Comando

Primero se ejecuta con `--command preview`. Después de revisar el diff y con CI verde, se sustituye únicamente ese valor por `--command apply`:

```bash
npm run admin:v17:shary -- \
  --command preview \
  --project click-360 \
  --subject shary \
  --uid 3UTjgHd1QNSvqlcXNKQ6tL79X7u2 \
  --email shary10mmvv@gmail.com \
  --organization-id org_6ac74bfaacbf493f2987709b \
  --plan pro \
  --plan-code pro_lifetime \
  --billing-status lifetime \
  --approved-plan-hash e95c038115be1b7571674ca9e3f3a33782cc2cf3ec2cf91b1ed8214d9a62e9ef \
  --expected-audit-hash 08602dcc7e968c4df9c51185a412bc5725bd61280c36c35313b2968dffdae1a2 \
  --expected-inventory-hash 1f3cbefb5e53deac093ff9c756c3555900be9ef40f3aa8916eff72f308c16228 \
  --expected-account-hash f39e08da6af4109983bdda059c3e2458c4e39953fc1374e93b42e4ef7b45450c \
  --expected-claims-hash 44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a \
  --expected-tenant-manifest-hash 660694bedf568e52c763c20fef148839817604c112c8d2f9ba922b720c315dee \
  --actor-uid iESlWpF92JXaGDoYTQ28ThWs93y1 \
  --actor-auth-email roddysmith23@hotmail.com \
  --actor-admin-email roddysmithceo@gmail.com \
  --reason "Autorización controlada V17 para Shary" \
  --reauthenticated \
  --reauthenticated-at <ISO-UTC-MENOR-A-10-MINUTOS> \
  --confirm "APPLY:CLICK360:V17:SHARY:3UTjgHd1QNSvqlcXNKQ6tL79X7u2:e95c038115be1b7571674ca9e3f3a33782cc2cf3ec2cf91b1ed8214d9a62e9ef" \
  --plan-file artifacts/v17-confirmed-identities-plan-2026-07-16/CLICK360_V17_DRY_RUN.json \
  --fresh-audit artifacts/v17-shary-fresh-audit/CLICK360_V17_AUDIT.json \
  --out artifacts/v17-shary-execution
```

## Diff de escrituras

El primer apply puede efectuar como máximo 13 mutaciones:

| Orden | Ruta | Operación |
| ---: | --- | --- |
| 1 | `adminBackups/v17-shary-backup-ebfec0fc6a8c6b41bb1241dd` | create-only y relectura obligatoria |
| 2 | `users/3UTjgHd1QNSvqlcXNKQ6tL79X7u2` | create-only |
| 3 | `entitlements/3UTjgHd1QNSvqlcXNKQ6tL79X7u2` | create-only |
| 4 | `organizations/org_6ac74bfaacbf493f2987709b` | create-only |
| 5 | `organizations/org_6ac74bfaacbf493f2987709b/members/3UTjgHd1QNSvqlcXNKQ6tL79X7u2` | create-only owner |
| 6 | `userOrganizations/3UTjgHd1QNSvqlcXNKQ6tL79X7u2/organizations/org_6ac74bfaacbf493f2987709b` | create-only |
| 7 | `subscriptions/org_6ac74bfaacbf493f2987709b` | create-only PRO Lifetime |
| 8 | `accountAccess/3UTjgHd1QNSvqlcXNKQ6tL79X7u2` | merge solo si el hash completo sigue siendo `f39e08da...` |
| 9 | `provisioningJobs/v17-shary-job-ebfec0fc6a8c6b41bb1241dd` | create-only en la misma transacción |
| 10 | `auditLogs/v17-shary-audit-ebfec0fc6a8c6b41bb1241dd` | create-only en la misma transacción |
| 11 | Auth custom claims de Shary | merge conservando claims no relacionados |
| 12 | provisioning job | finalizar con hashes y `READY` |
| 13 | audit log | finalizar con hashes y `READY` |

`accountAccess` conserva `trialDays`, `trialStartedAt`, nombre, foto y campos no mencionados. El plan lifetime domina esos campos. No se crea información comercial ni un snapshot V10.

## Rollback

El rollback exige la confirmación literal separada incluida en el código. Solo restaura si cada ruta sigue coincidiendo con el resultado del job:

- documentos create-only: se eliminan solo si aún contienen el valor creado por el job;
- `accountAccess`: se restaura completo desde el backup verificado;
- custom claims: se restauran exactamente desde el backup si no fueron modificados por otro actor;
- job y audit log: quedan en `ROLLED_BACK` como evidencia;
- los cuatro tenants protegidos se vuelven a verificar y nunca se escriben.

Este rollback se ejecuta en Auth/Firestore Emulator durante CI. No se prueba destruyendo datos de producción.
