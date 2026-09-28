# CLICK 360 — P0 de integridad de sincronización

Fecha: 2026-09-28

Base certificada: `f6ce43207e5d02b93c95cd6b0b45730469b262e0`

Rama: `hotfix/p0-sync-state-authoritative-verification-20260927`

## Resultado de la lectura remota

La lectura autorizada y exclusivamente de servidor confirmó que la operación
histórica del 03/09 sigue almacenada una sola vez: una venta de USD 30, un
movimiento de ingreso enlazado, un único descuento de inventario y una sesión
de caja abierta. No existe todavía un reporte de cierre para esa sesión.

La captura se guardó fuera del repositorio público con los valores nativos de
Firestore, manifiesto y SHA-256. La comparación contra la captura anterior
encontró cambios únicamente en la envoltura de revisión y actualización; el
payload económico no cambió. No se escribió ningún documento de producción.

## Causa demostrada

El hash rotulado como remoto por la PWA no era una lectura fresca del servidor:
era el último baseline aplicado al dispositivo. Cuando el estado local difería
de ese baseline y no había un outbox o marcador de conflicto activo, la máquina
de estados podía caer en `clean`. En el incidente, una lectura fresca confirmó
que el material local y el material del servidor sí coincidían; la diferencia
mostrada correspondía a un baseline obsoleto, no a una segunda venta pendiente.

El riesgo era global: una diferencia material real podía recibir el mismo
estado visual hasta que otra ruta detectara el conflicto.

## Corrección compartida

- `clean` ya no se emite ante una diferencia material sin evidencia.
- La PWA separa el hash del baseline anterior de una lectura fresca obtenida con
  `source: server`.
- Una diferencia sin comprobar queda en `needs_review` y bloquea la escritura.
- Una lectura fresca que coincide habilita únicamente la operación solicitada;
  una lectura divergente queda en `real_conflict` y no modifica el estado local.
- La comprobación es efímera y ligada a usuario, tenant, época de autenticación,
  hash material y vencimiento. No hidrata, no limpia la cola y no reemplaza
  datos locales.
- Una mutación crítica legítima recibe una intención acotada a su operación y
  hash exactos. La intención no permite reutilización ni atravesar otro tenant.
- El cierre espera que su propio snapshot y marcador pendiente queden
  persistidos antes de iniciar el push remoto.
- El diagnóstico y la interfaz distinguen baseline anterior, servidor fresco,
  cierre confirmado, verificación pendiente y conflicto real.

No se añadió ninguna condición por nombre, ID, plan o cuenta de SHARY. La lógica
se aplica a todos los tenants que ya tienen permiso de caja.

## Capacidad

El hotfix conserva el comprobante compacto del cambio anterior. El fixture que
reproduce la cuenta grande queda en 848.247 bytes, solo 1.753 bytes por debajo
del límite interno de 850.000 bytes. Este cambio no eleva el límite ni borra
historial: protege el cierre inmediato, pero la salida definitiva continúa en
el trabajo modular independiente.

## Evidencia de pruebas locales

- Suite estática y simulador: `npm run qa` — PASS.
- Reglas y emulador Firestore: `npm run qa:rules` — PASS.
- Regresión exacta de SHARY en WebKit/iPhone PWA: `npm run qa:p0:shary` — PASS.
- Matriz automatizada de caja: ocho perfiles móviles/escritorio — PASS.
- Inventario real sintético y comprobante: PASS.
- Smoke del artefacto construido en Chromium y WebKit — PASS.
- Auditoría de dependencias de producción — cero vulnerabilidades con umbral
  `moderate`.

Las combinaciones que usan motores de navegador son automatizadas; no equivalen
a una prueba física en un iPhone, Android, Windows o macOS. La única aceptación
física pendiente es la comprobación controlada de SHARY después de que el dueño
autorice un eventual Hosting-only de este nuevo SHA.

## Límites operativos

- No se ejecutó la reparación del 02/09 otra vez.
- No se creó ni cerró ninguna sesión real.
- No se modificó venta, movimiento, inventario, reporte, auditoría o cuota.
- No se publicó Hosting, Rules, Functions o índices.
- No se debe pedir a SHARY que repita la venta de USD 30.
- Si el resultado físico del cierre fuera incierto, se debe leer el servidor
  antes de ofrecer otro intento.

## Despliegue reversible propuesto

1. Exigir CI obligatorio completamente aprobado para el SHA final.
2. Publicar y validar primero un canal de staging independiente.
3. Obtener otra lectura remota y otro respaldo verificable inmediatamente antes
   de cualquier cambio productivo.
4. Con autorización específica del propietario, desplegar solo Firebase Hosting
   del SHA certificado. No incluir Rules, Functions, Firestore ni índices.
5. Verificar manifiesto, archivos servidos, versión de la PWA, permisos Founder
   Legacy, inventario, ventas y diagnóstico de sincronización.
6. Si falla una condición, volver al canal de Hosting recuperable conservado
   antes del despliegue; los datos Firestore no forman parte de la reversión.
7. Solo después, pedir un único cierre del 03/09. No repetir la venta.
8. Leer el servidor y confirmar una venta, un movimiento, un descuento de stock,
   una sesión cerrada y un reporte antes de declarar la recuperación definitiva.

## Estado

El código está listo para revisión local. El PR, CI, staging y aceptación física
se documentarán con su evidencia exacta; ninguno se considera aprobado por este
documento de trabajo.
