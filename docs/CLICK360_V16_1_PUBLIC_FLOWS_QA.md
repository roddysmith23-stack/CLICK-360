# CLICK 360 V16.1 Public Flows QA

Fecha: 2026-07-14

## Flujos

| Accion | Resultado esperado | Evidencia |
| --- | --- | --- |
| Iniciar sesion | Google Auth, cuenta existente, sin crear trial | Intencion `login` y harness V16.1 |
| Probar gratis | Una prueba Base de 7 dias por UID | Transaccion `accountAccess`, tiempo de servidor |
| Registrarse | Auth, trial y onboarding completo | Intencion `register`, formulario e idempotencia |
| Tengo una invitacion | Link o token + propietario, validacion y consumo unico | Contrato de invitaciones y Rules |
| Ver planes | Comparacion visible Base, Pro y prueba | Browser QA desktop/movil |
| Hablar con CLICK 360 | WhatsApp con mensaje prellenado | Enlace `wa.me` seguro |

## Controles de seguridad

- Solo `trial` y `register` pueden crear la prueba.
- El documento usa `source: self_service`, unico valor permitido por Rules.
- Doble clic queda bloqueado mientras Google Auth esta en curso.
- Una sesion Google publica previa se cierra antes de mostrar el selector de cuenta.
- El trial usa `serverTimestamp()` para inicio, ultima vista y creacion.
- La expiracion conserva datos en lectura y ofrece activacion por WhatsApp.
- Fundadores y planes pagados no pasan por paywall.
- Invitaciones no conceden acceso a otro negocio ni a `demo-click360`.

## Landing y descubrimiento

- H1: `Todo tu negocio en una sola aplicacion`.
- Copy principal y promesa comercial visibles.
- FAQ visible con nueve preguntas y JSON-LD `FAQPage`.
- JSON-LD `SoftwareApplication`, canonical, Open Graph y Twitter Cards.
- `robots.txt`, `sitemap.xml`, manifest y favicon disponibles.
- Los seis CTA aparecen en la jerarquia requerida.

## Browser QA

- Desktop 1440 px: PASS.
- Movil 320 y 390 px: PASS.
- Comparacion de planes: PASS.
- Formulario para pegar invitacion: PASS.
- Sin overflow horizontal: PASS.
- No se envio Auth desde el entorno local para evitar crear cuentas o datos reales.
