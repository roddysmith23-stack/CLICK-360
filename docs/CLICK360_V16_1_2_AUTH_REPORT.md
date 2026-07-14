# CLICK 360 V16.1.2 - Acceso y aislamiento

## Causa raíz

El fallo no era un límite de dispositivos ni IAM. La ruta de entrada combinaba aprobación legacy, invitación y `accountAccess`; una invitación obsoleta podía cortar la resolución y la interfaz decidía qué botones mostrar mediante `message.includes(...)`. Además, la actualización de `lastSeenAt` estaba acoplada a la lectura crítica y convertía fallos secundarios en falsos "sin cuenta".

## Corrección

- Se añadió una máquina de estados: `loading`, `unauthenticated`, `authenticated_resolving`, `invalid_invitation`, `recoverable_error`, `authenticated_no_access`, `pending`, `blocked`, `online_only_safe` y `ready`.
- La resolución usa UID y consulta primero `accountAccess/{uid}`. Email queda solo como atributo.
- Se valida que `uid`, `ownerId`, `businessId` y `tenantKey` correspondan exactamente al usuario autenticado.
- Una invitación requiere envío explícito del formulario, sesión efímera de 30 minutos, propietario y token. Una URL vieja se limpia y continúa por login normal.
- `lastSeenAt` se actualiza después de entrar; un fallo solo produce telemetría sanitizada.
- La prueba gratuita se crea únicamente desde `Probar gratis` o `Registrarse`, una vez por UID y usando tiempo emitido por servidor.
- Una cuenta pagada sin tenant crea solo su documento V10 mediante transacción. Si aparece un remoto concurrente, lo relee y no lo reemplaza.
- Si localStorage o IndexedDB fallan, el remoto sigue siendo fuente principal y la cuenta entra en `ONLINE_ONLY_SAFE` con internet.
- Caché de acceso, estado, perfil y sesión quedan aisladas por aplicación + UID + tenant.
- Timers, listeners y escrituras diferidas validan época Auth, UID y tenant antes de actuar.

## Pruebas ejecutables

- A -> B -> A durante 10 ciclos y estrés de 100 tenants.
- Dos pestañas, reconexión y eliminación que no reaparece.
- Invitación inválida, vieja, consumida y revocada.
- Cuenta sin acceso, fundador, prueba nueva, expirada y cuenta pagada sin tenant.
- Almacenamiento lleno/ausente y `ONLINE_ONLY_SAFE`.
- `lastSeenAt` fallando, red intermitente y permission denied.
- Documento remoto concurrente y prohibición de `STATE_DOC.set()` ciego.
- Reglas: lectura propia, escritura por tenant, campos de plan protegidos y `demo-click360` denegado.

`npm run qa` y `npm run qa:rules` finalizaron con código 0. La suite de reglas confirmó que un UID pagado puede crear transaccionalmente únicamente su propio primer tenant V10.

## Shary

La inspección administrativa de solo lectura mantiene Auth activo, `paid_base`, plan Base, UID/businessId coherentes y sin tenant previo. Con V16.1.2 su próximo login limpio toma la ruta pagada por UID; no crea trial ni copia datos. La comprobación visual autenticada con su cuenta real permanece en el checklist manual porque no se crean operaciones comerciales automatizadas en producción.
