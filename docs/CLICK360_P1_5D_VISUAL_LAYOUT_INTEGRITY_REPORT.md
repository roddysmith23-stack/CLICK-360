# CLICK 360 P1.5D Visual Layout Integrity

## Estado

- Rama: `hotfix/p1-5d-visual-layout-integrity`
- Base: `58b3f85` (main, P1.5C universal smart print wizard)
- Version candidata: `1.0.4-p3`
- Asset/cache: `mvp-launch-v16-2-p1-5d-r1`
- Produccion: sin cambios
- Firebase/Auth/OAuth/Rules/datos: sin cambios

## Objetivo

Corregir el ultimo detalle transversal de experiencia visual: botones, flechas,
contenedores, secciones y textos largos no pueden salirse de su estructura ni
romper margenes. La interfaz debe reorganizarse antes de truncar contenido o
crear desplazamiento horizontal.

## Cambios

- Se agrego una capa de contencion para encabezados, barras de acciones,
  modales, filas, tarjetas, botones, flechas e iconos.
- Los textos largos usan `overflow-wrap:anywhere`; iconos y flechas mantienen
  una base estable y no comprimen el contenido principal.
- En movil, filas de movimientos, encabezados de tarjetas y controles de
  impresion pueden reorganizarse sin superponerse.
- En anchos de hasta 430 px, las acciones de encabezado se apilan en una sola
  columna. Esto evita palabras partidas de forma poco profesional.
- Las etiquetas de la navegacion inferior tienen una caja estable y pueden
  envolver contenido sin salir de la barra.
- Se habilito `overscroll-behavior: contain` para que el scroll de modales no
  se propague accidentalmente a la pantalla de fondo.
- Se creo una fixture visual aislada y un harness P1.5D para evitar regresiones.

## Relacion con el Plan Maestro Universal

El plan maestro fue revisado completo. El estado actual de `main` ya contiene
la prioridad operativa numero uno: el asistente universal de etiquetas P1.5C,
con plan fisico comun para preview, PDF e impresion, perfiles por negocio y
dispositivo, calibracion y pruebas de aislamiento.

P1.5D es la base visual reutilizable para el futuro Lienzo de Etiquetas y los
modulos universales. No se afirma que workers, restaurante, logistica, panel
administrativo ni el modelo modular completo esten terminados. Esos trabajos
deben seguir las ramas y PRs separados definidos en el plan maestro, con
feature flags, reglas en emulador y revision de seguridad propia.

## QA

| Prueba | Resultado | Evidencia |
| --- | --- | --- |
| `npm run qa` | PASS | Incluye P0-P1.5C, P1.5D, simulador quick y build |
| `npm run qa:rules` | PASS | Emulador local `demo-click360-p0-rules`; denegaciones esperadas verificadas |
| `npm run qa:simulator:full` | PASS | 2,600 acciones, 100 reportes, revision de nube 51 |
| `npm run build:static` | PASS | 18 entradas allowlisted en `dist/` |
| Harness P1.5D | PASS | Contencion, wrapping, iconos estables y reflow movil |
| Chromium | PASS | 320, 360, 390, 430, 768, 1024, 1366, 1440 y 1920 px sin overflow |
| WebKit movil | PASS | Fixture a 402 px, sin overflow ni errores de consola |
| Firefox | PASS | 320 y 1366 px sin overflow ni errores de consola |
| Pantalla publica local | PASS | 320, 390, 430 y 1440 px sin overflow; 0 errores, 1 advertencia conocida de persistencia Firebase |

La fixture visual cubre titulos extensos, botones de accion, filas con flecha,
modales, movimientos, mesa, navegacion inferior y textos de sincronizacion.

## Alcance no modificado

- No se modificaron `firestore.rules`, `firebase-config.js`,
  `p0-tenant-guard.js` ni `access-flow.js`.
- No se tocaron Firebase Auth, OAuth, accountAccess, claims, datos reales,
  `businesses/*/state/main`, Cloud Run, V17 ni STABLE.
- No se hizo merge, deploy, cambio de Rules ni publicacion de Hosting.

## Riesgo abierto

`npm audit --omit=dev` informa cinco vulnerabilidades altas transitivas en la
cadena `google-gax -> rimraf -> glob/minimatch -> brace-expansion`. No se aplico
`npm audit fix` automaticamente: debe resolverse en un PR de dependencias
separado, con revision de lockfile y regresion completa. No afecta esta
correccion visual ni implica modificacion de produccion.

## Rollback

Antes de merge, cerrar este PR y eliminar la rama no afecta datos ni
infraestructura. Despues de un merge futuro, revertir el commit P1.5D restaura
el CSS, la version/cache y los harnesses anteriores; no requiere rollback de
Firestore ni de datos comerciales.

## Veredicto

`NO_GO_FOR_MERGE`

La correccion visual, los harnesses, las reglas en emulador, los simuladores y
el build pasaron. Sin embargo, la CI bloquea el merge por cinco vulnerabilidades
altas transitivas de `firebase-admin 14.1.0`:
`google-gax -> rimraf -> glob/minimatch -> brace-expansion`.

La investigacion confirmo que subir `firebase-admin` a 14.2.0 no elimina la
cadena vulnerable y que el arreglo automatico propone un cambio incompatible
en `firebase-tools`. No se forzaron overrides fuera de rango. Se requiere un
PR de dependencias aprobado cuando exista una ruta compatible o se defina una
politica de mitigacion revisada. No es autorizacion de deploy; la validacion
fisica de impresion de Shary tambien sigue siendo un smoke separado.
