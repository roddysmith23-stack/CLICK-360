# Controles de estabilidad comercial de CLICK 360

Los guardianes agrupan las pruebas existentes. El control de publicación exige completar las cuatro áreas para el árbol que se va a servir.

| Área | Controles |
| --- | --- |
| PRINT GUARDIAN | `npm run qa:labels:e2e` y contrato de catálogo de `qa:r38:e2e`. Geometrías de rollo y hoja, plantillas, perfiles, casillas, precios y proveedores. Prueba de 100 etiquetas con 100 códigos y pares de precios distintos, 50 páginas de 92 × 64 mm y decodificación a 203 dpi. |
| DATA GUARDIAN | `web-rules-qa`, `inventory-conflict-e2e`, `recovery-tooling`, Spark y capacidad del dispositivo. Separación entre negocios y trabajadores, confirmación del servidor, revisiones, ledger, IndexedDB, conservación del journal y recuperación. |
| FINANCIAL GUARDIAN | Contratos de caja, ventas, apartados y abonos de `qa:r38:e2e` y Spark. Relectura de efectos de caja y stock, idempotencia, cierre exacto y recuperación de respuesta perdida sin duplicados. |
| RELEASE GUARDIAN | `web-release-gate`, `qa:artifact:e2e` y actualización segura de la suite de capacidad. Arranque, manifiesto y service worker, reapertura offline, rechazo de assets mezclados, recuperación, Chrome/Edge en Windows y pruebas de motores Chromium/WebKit/Firefox. |

## Evidencia y criterio de publicación

- Esperar los workflows Web Release QA, Spark modular client safety y capacidad. El gate web incorpora la prueba de etiquetas y el chequeo real de Chrome/Edge en Windows. Una reejecución por fallo de infraestructura conserva todos los controles.
- Rotular las evidencias como navegador en su sistema, motor con dispositivo emulado, emulador de sistema operativo o impresión física. Una vista previa, un PDF o una sesión de navegador no sustituye una tirada real.
- Antes de publicar, comprobar el SHA y artefacto, registrar el punto de reversión de Hosting y verificar la integridad comercial mediante lecturas acotadas. Después de publicar, cotejar manifiesto, service worker y hashes en ambos dominios oficiales. Ante regresión crítica, revertir exclusivamente Hosting a una versión verificada.
- Registrar CLICK360_PRINT_GOLDEN_SHARY_2026 cuando exista una prueba física aceptada desde la aplicación habitual. Conservar el SHA, ruta de impresión, configuración aplicada y evidencia de la tira, sin datos comerciales identificables.
