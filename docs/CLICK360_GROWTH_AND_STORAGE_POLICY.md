# Crecimiento comercial y almacenamiento — propuesta pendiente de aprobación

## Contratos independientes

1. Cuotas comerciales: negocios, trabajadores, productos activos y almacenamiento contratado. Founder Legacy mantiene su licencia histórica; no se cambia su condición por comprar una ampliación.
2. Capacidad del dispositivo: límite interno actual de 8 MiB para el snapshot local y persistencia comprobada en IndexedDB. No equivale al espacio comprado en nube.
3. Formato cloud heredado: 850000 bytes como guard de `state/main`. Ninguna compra permite escribir un documento de varios MB.
4. Formato modular: transacciones separadas, historial paginado y registros individuales. La capacidad contratada se mide a nivel de cuenta, no como límite de un único documento ni cargando toda la historia por venta.

Las cuotas vigentes efectivas de Founder son 2 negocios / 2 trabajadores / 2000 productos activos. El propietario ha solicitado ampliarlas; las cantidades nuevas y los precios todavía no están definidos. No se inventan valores ni se actualiza ninguna cuenta real. Todos los fundadores reciben la misma política aprobada; nunca se decide por nombre o correo.

## Ampliaciones

- Reutilizar las solicitudes de capacidad existentes para presentar ofertas y obtener aceptación explícita. No afirmar que una solicitud ya es una compra o que existe cobro automático.
- Una concesión de capacidad debe ser autoritativa, aprobada por administración, vinculada al titular, versionada, auditada e idempotente. No puede nacer de configuración local editable por el cliente.
- La ampliación se suma a la licencia base y no concede roles ni elimina las reglas de aislamiento. El estado de cobro, el plazo, los bytes adicionales, los precios/impuestos y las condiciones de cancelación requieren definición del propietario e integración certificada del proveedor de pago.
- Al bajar de plan o caducar una ampliación no se eliminan ni restauran productos, ventas, movimientos, auditoría ni cierres. El tratamiento de nuevas escrituras y el margen de crecimiento requieren una política comercial explícita: no implementar un bloqueo sorpresivo de caja por intuición.
- Advertencias tempranas y solicitud de ampliación/migración, diferenciando uso cloud confirmado, reserva pendiente del dispositivo y estimación. No mostrar sincronización confirmada cuando el respaldo está pendiente.

## Medición y seguridad

El contador actual `storageBytesApprox`, basado en imágenes de productos, y la telemetría de bytes de una operación NO son una medición total ni sirven para facturar almacenamiento. Antes de activar paquetes se requiere un agregador servidor idempotente de documentos y objetos, versiones de medición, conciliación y alertas; no agregar un documento caliente global a cada venta.

El aumento comercial nunca cambia los guards de Firestore ni autoriza migraciones. Antes de activar a un cliente: respaldo fresco y nativo, conciliación del dispositivo, shadow exacto, reglas/fence para PWAs antiguas, repositorio/journal conectados, pruebas, rollback y aprobación individual. No piloto global ni migración destructiva.

Estado: propuesta documentada, sin facturación ni cuotas nuevas activadas. PR #90 resuelve el acoplamiento dispositivo/cloud; PR #91 implementa el núcleo modular y su diario/coordinador en DEV. La integración completa de la interfaz y la migración aún no están certificadas.
