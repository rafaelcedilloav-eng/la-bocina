# Fase 1: pantalla, fixtures, teclado y estados

Type: prototype
Status: resolved
Claimed by: wayfinder
Blocked by: 01

## Question

¿Cómo se ve y se comporta la pantalla del cajero con datos falsos: monto gigante, teclado numérico siempre visible, QR desde `qrImage` de fixture, y todos los estados visuales (`pendiente`, `pagado`, `expirado`, `tardio`, `error`, sin conexión) sin cablear el server real?

## Answer

Módulos `src/ts/{types,state,fixtures,ui}.ts` + `main.ts` / `caja.css`.

- Monto gigante; teclado 0–9 / C / ⌫ siempre visible (entrada en centavos).
- QR desde `qrImage` base64 (fixture mínimo o respuesta real).
- Vistas vía `data-vista`: idle, creando, pendiente, pagado, entregado, expirado, tardio, error, sin_conexion.
- Demo: `?fixture=1` → «Simular pagado». **Nunca** verde por timer/clic fuera de ese camino de fixture.
- API real: issue 05 (cableado en la misma racha).
