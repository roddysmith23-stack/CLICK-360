# CLICK 360 V16 QA Report

Fecha: 2026-07-13
Decisión previa al release: GO técnico

## Suites ejecutadas

- `npm run qa`: PASS.
- `npm run qa:rules`: PASS con Firestore Emulator.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades.
- `git diff --check`: PASS.

## Cobertura

- A → B → A durante 10 ciclos y estrés de 100 tenants/1.000 cambios.
- logout rápido, callbacks ligados a epoch, listeners descargados y rutas Firestore exactas.
- dos pestañas, teléfono simulado, offline/reconexión y producto eliminado que no reaparece.
- localStorage/IndexedDB ausente, lleno, corrupto o extranjero.
- V10 remoto contra seed, marcadores legacy/cuarentena y documento legacy bloqueado.
- trial activo/expirado, founder, lifetime, paid Base/Pro, paid vencido y comprador histórico.
- revalidación por tiempo de servidor al entrar, expiración automática en sesión y heartbeat compatible con registros históricos.
- invitación de un uso, replay, email incorrecto, worker view-only y permisos de módulo/acción.
- IVA incluido/excluido/exento, descuento, redondeo, venta y recibo con valores congelados.
- apartados, términos snapshot, abonos, reserva/restauración de stock.
- cierre de caja, detalle, diferencia, auditoría y exportación segura.
- editor de etiqueta: guardar, aparición inmediata, QR, red social, mover, redimensionar, duplicar, PNG e impresión.
- rutas admin/backup/demo denegadas al cliente.
- actualización legítima de perfil permitida; inyección de campos de plan, vencimiento o límites denegada mediante `affectedKeys()`.

## QA visual local

Se verificaron landing y app en 1440 px, 390 px y 320 px; Home, Inventario, Vender, Etiquetas, Recordatorios, Mi plan y móvil. No hubo errores de consola; Firebase compat emite únicamente un aviso de deprecación futura para persistencia multi-tab.

## Producción controlada

- Auditoría: 3 `CLEAN_V10`, 1 `CROSS_TENANT_SUSPECT`, 0 legacy.
- Shary: UID/email exactos, Auth habilitado, acceso recuperado `paid_base` con backup/auditoría.
- `demo-click360`: hash y conteos idénticos antes/después.
- No se creó, vendió, editó ni borró información comercial real.

## Límite de evidencia

El comportamiento físico de instalación/notificaciones varía por versión de iOS/Android. El flujo responsive y PWA se prueba automáticamente; la comprobación física final se mantiene en la checklist manual y no implica una regresión de código.
