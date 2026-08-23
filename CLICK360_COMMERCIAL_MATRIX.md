# CLICK 360 — Matriz comercial

Fuente única de verdad: `PLAN_CATALOG` en `v16-domain.js`. Este documento es una lectura humana de esa fuente — si alguna vez hay una diferencia entre este archivo y el código, **el código gana** y este documento debe actualizarse.

Última actualización: 2026-08-23 (release Commercial MVP).

## 1. Planes y precios

| Plan (código interno) | Nombre visible | Mensual | Trimestral | Semestral | Anual | Vitalicio |
|---|---|---|---|---|---|---|
| `base` | **Basic** | $40.00 | $114 | $180 | $240 | $600 (único) |
| `pro` | **Pro** | $59.99 | $169 | $299 | $499 | No disponible |
| `business` | **Business** | $99.99 | $291 | $540 | $999 | No disponible |
| `enterprise` | **Enterprise** | Cotización | Cotización | Cotización | Cotización | Cotización |
| `founder_legacy` | **Founder** | Sin mensualidad (licencia histórica) | — | — | — | — |

El plan **Anual** debe presentarse siempre como el recomendado (mejor precio por mes). El plan Vitalicio solo existe en Basic.

**Enterprise** no tiene precio de autoservicio: el CTA es "Solicitar cotización" (`period: "custom"`), y AIIA/el equipo comercial define el precio caso por caso según número de negocios, catálogo y cupos de Workers.

**Founder** no es un plan que se vende — es una licencia histórica permanente para clientes fundadores (ver sección 4).

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

Clientes Founder confirmados y activados en producción: **SHARY** (`3UTjgHd1QNSvqlcXNKQ6tL79X7u2`, activada 2026-08-23, fuente histórica `founding_customer_upgrade`).

**Pendiente de confirmación humana:** existen dos negocios reales con nombre "Lía/Lia" (`Lia perfumería`, uid `UCfRR5x7pagYAoZkj6XuVpcAyFw1`, plan Pro actual; y `Lía Perfumeria`, uid `cPy0PqLSHGO6Ei3xlRc2DHufQ5B3`, plan Pro actual). Ninguna de las dos cuentas tiene en sus datos un marcador que identifique claramente cuál es la que originalmente tenía estatus Founder — ambas se activaron por vías ordinarias (`self_service` y `manual_admin` respectivamente), a diferencia de SHARY cuyo registro sí dice `founding_customer_upgrade`. **No se adivinó ni se modificó el acceso de ninguna de las dos** — ambas siguen con su plan Pro actual, con acceso completo. Se necesita que Mr. Smith confirme cuál de las dos (si alguna) es la cuenta Founder original antes de aplicar `founder_legacy`.

## 5. Add-ons de capacidad

No existe todavía un precio comercial aprobado para add-ons de productos/almacenamiento/Workers adicionales más allá de lo ya definido (cupos base de Workers). Por diseño, esto **no bloquea** la arquitectura: el cliente puede solicitar más capacidad desde "Mi plan y acceso" (botón "Solicitar más capacidad" / "Solicitar Worker adicional"), lo que genera una solicitud auditable (`capacityRequests` / `seatRequests` en Firestore) que AIIA revisa y activa manualmente vía `scripts/admin-access-v16.mjs`. Cuando exista un precio aprobado para un add-on específico, agregarlo aquí y a `PLAN_CATALOG`.

## 6. Estado de las funciones (qué se puede vender hoy)

### Production Ready (vender sin reservas)
Inventario, Ventas/Checkout, Caja, Apartados + abonos, Recordatorios por WhatsApp (envío manual, por diseño), Impresión de recibos, Impresión de etiquetas/QR, Auditoría, Reportes, Configuración del negocio, KDS (cocina/bar), Mesas/Restaurante.

### Pilot (funciona, con límites reales que el vendedor debe conocer)
- **CRM**: funcional pero delgado (seguimiento básico de clientes).
- **Workers**: sistema completo y probado, pero activación es controlada tenant por tenant (no autoservicio todavía) — ver sección 7.
- **Logística / rutas**: el despacho de hojas de ruta NO descuenta inventario automáticamente todavía (existe la lógica correcta en `p2-logistics-domain.js` pero no está conectada a la UI real); el cierre de liquidación es una sola acción sin flujo de aprobación/variación/reapertura. No prometer estas dos capacidades como completas a un cliente de distribución.
- **Vehículos**: mismos límites que logística (módulo compartido).

### Hidden / no vender todavía (no implementado)
- **Sucursales físicas** (branches) — no existe en el código, solo el concepto de "negocios" independientes dentro de una cuenta.
- **Bodegas** (warehouses) — no existe.
- **Estaciones POS / multi-caja** — no existe.

## 7. Workers (trabajadores)

Sistema completo, probado y en producción para los 5 clientes reales actuales. Regla comercial: el dueño no consume cupo (0 asientos), cada plan incluye 2 cupos base, el máximo por plan está en la tabla de la sección 2, revocar un acceso libera el cupo, y el aislamiento entre negocios (cross-tenant) está verificado. La activación de Workers para un cliente nuevo es un paso manual de AIIA (no autoservicio), controlado por una lista explícita de tenants autorizados en `scripts/config/pilot-authorized-tenants.json`.
