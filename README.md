# CLICK 360

PWA de inventario, ventas, caja, reportes, facturas de proveedores y etiquetas QR para negocios.

## Acceso, prueba y datos

- Inicio de sesión: Google Firebase Auth.
- Fundadores y trabajadores: `approvedUsers/{uid}` y, para trabajadores, invitación activa en `approvedUsersByEmail/{email}`.
- Usuarios nuevos: una sola prueba gratuita de 7 días en `accountAccess/{uid}`. El vencimiento usa tiempo de Firestore; al vencer los datos quedan disponibles en modo lectura.
- Activación manual: un administrador puede cambiar `accountAccess/{uid}` a `status: "active"` y `plan: "normal"`, `"pro"` o `"founder"`. El cliente no puede concederse un plan.
- Tenant remoto: `businesses/{ownerId}/state/main` con `schemaVersion: 10` e identidad canónica.
- Caché local: `CLICK360_STATE:{tenantKey}`. La sesión de interfaz, el perfil y la aprobación offline están separadas por UID.
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

## Estado de lanzamiento

El candidato MVP incorpora aislamiento por cuenta, reconciliación V10, prueba gratuita controlada por servidor, modo lectura posterior al vencimiento, CRM, recordatorios, PWA, cierres de caja, trabajadores y sincronización multidispositivo. La guía operativa y la evidencia de QA están en `docs/CLICK360_MVP_LAUNCH_READINESS.md`.

La arquitectura modular por entidades y un ledger financiero inmutable siguen como P1 para endurecer permisos de trabajadores. No bloquean la beta privada porque los accesos de trabajadores continúan restringidos por reglas y por interfaz, pero deben completarse antes de una expansión de alto riesgo.
