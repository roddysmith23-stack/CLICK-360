# Modular V4 — continuación desde producción #93

Base exacta: `21409a1d2dc710315ab8c3c27e5da566f004cc8e`.
Rama: `codex/modular-v4-production-integration-20261005`.

Se portaron selectivamente 20 archivos DEV desde #92 `6b3650c`, sin copiar `app.js`, `firebase-service.js`, `v16-storage.js`, cuotas ni package.json completo. Los tres checkpoints V2/V3/V4 portados son evidencia histórica: sus referencias a producción #90 y override 600 ya fueron superadas por #93. Founder productivo mantiene el piso efectivo 2/2/2000.

El repositorio transaccional, journal, coordinador, importer shadow nativo, comparador independiente, paginación y política futura 100 MiB permanecen DEV; no están cargados por Hosting. No se activó ningún tenant, no se escribieron sombras productivas y no hay write fence desplegado todavía.

El harness portado pasó: venta/movimiento/stock idempotentes, cierre exacto compacto, respuesta perdida, aislamiento, flag por negocio y lectura acotada con 5000 ventas + 5000 movimientos + 5000 auditorías. Esto no certifica todavía Rules cliente modulares, UI ni cutover.

Prioridad de integración: adapters explícitos de comandos comerciales → journal durable → reconciliación server ledger → proyección UI/paginación → importer de fuente reconciliada → Rules cliente/fence → staging y ensayo forward-safe. Ninguna operación UNKNOWN autoriza replay ciego. Un archivo de seguridad no constituye sincronización operacional.

Fuente de una migración real: legacy remoto + último respaldo COMPLETE del dispositivo + outbox + operaciones confirmadas, nunca el legacy antiguo por sí solo. Sin respaldo actualizado e igualdad semántica independiente, el piloto sigue bloqueado.

Infraestructura observada el 05/10: producción y staging sin billing habilitado; la publicación del verificador de archivos requiere habilitación autorizada de Blaze. El desarrollo/emulador continúa sin credenciales del cliente ni datos reales.
