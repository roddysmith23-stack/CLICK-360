# CLICK 360 V16.2

PWA comercial de inventario, ventas, caja, CRM, reportes, apartados y etiquetas QR para negocios. El acceso operativo de trabajadores está pausado en este candidato hasta completar su arquitectura modular.

## Acceso, prueba y datos

- Inicio de sesión: Google Firebase Auth.
- Resolución UID-first: `accountAccess/{uid}`, `approvedUsers/{uid}`, compatibilidad histórica validada por UID, invitación explícita y, únicamente al final, trial para una identidad realmente nueva.
- Fundadores y cuentas pagadas conservan su acceso; nunca se degradan automáticamente a trial.
- Usuarios nuevos: una sola prueba gratuita de 7 periodos exactos de 24 horas en `accountAccess/{uid}`. El cálculo normaliza Timestamp, segundos, milisegundos y microsegundos, y usa tiempo confiable del servidor; al vencer, los datos quedan en modo lectura.
- Activación manual: la consola IAM `npm run admin:v16` crea respaldo, exige UID/email/hash/confirmación y registra antes/después. El cliente nunca puede concederse un plan.
- Tenant remoto: `businesses/{ownerId}/state/main` con `schemaVersion: 10` e identidad canónica.
- Caché V16: estado, sesión, perfil, aprobación e IndexedDB separados por aplicación + UID + tenant.
- Al iniciar, un documento remoto V10 coherente prevalece sobre marcadores legacy locales del mismo tenant. Los marcadores ambiguos y los de otras cuentas nunca se borran ni desbloquean datos.
- Si el dispositivo no admite almacenamiento local, la cuenta válida entra en `ONLINE_ONLY_SAFE`: Firestore continúa como fuente principal, la edición requiere conexión y la interfaz no promete un guardado antes de confirmarlo en la nube.
- No existen usuarios ni contraseñas demo en el cliente.

## Integridad comercial y seguridad

- Ventas, caja, inventario, restauraciones, facturas y otras mutaciones críticas esperan confirmación remota cuando hay conexión. Si la confirmación falla, se restaura el estado previo y se informa sin exponer detalles técnicos.
- Productos eliminados usan marcadores aislados por negocio para impedir que reaparezcan durante una reconciliación.
- La migración administrativa V9 -> V10 exige propietario inequívoco, dry-run, backup verificado, hash sin cambios y conteos exactos antes/después de todos los módulos comerciales conservados.
- El snapshot monolítico V10 es temporalmente **solo del propietario**. Las invitaciones pueden registrarse, pero el acceso operativo de trabajadores permanece pausado hasta separar los módulos en colecciones con permisos por registro en P1. Esta restricción evita que un trabajador lea el negocio completo.
- `demo-click360` permanece bloqueado y fuera de cualquier migración o desbloqueo automático.

## Desarrollo y QA

Requiere Node 22 para las herramientas administrativas y Java 21 para el emulador de reglas.

```bash
npm ci
npm run qa
npm run qa:rules
npm run audit:fixture
npm run migrate:fixture
npm audit --omit=dev --audit-level=moderate
```

Para abrir la PWA localmente:

```bash
python3 -m http.server 4173
```

La matriz de validación de V16.2 está en [`docs/CLICK360_V16_2_QA_CHECKLIST.md`](docs/CLICK360_V16_2_QA_CHECKLIST.md). No se debe declarar un release operativo por CI verde solamente: también exige emulador de reglas, navegadores, PWA, aislamiento A -> B -> A y smoke autenticado sin modificar datos comerciales reales.

## Administración segura

La consola es solo para una identidad IAM autorizada y está fijada al proyecto `click-360`. Primero se ejecuta en dry-run; `--apply` exige el hash recién leído y la frase exacta mostrada por la herramienta. Las colecciones `adminBackups` y `adminAuditLogs` están negadas al cliente.

## Estado V16.2 / 1.0.2-p0

V16.2 es un candidato de release con hotfix comercial `1.0.2-p0` y build `mvp-launch-v16-2-p0-r2`. Firebase Hosting (`https://click-360.web.app/`) es la única URL oficial para clientes. El código incluye aislamiento UID/tenant, remoto V10 autoritativo, `ONLINE_ONLY_SAFE`, trial exacto de siete días, migración integral, confirmación de operaciones críticas, PWA/cache renovada y protección owner-only del snapshot de trabajadores. La compatibilidad directa con M02X continúa desactivada hasta validar protocolo y hardware real.

El estado del P0 está en [`docs/CLICK360_V16_2_P0_OFFICIAL_ACCESS_MOBILE_FIX_REPORT.md`](docs/CLICK360_V16_2_P0_OFFICIAL_ACCESS_MOBILE_FIX_REPORT.md). La evidencia histórica de V16.2 se conserva en [`docs/CLICK360_V16_2_RELEASE_REPORT.md`](docs/CLICK360_V16_2_RELEASE_REPORT.md).
