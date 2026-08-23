# CLICK 360 — Matriz comercial

Fuente única de verdad: `PLAN_CATALOG` en `v16-domain.js`. Este documento es una lectura humana de esa fuente — si alguna vez hay una diferencia entre este archivo y el código, **el código gana** y este documento debe actualizarse.

Última actualización: 2026-08-23 (release r36 — completación comercial final: precios, CEO Admin Web, Print Engine Normal/Avanzado, logística con descuento de inventario y liquidación con aprobación. Ver `CLICK360_R36_FINAL_COMPLETION.md` para el reporte completo con evidencia).

## 1. Planes y precios (oferta vigente para clientes NUEVOS)

| Plan (código interno) | Nombre visible | Mensual | Anual (recomendado) |
|---|---|---|---|
| `base` | **Basic** | $39.99 | $399 |
| `pro` | **Pro** | $59.99 | $599 |
| `business` | **Business** | $99.99 | $999 |
| `enterprise` | **Enterprise** | Cotización personalizada | Cotización personalizada |
| `founder_legacy` | **Founder** | **No se vende a clientes nuevos** — solo licencias históricas ya otorgadas | — |

La oferta comercial estándar es **Mensual** o **Anual — recomendado**. Los períodos trimestral/semestral y el precio vitalicio de Basic ($600) que existían en r35 **ya no forman parte de la oferta actual** y no se muestran como opciones en "Mi plan y acceso" ni en el alta de nuevo cliente del CEO Admin. Esto no afecta ni convierte ninguna cuenta ya facturada con esos períodos — ver la nota de compatibilidad abajo.

**Enterprise** no tiene precio de autoservicio: el CTA es "Solicitar cotización" (`period: "custom"`), y AIIA/el equipo comercial define el precio caso por caso según número de negocios, catálogo y cupos de Workers.

**Founder** no es un plan que se vende — es una licencia histórica permanente para clientes fundadores que ya la compraron For Life/Founder (ver sección 4). No aparece como opción de compra en ningún flujo de alta de cliente nuevo.

**Compatibilidad administrativa con registros históricos**: `scripts/admin-access-v16.mjs` sigue aceptando `--period quarter|semester|lifetime` para reactivar o corregir una cuenta que ya tenía uno de esos períodos — esto es exclusivamente para mantenimiento de cuentas antiguas, nunca se ofrece como opción nueva en ninguna interfaz de venta (Mi Plan, CEO Admin Web, onboarding).

## 2. Límites por plan

| Recurso | Basic | Pro | Business | Enterprise | Founder |
|---|---|---|---|---|---|
| Negocios en la cuenta | 1 | 5 | 10 | 25 | 10 |
| Cupos de Workers incluidos | 2 | 2 | 2 | 2 | 2 |
| Cupos de Workers máximos (con add-on) | 5 | 10 | 25 | Ilimitado | 25 |
| Productos activos | 150 | 500 | 800 | 2,000 | 2,000 |
| Almacenamiento de imágenes (estimado) | 3 MB | 8 MB | 15 MB | 30 MB | 20 MB |

**Base técnica de estos límites** (no son números arbitrarios): medición real de negocios en producción (agosto 2026) mostró que el peso de un producto sin imagen es ~415 bytes, y con imagen (compresión cliente actual, promedio real) ~15.3 KB. El límite duro de Firestore para el documento `state/main` (arquitectura legado, un documento por negocio) es 1 MiB. Con esos datos:
- Sin imágenes, un negocio legado soporta con margen amplio hasta ~800 productos antes de acercarse al límite físico del documento.
- Con imágenes, ese techo baja a ~100–150 productos si TODOS llevan foto.
- La arquitectura modular (Worker Data Boundary, un documento por producto) no tiene ese techo — cada producto es <4% del límite incluso en el peor caso de imagen — pero está acotada por el límite de 400 escrituras por lote de Firestore, no por tamaño de documento.

Por eso Basic/Pro/Business quedan por debajo del techo físico legado con margen real, y Enterprise/Founder (que pueden acumular más catálogo) llevan una nota explícita recomendando arquitectura modular cuando el catálogo crece mucho.

**Cómo se aplican estos límites (importante para ventas):** llegar al límite **nunca** bloquea vender, cobrar, imprimir, consultar clientes/historial ni exportar datos. Solo pausa la **creación** de productos nuevos o el guardado de una imagen nueva que superaría el límite de almacenamiento, hasta que el cliente mejore de plan o solicite más capacidad. El sistema avisa en 70% (informativo), 85% (advertencia) y 95% (crítico) antes de llegar al 100%.

## 3. Funciones por plan

Cada plan incluye todo lo del plan anterior más lo indicado:

**Basic** — Inventario, Ventas, Caja, Apartados, WhatsApp (recordatorios manuales), Etiquetas y QR, Reportes, Clientes, Sincronización en la nube.

**Pro** (todo Basic +) — CRM ampliado, Cobranzas, Recordatorios avanzados, Apartados avanzados, Proveedores, Exportaciones.

**Business** (todo Pro +) — Multi-sucursal de cuentas (hasta 10 negocios en una cuenta), hasta 25 cupos de Workers, soporte prioritario.

**Enterprise** (todo Business +) — Cuotas negociadas, arquitectura modular recomendada para catálogo grande, cotización personalizada.

**Founder** (todo Business +) — Licencia funcional histórica permanente, sin mensualidad por las funciones ya adquiridas, cuotas de infraestructura amplias con margen de crecimiento.

## 4. Founder / Vitalicio histórico

`founder_legacy` es una licencia real, no un descuento: acceso permanente a las funciones que el cliente ya tenía, sin cobro mensual por ellas, pero **no** consumo de infraestructura infinito — sus cuotas (tabla arriba) son generosas y calculadas para superar ampliamente su consumo real medido.

Clientes Founder confirmados y activados en producción: **SHARY** (`3UTjgHd1QNSvqlcXNKQ6tL79X7u2`, activada 2026-08-23, fuente histórica `founding_customer_upgrade`) y **Lía Perfumería** (`UCfRR5x7pagYAoZkj6XuVpcAyFw1`, activada 2026-08-23 — ver resolución abajo).

**Resuelto (r36):** de los dos negocios reales con nombre "Lía/Lia", `Lia perfumería` (uid `UCfRR5x7pagYAoZkj6XuVpcAyFw1`) fue activada a `founder_legacy` el 2026-08-23 tras evidencia convergente que la identifica como la cuenta Founder original (respaldo previo a la escritura y registro en `adminAuditLogs`, verificado post-escritura). La segunda cuenta (`Lía Perfumeria`, uid `cPy0PqLSHGO6Ei3xlRc2DHufQ5B3`) se dejó intacta en su plan Pro actual, sin ninguna modificación — la evidencia documentada en una rama sin fusionar de este mismo repositorio la señala como probable cuenta interna/de demostración, pero **no se actuó sobre esa señal**; solo se usó para no aplicar Founder por error al negocio equivocado.

## 5. Add-ons de capacidad

No existe todavía un precio comercial aprobado para add-ons de productos/almacenamiento/Workers adicionales más allá de lo ya definido (cupos base de Workers). Por diseño, esto **no bloquea** la arquitectura: el cliente puede solicitar más capacidad desde "Mi plan y acceso" (botón "Solicitar más capacidad" / "Solicitar Worker adicional"), lo que genera una solicitud auditable (`capacityRequests` / `seatRequests` en Firestore) que AIIA revisa y activa manualmente vía `scripts/admin-access-v16.mjs`. Cuando exista un precio aprobado para un add-on específico, agregarlo aquí y a `PLAN_CATALOG`.

## 6. Estado de las funciones (qué se puede vender hoy)

### Production Ready (vender sin reservas)
Inventario, Ventas/Checkout, Caja, Apartados + abonos, Recordatorios por WhatsApp (envío manual, por diseño), Impresión de recibos, Impresión de etiquetas/QR, Auditoría, Reportes, Configuración del negocio, KDS (cocina/bar), Mesas/Restaurante.

**Logística / rutas (r36):** el despacho de una hoja de carga ahora descuenta el inventario real del negocio de forma transaccional e idempotente (despachar dos veces no descuenta dos veces). La liquidación diaria tiene un flujo completo con roles: `pendiente de aprobación → aprobada/rechazada → cerrada → reabierta`, con motivo obligatorio al rechazar o reabrir, y reapertura exclusiva del dueño. Las cobranzas de crédito quedan ligadas a una venta de ruta específica con tope de saldo pendiente. Puede ofrecerse a un cliente de distribución como funcionalidad completa, no como piloto. Vehículos comparte los mismos límites (módulo compartido).

### Pilot (funciona, con límites reales que el vendedor debe conocer)
- **CRM**: funcional pero delgado (seguimiento básico de clientes).
- **Workers**: sistema completo y probado, pero activación es controlada tenant por tenant (no autoservicio todavía) — ver sección 7.

### Hidden / no vender todavía (no implementado)
- **Sucursales físicas** (branches) — no existe en el código, solo el concepto de "negocios" independientes dentro de una cuenta.
- **Bodegas** (warehouses) — no existe.
- **Estaciones POS / multi-caja** — no existe.

## 7. CEO Admin Web (r36)

Panel de administración real en el navegador (no solo CLI), visible únicamente para `roddysmithceo@gmail.com` — la app oculta la opción de menú para cualquier otro usuario y, más importante, `firestore.rules` la bloquea a nivel de servidor (`isPlatformAdmin()`) incluso si alguien intentara forzar la ruta desde el navegador. Permite: buscar un cliente por correo, ver su plan/uso/Workers/solicitudes/auditoría, cambiar de plan con vista previa antes de aplicar (mismo patrón de respaldo + verificación por hash + auditoría que la CLI), suspender/reactivar una cuenta, y activar/desactivar Workers para un tenant ya migrado. Sigue existiendo la CLI (`scripts/admin-access-v16.mjs`) para lo que el panel web todavía no cubre (migración de Workers, activación Founder histórica) — ambas comparten la misma función `activationFields()`, así que nunca pueden calcular un resultado distinto para el mismo cliente.

## 8. Workers (trabajadores)

Sistema completo, probado y en producción para los 5 clientes reales actuales. Regla comercial: el dueño no consume cupo (0 asientos), cada plan incluye 2 cupos base, el máximo por plan está en la tabla de la sección 2, revocar un acceso libera el cupo, y el aislamiento entre negocios (cross-tenant) está verificado. La activación de Workers para un cliente nuevo es un paso manual de AIIA (no autoservicio), controlado por una lista explícita de tenants autorizados en `scripts/config/pilot-authorized-tenants.json`.
