# CLICK 360 — P1.5C Smart Print Wizard Universal

## Estado

- PR: #27
- Rama: `feature/p1-5c-smart-print-wizard-universal`
- SHA candidato actualizado: `2be920529c9dd63e9c4d2213985c3e1ea6431ed9`
- Versión: `1.0.4-p2`
- Asset/cache: `mvp-launch-v16-2-p1-5c-r1`
- CI GitHub Actions: PASS, workflow run #73
- Producción: no desplegada
- Hardware físico: pendiente de smoke con la impresora y el rollo reales de Shary

## Corrección de cierre

El primer workflow remoto falló porque el harness de regresión esperaba el artefacto reproducible `qa/artifacts/p1-5c-synthetic-print-plans.json`, que existía localmente pero no había quedado incluido en GitHub. Se añadió el artefacto en un segundo commit y el workflow remoto completo pasó correctamente.

## Alcance implementado

- Asistente universal y guiado de impresión.
- Perfiles separados de impresora y papel.
- Geometría física en milímetros.
- Rollos de una, dos y tres columnas.
- Hojas A4 de etiquetas.
- Cantidad exacta independiente del stock.
- Inicio desde casilla o columna específica.
- Preview, PDF e impresión usando el mismo plan físico.
- Calibración y ajustes X/Y.
- Auto-layout y prevención de colisiones.
- Perfiles aislados por usuario, negocio y dispositivo.
- Diagnóstico sanitizado.
- Ayuda contextual para navegador, Windows y driver.

## QA confirmado

- `npm run qa`: PASS
- `npm run qa:rules`: PASS
- simulador quick: PASS
- simulador full: PASS
- build estático: PASS
- GitHub Actions Ubuntu: PASS

## Seguridad y límites

No se autorizó ni realizó:

- merge a `main`;
- deploy de Firebase Hosting;
- cambios en Firebase Auth;
- cambios en OAuth;
- cambios en Firestore Rules;
- cambios en `accountAccess` o claims;
- modificaciones manuales de datos reales;
- instalación de drivers;
- certificación definitiva de hardware.

## Siguiente validación

Crear preview temporal de la rama y ejecutar smoke físico con la impresora de Shary, confirmando:

1. rollo de dos columnas;
2. medidas reales del soporte y cada sticker;
3. cantidad exacta 1;
4. inicio por columna derecha/izquierda;
5. vista previa versus salida física;
6. calibración X/Y;
7. configuración de Chrome/Windows/driver;
8. ausencia de URL, recortes y colisiones.

## Veredicto

`P1_5C_CI_PASS_READY_FOR_PREVIEW_AND_PHYSICAL_SMOKE`
