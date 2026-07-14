# CLICK 360 V16.1 QR Editor QA

Fecha: 2026-07-14

## Implementacion

- Modo sencillo por defecto.
- Preview sticky y colapsable en movil; dos columnas en desktop.
- Presets: pequena, mediana, grande, solo QR, QR + precio y QR + negocio.
- Seleccion, mover, redimensionar, aumentar, reducir, centrar, ocultar, bloquear y restablecer.
- Coordenadas, capas, margenes y colores dentro de `Ajustes avanzados`.
- IVA: heredar, incluido, no incluido, exento u oculto.
- Red social, direccion y texto libre en preview e impresion.
- Guardar, guardar como nueva, duplicar, eliminar, restablecer, imprimir prueba, PNG, stock y catalogo.

## Pruebas en navegador

| Prueba | Resultado |
| --- | --- |
| Preview movil 390 px | PASS, sticky y sin overflow |
| Editor desktop 1440 px | PASS, dos columnas |
| Drag por puntero | PASS, canvas cambio |
| Resize por handle | PASS, canvas cambio |
| Cambio de IVA en vivo | PASS |
| Red social en vivo | PASS |
| Guardar plantilla | PASS, toast correcto |
| Lista inmediata | PASS, visible con modal abierto |
| Un solo modal root | PASS |
| Controles y botones accesibles | PASS |

El QR se genera y lee con dependencias locales. No depende de un CDN para funcionar offline.

## Evidencia visual

- `output/playwright/v16-1-qr-mobile-390.png`
- `output/playwright/v16-1-qr-desktop-1440-top.png`
