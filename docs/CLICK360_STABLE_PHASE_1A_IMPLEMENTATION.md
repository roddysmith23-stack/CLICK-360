# CLICK 360 STABLE - Fase 1A

Fecha de corte: 2026-07-16

Versión: `0.1.0-staging.1`

Proyecto autorizado: `click360-staging-7620168025`

Producción: fuera de alcance y sin cambios

## Objetivo

Demostrar en un entorno aislado el flujo:

```text
Firebase Auth staging
  -> Cloud Run
  -> POST /v1/session/bootstrap
  -> acceso sintético de solo lectura
  -> decisión nueva + decisión legacy sintética
  -> comparación shadow
  -> observabilidad sanitizada
  -> cero escrituras
```

## Recursos creados

| Recurso | Identificador | Estado |
|---|---|---|
| Google Cloud/Firebase | `click360-staging-7620168025` | ACTIVE |
| Project number | `471043029016` | ACTIVE |
| Firebase web app | `1:471043029016:web:556e46fb8fdd48b95eeb6d` | ACTIVE |
| Firestore | `(default)`, Native, `nam5` | READY |
| Firebase Hosting site | `click360-staging-7620168025` | reservado, sin deploy |
| Runtime service account | `click360-api-runtime-stg@...` | ACTIVE |
| Deployer service account | `click360-deployer-stg@...` | ACTIVE |
| Workload Identity Pool | `github-click360-staging` | ACTIVE |
| OIDC provider | `github-click360-provider` | ACTIVE |
| GitHub environment | `staging`, branch permitida `develop` | ACTIVE |

No se creó ninguna llave JSON.

## Recursos bloqueados por facturación

El proyecto no tiene una cuenta de facturación asociada y la identidad activa no
puede listar ninguna cuenta disponible. Google rechazó con
`UREQ_PROJECT_BILLING_NOT_FOUND` o `BILLING_NOT_ENABLED`:

- Cloud Run API y servicio `click360-api-staging`;
- Artifact Registry;
- Secret Manager;
- presupuesto y alertas USD 10/25/40/50;
- retención personalizada de Logging a 14 días;
- inicialización administrada de Firebase Auth/Identity Platform.

No se sustituyeron estos servicios por mecanismos inseguros. En particular, no se
guardó el secreto HMAC en GitHub ni se desplegó desde el equipo local.

## IAM aplicado

### Runtime

`click360-api-runtime-stg@click360-staging-7620168025.iam.gserviceaccount.com`

- `roles/datastore.viewer`;
- `roles/logging.logWriter`.

No tiene roles de escritura Firestore, Auth Admin, Project Editor, Owner, Run Admin
ni acceso a producción.

### Deployer

`click360-deployer-stg@click360-staging-7620168025.iam.gserviceaccount.com`

- `roles/run.admin` en staging;
- `roles/artifactregistry.writer` en staging;
- `roles/firebasehosting.admin` en staging;
- `roles/serviceusage.serviceUsageConsumer` en staging;
- `roles/iam.serviceAccountUser` únicamente sobre el runtime staging.

OIDC está restringido simultáneamente a `roddysmith23-stack/CLICK-360` y a
`refs/heads/develop`. El environment de GitHub también acepta despliegues
únicamente desde `develop`.

## Backend shadow

### Contratos

- `GET /health/live`: confirma proceso vivo.
- `GET /health/ready`: lee `stagingHealth/bootstrap` sin escribir.
- `GET /health/version`: expone SemVer, SHA, entorno, build time y shadow mode.
- `POST /v1/session/bootstrap`: exige Bearer token Firebase staging y body vacío.

El cliente no puede suministrar UID. El backend lo extrae del token verificado.
Los resultados posibles son `MATCH`, `DIFFERENCE`, `INSUFFICIENT_DATA`,
`LEGACY_AMBIGUOUS`, `BLOCKED` y `ERROR`.

### Colecciones sintéticas

- `stagingConfig/featureFlags`;
- `stagingHealth/bootstrap`;
- `stagingAccountAccess/{qaUid}`;
- `stagingLegacyAccess/{qaUid}`;
- `stagingOrganizations/{qaOrganizationId}`.

No existen referencias a `businesses`, `state/main`, `accountAccess` o
`approvedUsers` en el backend.

## Feature flags

| Flag | Valor inicial | Autoridad |
|---|---:|---|
| `bootstrap_shadow` | `true` | Backend |
| `observability_v1` | `true` | Backend |
| `maintenance_mode` | `false` | Backend |

`bootstrap_shadow=false` produce `BLOCKED` y funciona como kill switch. Ningún
flag concede un plan, una organización o permisos.

## Fixtures y matriz

Se sembraron 11 perfiles sintéticos: Founder, Founder Admin, Base, PRO,
PRO Lifetime, trial activo, trial vencido, suspendido, sin organización,
organización activa y legacy ambiguo.

| Perfil | Esperado |
|---|---|
| Founder | MATCH |
| Founder Admin | MATCH |
| Base | MATCH |
| PRO | MATCH |
| PRO Lifetime | MATCH |
| Trial activo | MATCH |
| Trial vencido | DIFFERENCE |
| Suspendido | MATCH |
| Sin organización | INSUFFICIENT_DATA |
| Organización activa | MATCH |
| Legacy ambiguo | LEGACY_AMBIGUOUS |

Verificación remota:

- perfiles: `11`;
- hash esperado: `a4dbc8165bfba4ddcafd907e65679fd93c2ca550a2c1762ac574667b64843a96`;
- hash observado: `a4dbc8165bfba4ddcafd907e65679fd93c2ca550a2c1762ac574667b64843a96`.

## Observabilidad

Los eventos del bootstrap incluyen únicamente request ID, timestamp, entorno,
versión, SHA, resultado, latencia, UID seudonimizado y tipo QA. Los errores se
sanitizan y eliminan correos. El logger no registra headers ni payloads.

La retención objetivo es 14 días. Su aplicación remota queda bloqueada hasta que
se habilite facturación; mientras tanto rige la retención predeterminada del
proyecto.

## CI/CD

El workflow `staging-phase1a.yml`:

1. ejecuta lint, typecheck, unit, matriz shadow, build y E2E responsive;
2. audita dependencias y secretos;
3. impide referencias de despliegue al proyecto de producción;
4. autentica con WIF, sin llaves;
5. construye una imagen inmutable;
6. despliega únicamente ante push a `develop`;
7. comprueba health;
8. genera manifest;
9. emite exclusivamente `GO` o `NO_GO`.

No existe workflow de producción.

## Release Manager

El gate exige SHA completo, SemVer, image digest, rollback digest, health READY,
flags exactos, seis evidencias PASS, cero escrituras shadow y proyecto staging.
Cualquier evidencia ausente produce `NO_GO`.

## Rollback

El script `staging/scripts/rollback-staging.sh` rechaza cualquier proyecto que no
sea `click360-staging-7620168025`, exige digest inmutable y restaura Cloud Run y
Hosting desde el canal `phase1a-rollback`. La prueba A -> B -> A no puede ejecutarse
hasta habilitar Cloud Run y realizar el primer deploy mediante CI.

## Pruebas ejecutadas

- 17 pruebas backend: PASS;
- 6 pruebas Release Manager: PASS;
- 4 E2E Chromium, escritorio y móvil: PASS;
- build web: PASS;
- build TypeScript backend: PASS;
- auditoría de dependencias backend/web: 0 vulnerabilidades tras override seguro;
- guard de proyecto staging: PASS;
- Firestore real staging `/health/ready`: READY;
- búsqueda estática de escrituras en backend: 0 llamadas Firestore de escritura.

## Identidad QA

No se creó una identidad Google improvisada ni se usó un correo personal. El smoke
Google real permanece pendiente de una identidad QA controlada. Los E2E actuales
usan fixtures deterministas y no dependen de UIDs de producción.

## Costos

- gasto observado con facturación desactivada: USD 0;
- Firestore y Hosting permanecen dentro de recursos gratuitos actuales;
- no existe todavía una medición válida de Cloud Run, Artifact Registry, Secret
  Manager o Logging personalizado;
- el presupuesto USD 50 y sus alertas no se pueden crear sin una cuenta de
  facturación.

## Veredicto actual

`NO_GO`

La implementación local y Firestore staging son correctos, pero no se puede emitir
`READY_FOR_STAGING_SHADOW` sin Cloud Run, Artifact Registry, Secret Manager,
Hosting desplegado por CI, Auth Google QA, rollback real y presupuesto activo.

## Condiciones para desbloquear

1. Asociar una cuenta de facturación autorizada al proyecto staging.
2. Mantener límite aprobado de USD 50 y crear alertas 10/25/40/50.
3. Proveer o crear una identidad Google QA dedicada, no personal.
4. Ejecutar el workflow desde `develop`.
5. Demostrar deploy A, deploy B fallido y rollback a A.
6. Completar smoke Google y cambiar E2E de `PENDING` a `PASS`.

Hasta entonces no se autoriza producción ni Fase 1B.
