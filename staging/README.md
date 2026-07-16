# CLICK 360 STABLE - Staging Phase 1A

Entorno mínimo de bootstrap shadow. Este directorio está fijado al proyecto
`click360-staging-7620168025` y no contiene rutas ni credenciales de producción.

## Componentes

- `backend/`: API Fastify de solo lectura, health checks y comparación shadow.
- `web/`: interfaz QA con Firebase Auth de staging.
- `fixtures/`: perfiles completamente sintéticos.
- `scripts/`: guardas de entorno, manifest, Release Manager y rollback.
- `firebase.staging.json`: Hosting exclusivo del sitio staging.

## Validación local

```bash
npm ci --prefix staging/backend
npm ci --prefix staging/web
npm --prefix staging/web exec playwright install chromium
npm run qa:staging
```

Para verificar los fixtures remotos con ADC autorizado en staging:

```bash
npm --prefix staging/backend run verify:fixtures
```

## Invariantes

- El UID se obtiene exclusivamente del token Firebase verificado.
- El body de bootstrap debe estar vacío.
- El runtime solo tiene `roles/datastore.viewer` y escritura de logs.
- El backend no expone métodos de escritura Firestore.
- Las colecciones comerciales y `businesses/*/state/main` no se leen ni escriben.
- `bootstrap_shadow` tiene kill switch y nunca concede permisos.
- El resultado máximo de esta fase es `READY_FOR_STAGING_SHADOW`.
