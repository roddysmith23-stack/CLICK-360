# P0A — guard comercial del merge

El merge mínimo #97 (`88fe95a2d05f`) quedó retenido, sin publicar ni activar
el piloto, al fallar `founder-hosted-commerce-e2e` en la edición de stock.
La repetición pasó; eso no se consideró explicación del fallo original.

Se reprodujo determinísticamente en WebKit: abrir el editor, completar un
guardado durable de IndexedDB mientras el editor está abierto y guardar una
cantidad nueva. El guardado reemplaza `state` por su snapshot protegido y el
formulario conserva el objeto anterior. Antes: toast de guardado, stock todavía
5 en vez de 6 y timeout en el mismo predicado del CI. El defecto también está
en el código productivo anterior `21409a1d2dc7`.

Corrección mínima: resolver el registro vigente por ID y negocio antes de
editarlo, conservando el fingerprint comercial de apertura. Si cambió o fue
eliminado, rechazar la edición sin escribir. No cambia contratos, cuotas,
Rules, cash, sincronización ni los límites de persistencia.

Regresión permanente en la PWA servida con Auth/Firestore emulator, WebKit y
Chromium: reemplazo durable durante edición, stock exacto, conflicto real
rechazado sin encolar escritura, reapertura y edición válida, venta única y
remoto legacy intacto. No se aumentan timeouts ni se omiten controles.

Esta dependencia de seguridad no incluye P0B. #96 se conserva separado.
El piloto y producción siguen retenidos hasta CI final, staging y publicación
exacta verificados. No implica recuperación del iPhone real.
