# Research: voz ElevenLabs (STT + TTS) para la Bocina

Type: research
Status: resolved
Claimed by: oscar
Blocked by:

## Question

¿Qué API usamos desde el mini-proxy para (1) transcribir el audio del cajero y (2) sintetizar la frase de la Bocina, sin exponer keys en el browser?

## Answer

**Todo ElevenLabs**, una sola key en `server/.env`.

| Camino | API |
|---|---|
| **Bocina (TTS)** | `POST /v1/text-to-speech/{voice_id}` → MP3 |
| **Entrada (STT)** | `POST /v1/speech-to-text` (Scribe) → `{ text }` |
| Front | Mic = MediaRecorder → `POST /api/voz/transcribir` → **parser fijo** (sin LLM) |
| Si falla TTS | Tono + verde igual |

> Nota: el brief de Rafael fase 3 mencionaba `SpeechRecognition` es-MX. Oscar elige ElevenLabs STT para un solo vendor/key y mejor ruido de sala; el teclado sigue como respaldo.

### TTS

| | |
|---|---|
| URL | `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` |
| Auth | `xi-api-key` |
| Modelo | `eleven_multilingual_v2` (alt: `eleven_flash_v2_5`) |
| Voz default | Sarah premade `EXAVITQu4vr4xnSDxMaL` (plan free). Voces de biblioteca (p.ej. Gabriela MX) → plan de pago |
| Proxy | `POST /api/voz/hablar` `{texto}` → `audio/mpeg` |

### STT

| | |
|---|---|
| URL | `https://api.elevenlabs.io/v1/speech-to-text` |
| Body | multipart: `file` + `model_id=scribe_v1` + `language_code=es` |
| Formatos | webm / mp4 / wav / mp3 / ogg (iPhone: preferir `audio/mp4`) |
| Proxy | `POST /api/voz/transcribir` (multipart `audio`) → `{ "texto": "…" }` |

### Env

```
ELEVENLABS_API_KEY=…
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
ELEVENLABS_STT_MODEL=scribe_v1
```
