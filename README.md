# CLICK 360

PWA de inventario, ventas, caja, reportes, facturas de proveedores y etiquetas QR para negocios.

## Acceso y datos

- Inicio de sesión: Google Firebase Auth.
- Autorización: `approvedUsers/{uid}` y, para trabajadores, invitación activa en `approvedUsersByEmail/{email}`.
- Tenant remoto: `businesses/{ownerId}/state/main` con `schemaVersion: 10` e identidad canónica.
- Caché local: `CLICK360_STATE:{tenantKey}`. La sesión de interfaz y la aprobación offline están separadas por UID.
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

## Estado P0

El aislamiento por cuenta, bloqueo legacy, migraciones verificadas, caché offline, perfiles, almacenamiento, concurrencia y reglas tienen cobertura automatizada. La decisión de producción sigue en **NO-GO** por el modelo de snapshot único: un trabajador con acceso al tenant puede escribir el documento completo y Firestore Rules no puede imponer permisos por módulo ni un ledger financiero inmutable dentro de ese mapa.

El PR P0 debe permanecer Draft. No desplegar reglas, publicar Pages ni hacer merge sin autorización y sin completar la arquitectura por entidades descrita en `docs/CLICK360_ARCHITECTURE.md`.
