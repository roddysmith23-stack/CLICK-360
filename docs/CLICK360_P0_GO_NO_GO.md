# CLICK 360 P0 GO / NO-GO

Fecha: 2026-07-10

## Decisión: CANDIDATO GO PARA BETA PRIVADA

El bloqueo P0 de datos cruzados queda resuelto en el candidato de lanzamiento. La decisión final de publicación depende de CI, despliegue de reglas, GitHub Pages y el checklist de smoke autenticado descrito en `CLICK360_MVP_LAUNCH_READINESS.md`.

## P0 resuelto

- Dos tenants legítimos están migrados y verificados como `CLEAN_V10`.
- `demo-click360` sigue intacto y bloqueado como `CROSS_TENANT_SUSPECT`.
- Tenant, caché, sesión, aprobación, listeners y escrituras están aislados.
- Legacy, seed vacío, caché corrupta y documento remoto ausente con datos locales quedan bloqueados.
- Perfiles persisten localmente, se reintentan y resuelven versiones entre dispositivos.
- Almacenamiento lleno revierte el último cambio sin borrar imágenes ni estado confirmado.
- Concurrencia usa transacciones, revisiones y cuarentena de conflictos.
- Ventas en efectivo ya no cuentan el vuelto como ingreso; facturas anuladas neutralizan su movimiento.
- Reglas reales pasan en emulador y dependencias de producción tienen 0 vulnerabilidades conocidas por `npm audit`.

## Condiciones de liberación

1. CI y emulador de reglas verdes sobre el PR de lanzamiento.
2. Reglas desplegadas desde este commit; no modificar datos de clientes ni `demo-click360`.
3. GitHub Pages publicado con la versión `mvp-launch-v14`.
4. Smoke autenticado de las dos cuentas legítimas sin crear datos reales. Si el entorno no permite controlar la sesión de Chrome, usar el checklist manual sin revertir un release correcto por esa limitación.

## Acciones prohibidas en este cierre

La arquitectura por entidades y el ledger financiero inmutable continúan como P1. Este lanzamiento no toca `demo-click360` ni ejecuta migraciones de clientes.
