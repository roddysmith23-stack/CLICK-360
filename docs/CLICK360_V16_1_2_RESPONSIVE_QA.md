# CLICK 360 V16.1.2 - QA responsive

## Cambios

- Versión y slogan separados dentro del sidebar, con `min-width: 0`, wrapping y límites estables.
- Saludo y nombres largos pueden ocupar más de una línea sin salir del viewport.
- Selector de negocio reserva el icono y aplica elipsis solo al nombre.
- Fecha y hora aparecen una sola vez en la barra principal.
- Se eliminó el texto visible `Heredar negocio` y se reemplazó por acciones comprensibles.
- El banner de Inicio usa `object-fit: contain`, `object-position: center`, proporción estable y bordes redondeados sin deformación.
- La pantalla pública usa composición móvil hasta 899 px para evitar colisión en tableta.
- Centro de impresión usa grids y botones adaptables.

## Matriz comprobada

Se verificaron anchos `320`, `360`, `375`, `390`, `430`, `768`, `1024`, `1280`, `1440` y `1920` px en la pantalla pública y en vistas internas inyectadas con identidad QA local. En todos los casos:

- `document.documentElement.scrollWidth === innerWidth`;
- no hubo controles fuera del viewport;
- nombres extensos no movieron ni ocultaron el icono del selector;
- consola sin errores inesperados.

También se ejecutaron WebKit móvil, Chrome móvil y Firefox desktop. La validación PWA comprobó arranque offline, actualización desde caché V16.1.1 y eliminación exclusiva de cachés `click360-*` anteriores.

Evidencia seleccionada: `docs/screenshots/v16-1-2/public-320.png`, `public-768-fixed.png`, `public-1440.png`, `home-320-final.png` y `printing-1024-final-2.png`. La matriz completa se generó localmente para los diez anchos obligatorios.

## Alcance físico

WebKit/Chrome/Firefox se validaron mediante motores automatizados. Safari iPhone, Chrome iPhone, Chrome Android y Brave en dispositivos físicos requieren el smoke manual posterior; no se declara una prueba física que no ocurrió.
