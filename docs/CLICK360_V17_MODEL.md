# CLICK 360 V17 - Modelo de acceso

## Principio

V17 separa cinco conceptos que no pueden inferirse entre sí:

| Concepto | Campo | Valores iniciales |
| --- | --- | --- |
| Rol de plataforma | `platformRole` | `platform_founder`, `platform_admin`, `support_admin`, `customer` |
| Rol en una organización | `organizationRole` | `owner`, `co_owner`, `admin`, `manager`, `worker` |
| Plan | `plan` | `founder_unlimited`, `pro`, `base`, `trial` |
| Facturación | `billingStatus` | `internal`, `lifetime`, `subscription`, `trial` |
| Reconocimiento | `customerTier` | `platform_founder`, `founding_customer`, `standard_customer` |

El campo histórico `founder` no representa simultáneamente permisos, plan y reconocimiento.

## Documentos

- `users/{uid}` identifica a una persona de Firebase Authentication.
- `organizations/{organizationId}` identifica un negocio con un ID opaco distinto del UID.
- `organizations/{organizationId}/members/{uid}` define el rol de esa persona en ese negocio.
- `userOrganizations/{uid}/organizations/{organizationId}` permite resolver las organizaciones de una persona.
- `subscriptions/{organizationId}` define plan y facturación del negocio.
- `entitlements/{uid}` define el acceso permanente o temporal de la persona.
- `plans/{planId}` es el catálogo central de funciones y límites.
- `activationCodes/{codeHash}` guarda solo el hash SHA-256 de un código aleatorio de un solo uso.
- `activationRequests`, `provisioningJobs`, `auditLogs` y `supportDiagnostics` soportan activación, idempotencia y diagnóstico.

Durante la transición, `businesses/{uid}/state/main` permanece intacto como snapshot V10. `accountAccess.businessId == uid` se conserva únicamente como puente de compatibilidad; `primaryOrganizationId` enlaza el modelo V17.

## Identidades confirmadas

| Persona | Identidad Auth | Acceso V17 |
| --- | --- | --- |
| Sr. Smith | UID `iESlWpF92JXaGDoYTQ28ThWs93y1`, `roddysmith23@hotmail.com`; correo administrativo `roddysmithceo@gmail.com` | `platform_founder`, `super_admin`, `founder_unlimited`, `internal` |
| Debby | UID `g9e8NjJjrDS3ldvNxHLlhqvzm3E3`, `debbya632@gmail.com` | `platform_founder`, `founder_admin`, `founder_unlimited`, `internal`; membership `co_owner` diferida hasta autorizar una organización |
| Shary | UID `3UTjgHd1QNSvqlcXNKQ6tL79X7u2`, `shary10mmvv@gmail.com` | `customer`, owner, `pro_lifetime`, `lifetime`, `founding_customer` |
| Lía | Sin Auth ni UID; correo pendiente `liavero_zambrano@hotmail.com` | Activación hash-only; PRO Lifetime después de autenticar el UID real |

El tenant con “Lía Perfumería” bajo `cPy0PqLSHGO6Ei3xlRc2DHufQ5B3` es `internal_demo` / `sales_sandbox`. No pertenece automáticamente a Lía y no puede transferirse. Una importación futura requiere revisión selectiva y excluye ventas, caja, movimientos y auditorías.

## Planes

`scripts/lib/click360-v17-access-core.mjs` es la definición canónica actual.

- `founder_unlimited`: organizaciones y trabajadores ilimitados, todas las funciones, administración de plataforma, facturación `internal`, sin vencimiento.
- `pro`: una organización, cinco trabajadores, funciones PRO, soporte y recuperación prioritarios. Puede ser `lifetime` o `subscription`.
- `base`: una organización, dos trabajadores y funciones base. Puede ser `subscription` o `trial`.

PRO Lifetime no concede Control Center, acceso cruzado, organizaciones ilimitadas, white label ni API empresarial ilimitada.

## Flujo

Las funciones puras `bootstrapSession`, `provisionOrganization`, `repairAccount`, `approveAccount`, `redeemActivationCode` y `refreshAccessClaims` producen decisiones verificables. La ejecución administrativa debe:

1. Resolver Auth por UID y correo normalizado.
2. Releer todos los documentos y hashes esperados.
3. Crear y verificar `adminBackups/{backupId}`.
4. Crear un `provisioningJobs/{jobId}` idempotente.
5. Crear ausentes con precondición create-only y modificar existentes solo con hash previo coincidente.
6. Refrescar claims conservando claims no relacionados.
7. Ejecutar `bootstrapSession()` y exigir `READY`.
8. Recalcular hashes y conteos de todos los tenants protegidos.
9. Registrar `auditLogs/{auditId}`.

## Seguridad

- `super_admin` puede inspeccionar organizaciones globalmente; las escrituras administrativas siguen bloqueadas en el cliente.
- `founder_admin` puede ver metadatos del Control Center, pero solo entra a una organización con membresía activa.
- Un `customer` solo ve su usuario, entitlement y organizaciones activas.
- Shary y Lía nunca reciben `platformRole: platform_founder` ni `platformAdmin: true`.
- `activationCodes` no es legible ni escribible por clientes.
- Operaciones críticas exigen reautenticación, confirmación, motivo, backup, auditoría y, para `founder_admin`, aprobación adicional de `super_admin`.

Las reglas V17 incluidas en esta rama son candidatas y solo se probaron en emulador. No se desplegaron.

El ejecutor `scripts/admin-access-v17.mjs` está intencionalmente limitado a dry-run. Verifica plan, actor, identidades, rutas, precondiciones y tenants, pero no contiene métodos de escritura.
