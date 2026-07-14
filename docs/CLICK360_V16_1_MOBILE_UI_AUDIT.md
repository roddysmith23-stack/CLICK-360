# CLICK 360 V16.1 Mobile UI Audit

Fecha: 2026-07-14

## Resultado responsive

| Ancho | Overflow horizontal | Resultado |
| ---: | --- | --- |
| 320 | No | PASS |
| 375 | No | PASS |
| 390 | No | PASS |
| 430 | No | PASS |
| 768 | No | PASS |
| 1440 | No | PASS |

## Componentes revisados

- Header movil: logo, negocio, notificaciones y reloj sin superposicion.
- Selector: nombre completo dentro del sheet y estado activo visible.
- Navegacion inferior: cinco destinos estables y tactiles.
- `Mas`: iconos Lucide, nombres accesibles y filas de 58 px.
- Notificaciones: tipo, fecha/detalle, prioridad, estado, lectura y accion global.
- Calculadora: 20 teclas, resultado estable y uso en efectivo/descuento.
- Editor QR: preview superior, controles grandes y scroll independiente.
- Cards, inputs, badges y botones: radio y espaciado consistentes.
- Safe areas: navegacion y modales respetan el borde inferior.

## Hallazgo corregido durante QA

El shell podia conservar un modal root antiguo y crear otro al navegar. Ese overlay invisible bloqueaba toques aunque la pantalla pareciera cerrada. V16.1 reutiliza un unico root y elimina duplicados al cerrar o cambiar de vista.

## Evidencia visual

- `output/playwright/v16-1-more-mobile-390.png`
- `output/playwright/v16-1-qr-mobile-390.png`
- `output/playwright/v16-1-qr-desktop-1440-top.png`
