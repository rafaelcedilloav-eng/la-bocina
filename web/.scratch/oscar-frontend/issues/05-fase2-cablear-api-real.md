# Fase 2: cablear API real (POST + SSE + poll)

Type: task
Status: resolved
Claimed by: wayfinder
Blocked by: 03

## Question

¿Qué cambios concretos conectan la pantalla al server de Rafael?

**Base URL (2026-11-14):** `https://merger-fish-gets-peace.trycloudflare.com`

- `POST /api/cobros` → pintar `qrImage` (base64; opcional `GET /api/cobros/{id}/qr` como PNG)
- `GET /api/eventos` (SSE) + poll `GET /api/cobros/{id}` cada 2s
- Al `pagado` → verde (+ Bocina cuando 04 esté listo; si no, verde sin voz)
- Opcional: reaccionar a `creado` (MCP)
- `VITE_API_BASE` (o config) apuntando al tunnel; sin secretos pey en el front

Rafael ya avisó: endpoints expuestos. Bocina/Entregado no bloquean cablear el cobro+QR+verde.

## Answer

- Cliente: `src/ts/api.ts` — `crearCobro`, `getCobro`, `watchEventos`, `pollCobro`.
- `main.ts` cablea cobro → pendiente+QR → SSE/poll → `pagado` verde (idempotente por `transactionId`).
- `VITE_API_BASE` en `.env` / `.env.example` = tunnel Rafael.
- En DEV el front usa paths relativos; Vite proxifica `/api/cobros` y `/api/eventos` (Rafael aún sin CORS).
- Si falta `expiraEn` en el 201, el cliente asume +360s.
- Nota: al cablear, SSE del tunnel respondía 200 sin bytes/latido; el poll 2s es el oído confiable hasta que Rafael emita eventos.
