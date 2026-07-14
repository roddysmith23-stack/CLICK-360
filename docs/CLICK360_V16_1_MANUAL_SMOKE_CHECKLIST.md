# CLICK 360 V16.1 Manual Smoke Checklist

Fecha: 2026-07-14

No crear ventas, productos ni clientes reales durante este smoke.

## Publico

- [ ] Abrir la URL con cache busting en Safari y Chrome.
- [ ] Confirmar H1, FAQ, planes y WhatsApp.
- [ ] Confirmar que cada CTA abre su flujo independiente.
- [ ] Confirmar manifest e instalacion PWA.

## Shary

- [ ] Elegir exactamente `shary10mmvv@gmail.com`.
- [ ] Confirmar UID `3UTjgHd1QNSvqlcXNKQ6tL79X7u2` en la inspeccion administrativa posterior.
- [ ] Confirmar `Plan CLICK 360 activo`.
- [ ] Confirmar que no pide invitacion, trial ni IAM.
- [ ] Confirmar negocio vacio propio, sin datos de otra cuenta.
- [ ] Navegar Inicio, Inventario, Vender, Caja y Mas sin guardar operaciones.
- [ ] Cerrar sesion y volver a entrar.
- [ ] Instalar/abrir PWA en iPhone.
- [ ] Simular almacenamiento local no disponible y confirmar modo solo en linea.

## A/B sin mutaciones

- [ ] Entrar con la cuenta A y anotar nombre, plan y conteos visibles.
- [ ] Logout completo.
- [ ] Entrar con B y comparar nombre, plan y conteos.
- [ ] Volver a A y confirmar que sus datos no cambiaron.
- [ ] Repetir en segunda pestana y en movil.

## Funciones

- [ ] Abrir calculadora desde Vender, Caja y Mas.
- [ ] Probar suma, porcentaje y cerrar sin guardar.
- [ ] Abrir una etiqueta QR existente o muestra sin persistir cambios reales.
- [ ] Confirmar preview, controles tactiles y modo avanzado.
- [ ] Abrir selector de negocio y notificaciones.
- [ ] Confirmar reloj y zona horaria del negocio.

## Produccion

- [ ] CI verde en el commit de merge.
- [ ] GitHub Pages sirve `mvp-launch-v16-1-r1`.
- [ ] Service Worker activo y cache anterior reemplazado.
- [ ] Rules compiladas/desplegadas solo si el diff las requiere.
- [ ] Auditoria final: 3 `CLEAN_V10`, 1 `CROSS_TENANT_SUSPECT`.
- [ ] `demo-click360` conserva revision/fecha y sigue bloqueado.
- [ ] Registrar GO o NO-GO con la causa exacta.
