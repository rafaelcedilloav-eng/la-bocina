# Voz de calidad en la PC Linux (AMD/ROCm) como mini-servicio por Tailscale

La Linux corre el modelo pesado y expone `POST /tts {texto} -> audio`. Nuestro server verde
(en la Latitude) le pega por Tailscale con `TTS_BACKEND=remote`. El camino de pago NO se mueve.

## Lo que necesito que me digas de la Linux (para darte comandos exactos)
```bash
# 1) Que GPU AMD es:
rocminfo | grep -i "Marketing Name" ; lspci | grep -i vga
# 2) ROCm instalado y ve la GPU?
rocm-smi
# 3) torch-ROCm funciona? (en ROCm, cuda.is_available()=True es buena senal)
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# 4) IP de Tailscale de la Linux (para apuntar el server):
tailscale ip -4
# 5) version de python
python --version
```
Con eso te doy la instalacion correcta (rueda torch-ROCm de la version que tengas).

## Conectar (una vez que la Linux sirva /tts)
En el `.env` del server (Latitude):
```
TTS_BACKEND=remote
TTS_REMOTE_URL=http://<ip-tailscale-de-la-linux>:8080/tts
```
Reinicia uvicorn. Oscar no cambia nada: sigue pegandole a /api/tts.

## Esqueleto del servicio en la Linux  (tts_server.py)
> Corre en la Linux: `uvicorn tts_server:app --host 0.0.0.0 --port 8080`
> OJO: el import exacto y la firma de generacion de Qwen3-TTS confirmalos en el model card /
> repo oficial QwenLM/Qwen3-TTS (no lo tomes 100% literal, la API puede cambiar).
```python
import io
from fastapi import FastAPI, Request
from fastapi.responses import Response
import soundfile as sf

# pip install -U qwen-tts soundfile fastapi uvicorn   (+ torch-ROCm ya instalado)
from qwen_tts import Qwen3TTSModel   # <-- confirma el import real en el repo

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    device_map="cuda:0",           # en ROCm, torch presenta la GPU AMD como 'cuda'
    dtype="bfloat16",
    attn_implementation="sdpa",    # NO flash_attention_2 (no corre en ROCm)
)
SPEAKER = "Vivian"                 # elige voz; para es-MX usa instruction

app = FastAPI()

@app.post("/tts")
async def tts(req: Request):
    body = await req.json()
    texto = (body.get("texto") or body.get("text") or "").strip()
    wav, sr = model.generate_custom_voice(
        text=texto, language="es", speaker=SPEAKER,
        instruction="Habla en español mexicano, tono cálido de cajero.")
    buf = io.BytesIO(); sf.write(buf, wav, sr, format="WAV"); buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")
```

## Si qwen-tts pelea con ROCm (su paquete es NVIDIA-céntrico)
Plan B de calidad que suele llevarse mejor con torch estándar/ROCm:
- **XTTS-v2 (Coqui TTS):** `pip install TTS`, buen español, clonación de voz. Más estándar que qwen-tts.
- **F5-TTS:** alta calidad, clonación, también torch estándar.
Cualquiera de los dos se sirve igual detrás del mismo `/tts`.

## Realidad de reloj
Montar GPU+ROCm+modelo nuevo toma tiempo. Si en ~30-40 min no canta, para la DEMO quédate con
`edge` (Dalia, calidad premium, 2 min) y deja la Linux+Qwen como la versión del producto.
