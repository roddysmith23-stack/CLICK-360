# CLICK 360 P2 Owner Preview

## Objetivo

Este artefacto local permite revisar visualmente los dominios P2 con un negocio y usuarios sintéticos. No es un entorno de staging, no es una URL para clientes y no se conecta a Firebase.

## Alcance visible

- Navegación: Inicio, Ventas, Inventario, Caja, Reportes, Etiquetas, Trabajadores, Restaurante, Cocina, Logística, Rutas, Liquidaciones y Administración.
- Lienzo Universal como entrada principal de Etiquetas; el Asistente avanzado sigue disponible desde el editor.
- Siete roles sintéticos: owner, admin, cashier, server, kitchen, routeSeller y collector.
- Restaurante: seis mesas, comandas, cocina y barra, pagos parciales y cuenta.
- Logística: dos vehículos, dos rutas, hoja de carga, venta, crédito, cobranza, retorno y liquidación.
- Perfil provisional de etiquetas de 40 x 60 mm, dos columnas, 203 DPI. No representa una calibración física certificada.

## Aislamiento

El preview usa el único namespace local `CLICK360_P2_OWNER_PREVIEW:` y fixtures de `CLICK 360 P2 DEMO`. No carga Firebase, no registra un Service Worker, no llama Functions y no importa credenciales. La acción **Recargar versión nueva** borra solamente ese namespace y recarga la página.

La página expone un contrato verificable en `window.__CLICK360_OWNER_PREVIEW__` con contadores de Firebase y Functions en cero. No contiene UID, correo, negocio ni información comercial real.

## Ejecución local

```sh
git switch preview/p2-owner-complete
npm run build:static
npm run preview:owner:serve
```

Abrir `http://localhost:4173/owner-preview.html` en el equipo. Para otro dispositivo en la misma red Wi-Fi, usar la IPv4 que imprime el servidor, por ejemplo `http://192.168.x.x:4173/owner-preview.html`.

El servidor escucha deliberadamente en `0.0.0.0`, sirve solo `dist`, no guarda caché (`Cache-Control: no-store`) y no expone Firebase ni un backend. Si macOS bloquea el acceso desde el teléfono, permitir Node o Terminal en **Configuración del sistema > Red > Firewall > Opciones**.

## Verificación automatizada

Ejecutar:

```sh
npm run qa:owner-preview
```

La comprobación estática valida el contrato de aislamiento, los fixtures, el build y el servidor. La E2E abre Chromium y WebKit, recorre las rutas, prueba invitación, mesa, KDS, ruta y operaciones del lienzo (arrastrar, redimensionar, duplicar, deshacer, rehacer, cantidad y posición inicial). También revisa anchos de 320, 390, 768, 1024 y 1440 px sin overflow horizontal ni errores inesperados de consola.

Capturas generadas:

- `output/playwright/p2/owner-preview/chrome-desktop.png`
- `output/playwright/p2/owner-preview/chrome-mobile.png`
- `output/playwright/p2/owner-preview/webkit-desktop.png`
- `output/playwright/p2/owner-preview/webkit-mobile.png`

## Smoke físico pendiente

Antes de declarar una impresora compatible, ejecutar este recorrido con papel real:

1. Medir ancho total, ancho y alto de etiqueta, gap central y pitch.
2. Guardar el perfil provisional para el negocio y dispositivo de prueba.
3. Imprimir una fila y ajustar desplazamientos X/Y y escala horizontal/vertical.
4. Imprimir las dos posiciones, escanear ambos QR y probar comenzar desde la segunda casilla.
5. Guardar PDF, reiniciar la PWA y confirmar que el perfil persiste de forma aislada.

No se instalan drivers ni se afirma certificación de hardware en esta rama.

## Rollback

No hay efectos cloud ni migraciones. Para revertir basta con dejar de usar esta rama o borrar el namespace `CLICK360_P2_OWNER_PREVIEW:` mediante la acción local del preview. El código previo permanece intacto en la base `qa/p2-cloud-multiuser-integration`.
