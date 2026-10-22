# P0D: uso normal y handoff condicionado

Este cambio no activa ningún tenant, no publica aprobaciones y no modifica Rules.

## Despertar sin intervención del cliente

Además de Auth y reconexión, `visibilitychange` visible y `pageshow` restaurado
despiertan el mismo `runP0ARecovery`. No hay polling ni temporizadores. El single
flight, época Auth, Web Lock y comprobaciones de fuente/journal se conservan.
No se despierta para otro actor, offline o con escritor modular instalado.
No se relanza el bootstrap comercial desde una sesión legacy que está trabajando.

P0A verifica la copia de recuperación; P0D registra un preflight privado.
Ninguno equivale a sincronización operacional ni aprobación administrativa.

## Handoff sin coordinación manual con el teléfono

Una futura inscripción operacional individual puede aprovechar el próximo
arranque Auth normal, antes de desbloquear la UI. La preparación existente
calcula el plan completo del dispositivo actual y exige, ANTES de reclamar
el shadow/fence de un propietario legacy, que `runtimePreparation` y `cutover`
administrativos coincidan exactamente con ese plan, build y negocios.

Si faltan o son antiguos, vuelve `prepared:false` sin shadow ni cambio de modo.
Los cambios en metadatos o referencias de guardado invalidan también la prueba.
No se crea autorización para una fuente nueva a partir de un READY del cliente.

Las incertidumbres de fuente, journal o finanzas detectadas antes del shadow
solo permiten mantener legacy tras releer desde servidor que no existe control.
Si el shadow ya empezó, hay fence, identidad revocada o resultado incierto,
continúa la recuperación estricta: nunca se habilita un escritor legacy paralelo.

La política global operacional y las aprobaciones reales permanecen apagadas/
ausentes. Para un piloto futuro, el operador debe verificar independientemente
el recibo actual y publicar exclusivamente las autorizaciones source-bound
comprendidas por el permiso del owner. La aplicación comprobará de nuevo la
fuente en el arranque normal. Una fuente diferente no adquiere permiso implícito.

## Regresiones

- `qa-p0d-normal-resume.mjs`: falla antes del listener; foreground/BFCache,
  deduplicación, actor, offline, escritor activo, datos nuevos y BLOCKED sin lock.
- `qa/spark-migration-shadow-pwa.mjs`: PWA real Chromium/WebKit, evento de
  foreground sin nuevo Auth, snapshot local posterior, BFCache event, relectura
  del recibo y reinicios sin mutaciones comerciales.
- `qa-spark-migration-bootstrap.mjs`: producción sin aprobación/antigua no llama
  importer; aprobación exacta permite la preparación; finanzas no verificadas
  mantienen legacy solo cuando el fence sigue ausente.

No existe aceptación física nueva ni cutover real como consecuencia del release.
