# Cloud Safety — certificación previa a cualquier decisión de facturación

Producción no se modifica en esta fase. #94 y #95 permanecen separados; ningún gate DEV equivale a cutover.

## Por qué existe el verificador

Firestore Rules sí dispone de `hashing.sha256`; no se afirma lo contrario. Pero una autorización de escritura tiene límites de acceso a documentos y expresiones. No es un proceso de reconstrucción que lea hasta 96 partes, decodifique el envelope, restaure las posiciones de filas, interprete JSON, canonicalice todo el estado y compruebe identidad, relaciones de negocio, revisiones y outbox antes de escribir un recibo fiable.

Fuentes primarias: [hashing](https://firebase.google.com/docs/reference/rules/rules.hashing), [límites de Rules](https://firebase.google.com/docs/firestore/security/rules-structure#security_rule_limits), [despliegue de Functions](https://firebase.google.com/docs/functions/get-started).

Permitir que el cliente marque COMPLETE por haber subido partes trasladaría al dispositivo la autoridad que se intenta verificar. Un manifiesto puede mentir sobre el hash global o describir un estado no reconstruible aunque sus documentos existan. La Function lee las partes almacenadas, reconstruye y verifica SHA/identidad/revisión/conteos; solo entonces crea COMPLETE y timestamp servidor. Rules deniega al cliente ese cambio.

Se evaluó Rules+cliente: no cumple por sí solo esa garantía integral con este formato y estos tamaños. Un verificador administrativo externo permanente también podría realizarla, pero introduce otro backend/operador y no constituye una alternativa automática más simple sobre Spark. No se elimina la verificación para ahorrar infraestructura.

## Integridad reforzada

Una regresión cliente del emulador demostró que el guard inicial permitía un `undeclared-part` antes de COMPLETE. El manifiesto ahora declara `partIds` únicos, acotados e iguales a las partes de sus scopes. Rules permite crear exclusivamente esos IDs; las partes y manifiesto son inmutables. Tras reconstruir todas las partes declaradas, no puede aparecer una parte adicional entre verificación y confirmación.

## Recursos y frecuencia

- Node 22, región us-central1, 512 MiB, timeout 60 s, minInstances 0, maxInstances 3, concurrency 1. La memoria mantiene margen para reconstrucción/canonicalización de 7 MiB y SDK; no se reduce sin certificar el peor caso.
- Autenticación obligatoria; owner derivado del token verificado, no del cuerpo.
- Cero schedulers. Cero invocaciones si no hay captura nueva pendiente. La comprobación local de IDB no es polling cloud.
- Una captura con mismo hash/revisión/outbox conserva ID y partes; no se vuelve a cargar. Un recibo COMPLETE ya verificado se reconfirma con una lectura del manifiesto, sin volver a leer todos sus fragmentos ni repetir cleanup.
- El cliente hace como máximo tres intentos automáticos por captura/contexto/sesión, con demora exponencial. Renders y eventos de acceso no reinician el presupuesto. Una reconexión real o petición explícita puede recuperarlo; nunca se reejecutan ventas.
- El umbral preventivo es 95% del guard legacy, además de capacity-blocked. No cambia 850000 bytes, 8 MiB ni cuotas comerciales.
- Pending/unknown y metadatos de revisión son contenido protegido, no ruido descartable. Ningún contador desconocido se convierte en cero por inferencia.

Invocaciones esperadas: cero para un hash ya respaldado; normalmente una por nueva captura material que llegue a completarse, más intentos acotados si hay fallos. No hay un número diario verificable sin telemetría de operaciones reales. Para los siete roots legacy observados la escala es pequeña; las lecturas/escrituras de fragmentos y su volumen pueden dominar más que la Function. No se promete costo cero ni un precio fijo: tamaño, cambios diarios y regiones afectan el costo. El modelo modular sigue siendo necesario para no copiar historiales completos por operación.

Retención: tres versiones completas útiles por negocio más todos los heads activos; cleanup únicamente después de verificación posterior. No fabricar tres copias idénticas. Los uploads incompletos no se consideran válidos ni se destruyen por intuición; un retry del mismo contenido reutiliza el mismo upload.

## QA y lifecycle

La suite cliente Rules/HTTP cubre tamaños 850000, 860000, 1 MiB, 1.2 MiB, 3 MiB y 7 MiB. SHA reconstruido coincide exactamente con el registro capturado; no crea state/main ni reejecuta operaciones. El build servido prueba Auth sintético, Founder 600→2000, IDB, outbox, cold restart y captura automática sin venta nueva, con Chromium móvil/escritorio, WebKit y Firefox.

Cada ejecución prueba puertos aislados cerrados antes/después; `emulators:exec` hace shutdown incluso si falla el comando. Clientes Firestore se terminan explícitamente, y browsers/servidor HTTP se cierran en finally. CI ejecuta tres lifecycles independientes sin aumentar la espera por confirmación. El timeout previo del segundo reinicio sigue requiriendo evidencia: no se etiqueta flaky por pasar una repetición local.

Cancelaciones sin pasos tienen anotación de GitHub: runner no adquirido tras varios intentos. Se fijaron imágenes ubuntu-24.04/macOS-15 Intel y se escalonaron requests de runners manteniendo nombres, assertions y gate final obligatorio. Ningún cancelado cuenta como PASS.

El fallo de `labels-e2e` en 412fcea fue `one abono` en WebKit 390, no impresión. La prueba ahora espera la promesa de la mutación real antes de exigir el resultado servidor; no reintenta el abono ni elimina assertions. Se valida por separado del timeout de segundo reinicio: no se declara que ambos tengan la misma causa.

Una reproducción local adicional encontró un Java Firestore huérfano después del timeout de arranque de Auth. Firebase crea Java en un grupo propio; el cleanup anterior señalaba el grupo del CLI y regresaba sin esperar. La matriz comercial ahora pide SIGTERM al CLI y espera su cierre ordenado, permitiéndole terminar sus emuladores hijos. Un fallo de shutdown es un error de prueba, no PASS. No se aumentan deadlines de operaciones.

## Preparación de staging (no ejecutar todavía)

Primero todos los controles del HEAD exacto deben estar verdes. Inspeccionar HEAD y diff, árbol limpio, build exacto y rollback. Estos comandos son un plan, no evidencia de deploy:

```sh
git diff --exit-code
npm ci
npm ci --prefix functions --ignore-scripts
npm run build:static
node scripts/build-cloud-safety-functions.mjs
node scripts/validate-cloud-safety-staging.mjs click360-staging-7620168025
```

Después de una decisión explícita de facturación: habilitar primero STAGING, verificar billingEnabled=true mediante lectura API y proyecto correcto. En Firebase Console seleccionar click360-staging-7620168025 → Usage and billing → Details & settings → modificar plan → Blaze → vincular cuenta autorizada. No pedir contraseñas/tarjeta al cliente ni modificar producción.

Solo entonces, bajo los gates aprobados:

```sh
firebase deploy --project click360-staging-7620168025 --config firebase.staging.json --only functions:cloud-safety
firebase deploy --project click360-staging-7620168025 --config firebase.staging.json --only firestore:rules
firebase hosting:channel:deploy cloud-safety-certified --project click360-staging-7620168025 --config firebase.staging.json
```

Smoke real obligatorio: proyecto/Auth correctos, owner/worker/cross-tenant Rules reales, captura existente sin nueva operación, lectura servidor COMPLETE, reconstrucción independiente con SHA idéntico, cold restart/offline/reconnect y update PWA sin borrar IDB. Rechazar staged build que apunte a click-360. No declarar STAGING_CLOUD_SAFETY_CERTIFIED mediante emuladores.

Rollback: Hosting previo y Rules previas recuperables; mantener IDB/outbox y archivos completos. Conservar configuración/revisión previa de la Function. Congelar el nuevo uploader si falla la verificación; no restaurar un state/main antiguo ni borrar archives para revertir código. No se despliega ni migra Modular V4.

## Decisión final de esta fase

CLOUD_SAFETY_READY_EXCEPT_BILLING solo corresponde después de CI exacto completo y QA repetida PASS. La certificación real de Firebase staging y posteriormente producción sigue pendiente hasta ejecutarla; no se confunde con certificación de emuladores. No solicitar activación de Blaze antes de ese punto.
