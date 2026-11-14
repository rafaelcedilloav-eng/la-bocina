# Arquitectura de módulos del frontend

Type: grilling
Status: resolved
Blocked by:

## Question

¿Cerramos el esqueleto así para arrancar ya?

- **Vite + vanilla ES modules** (sin React): permite env en el proceso de Node/Python, no en el bundle.
- Layout: `index.html`, `src/css/caja.css`, `src/js/{main,state,api,bocina,voz,fixtures,openrouter}.js` (el cliente `openrouter` habla con **nuestro** mini-backend, no con OpenRouter directo).
- Build/static servible luego desde el FastAPI de Rafael (`GET /`).
- Contratos internos: `state` manda qué pintar; `bocina` solo habla con texto ya decidido; `voz` = capturar audio → nuestro `/api/voz/*` → parser fijo → monto; `api` habla con cobros/SSE.

## Answer

**Sí.** Vite + módulos vanilla, en **TypeScript** (tipado de contratos cobro/eventos/voz). Layout: `src/{main.ts,css/caja.css,ts/…}` (módulos se agregan al implementar fase 1).

Además: **mini-backend local FastAPI** en `server/` solo para STT/TTS de OpenRouter (key en `server/.env`, gitignored). El front nunca lleva la key. Arranque local: `uvicorn` en :8000 + Vite proxy `/api/voz`. Cuando Rafael absorba las rutas, se apaga este proceso. Detalle: [Mini-proxy OpenRouter local](09-mini-proxy-openrouter.md).
