# La Bocina · frontend (Oscar)

Pantalla del cajero: monto, teclado, QR CoDi, confirmación en verde y **Bocina** (voz).  
Repo del hackatón Cursor México — se integrará después con el backend/mono-repo de Rafael.

## Qué hay aquí

| Pieza | Rol |
|---|---|
| `src/` | Vite + **TypeScript** — UI del cajero |
| `server/` | Mini **FastAPI** — proxy a **ElevenLabs** (STT/TTS); la API key no va al browser |
| `.scratch/` | Mapa wayfinder / tickets de decisión |
| `PROGRESS.md` | Índice de avance |

El dinero y pey viven en el server de Rafael. Este repo solo pinta la caja y habla con `/api/voz/*` (local) y, en fase 2, con los endpoints de cobros.

## Arranque local

### 1. Front

```bash
cp .env.example .env   # VITE_API_BASE → tunnel de Rafael
npm install
npm run dev
```

Abre `http://localhost:5173`. En DEV, Vite proxifica `/api/cobros` y `/api/eventos` al tunnel (Rafael aún sin CORS). Demo sin API: `?fixture=1`.

### 2. Mini-proxy de voz (otra terminal)

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # pega ELEVENLABS_API_KEY
uvicorn main:app --reload --port 8000
# o desde la raíz: npm run dev:voz
```

Vite ya proxifica `/api/voz` → `http://127.0.0.1:8000`.

Comprueba: `curl http://127.0.0.1:8000/salud`  
TTS: `curl -X POST http://127.0.0.1:8000/api/voz/hablar -H 'Content-Type: application/json' -d '{"texto":"Listo"}' -o listo.mp3`

## Secretos

- `server/.env` — **nunca** al repo (`ELEVENLABS_API_KEY`).
- No uses `VITE_*` para la key de ElevenLabs.

## Roadmap corto

1. ~~Fase 1: UI + teclado + estados~~ · ~~Fase 2: cobros + SSE/poll → verde~~ · ~~Bocina ElevenLabs~~
2. Voz de entrada: mic → STT (Scribe) → parser fijo (sin LLM para el monto).
3. Stretch: botón Entregado (track #5).
4. Prueba en celular + ensayo del pitch.

Detalle: `PROGRESS.md` y `.scratch/oscar-frontend/map.md`.
