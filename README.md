# CLICK 360 V16.1.1

PWA comercial de inventario, ventas, caja, CRM, reportes, trabajadores, apartados y etiquetas QR para negocios.

## Acceso, prueba y datos

- Inicio de sesión: Google Firebase Auth.
- Fundadores: `approvedUsers/{uid}`. Trabajadores V16: invitación con token hash, membresía tenant y permisos por módulo/acción.
- Usuarios nuevos: una sola prueba gratuita de 7 días en `accountAccess/{uid}`. El vencimiento usa tiempo de Firestore; al vencer los datos quedan disponibles en modo lectura.
- Activación manual: la consola IAM `npm run admin:v16` crea respaldo, exige UID/email/hash/confirmación y registra antes/después. El cliente nunca puede concederse un plan.
- Tenant remoto: `businesses/{ownerId}/state/main` con `schemaVersion: 10` e identidad canónica.
- Caché V16: estado, sesión, perfil, aprobación e IndexedDB separados por aplicación + UID + tenant.
- Al iniciar, un documento remoto V10 coherente prevalece sobre marcadores legacy locales del mismo tenant. Los marcadores ambiguos y los de otras cuentas nunca se borran ni desbloquean datos.
- No existen usuarios ni contraseñas demo en el cliente.

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

## Administración segura

La consola es solo para una identidad IAM autorizada y está fijada al proyecto `click-360`. Primero se ejecuta en dry-run; `--apply` exige el hash recién leído y la frase exacta mostrada por la herramienta. Las colecciones `adminBackups` y `adminAuditLogs` están negadas al cliente.

## Estado V16.1.1

El hotfix incorpora aislamiento por cuenta, remoto V10 autoritativo, modo `ONLINE_ONLY_SAFE`, trial de siete días por tiempo de servidor, planes, CRM, recordatorios, PWA, IVA congelado por venta, apartados con términos, cierres auditables, trabajadores con permisos, flujos públicos independientes, editor QR táctil y protección temprana ante errores de código externo o caché obsoleta. La evidencia vigente está en `docs/CLICK360_V16_1_1_HOTFIX_REPORT.md`, `docs/CLICK360_V16_1_RELEASE_REPORT.md` y `docs/CLICK360_V16_1_PUBLIC_FLOWS_QA.md`.
