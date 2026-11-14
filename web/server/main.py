"""Mini-proxy local: ElevenLabs TTS + STT. La key nunca sale al frontend."""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

# override=True: al editar .env con --reload, toma los valores nuevos (no los del primer boot).
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

ELEVEN_BASE = "https://api.elevenlabs.io/v1"
# Sarah (premade): funciona en plan free. Voces de biblioteca (p.ej. Gabriela MX) exigen plan de pago.
DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_STT_MODEL = "scribe_v1"

app = FastAPI(title="La Bocina · voz", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_eleven_key() -> str:
    key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Falta ELEVENLABS_API_KEY en server/.env",
        )
    return key


def _filename_for(upload: UploadFile) -> str:
    name = (upload.filename or "").strip()
    if name:
        return name
    ctype = (upload.content_type or "").split(";")[0].strip().lower()
    ext = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/ogg": "ogg",
        "audio/m4a": "m4a",
    }.get(ctype, "webm")
    return f"clip.{ext}"


@app.get("/salud")
def salud() -> dict[str, str | bool]:
    return {
        "servicio": "voz",
        "elevenlabs": bool(os.getenv("ELEVENLABS_API_KEY", "").strip()),
        "tts": "elevenlabs",
        "stt": "elevenlabs",
        "version": "0.2.0",
    }


@app.post("/api/voz/transcribir")
async def transcribir(audio: UploadFile = File(...)) -> dict[str, str]:
    """Audio del micrófono → texto (ElevenLabs Scribe)."""
    key = _require_eleven_key()
    model_id = (
        os.getenv("ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL).strip() or DEFAULT_STT_MODEL
    )
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Audio vacío")

    filename = _filename_for(audio)
    content_type = audio.content_type or "application/octet-stream"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{ELEVEN_BASE}/speech-to-text",
                headers={"xi-api-key": key},
                data={
                    "model_id": model_id,
                    "language_code": "es",
                },
                files={"file": (filename, raw, content_type)},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs STT no respondió: {exc}",
        ) from exc

    if r.status_code >= 400:
        detail = r.text[:400] if r.text else f"HTTP {r.status_code}"
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs STT {r.status_code}: {detail}",
        )

    try:
        payload = r.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="ElevenLabs STT: respuesta no JSON",
        ) from exc

    texto = (payload.get("text") or "").strip()
    if not texto:
        raise HTTPException(status_code=502, detail="ElevenLabs STT: texto vacío")
    return {"texto": texto}


class HablarBody(BaseModel):
    texto: str = Field(min_length=1, max_length=500)


@app.post("/api/voz/hablar")
async def hablar(body: HablarBody) -> Response:
    """Texto de la Bocina → MP3 (ElevenLabs TTS)."""
    key = _require_eleven_key()
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE).strip() or DEFAULT_VOICE
    model_id = (
        os.getenv("ELEVENLABS_TTS_MODEL")
        or os.getenv("ELEVENLABS_MODEL_ID")
        or DEFAULT_TTS_MODEL
    ).strip() or DEFAULT_TTS_MODEL

    url = f"{ELEVEN_BASE}/text-to-speech/{voice_id}"
    params = {"output_format": "mp3_44100_128"}
    payload = {
        "text": body.texto.strip(),
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.45,
            "similarity_boost": 0.75,
            "style": 0.15,
            "use_speaker_boost": True,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.post(
                url,
                params=params,
                headers={
                    "xi-api-key": key,
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs TTS no respondió: {exc}",
        ) from exc

    if r.status_code >= 400:
        detail = r.text[:400] if r.text else f"HTTP {r.status_code}"
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs TTS {r.status_code}: {detail}",
        )

    return Response(content=r.content, media_type="audio/mpeg")


@app.post("/api/voz/hablar-form")
async def hablar_form(texto: str = Form(...)) -> Response:
    return await hablar(HablarBody(texto=texto))
