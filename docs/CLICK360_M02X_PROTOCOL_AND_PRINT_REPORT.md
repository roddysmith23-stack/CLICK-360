# CLICK 360 - M02X y centro de impresión

Fecha: 2026-07-14

## Investigación

El producto comercial revisado es Phomemo M02X. La documentación pública confirma impresión térmica por Bluetooth, resolución de 203 dpi y velocidad aproximada de 10 a 15 mm/s. No se encontró una especificación pública verificable del protocolo de impresión, UUID GATT, comandos, MTU, fragmentación o confirmación de trabajo que permita implementar un driver web seguro.

Fuentes primarias consultadas:

- Producto oficial: `https://eu.phomemo.com/products/m02x`
- Manual presentado ante FCC: `https://fccid.io/2ASRB-M02X/User-Manual/User-manual-5492362`
- Expediente FCC: `https://fccid.io/2ASRB-02X`

## Implementación

Se creó un contrato único de proveedores con descubrimiento, conexión, estado, desconexión, olvido, prueba, etiquetas y comprobantes:

- `SystemPrintProvider`: entrega al diálogo nativo del navegador.
- `PdfExportProvider`: genera PDF dentro de CLICK 360.
- `M02XBluetoothProvider`: visible pero desactivado como `validation_required`.
- `NativeBridgeProvider`: punto de integración futuro para un cliente móvil validado.

El Centro de impresión permite elegir salida, ticket 57/80 mm o A4, copias, prueba, desconexión y acciones rápidas. Etiquetas, comprobantes, reportes y cierres reutilizan la capa de salida. Los comprobantes se limitan al negocio activo e incluyen: "Comprobante interno de venta. No válido como factura electrónica."

## Decisión de compatibilidad

**M02X directo: NO VALIDADO.** No se implementaron UUID o comandos inventados y no se muestra una falsa confirmación de impresión. La ruta vendible y comprobada es impresión del sistema, PDF y las descargas PNG existentes. Un driver M02X solo puede habilitarse después de capturar protocolo y completar una impresión/lectura QR con una unidad física.

## Prueba pendiente externa

Se requiere la impresora real para documentar descubrimiento, enlace, etiqueta pequeña/grande, QR, copias, desconexión, reconexión, batería baja, Android e iPhone. Este pendiente P1 no bloquea el acceso P0 ni los fallbacks actuales.
