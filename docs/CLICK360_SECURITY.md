# CLICK 360 Security

Fecha: 2026-07-10

## Controles P0

- Contexto obligatorio: `authUid`, `ownerUid`, `ownerId`, `businessId`, `tenantKey`, `schemaVersion`.
- Aprobación offline por UID con caducidad de 24 horas.
- Push, pull, listeners y scheduler ligados al epoch de Auth y al tenant capturado.
- Transacciones con revisión; no existe `STATE_DOC.set()` directo.
- Legacy, identidad inválida, caché corrupta y conflictos bloquean escrituras.
- El navegador no restaura backups legacy sin identidad.
- Actualizar desde nube exige backup, confirmación y frase exacta.
- Zona de peligro exige owner, backup y doble confirmación.
- Imágenes se validan, comprimen y limitan; SVG/data URLs peligrosas se rechazan.
- HTML de cierres se sanea y las fórmulas de Excel/CSV se neutralizan.
- Service Worker no cachea respuestas de Auth o Firestore y solo elimina cachés `click360-*`.
- Reglas niegan autoaprovisionamiento de owners, acceso cruzado, deletes sensibles y acceso cliente a backups legacy.
- Un remoto V10 válido reconcilia únicamente sus propios marcadores de cuarentena/legacy; nunca importa el estado legacy ni borra claves de otro tenant.
- `accountAccess/{uid}` permite al cliente crear solo una prueba normal de 7 días con timestamps de servidor. Los cambios de plan son administrativos; una prueba expirada puede leer, no escribir.

## Reglas verificadas en emulador

Se probaron owner A/B, worker, usuario no aprobado, atacante, revocación atómica, perfiles limitados, invitaciones, payload inválido, backups legacy, creación de prueba, vencimiento en modo lectura y denegación explícita de `demo-click360`.

## Riesgo crítico pendiente

Un worker autorizado puede escribir un snapshot completo semánticamente válido. Los roles `cashier`, `inventory` y `worker` restringen la interfaz, pero no son una frontera de seguridad por módulo. La migración a colecciones por entidad y un command layer queda como P1 antes de ampliar el uso a operaciones de alto riesgo.

## Riesgos residuales

- Datos offline quedan legibles en el almacenamiento del dispositivo; no hay cifrado por usuario.
- La revocación no puede conocerse mientras el dispositivo permanece desconectado; la aprobación offline expira a las 24 horas.
- El SDK compat de Firestore emite una advertencia de deprecación futura de persistencia multi-tab.
- App Check y CSP estricta todavía no están implementados.
- `npm audit --omit=dev` reporta 0 vulnerabilidades. La herramienta de emulación mantiene 3 moderadas transitivas en Pub/Sub/OpenTelemetry; no se incluye en el bundle público.
