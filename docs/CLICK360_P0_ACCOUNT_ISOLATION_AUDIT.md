# CLICK 360 P0 - Auditoría de aislamiento de cuentas

Fecha: 2026-07-10

## Causa original

Una llave global de estado y la sincronización amplia de `localStorage` permitían que el estado de A sobreviviera al cambio hacia B. Heurísticas de “local más nuevo/rico” podían subirlo al documento equivocado.

## Contrato corregido

- Estado: `CLICK360_STATE:{tenantKey}`.
- Sesión de interfaz: `CLICK360_SESSION:{uid}` sin rol autorizador.
- Aprobación offline: `CLICK360_APPROVED_IDENTITY:{uid}`, expira en 24 horas.
- Contexto: Auth UID + owner + business + tenantKey + schema 10.
- Remote: payload explícito y validado, nunca el mapa de almacenamiento del navegador.
- Cierre/cambio de cuenta: epoch nuevo, listeners cancelados, memoria/DOM descargados.
- Escrituras asíncronas: scheduler por epoch y metadatos escritos al contexto capturado.
- Varias pestañas: solo aceptan estado con identidad y estructura completas del tenant activo.

## Legacy y seed

Un documento legacy activa `LEGACY_MIGRATION_REQUIRED`; no desbloquea UI ni push. Un documento v10 remoto con caché local ausente se aplica antes de abrir. Un documento remoto ausente solo permite seed si tampoco existe caché previa; cualquier caché válida o corrupta provoca bloqueo y revisión.

La migración es administrativa, exige owner/ruta/Auth inequívocos, estructura válida, backup verificado, hash estable, conteos exactos y relectura v10. `--apply` no acepta fixtures, no admite selección vacía y preserva el email histórico.

## Evidencia

- Harness A → logout → B → logout → A, 10 ciclos: PASS.
- Stress 100 tenants/1.000 cambios: PASS.
- Legacy no invoca escritura: PASS.
- Caché extranjera, corrupta y offline sin datos: bloqueadas.
- Firestore Emulator owner A/B/worker/revocado/atacante: PASS.
- Auditoría real previa: 2 tenants migrados; `demo-click360` intacto y sospechoso.

## Límite

El aislamiento entre tenants está cubierto. Los permisos internos por módulo no son una frontera de seguridad mientras todo el tenant sea un único snapshot; por eso la decisión general sigue NO-GO.
