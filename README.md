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


## FULL SCANNER

Esta versión agrega:

- Lector QR nativo cuando el navegador soporta `BarcodeDetector`.
- Soporte para librería local `vendor/jsQR.js` si se reemplaza el archivo placeholder por una copia real de jsQR.
- Lector local CLICK 360 propio para los QR generados por esta app.
- Botón “Leer QR desde foto” como respaldo.
- Código manual siempre disponible.

La cámara en iPhone debe probarse desde HTTPS, por ejemplo GitHub Pages.
