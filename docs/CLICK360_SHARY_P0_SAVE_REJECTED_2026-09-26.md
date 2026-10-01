# CLICK 360 — SHARY P0 `save_rejected` — 2026-09-26

Este documento registra la segunda incidencia de cierre histórico observada en el SHA productivo `3f32a5712987`. No contiene identidad, datos personales ni contenido comercial del cliente. La lectura de producción fue exclusivamente de solo lectura. No se modificó Firestore, no se restauró un respaldo, no se desplegó producción y no se hizo merge.

## Resultado de la lectura remota

Última lectura autorizada capturada el `2026-09-27T00:10:04.196Z`:

- revisión remota: `1790446720233`;
- hash SHA-256 de los campos nativos: `55e330e76c8dc91c3cd15f97b513f76880cd6830cc25d59efac0df1fcbaa28ae`;
- 463 productos, 30 ventas, 107 movimientos, 24 sesiones de caja, 21 reportes diarios y 271 entradas de auditoría del estado monolítico;
- la única venta con fecha comercial `2026-09-03` está confirmada en el servidor: total `$30`, estado pagado, transferencia, una línea de producto;
- la venta tiene `operationId`, `saleId` y `cashSessionId` explícitos. El hash anonimizado del identificador de sesión es `b211ea756f44c29fc8f096085cae455e1dcaabcdef15e423bff816a413897144`;
- existe exactamente un movimiento de ingreso por `$30` con la misma operación, venta y sesión;
- el producto relacionado ya tiene `stock=0` y `qty=0` en el servidor. No debe descontarse nuevamente;
- la sesión del `2026-09-03` existe y sigue `open`;
- no existe reporte de cierre del `2026-09-03`, ni confirmado ni pendiente;
- ningún reporte previo referencia esa venta;
- no hay identificadores de venta u operación duplicados.

Conclusión: la venta, su movimiento y el descuento de inventario están confirmados remotamente. El cierre no llegó al servidor. No hace falta recuperar ni recrear la venta desde el iPhone.

El fingerprint material remoto actual calculado con el algoritmo productivo es `h_0fee9b18`, igual al `localHash` del diagnóstico del iPhone. El `remoteHash=h_01f8df6e` mostrado por el dispositivo era un baseline remoto anterior, no el contenido autoritativo leído del servidor.

## Respaldo verificable

El respaldo vigente conserva los tipos nativos de Firestore y está fuera de Git en:

`artifacts/private/shary-incident-20260927-cash-close-final-read/`

Archivos:

- `firestore-native-backup.private.json` — 2.433.731 bytes — SHA-256 `c47527ed9ad6a7ee7e9dfaea95437ba204a312ee8b81fc4e1bbdc982830dfe31`;
- `manifest.private.json` — SHA-256 `2d1adf47f45eb4a2599aaf4811496730da9e0e825f50dea36b7431e1560fbf13`;
- `reconciliation-2026-09-03.private.json` — SHA-256 `d9532c2a85ccc37fd3088a19fa84b6c0273fb01ff6935e939a93bc5c22002035`;
- `comparison-preview.private.json` — SHA-256 `883a99a79eb422d8b2ff3d68908d15843358fe579e8780df208ed6e2a85e488f`.

El manifiesto fue contrastado nuevamente contra el archivo de respaldo y coincide. Frente a la captura anterior cambiaron la revisión, `baseRevision`, `updatedAt` y `updatedAtMs`, pero no cambió el payload comercial ni ninguno de sus conteos. Por lo tanto, la captura anterior queda obsoleta para una comparación CAS y se conserva solamente como evidencia; no es candidata de restauración. La venta, el movimiento, el stock, la sesión abierta y la ausencia de reporte del `2026-09-03` permanecen iguales en la captura vigente.

## Causa exacta

El rechazo ocurrió antes de escribir Firestore:

1. El payload remoto actual ocupa 847.451 bytes bajo la misma serialización usada por producción.
2. `save()` mantiene un guard de seguridad de 850.000 bytes.
3. El cierre antiguo añadía al reporte campos contables estructurados y, además, una copia HTML completa del comprobante.
4. La reproducción con 463 productos e historial extenso produjo 850.947 bytes al intentar cerrar, por lo que `save()` revirtió el cambio local y devolvió `false`.
5. `commitCriticalMutation()` convirtió ese motivo en el genérico `save_rejected` y el diagnóstico final perdió la sesión y el gate ya evaluados.

Por eso `cashSessionId:""` y `writeGate:null` en el diagnóstico original no describían la operación real. La sesión remota sí tiene ID. El acceso Founder Legacy no rechazó el cierre. Tampoco fue un rechazo de reglas, de permisos o de Firestore.

## Corrección

- Los cierres nuevos persisten únicamente sus campos estructurados; el HTML imprimible, que es una vista derivada, se reconstruye al abrir, imprimir o descargar el cierre. Los reportes históricos que ya contienen HTML siguen siendo compatibles y no se reescriben.
- Antes de crear un cierre online, la aplicación relee el documento desde el servidor y busca un reporte cerrado por `businessId + date + cashSessionId`. El fallback legacy sin sesión se limita a reportes que tampoco tengan sesión explícita.
- Si el servidor ya contiene el cierre, el reintento termina sin crear otro reporte.
- Si el servidor marca la sesión cerrada pero no existe su reporte, el flujo falla cerrado para investigación.
- `save()` conserva el motivo real (`local_state_too_large`, cuota local u otro código), etapa, bytes intentados y límite.
- El diagnóstico de cierre conserva el gate evaluado y la sesión objetivo aun después de una excepción.
- Si la respuesta de persistencia falla, el sistema relee el servidor antes de habilitar un reintento. Un reporte ya confirmado se reconoce como éxito sin una segunda escritura.
- La interfaz distingue cuatro resultados: `confirmed`, `pending`, `rejected` y `unknown`. El estado desconocido solo permite comprobar el servidor; nunca ofrece reintento directo.
- No se cambia el límite de 850.000 bytes. No se eliminan ventas, movimientos, productos, sesiones, reportes ni auditoría.

La corrección vive en la arquitectura compartida. No contiene identificadores, correos, hashes ni condiciones particulares de SHARY. Se ejerce con la misma conciliación por negocio, fecha y sesión para Basic, Pro, Business, Enterprise y Founder Legacy, y respeta el mapa común de permisos de caja.

## Cuota Founder Legacy conservada

La diferencia del artefacto productivo frente a `main` ya quedó reconciliada en la base del PR #83:

- `manualLimitOverrides` se lee solamente desde `accountAccess` del usuario autenticado;
- los overrides son por tenant y no alteran `PLAN_CATALOG`;
- el override verificado de SHARY permanece en 2 negocios, 2 trabajadores y 600 productos activos;
- `v16-domain.js` continúa byte por byte congelado; la semántica aditiva vive en `tenant-quota-overrides.js`;
- los harnesses de cuota, paridad Founder Legacy y sentinel R38 están aprobados.

## Pruebas

- `npm run qa:p0:shary`: PASS.
- `npm run qa`: PASS.
- `npm run qa:rules`: PASS, incluido el emulador de dos dispositivos con un solo cierre y ninguna mutación de venta, movimiento o inventario.
- `npm run qa:labels:e2e`: PASS. El timeout anterior esperando `#manualCode` no se reprodujo; el sweep completó 9 anchos por 14 rutas en Chromium y WebKit sin reducir ni desactivar controles.
- R38 comercio autoritativo: PASS en Chromium y WebKit, 1280 px y 390 px; el comprobante reconstruido conserva todos los totales.
- R38 Restaurant, matriz de fallos de arranque, contrato de impresión y smoke del artefacto construido: PASS.
- Regresión específica WebKit/iPhone standalone: rechazo real a 850.947 bytes sin mutación; cierre compacto a 848.247 bytes; doble toque, cierre ya confirmado en servidor, fallback IndexedDB y offline pendiente cubiertos.
- Arnés universal: PASS para cinco planes, seis roles, tres tenants sintéticos aislados, negocios con identificadores coincidentes bajo propietarios distintos, sesiones actuales/retroactivas/cerradas/reabiertas, efectivo/tarjeta/transferencia y transición de fecha `America/Guayaquil`.
- Matriz automatizada de cierre: PASS en ocho perfiles: motor WebKit iPhone navegador, WebKit iPhone PWA, Chromium Android navegador, Chromium Android PWA, Chromium escritorio, WebKit escritorio, Firefox escritorio y emulación compatible con Edge. Todos comprobaron rechazo seguro cerca del límite y cierre compacto único sin cambiar conteos de ventas, movimientos o stock.
- Conflicto de inventario con dos dispositivos: PASS 30/30; un solo stock autoritativo, cero confirmaciones falsas, cero sobrescrituras silenciosas y cero actualizaciones perdidas. Los motivos específicos de rechazo/estado desconocido vuelven a producir mensajes terminales claros en vez del fallback genérico.
- El fallo CI de la matriz de caja se aisló a la carga ajena de Firebase Auth dentro de un fixture que aporta identidad sintética propia. El iframe se aísla tanto contra servidor local como staging; los errores reales de la página continúan siendo aserciones bloqueantes y no se omitió ningún escenario.
- El E2E comercial WebKit conserva todas sus aserciones, pero dispara el botón actualmente conectado de forma atómica después de forzar el reemplazo sintético de `productList`; así evita perder el gesto de Playwright entre `pointerdown` y `pointerup` sin saltarse el handler real ni las comprobaciones posteriores de producto, venta, stock y caja.
- Google Chrome instalado en macOS: PASS adicional ejecutado contra el binario local.

La matriz automatizada no sustituye hardware ni navegadores propietarios. Siguen pendientes para aceptación física: iPhone Safari real, PWA instalada real de SHARY, Android real, Edge real en Windows y Safari real en macOS. Los perfiles WebKit/Chromium y los dispositivos Playwright se reportan como automatización, no como certificación física.

## Recuperación operativa propuesta

Para esta segunda incidencia no se propone una reparación directa de datos: el estado remoto es coherente y solo falta cerrar la sesión mediante el código corregido.

Después de una autorización separada de producción:

1. Volver a leer el documento remoto y comparar estrictamente revisión, hash nativo, fingerprint material y conteos contra este respaldo. Si cualquiera cambió, detenerse y generar respaldo/vista previa nuevos.
2. Confirmar otra vez una venta, un movimiento, `stock=qty=0`, sesión `open` y cero reportes para `2026-09-03`.
3. Desplegar únicamente Hosting desde el commit aprobado. No desplegar reglas, funciones ni Firestore.
4. Pedir a SHARY que mantenga el iPhone online, abra la versión nueva y cierre la caja del `2026-09-03` una sola vez. No usar “Actualizar desde nube”, no limpiar almacenamiento y no reinstalar.
5. Leer el servidor de forma independiente: debe existir un solo reporte nuevo vinculado a la sesión, la sesión debe quedar `closed`, y deben permanecer 30 ventas, 107 movimientos y el mismo stock del producto relacionado.
6. Solo después de esa comprobación, pedir a SHARY una venta real pequeña de la jornada actual. Verificar remotamente una venta, un movimiento y un único descuento de stock antes de declarar recuperación completa.

El script de reparación de las dos sesiones huérfanas del `2026-09-02` sigue siendo una herramienta separada, transaccional y `dry-run` por defecto. No debe ejecutarse para resolver el cierre del `2026-09-03` y su modo `apply` sigue requiriendo autorización expresa y una comparación fresca del servidor.

## Riesgo residual

El cierre compacto cabe bajo el guard actual, pero el tenant sigue cerca del límite monolítico. Continuar cargando muchas ventas históricas puede volver a agotar el margen. La solución durable es la migración modular ya diseñada; no corresponde elevar el límite ni borrar historial durante este hotfix.

## Estado de publicación

- Producción: sin cambios.
- Firestore de SHARY: solo lectura; sin cambios.
- Merge: no realizado.
- Staging independiente: `https://click360-staging-7620168025--shary-save-rejected-kr7fzzx1.web.app` (canal Hosting aislado, validado con la regresión sintética completa; expira el 2026-10-04).
