# CLICK 360 V16.2 - Checklist de QA

Build esperado: `mvp-launch-v16-2-r1`

Rama esperada: `release/v16-2-commercial-mvp`

Regla de evidencia: no marcar una casilla por inferencia. Registrar fecha, entorno y enlace/log en la tabla final. Las pruebas con cuentas reales son de solo lectura y no crean ventas, productos, movimientos ni otros datos comerciales.

## 1. Preparación y suite automatizada

- [x] Confirmar Java 21, proyecto Firebase `click-360` y Node local compatible; CI fija Node 22.
- [x] Ejecutar `npm ci` desde un árbol de trabajo controlado.
- [x] Ejecutar `npm run qa` y confirmar código 0.
- [x] Ejecutar `npm run qa:rules` y confirmar código 0.
- [x] Confirmar que el log del emulador no contiene `maximum of 1000 expressions`.
- [x] Ejecutar `npm run audit:fixture`.
- [x] Ejecutar `npm run migrate:fixture` en dry-run.
- [x] Ejecutar `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades de producción.
- [x] Confirmar que el build estático contiene solo la allowlist pública (17 entradas).
- [x] Confirmar que scripts administrativos, fixtures, informes privados y credenciales no entran al build.

## 2. Identidad y acceso

- [ ] Una cuenta con `accountAccess/{uid}` válido se resuelve antes de `approvedUsers`, email o invitación.
- [ ] Una cuenta fundadora entra sin trial ni paywall.
- [ ] Una cuenta `paid_base` entra sin trial ni paywall.
- [ ] Una cuenta `paid_pro` conserva Pro.
- [ ] Una cuenta lifetime conserva acceso.
- [ ] Una cuenta histórica solo se recupera cuando el UID queda inequívocamente validado.
- [ ] Un error de red o permisos al buscar aprobación produce estado recuperable y no crea trial.
- [ ] Una cuenta realmente nueva obtiene un solo trial.
- [ ] Una cuenta no aprobada no lee ni crea un tenant ajeno.
- [ ] Una invitación inválida, vencida o revocada se limpia sin secuestrar el login normal.
- [ ] `lastSeenAt` fallando no cambia identidad, plan ni acceso.
- [ ] Logout cancela listeners, timers, escrituras diferidas, estado en memoria y contexto tenant.

## 3. Trial de siete días

- [ ] Inicio y fin se calculan con tiempo confiable del servidor.
- [ ] Duración exacta: `7 * 24 * 60 * 60 * 1000` ms.
- [ ] Timestamp Firestore se interpreta correctamente.
- [ ] Segundos Unix se convierten correctamente.
- [ ] Milisegundos Unix se conservan correctamente.
- [ ] Microsegundos se normalizan correctamente.
- [ ] El reloj local adelantado o atrasado no extiende ni acorta el trial.
- [ ] La UI muestra días, horas y fecha/hora de finalización coherentes.
- [ ] Trial expirado conserva datos en lectura y muestra activación comercial.
- [ ] El cliente no puede modificar status, plan, fechas, lifetime ni límites.
- [ ] Un fundador o pagado nunca es convertido automáticamente en trial.

## 4. Shary y `ONLINE_ONLY_SAFE`

- [ ] Verificar en solo lectura Auth activo y `accountAccess` `paid_base` por su UID real.
- [ ] Confirmar UID, ownerId, businessId y tenantKey coherentes.
- [ ] Entrar con `shary10mmvv@gmail.com` sin invitación ni trial.
- [ ] Si aún no existe tenant, confirmar creación V10 transaccional y vacía, sin seed demo.
- [ ] Simular localStorage no disponible: conservar IndexedDB si funciona; usar `ONLINE_ONLY_SAFE` solo si no queda otra copia local.
- [ ] Simular IndexedDB no disponible: conservar localStorage si funciona; usar `ONLINE_ONLY_SAFE` solo si no queda otra copia local.
- [ ] Confirmar que `STATE_DOC.set()` no se ejecuta en bootstrap.
- [ ] Confirmar que la interfaz no anuncia guardado antes de confirmación remota.
- [ ] Cerrar y volver a entrar; mantener exclusivamente su tenant.

## 5. Aislamiento y concurrencia

- [ ] Ejecutar A -> logout -> B -> logout -> A durante 10 ciclos.
- [ ] Confirmar que nombre, foto, negocio, inventario, ventas, caja y CRM nunca pasan de A a B.
- [ ] Confirmar namespaces distintos en localStorage por aplicación + UID + tenant.
- [ ] Confirmar snapshots IndexedDB separados por UID + tenant.
- [ ] Confirmar listeners asociados a la época Auth actual.
- [ ] Abrir A y B en dos pestañas/perfiles; ninguna actualización cruza tenant.
- [ ] Probar cambio rápido de cuenta durante pull y durante push.
- [ ] Probar refresh durante resolución de identidad.
- [ ] Probar escritura concurrente y confirmar control por revision/hash.
- [ ] Probar caché local corrupta con remoto V10 válido; el remoto prevalece.
- [ ] Probar marcador legacy/cuarentena obsoleto del mismo tenant; se reconcilia de forma idempotente.
- [ ] Confirmar que marcadores de otros UID/tenant permanecen intactos.
- [ ] Confirmar que ninguna caché de otros productos del dominio se elimina.

## 6. Offline, reconexión y PWA

- [ ] Instalar PWA en Chrome Android.
- [ ] Añadir a inicio en Safari iPhone.
- [x] Confirmar manifest, iconos, nombre, orientación y `start_url` mediante Chrome Android emulado.
- [x] Confirmar versión de caché `click360-mvp-launch-v16-2-r1`.
- [x] Actualizar desde V16.1.2/caché antigua y comprobar que no queda JS mezclado.
- [x] Abrir shell sin internet con caché válida y una solicitud de red bloqueada.
- [ ] Crear un cambio permitido offline en tenant de prueba y reconectar.
- [ ] Confirmar una sola sincronización y ausencia de duplicados.
- [ ] Eliminar un producto en tenant de prueba, reconectar y confirmar que no reaparece.
- [ ] En `ONLINE_ONLY_SAFE`, desconectar y confirmar que la edición queda pausada de forma clara.

## 7. Migración V9 -> V10

- [ ] Clasificar owner inequívoco antes de dry-run.
- [ ] Bloquear casos ambiguos, sospechosos y huérfanos.
- [ ] Crear y releer backup administrativo antes de escribir.
- [ ] Comparar hash de origen inmediatamente antes de migrar.
- [ ] Comparar exactamente negocios, productos, ventas, movimientos, facturas y reportes.
- [ ] Comparar exactamente trabajadores, plantillas, eliminados y logs.
- [ ] Comparar apartados, sesiones de caja, notificaciones y aceptaciones legales.
- [ ] Comparar clientes, recordatorios y solicitudes de activación.
- [ ] Verificar preservación de perfiles, onboarding y políticas.
- [ ] Releer el documento y validar schemaVersion 10, UID, ownerId, businessId y tenantKey.
- [ ] Validar hash lógico y conteos post-migración.
- [ ] Interrumpir una migración simulada; confirmar original y backup intactos.
- [ ] Confirmar que `demo-click360` nunca entra en allowlist ni recibe escritura.

## 8. Integridad comercial

Usar exclusivamente tenant/fixtures de QA.

- [ ] Crear, editar y eliminar producto; verificar stock y tombstone por negocio.
- [ ] Registrar venta y confirmar stock, venta, movimiento y comprobante coherentes.
- [ ] Confirmar subtotal previo al descuento, descuento, IVA y total.
- [ ] Confirmar que `IVA desactivado` no se reactiva por normalización.
- [ ] Anular una venta una sola vez; no duplicar devolución ni movimiento.
- [ ] Intentar anular una venta de otro negocio; debe bloquearse.
- [ ] Registrar y cobrar apartado dentro del negocio activo.
- [ ] Abrir caja, crear/editar/anular movimiento y cerrar caja.
- [ ] Intentar editar un día cerrado; debe bloquearse o exigir reapertura auditable.
- [ ] Crear y anular factura de proveedor con inventario coherente.
- [ ] Restaurar backup y reiniciar inventario/sistema con doble confirmación.
- [ ] En cada operación crítica en línea, esperar confirmación remota antes de éxito.
- [ ] Forzar fallo remoto; confirmar rollback local y mensaje amigable.
- [ ] Repetir/reintentar una operación; confirmar idempotencia por operationId.

## 9. Trabajadores y Rules

- [ ] El propietario puede leer/escribir exclusivamente su snapshot V10.
- [ ] Un UID ajeno no puede leer, crear, actualizar ni borrar el snapshot.
- [ ] Un miembro invitado no puede leer el snapshot monolítico completo.
- [ ] Un miembro invitado no puede actualizar el snapshot por cambio de tamaño de listas.
- [ ] La UI informa que el acceso operativo de trabajadores está temporalmente pausado.
- [ ] Invitaciones y membresías existentes no se borran ni se convierten en acceso de propietario.
- [ ] Documentar la modularización por registros como P1 antes de reactivar trabajadores.

## 10. Seguridad y datos protegidos

- [ ] `accountAccess` tiene precedencia y no puede contradecir una aprobación legacy.
- [ ] UID, ownerId, businessId y tenantKey coinciden en toda lectura/escritura.
- [ ] El cliente no puede concederse planes, cambiar trial ni crear backups administrativos.
- [ ] `adminBackups` y `adminAuditLogs` están denegados al cliente.
- [ ] No hay tokens de invitación sin hash en documentos públicos.
- [ ] No hay claves, credenciales, UIDs de diagnóstico ni stacks técnicos visibles en UI.
- [ ] Reportes de error incluyen código, archivo, stack sanitizado, navegador, versión y URL segura.
- [ ] `demo-click360` da permiso denegado y permanece intacto en auditoría read-only.

## 11. UX y navegadores

- [ ] Safari iPhone: login, navegación, modal, teclado, PWA y logout.
- [ ] Chrome iPhone: login, navegación, modal, teclado y logout.
- [ ] Chrome Android: login, PWA, cámara/QR, offline y logout.
- [ ] Chrome desktop: flujos completos y dos pestañas.
- [x] Firefox desktop: shell público y cero errores inesperados; flujo autenticado pendiente.
- [ ] Viewports autenticados 320, 375, 768, 1024, 1440 y 1920 px sin overflow horizontal.
- [x] Shell público en 320, 360, 393, 740 landscape, 1280 y 1440 px sin overflow horizontal.
- [x] Orientación landscape corta sin solapamientos en el shell público.
- [x] Banner público centrado, sin deformación ni recorte importante; banner Inicio autenticado pendiente de smoke.
- [ ] Modales atrapan foco, cierran con Escape y restauran foco.
- [x] Objetivos táctiles principales del acceso público miden al menos 44 x 44 px.
- [ ] QR responde a teclado/touch, descarga PNG escaneable e imprime a tamaño esperado.
- [x] Consola pública: cero errores inesperados en Chromium, Chrome Android, WebKit iPhone y Firefox.

## 12. Cierre Git, CI y publicación

- [x] Revisar `git diff` y confirmar ausencia de archivos privados o cambios fuera de alcance.
- [x] Commit de implementación creado e identificado: `b1df664`.
- [x] Documentación base incluida en `b1df664`; evidencia operativa actualizada en la misma rama.
- [x] Rama `release/v16-2-commercial-mvp` subida a GitHub.
- [x] PR Draft creado: `https://github.com/roddysmith23-stack/CLICK-360/pull/13`.
- [ ] PR revisado y aprobado.
- [x] CI del commit de implementación verde: run `29405740605`.
- [ ] Merge a `main` autorizado y completado.
- [ ] Reglas Firestore desplegadas desde el mismo SHA aprobado.
- [ ] Firebase Hosting publicado desde el build allowlist del mismo SHA.
- [ ] GitHub Pages actualizado como respaldo si forma parte del release autorizado.
- [ ] Abrir URL con `?v=mvp-launch-v16-2-r1` y confirmar versión visible.
- [ ] Ejecutar smoke público sin crear ni modificar operaciones comerciales reales.
- [ ] Si falla código, Rules, Hosting o aislamiento, detener release y aplicar rollback controlado.

## Evidencia final

| Evidencia | Resultado |
| --- | --- |
| Commit implementación | `b1df664` |
| Commit documentación | `b1df664` + cierre de evidencia en la misma rama |
| PR | `https://github.com/roddysmith23-stack/CLICK-360/pull/13` (Draft) |
| CI | `PASS: https://github.com/roddysmith23-stack/CLICK-360/actions/runs/29405740605 @ b1df664` |
| QA local | `PASS 2026-07-15: npm run qa` |
| Rules emulator | `PASS 2026-07-15: npm run qa:rules, sin límite de expresiones` |
| Matriz navegadores | `PASS shell público: Chromium, Chrome Android, WebKit iPhone y Firefox; capturas en output/playwright (no publicadas)` |
| Smoke Shary | `[PENDING: fecha + resultado]` |
| Smoke fundador/cuentas válidas | `[PENDING: fecha + resultado]` |
| Auditoría `demo-click360` | `PASS read-only: permanece CROSS_TENANT_SUSPECT; no se escribió` |
| Rules release | `[PENDING: ID/hash]` |
| Hosting release | `[PENDING: ID/hash]` |
| URL cache-busting | `[PENDING: URL]` |
| Decisión final | `NO GO publicación / GO PR Draft: faltan smoke autenticado y aceptación owner-only` |
