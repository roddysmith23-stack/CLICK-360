# CLICK 360 — MVP QA FINAL

App web/PWA estática para piloto comercial controlado de negocios pequeños.

## Accesos de prueba

- Dueño / negocio: `demo` / `demo123`
- Cajero: `cajero` / `cajero123`
- Inventario: `inventario` / `inventario123`
- Admin CLICK 360: `click360admin` / `click360admin`

## Qué incluye

- Inventario por negocio.
- Precios con punto o coma: `5.50`, `5,50`, `12.99`, `12,99`.
- QR interno CLICK 360 generado localmente, sin CDN.
- Etiquetas QR imprimibles.
- Descargar etiqueta PNG.
- Imprimir 1 etiqueta, por stock o todas.
- Venta por código manual.
- Cámara con escáner usando BarcodeDetector cuando el navegador lo permite.
- Beep/vibración al agregar producto o cobrar.
- Caja diaria.
- Reportes.
- Roles básicos: dueño, cajero, inventario.
- Respaldo local: guardar/restaurar archivo.
- PWA instalable con icono CLICK 360.

## Cómo probar localmente

```bash
python3 -m http.server 8080
```

Abrir:

```text
http://localhost:8080
```

## Probar en iPhone

Para cámara real, lo mejor es publicar en HTTPS, por ejemplo GitHub Pages.  
En local por IP, iOS puede bloquear cámara. El código manual y la lógica de QR sí funcionan localmente.

## GitHub Pages

Sube todos los archivos a un repositorio y activa:

```text
Settings → Pages → Deploy from branch → main / root
```

## Nota comercial

Esta versión guarda datos en el navegador del dispositivo. Sirve para pilotos y presentación comercial. Para uso masivo con varios celulares sincronizados se necesita backend real: CLICK 360 Cloud.


## CLICK 360 MVP FINAL v2 FULL POWER

Versión corregida desde la última publicación.

### Incluye

- Inventario con imagen opcional de producto.
- Registro/edición de producto con foto desde cámara o archivo.
- Producto visible en inventario, buscador de venta y carrito.
- QR más simple y más fácil de leer: el QR contiene el código interno del producto.
- Código manual siempre visible bajo la etiqueta.
- Venta por búsqueda, selección rápida o código manual.
- Flujo de escaneo preparado con cámara, foto del QR y fallback manual.
- Beep/vibración al agregar producto o cobrar.
- Caja diaria, reportes, roles y respaldo local.
- Favicon, iconos PWA y logo interno separados.

### Accesos

- Dueño: `demo` / `demo123`
- Cajero: `cajero` / `cajero123`
- Inventario: `inventario` / `inventario123`
- Admin: `click360admin` / `click360admin`

### Nota de producción

Esta app sigue siendo PWA estática con almacenamiento local. Para vender con multiusuario real y respaldo automático para varias personas de la misma empresa, se necesita conectar CLICK 360 Cloud con Firebase/Supabase o backend propio, usando lenguaje simple en la app: Respaldo en la nube, Código de empresa y PIN de empresa.


## v3 LOGO FIX

Se corrigió el logo interno, favicon e iconos PWA para eliminar el triángulo CSS y separar correctamente cada uso visual.


## v4 REAL QR FIX

Corrección crítica:
- Se reemplazó el generador QR experimental por `qrcode-generator` local real.
- Se reemplazó el lector placeholder por `jsQR` local real.
- El QR de la etiqueta ahora contiene el código simple del producto para que sea más fácil de leer.
- La etiqueta sigue mostrando el código visible debajo del QR para respaldo manual.
- Se mantiene imagen opcional, ventas, stock, caja, reportes, impresión, PNG y roles.
- Se actualizó el service worker a `click360-mvp-final-v4-real-qr` para forzar cache nuevo.
