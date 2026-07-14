# CLICK 360 V16.1 Initial Audit

Fecha: 2026-07-14

Proyecto: `click-360`

Rama: `hotfix/v16-1-commercial-stability`

Base: `main` en `0f526da`

## Auditoria de produccion, solo lectura

La auditoria administrativa se ejecuto sin escribir documentos:

| Resultado | Cantidad |
| --- | ---: |
| Tenants inspeccionados | 4 |
| `CLEAN_V10` | 3 |
| `CROSS_TENANT_SUSPECT` | 1 |
| Legacy claro/ambiguo | 0 |
| Orphaned | 0 |

`demo-click360` continua clasificado `CROSS_TENANT_SUSPECT`. No se uso como fuente, no se migro y no se modifico.

## Cuenta critica

- Email exacto: `shary10mmvv@gmail.com`
- UID: `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`
- Firebase Auth: habilitado, proveedor Google
- Acceso: `paid_base`, plan Base, revision 1
- `businessId`: igual al UID
- Documento `businesses/{uid}/state/main`: todavia no existe

La cuenta no tiene datos comerciales previos que importar. Su primer ingreso debe crear un estado vacio exclusivamente en su propia ruta, mediante una transaccion que no sobrescribe documentos existentes.

## Hallazgos reproducidos

1. Una cuenta valida podia quedar bloqueada si fallaba la primera copia local, aunque Firestore estuviera disponible.
2. Prueba gratis y registro enviaban nombres de origen incompatibles con el valor `self_service` permitido por Rules.
3. Los CTA publicos compartian comportamiento y no expresaban intenciones independientes.
4. El editor QR era tecnico, largo y sin controles tactiles simples.
5. La lista de plantillas no se actualizaba detras del editor hasta volver a Inventario.
6. El shell podia acumular un segundo `#modalRoot`, dejando un overlay invisible que interceptaba toques.
7. El header movil, selector, notificaciones y accesos de `Mas` necesitaban una composicion consistente.
8. Faltaban reloj del negocio, calculadora integrada, FAQ estructurada, sitemap y robots.

## Correcciones aplicadas

- Bootstrap inicial local o `ONLINE_ONLY_SAFE`, siempre condicionado a identidad, acceso, conexion y ruta exacta.
- Primera escritura cloud-only transaccional; ningun `STATE_DOC.set()` y ninguna sustitucion de remoto existente.
- Intenciones publicas `login`, `trial`, `register` e `invite`, con bloqueo de doble clic.
- Trial unico de siete dias por UID y tiempo de Firestore; `login` nunca crea trial.
- Editor QR sencillo, presets, drag/resize, modo avanzado, IVA, redes, guardado e impresion.
- Actualizacion inmediata de la lista de plantillas sin cerrar el editor.
- Un solo modal root, cierre seguro al navegar y controles accesibles.
- Landing, FAQ, metadatos, PWA y cache `mvp-launch-v16-1-r1`.

## Riesgos controlados

- El snapshot monolitico V10 sigue siendo una deuda de escala, no un bloqueo para beta privada.
- Fotos base64 grandes siguen limitadas por el tope de payload y la compresion del cliente.
- OAuth en navegadores embebidos se deriva a Safari o Chrome; no se intenta debilitar Auth.
- La comprobacion fisica de iPhone/PWA y el ingreso interactivo de Shary forman parte del smoke posterior a publicacion.
