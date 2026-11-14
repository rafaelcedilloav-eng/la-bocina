# Mini-proxy ElevenLabs local

Type: task
Status: resolved
Claimed by: oscar
Blocked by: 02

## Question

¿Cómo queda el mini-backend FastAPI en este repo para consumir ElevenLabs sin exponer la key en el front?

## Answer

`server/main.py` · key solo en `server/.env`.

| Ruta | Qué hace |
|---|---|
| `GET /salud` | `{ elevenlabs, tts, stt }` |
| `POST /api/voz/hablar` `{texto}` | ElevenLabs TTS → `audio/mpeg` |
| `POST /api/voz/transcribir` multipart `audio` | ElevenLabs Scribe → `{texto}` |

Env: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (default Sarah premade `EXAVITQu4vr4xnSDxMaL` — voces de biblioteca requieren plan de pago), `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL=scribe_v1`.

Arranque: `npm run dev` + `npm run dev:voz`. Vite proxifica `/api/voz` → `:8000`.

Probado: `POST /hablar` «Listo» y frase de pagado → 200 MP3.
