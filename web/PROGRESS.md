# PROGRESS · La Bocina · frontend Oscar

Índice de avance humano. El mapa canónico está en [`.scratch/oscar-frontend/map.md`](.scratch/oscar-frontend/map.md).

## Destino

Pantalla del cajero implementada, probada en celular y ejecutable: **fase 1 (UI + teclado + estados)** → **fase 2 (API Rafael)** → **Bocina ElevenLabs** → **voz de entrada (STT + parser)**. Entregado = stretch.

## Estado ahora

| | |
|---|---|
| Mapa | [Oscar frontend](.scratch/oscar-frontend/map.md) |
| Cerrado | Arquitectura · Fase 1 pantalla · Fase 2 API · **Research voz** · **Mini-proxy ElevenLabs** · **Bocina idempotente** |
| Repo | https://github.com/game013/la-bocina-frontend |
| **Server Rafael** | `https://merger-fish-gets-peace.trycloudflare.com` · `VITE_API_BASE` en `.env` |
| Siguiente | [Voz entrada](.scratch/oscar-frontend/issues/06-voz-entrada-parser-fijo.md) · [Prueba celular](.scratch/oscar-frontend/issues/07-prueba-en-celular.md) · stretch Entregado |

## Frontera (orden práctico ahora)

1. ~~Arquitectura~~ · ~~Fase 1~~ · ~~Fase 2 cobro→QR→verde~~ · ~~Research~~ · ~~Proxy TTS/STT~~ · ~~Bocina~~
2. **Ahora:** [Voz entrada](.scratch/oscar-frontend/issues/06-voz-entrada-parser-fijo.md) (MediaRecorder → Scribe → parser fijo) · [Prueba celular](.scratch/oscar-frontend/issues/07-prueba-en-celular.md)
3. Stretch: [Entregado](.scratch/oscar-frontend/issues/08-stretch-boton-entregado.md)
4. Freeze código ~15:30 (solo fixes de una línea después)

## Contrato Rafael (PASO 2)

**Base:** `https://merger-fish-gets-peace.trycloudflare.com`

| Llamada | Uso |
|---|---|
| `POST /api/cobros` | → QR |
| `GET /api/cobros/{id}` | Poll cada 2s (oído confiable) |
| `GET /api/eventos` | SSE (a veces mudo en tunnel) |
| `POST /api/cobros/{id}/entregar` | Stretch |

`pagado` → verde + Bocina 1× por `transactionId`. Nunca verde por clic/timer.

## Voz (Oscar)

- **TTS/STT:** ElevenLabs vía `server/` (`ELEVENLABS_API_KEY`). Front → `/api/voz/*`.
- **Bocina:** `src/ts/bocina.ts` al `setPagado` / poll. Fallback tono si falla TTS. `?fake=1` sin API.
- **Entrada (pendiente):** mic → `POST /api/voz/transcribir` → parser fijo → cobro.

## Cómo seguir

`npm run dev` + `npm run dev:voz`. Demo UI: `?fixture=1` + toque (unlock «Listo») + «Simular pagado». Demo sin ElevenLabs: `?fake=1&fixture=1`.
