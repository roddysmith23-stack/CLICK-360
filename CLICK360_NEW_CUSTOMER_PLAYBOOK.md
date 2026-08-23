# CLICK 360 — Playbook de alta de nuevo cliente

Para el equipo comercial / AIIA. No requiere editar Firestore a mano en ningún paso. Ver también `CLICK360_COMMERCIAL_MATRIX.md` para precios/límites/funciones vigentes.

## Antes de empezar

CLICK 360 solo autentica con **Google Sign-In** (no hay usuario/contraseña creado por un admin). Esto significa que el orden siempre es:

1. El cliente abre CLICK 360 e inicia sesión con su cuenta de Google.
2. Automáticamente queda en período de prueba gratuita (7 días) o en estado pendiente.
3. El cliente completa el formulario propio de bienvenida (nombre del negocio, tipo, moneda, zona horaria) — esto **no** lo hace el admin, lo hace el cliente al entrar.
4. **Recién ahí** el admin puede activar su plan comercial.

Si intentas activar un plan para alguien que todavía no inició sesión ni una vez, el sistema te lo va a decir claramente (no un error técnico) — solo pide al cliente que entre una vez y vuelve a intentar.

## Paso a paso: activar un cliente nuevo

Hay dos formas de hacerlo — misma lógica, mismas verificaciones (respaldo, hash, auditoría), dos interfaces:

### Opción A — CEO Admin Web (r36, recomendado para el día a día)

1. Entra a CLICK 360 con `roddysmithceo@gmail.com` y abre "CEO Admin" en el menú (solo visible para esa cuenta).
2. Busca al cliente por su correo de Google. Si todavía no inició sesión ni una vez, el panel te lo dice claramente — pide al cliente que entre una vez y vuelve a buscar.
3. En "Cambiar plan", elige plan y período, y presiona "Ver preview" — te muestra exactamente lo que el cliente va a recibir (plan, estado, período, límites de negocios y Workers) sin cambiar nada todavía.
4. Revisa el preview y presiona "Confirmar y aplicar". El panel hace respaldo antes de escribir, verifica que nada cambió desde el preview, y deja registro de auditoría — igual que la CLI.

### Opción B — Terminal (para lo que el panel web todavía no cubre: migración de Workers, activación Founder histórica)

Requiere acceso a una terminal con las credenciales administrativas de CLICK 360 (hoy: solo `roddysmithceo@gmail.com`).

```
node scripts/onboard-new-customer.mjs \
  --actor roddysmithceo@gmail.com \
  --email correo-del-cliente@gmail.com \
  --plan pro \
  --period year \
  --business-type retail \
  --addons "ninguno por ahora"
```

- `--plan`: `base` (Basic) | `pro` | `business` | `enterprise` | `founder_legacy`
- `--period`: para clientes nuevos usa siempre `month` o `year` (anual recomendado) — es la única oferta vigente (r36). `quarter` | `semester` | `lifetime` siguen aceptados solo por compatibilidad administrativa con cuentas históricas que ya tenían esos períodos; no se ofrecen a clientes nuevos. `historical` es exclusivo de Founder.
- `--business-type`: `retail` | `restaurant` | `distribution` | `services` | `other` — esto **solo** ajusta la experiencia visual del cliente (qué pantallas ve primero), **nunca** sus derechos. Los derechos los da exclusivamente el plan.
- `--addons`: texto libre, se guarda como nota para seguimiento comercial (no hay precio de add-on aprobado todavía — ver matriz comercial sección 5).

Esto imprime una **vista previa completa** (nombre del plan, precio, período, límites de negocios/productos/almacenamiento/Workers) sin cambiar nada todavía. Revísala.

Para aplicar de verdad, vuelve a correr el mismo comando agregando `--apply --confirm "<frase mostrada en la vista previa>"` (se imprime lista para copiar/pegar al final de la vista previa).

El sistema:
- Hace un respaldo del estado anterior antes de escribir nada.
- Verifica con hash que nada cambió entre la vista previa y el momento de aplicar.
- Deja un registro de auditoría (`adminAuditLogs`) con quién, cuándo y qué se activó.
- Verifica el resultado después de escribir (no confía en que "no hubo error" — relee y confirma).

## Cambiar de plan (upgrade / downgrade) a un cliente existente

Mismo comando, mismo flujo — solo cambia `--plan`/`--period`. Bajar de plan **nunca borra datos**: si el cliente tiene más productos de los que el nuevo plan permite, todo lo que ya tiene sigue visible y vendible; simplemente no puede crear productos nuevos hasta volver a estar dentro del límite o mejorar de plan otra vez.

## Suspender una cuenta

```
node scripts/admin-access-v16.mjs --command suspend --actor roddysmithceo@gmail.com --email correo@gmail.com --uid <uid>
```
(mismo patrón: vista previa primero, luego `--apply --confirm ...`)

## Resolver una solicitud de más capacidad o de Worker adicional

El cliente ve, dentro de "Mi plan y acceso", los botones "Solicitar más capacidad" y "Solicitar Worker adicional". Cada clic genera un registro auditable (colecciones `capacityRequests` y `seatRequests` en Firestore, bajo `businesses/{uid}/`) y además abre WhatsApp con un mensaje prellenado hacia soporte. Para atenderla:

- **Worker adicional**: usar `scripts/worker-boundary-admin.mjs` (ya existente, agrega cupos add-on) o coordinar el upgrade de plan si el máximo del plan actual ya se alcanzó.
- **Más capacidad (productos/almacenamiento)**: hoy no existe un add-on con precio propio — la vía es subir de plan (ver matriz comercial), o si el caso lo amerita, escalarlo para definir un precio de add-on nuevo.

## Activar Founder (licencia histórica)

Solo para clientes explícitamente aprobados por Mr. Smith como fundadores históricos (ver matriz comercial sección 4 para la lista vigente — SHARY y Lía Perfumería confirmadas en r36). Mismo comando de onboarding, con `--plan founder_legacy --period historical`. No se puede combinar con ningún otro período de facturación. El CEO Admin Web permite ver/gestionar una cuenta Founder ya activada (uso, Workers, suspensión), pero la activación inicial de `founder_legacy --period historical` sigue siendo exclusiva de la CLI por ahora.

## Workers (trabajadores) para un cliente nuevo

Workers es un sistema completo pero de activación manual y controlada (no autoservicio). Antes de activarlo para un cliente:
1. Agregar su `ownerUid`+`businessId` a `scripts/config/pilot-authorized-tenants.json` (cambio de código, revisado, con justificación — no un flag de CLI).
2. Correr `scripts/worker-boundary-activate-tenant.mjs` con el project/owner/business correctos y `--confirm ACTIVATE_PRODUCTION_TENANT`.
3. El comando hace preflight, evidencia, migración, promoción y activa el flag en un solo paso auditado, y termina en `ACTIVATED` o te dice exactamente qué falló y por qué.

## Qué hacer si algo falla

Todos los scripts administrativos de CLICK 360 siguen el mismo patrón: **vista previa primero, respaldo antes de escribir, verificación con hash, y verificación después de escribir**. Si algo fue mal, el respaldo (`adminBackups`) y el registro de auditoría (`adminAuditLogs`) siempre existen para poder revisar o revertir. Ningún comando de esta lista borra datos del cliente — todos son aditivos o reversibles.
