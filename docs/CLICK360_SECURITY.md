# CLICK 360 Security

## Cambios de reglas

- `businesses/{businessId}` ahora requiere que `businessId` coincida con `approvedUsers/{uid}.ownerId` o con el UID del owner en cuentas historicas.
- La creacion de trabajadores exige email preaprobado activo.
- El trabajador no puede autoproclamarse owner.
- Las invitaciones solo las crea/revoca el owner de ese tenant.
- No se permiten deletes directos en documentos sensibles.
- La revocacion usa `status: "blocked"` o `"revoked"` y `approved: false`.

## Cambios de app

- Zona de peligro restringida a owner.
- Restaurar respaldos restringido a owner.
- Trabajadores ya no ven herramientas de backup/reportes/trabajadores/facturas como acciones principales.
- Reapertura de caja solo owner y con motivo auditado.

## Pendientes antes de produccion completa

- Publicar `firestore.rules` en Firebase.
- Probar reglas contra usuarios reales: owner, worker activo, worker revocado, usuario no aprobado.
- Pasar a colecciones por entidad para permitir reglas mas granulares por modulo.
