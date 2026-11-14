"""La Bocina - servidor (PASO 3: endurecido).

/api/cobros -> POST /codi/qr real. /webhooks/pey con firma de CUERPO CRUDO +
timestamp (anti-replay) + idempotencia DURABLE + candados. SSE en /api/eventos.
/entregar (accion verificable). Polling de respaldo (con guard de monto).
mini-MCP cobrar(). Persistencia SQLite (idempotencia que sobrevive al reinicio +
ledger de auditoria, punto 6). Rate-limit + Bearer (dormante) en rutas de cobro.

Endurecido el 14-nov a partir de la auditoria de Egida (A1-A7), verificado por AETHER.
El SQLite espeja los escritos envuelto en try/except: si la DB falla, la demo en
memoria sigue; nunca tumba un pago.

REVISAR A MANO (3 puntos marcados con [CONFIRMAR] contra docs.pey.mx):
  1) formato del secreto del webhook (base64 / prefijo whsec_).
  2) forma exacta de la respuesta de GET /transaction/codi/qr/{id}.
  3) que POST /codi/qr acepte amount como numero (0.01, 35, 35.5).
"""
import os, time, json, asyncio, hmac, hashlib, base64, datetime, sqlite3, collections
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse, StreamingResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
import httpx
from fastapi.middleware.cors import CORSMiddleware

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

PEY_API_KEY = os.environ.get("PEY_API_KEY", "")
PEY_WEBHOOK_SECRET = os.environ.get("PEY_WEBHOOK_SECRET", "")
PEY_API_BASE = os.environ.get("PEY_API_BASE", "https://api.pey.mx")
BANK_ACCOUNT_ID = os.environ.get("PEY_BANK_ACCOUNT_ID", "")
MODO = os.environ.get("COMMERCE_MODE") or os.environ.get("MODO_COMERCIO") \
    or ("cuenta_registrada" if BANK_ACCOUNT_ID else "credencial_propia")
API_TOKEN = os.environ.get("LA_BOCINA_API_TOKEN", "")   # A1: Bearer en /api/* (vacio = abierto)
MCP_TOKEN = os.environ.get("MCP_TOKEN", "")             # Bearer del mini-MCP (vacio = abierto)
# Proxy de voz (ElevenLabs): la llave vive SOLO aqui, nunca en el navegador.
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "hHjbwzYZW17oh0p05AKv")
ELEVENLABS_TTS_MODEL = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
ELEVENLABS_STT_MODEL = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1")
# Motor de TTS intercambiable: "kokoro" (local, CPU), "edge" (gratis sin llave), "elevenlabs".
TTS_BACKEND = os.environ.get("TTS_BACKEND", "elevenlabs").lower()
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "ef_dora")   # es: ef_dora(F) em_alex em_santa(M)
KOKORO_LANG = os.environ.get("KOKORO_LANG", "e")           # e = español
EDGE_VOICE = os.environ.get("EDGE_VOICE", "es-MX-DaliaNeural")
# Motor remoto: la PC con GPU (Linux/ROCm) corre el modelo y expone /tts; aqui le pegamos por Tailscale.
TTS_REMOTE_URL = os.environ.get("TTS_REMOTE_URL", "")      # ej http://100.x.y.z:8080/tts
# OpenRouter TTS (OpenAI-compatible): Fish Audio sin GPU local.
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_TTS_MODEL = os.environ.get("OPENROUTER_TTS_MODEL", "fish-audio/s2.1-pro-free:free")
OPENROUTER_TTS_FALLBACK = os.environ.get("OPENROUTER_TTS_FALLBACK", "heygen/heygen-voice-1-turbo:free")
OPENROUTER_VOICE = os.environ.get("OPENROUTER_VOICE", "")  # opcional: id de voz del proveedor
OPENROUTER_STT_MODEL = os.environ.get("OPENROUTER_STT_MODEL", "x-ai/grok-stt-2.0")
STT_BACKEND = os.environ.get("STT_BACKEND", "elevenlabs").lower()   # openrouter | elevenlabs
# Cue de entrega para los modelos de OpenRouter que aceptan corchetes (Fish / HeyGen),
# ej. TTS_CUE=[cheerful]. Solo se antepone ahi: edge / kokoro / elevenlabs lo leerian en voz alta.
TTS_CUE = os.environ.get("TTS_CUE", "").strip()
# Pantalla del cajero ya compilada (web/dist). Si existe, este mismo proceso la sirve en GET /.
WEB_DIST = os.environ.get("WEB_DIST") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "web", "dist")
VERSION = "0.3-endurecido"

app = FastAPI(title="La Bocina")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

COBROS = {}            # id nuestro -> cobro
POR_CODIQR = {}        # codiQrId de pey -> id nuestro
WEBHOOKS_VISTOS = set()
TX_VISTOS = set()
ULTIMO_WEBHOOK = {"hora": None}
CUENTA_ESTADO = {"estado": "no_verificada"}
SUBS = set()           # colas asyncio de cada cliente SSE
PETICIONES = collections.defaultdict(list)   # A1 rate-limit: ip -> [timestamps]
LIMITE_POR_MIN = 20


def ahora_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ======================= Persistencia SQLite (A5 / punto 6) =======================
# Espeja el estado a disco. TODO envuelto en try/except: si la DB falla, la demo
# en memoria sigue. Da idempotencia durable + ledger de auditoria.
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "la_bocina.db")


def _db():
    con = sqlite3.connect(DB_PATH, timeout=5)
    con.row_factory = sqlite3.Row
    return con


def db_init():
    try:
        con = _db()
        con.execute("""CREATE TABLE IF NOT EXISTS cobros(
            id TEXT PRIMARY KEY, codi_qr_id TEXT, estado TEXT, monto REAL,
            concepto TEXT, canal TEXT, creado_en TEXT, pagado_en TEXT,
            entregado_en TEXT, transaction_id TEXT, monto_pagado REAL)""")
        con.execute("""CREATE TABLE IF NOT EXISTS pagos(
            transaction_id TEXT PRIMARY KEY, webhook_id TEXT, cobro_id TEXT,
            monto REAL, hora TEXT, origen TEXT)""")
        con.execute("""CREATE TABLE IF NOT EXISTS webhooks(
            webhook_id TEXT PRIMARY KEY, hora TEXT)""")
        con.commit()
        con.close()
    except Exception as e:
        print("[db] init fallo:", e)


def db_guardar_cobro(c):
    try:
        con = _db()
        con.execute("""INSERT OR REPLACE INTO cobros
            (id, codi_qr_id, estado, monto, concepto, canal, creado_en,
             pagado_en, entregado_en, transaction_id, monto_pagado)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (c["id"], c.get("codiQrId"), c["estado"], c["monto"], c.get("concepto"),
                     c.get("canal"), c.get("creadoEn"), c.get("pagadoEn"), c.get("entregadoEn"),
                     c.get("transactionId"), c.get("montoPagado")))
        con.commit()
        con.close()
    except Exception as e:
        print("[db] guardar_cobro fallo:", e)


def db_registrar_pago(tx, wid, cobro_id, monto, origen):
    """Ledger de auditoria + idempotencia durable. True si es pago NUEVO."""
    if not tx:
        return True
    try:
        con = _db()
        cur = con.execute("INSERT OR IGNORE INTO pagos VALUES (?,?,?,?,?,?)",
                          (tx, wid, cobro_id, monto, ahora_iso(), origen))
        con.commit()
        nuevo = cur.rowcount > 0
        con.close()
        return nuevo
    except Exception as e:
        print("[db] registrar_pago fallo:", e)
        return True


def db_persistir_webhook(wid):
    try:
        con = _db()
        con.execute("INSERT OR IGNORE INTO webhooks VALUES (?,?)", (wid, ahora_iso()))
        con.commit()
        con.close()
    except Exception as e:
        print("[db] persistir_webhook fallo:", e)


def db_cargar_estado():
    """Al arrancar: reconstruye estado para que un reinicio NO pierda idempotencia."""
    try:
        con = _db()
        for r in con.execute("SELECT * FROM cobros"):
            c = {"id": r["id"], "codiQrId": r["codi_qr_id"], "estado": r["estado"],
                 "monto": r["monto"], "concepto": r["concepto"], "canal": r["canal"],
                 "creadoEn": r["creado_en"], "pagadoEn": r["pagado_en"],
                 "entregadoEn": r["entregado_en"], "transactionId": r["transaction_id"],
                 "montoPagado": r["monto_pagado"], "qrImage": None, "qrString": None}
            COBROS[c["id"]] = c
            if c["codiQrId"]:
                POR_CODIQR[c["codiQrId"]] = c["id"]
        for r in con.execute("SELECT transaction_id FROM pagos"):
            if r["transaction_id"]:
                TX_VISTOS.add(r["transaction_id"])
        for r in con.execute("SELECT webhook_id FROM webhooks"):
            WEBHOOKS_VISTOS.add(r["webhook_id"])
        con.close()
        print(f"[db] estado cargado: {len(COBROS)} cobros, {len(TX_VISTOS)} tx, "
              f"{len(WEBHOOKS_VISTOS)} webhooks")
    except Exception as e:
        print("[db] cargar_estado fallo:", e)


# ======================= Auth / rate-limit (A1) =======================
def _ip(req: Request) -> str:
    # N4: tras el tunel, client.host es una sola IP. Prefiere la IP real del cliente.
    h = req.headers
    return (h.get("cf-connecting-ip")
            or (h.get("x-forwarded-for", "").split(",")[0].strip() or None)
            or (req.client.host if req.client else "x"))


def _rate_ok(ip: str) -> bool:
    ahora = time.time()
    q = PETICIONES[ip]
    while q and ahora - q[0] > 60:
        q.pop(0)
    if len(q) >= LIMITE_POR_MIN:
        return False
    q.append(ahora)
    return True


def _requiere_token(req: Request):
    # Dormante: sin API_TOKEN configurado, las rutas quedan ABIERTAS (no rompe a Oscar).
    if not API_TOKEN:
        return
    auth = req.headers.get("authorization", "")
    try:                                     # N5: header no-ASCII -> 401 limpio, no 500
        ok = hmac.compare_digest(auth, f"Bearer {API_TOKEN}")
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(401, "no autorizado")


async def emitir(evento, data):
    msg = {"evento": evento, **data}
    for q in list(SUBS):
        try:
            q.put_nowait(msg)
        except Exception:
            pass


def cuenta_ok():
    if MODO == "cuenta_registrada":
        return CUENTA_ESTADO["estado"] == "ACTIVE"
    return True  # credencial_propia: la cuenta ligada a la API key ES el comercio


# ======================= Nucleo: crear un cobro (lo usan /api/cobros y /mcp) =======================
async def _nuevo_cobro(monto: float, concepto=None, canal="qr"):
    if monto <= 0:
        raise HTTPException(400, "monto debe ser > 0")
    if not cuenta_ok():
        raise HTTPException(503, "cuenta no activa (candado 1)")
    concepto = (concepto or "Venta")[:100]
    cobro_id = "c_" + base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip("=")
    num_ref = str(int(time.time()))[-7:]
    payload = {
        "amount": monto,                 # [CONFIRMAR] monto FIJO, nunca 0
        "concept": concepto,
        "expiration": 360,
        "numRef": num_ref,
        "generateImage": True,
        "metadata": {"cobroId": cobro_id},
    }
    if MODO == "cuenta_registrada" and BANK_ACCOUNT_ID:
        payload["bankAccountId"] = BANK_ACCOUNT_ID
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{PEY_API_BASE}/codi/qr", json=payload,
                             headers={"Authorization": f"Bearer {PEY_API_KEY}"})
    except Exception as e:
        raise HTTPException(502, f"pey no responde: {e}")
    if r.status_code not in (200, 201):
        print("[pey] /codi/qr error", r.status_code, r.text[:200])   # A7: no fugar al cliente
        raise HTTPException(502, f"pey error {r.status_code}")
    data = r.json()
    codiqr = data.get("id")
    cobro = {
        "id": cobro_id, "codiQrId": codiqr, "estado": "pendiente",
        "monto": monto, "concepto": concepto, "canal": canal,
        "qrImage": data.get("qrImage"), "qrString": data.get("qrString"),
        "creadoEn": ahora_iso(),
    }
    COBROS[cobro_id] = cobro
    if codiqr:
        POR_CODIQR[codiqr] = cobro_id
    db_guardar_cobro(cobro)
    await emitir("creado", {"id": cobro_id, "monto": monto,
                            "qrImage": cobro["qrImage"], "estado": "pendiente"})
    return cobro


# ---------- Candado 1: verificar cuenta al arrancar + cargar estado + polling ----------
@app.on_event("startup")
async def startup():
    db_init()
    db_cargar_estado()
    if MODO == "cuenta_registrada" and BANK_ACCOUNT_ID:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(f"{PEY_API_BASE}/bank-account/{BANK_ACCOUNT_ID}",
                                headers={"Authorization": f"Bearer {PEY_API_KEY}"})
            CUENTA_ESTADO["estado"] = r.json().get("codiStatus", "desconocido") \
                if r.status_code == 200 else f"error_{r.status_code}"
        except Exception:
            CUENTA_ESTADO["estado"] = "no_alcanzable"
    else:
        CUENTA_ESTADO["estado"] = "credencial_propia"
    asyncio.create_task(polling_respaldo())


@app.get("/salud")
def salud():
    return {
        "modo": MODO,
        "cuentaEstado": CUENTA_ESTADO["estado"],
        "cobrosPendientes": sum(1 for c in COBROS.values() if c["estado"] == "pendiente"),
        "ultimoWebhook": ULTIMO_WEBHOOK["hora"],
        "authRutas": "on" if API_TOKEN else "abierto",
        "persistencia": "sqlite",
        "pantalla": "web/dist" if os.path.isfile(os.path.join(WEB_DIST, "index.html")) else "aparte",
        "version": VERSION,
    }


# ---------- Pantalla del cajero: un proceso, una URL ----------
# Si web/dist existe (npm run build en web/), GET / sirve la pantalla y /assets sus archivos.
# Si no existe, el server sigue vivo con el aviso de siempre (el front corre aparte con Vite).
if os.path.isdir(os.path.join(WEB_DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(WEB_DIST, "assets")), name="assets")


@app.get("/")
def home():
    index = os.path.join(WEB_DIST, "index.html")
    if os.path.isfile(index):
        return FileResponse(index, media_type="text/html",
                            headers={"Cache-Control": "no-cache"})
    return HTMLResponse("<h1>La Bocina</h1><p>Servidor vivo (paso 3, endurecido). "
                        "Pantalla del cajero: compila <code>web/</code> o corre Vite.</p>")


# ---------- Crear cobro -> POST /codi/qr real ----------
@app.post("/api/cobros")
async def crear_cobro(req: Request):
    if not _rate_ok(_ip(req)):
        raise HTTPException(429, "demasiadas peticiones")
    _requiere_token(req)
    body = await req.json()
    try:
        monto = float(body.get("monto"))
    except (TypeError, ValueError):
        raise HTTPException(400, "monto invalido")
    cobro = await _nuevo_cobro(monto, body.get("concepto"), body.get("canal", "qr"))
    return JSONResponse({"id": cobro["id"], "estado": "pendiente", "monto": cobro["monto"],
                         "canal": cobro["canal"], "qrImage": cobro["qrImage"]}, status_code=201)


@app.get("/api/cobros/{cobro_id}")
def estado_cobro(cobro_id: str):
    c = COBROS.get(cobro_id)
    if not c:
        raise HTTPException(404, "no existe")
    return c


@app.get("/api/cobros/{cobro_id}/qr")
def qr_png(cobro_id: str):
    c = COBROS.get(cobro_id)
    if not c or not c.get("qrImage"):
        raise HTTPException(404, "no existe o sin QR")
    return Response(content=base64.b64decode(c["qrImage"]), media_type="image/png")


# ---------- SSE hacia la pantalla ----------
@app.get("/api/eventos")
async def eventos():
    q = asyncio.Queue()
    SUBS.add(q)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": latido\n\n"
        finally:
            SUBS.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- Webhook: el unico lugar donde nace un PAGADO ----------
def verificar_firma(raw: bytes, headers) -> bool:
    # Standard Webhooks: base64(HMAC-SHA256(secret, f"{id}.{ts}.{body}"))
    wid = headers.get("webhook-id")
    wts = headers.get("webhook-timestamp")
    wsig = headers.get("webhook-signature")
    if not (wid and wts and wsig and PEY_WEBHOOK_SECRET):
        return False
    try:                                              # A2: anti-replay, +-5 min
        if abs(time.time() - int(wts)) > 300:
            return False
    except (TypeError, ValueError):
        return False
    secret = PEY_WEBHOOK_SECRET
    if secret.startswith("whsec_"):                   # [CONFIRMAR] prefijo del secreto
        secret = secret[len("whsec_"):]
    try:
        key = base64.b64decode(secret)
    except Exception:
        key = secret.encode()
    signed = f"{wid}.{wts}.".encode() + raw
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    try:                                              # A7: header raro -> 401 limpio, no 500
        for part in wsig.split(" "):
            sig = part.split(",", 1)[1] if "," in part else part
            if hmac.compare_digest(sig, expected):
                return True
    except Exception:
        return False
    return False


@app.post("/webhooks/pey")
async def webhook_pey(req: Request):
    raw = await req.body()                          # CUERPO CRUDO, sin parsear
    headers = {k.lower(): v for k, v in req.headers.items()}
    if not verificar_firma(raw, headers):
        return JSONResponse({"ok": False, "detalle": "firma invalida"}, status_code=401)

    try:                                            # A7: json malformado -> 400, no 500
        data = json.loads(raw)
    except Exception:
        return JSONResponse({"ok": False, "detalle": "json invalido"}, status_code=400)

    wid = headers.get("webhook-id")
    if wid in WEBHOOKS_VISTOS:                       # idempotencia por webhook-id (durable)
        return {"ok": True}
    WEBHOOKS_VISTOS.add(wid)
    db_persistir_webhook(wid)
    ULTIMO_WEBHOOK["hora"] = ahora_iso()

    if data.get("type") not in ("codi.qr.payment_received", "codi.pn.payment_received"):
        return {"ok": True}

    cobro_id = POR_CODIQR.get(data.get("codiQrId"))
    if not cobro_id:
        return {"ok": True}
    cobro = COBROS[cobro_id]

    # Candado extra (A4): si esperamos una cuenta, exigela; ausente o ajena -> ignora.
    if MODO == "cuenta_registrada" and BANK_ACCOUNT_ID:
        if data.get("bankAccountId") != BANK_ACCOUNT_ID:
            return {"ok": True}

    tx = data.get("transactionId")
    if not tx:                                       # A6: sin tx no se marca pagado
        return {"ok": True}
    if tx in TX_VISTOS:                              # idempotencia por transactionId (durable)
        return {"ok": True}
    TX_VISTOS.add(tx)

    monto_pagado = data.get("amount")
    if monto_pagado is not None and float(monto_pagado) != float(cobro["monto"]):
        cobro["estado"] = "error"
        cobro["mensajeError"] = "monto no coincide"
        db_guardar_cobro(cobro)
        await emitir("error", {"id": cobro_id, "mensaje": "monto no coincide"})
        return {"ok": True}

    tracking = (data.get("metadata", {}) or {}).get("trackingKey", "") or ""
    term = tracking[-2:] if tracking else ""
    if cobro["estado"] == "pendiente":
        cobro.update(estado="pagado", montoPagado=monto_pagado,
                     pagadoEn=data.get("datePaid") or ahora_iso(),
                     rastreoTerminacion=term, transactionId=tx)
        db_guardar_cobro(cobro)
        db_registrar_pago(tx, wid, cobro_id, monto_pagado, "webhook")   # ledger punto 6
        await emitir("pagado", {"id": cobro_id, "monto": monto_pagado,
                                "hora": cobro["pagadoEn"], "rastreoTerminacion": term,
                                "transactionId": tx})
    else:
        await emitir("tardio", {"id": cobro_id, "monto": monto_pagado,
                                "rastreoTerminacion": term})
    return {"ok": True}


@app.post("/api/cobros/{cobro_id}/entregar")
async def entregar(cobro_id: str, req: Request):
    _requiere_token(req)
    c = COBROS.get(cobro_id)
    if not c:
        raise HTTPException(404, "no existe")
    if c["estado"] == "entregado":
        return c
    if c["estado"] != "pagado":
        raise HTTPException(409, "solo se entrega un cobro pagado")
    c["estado"] = "entregado"
    c["entregadoEn"] = ahora_iso()
    db_guardar_cobro(c)
    await emitir("entregado", {"id": cobro_id, "entregadoEn": c["entregadoEn"]})
    return c


# ======================= Proxy de voz (ElevenLabs) para Oscar =======================
# La llave de ElevenLabs vive SOLO del lado servidor. El navegador le pega a estos
# endpoints, nunca a ElevenLabs directo -> la llave no se expone.
# --- Motores de TTS (lazy: solo se importa el que uses) ---
_KOKORO_PIPE = None


def _tts_kokoro(texto):
    """Local, CPU, Apache-2.0. Primera llamada descarga el modelo (~327MB)."""
    global _KOKORO_PIPE
    import io
    import numpy as np
    import soundfile as sf
    if _KOKORO_PIPE is None:
        from kokoro import KPipeline
        _KOKORO_PIPE = KPipeline(lang_code=KOKORO_LANG)
    trozos = [a for _, _, a in _KOKORO_PIPE(texto, voice=KOKORO_VOICE)]
    if not trozos:
        raise RuntimeError("kokoro no genero audio")
    audio = np.concatenate(trozos)
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    buf.seek(0)
    return buf.read(), "audio/wav"


async def _tts_edge(texto):
    """Gratis, sin llave (Microsoft). Voz es-MX."""
    import edge_tts
    com = edge_tts.Communicate(texto, EDGE_VOICE)
    out = bytearray()
    async for ch in com.stream():
        if ch["type"] == "audio":
            out.extend(ch["data"])
    if not out:
        raise RuntimeError("edge-tts no genero audio")
    return bytes(out), "audio/mpeg"


async def _tts_openrouter_modelo(texto, modelo):
    """Una llamada a OpenRouter /audio/speech con un modelo concreto.
    OJO: response_format por defecto es PCM; forzamos mp3 para el navegador."""
    payload = {"model": modelo, "input": texto, "response_format": "mp3"}
    if OPENROUTER_VOICE:
        payload["voice"] = OPENROUTER_VOICE
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post("https://openrouter.ai/api/v1/audio/speech",
                         headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                                  "Content-Type": "application/json"},
                         json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"{modelo} -> {r.status_code} {r.text[:150]}")
    return r.content, r.headers.get("content-type", "audio/mpeg")


async def _tts_openrouter(texto):
    """Intenta el modelo principal y, si falla, el de fallback (ambos free)."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "TTS no configurado (falta OPENROUTER_API_KEY)")
    ultimo = None
    if TTS_CUE:                                  # cue de entrega: solo modelos de OpenRouter
        texto = f"{TTS_CUE} {texto}"
    for modelo in [m for m in (OPENROUTER_TTS_MODEL, OPENROUTER_TTS_FALLBACK) if m]:
        try:
            return await _tts_openrouter_modelo(texto, modelo)
        except Exception as e:
            ultimo = e
            print(f"[tts] openrouter modelo '{modelo}' fallo: {e}")
    raise RuntimeError(f"openrouter agotado: {ultimo}")


async def _tts_remote(texto):
    """La PC con GPU (Linux/ROCm) corre el modelo y expone POST /tts {texto} -> audio."""
    if not TTS_REMOTE_URL:
        raise HTTPException(503, "TTS remoto no configurado (falta TTS_REMOTE_URL)")
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(TTS_REMOTE_URL, json={"texto": texto})
    if r.status_code != 200:
        print("[tts] remoto error", r.status_code, r.text[:200])
        raise HTTPException(502, "TTS remoto error")
    return r.content, r.headers.get("content-type", "audio/wav")


async def _tts_elevenlabs(texto):
    if not ELEVENLABS_API_KEY:
        raise HTTPException(503, "TTS no configurado (falta ELEVENLABS_API_KEY)")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(url, headers={"xi-api-key": ELEVENLABS_API_KEY,
                                       "accept": "audio/mpeg",
                                       "content-type": "application/json"},
                         json={"text": texto, "model_id": ELEVENLABS_TTS_MODEL})
    if r.status_code != 200:
        print("[tts] elevenlabs error", r.status_code, r.text[:200])
        raise HTTPException(502, "TTS error")
    return r.content, "audio/mpeg"


@app.post("/api/tts")
async def tts(req: Request):
    """Texto -> audio. Motor segun TTS_BACKEND. Mismo contrato para Oscar. La Bocina canta."""
    if not _rate_ok(_ip(req)):
        raise HTTPException(429, "demasiadas peticiones")
    _requiere_token(req)
    body = await req.json()
    texto = (body.get("texto") or body.get("text") or "").strip()[:500]
    if not texto:
        raise HTTPException(400, "texto vacio")
    try:
        if TTS_BACKEND == "kokoro":
            audio, mime = await asyncio.to_thread(_tts_kokoro, texto)
        elif TTS_BACKEND == "edge":
            audio, mime = await _tts_edge(texto)
        elif TTS_BACKEND == "openrouter":
            try:
                audio, mime = await _tts_openrouter(texto)
            except Exception as e:
                print("[tts] openrouter agotado -> red final edge:", e)
                audio, mime = await _tts_edge(texto)   # Fish -> HeyGen -> edge/Dalia
        elif TTS_BACKEND == "remote":
            audio, mime = await _tts_remote(texto)
        else:
            audio, mime = await _tts_elevenlabs(texto)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[tts] backend '{TTS_BACKEND}' fallo:", e)
        raise HTTPException(502, f"TTS backend '{TTS_BACKEND}' fallo")
    return Response(content=audio, media_type=mime)


async def _stt_openrouter(audio, ctype, ext):
    """OpenRouter /audio/transcriptions (multipart). Grok STT por defecto."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "STT no configurado (falta OPENROUTER_API_KEY)")
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post("https://openrouter.ai/api/v1/audio/transcriptions",
                         headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                         files={"file": (f"audio.{ext}", audio, ctype)},
                         data={"model": OPENROUTER_STT_MODEL})
    if r.status_code != 200:
        print("[stt] openrouter error", r.status_code, r.text[:200])
        raise HTTPException(502, "STT openrouter error")
    return r.json()


async def _stt_elevenlabs(audio, ctype, ext):
    if not ELEVENLABS_API_KEY:
        raise HTTPException(503, "STT no configurado (falta ELEVENLABS_API_KEY)")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post("https://api.elevenlabs.io/v1/speech-to-text",
                         headers={"xi-api-key": ELEVENLABS_API_KEY},
                         files={"file": (f"audio.{ext}", audio, ctype)},
                         data={"model_id": ELEVENLABS_STT_MODEL})
    if r.status_code != 200:
        print("[stt] elevenlabs error", r.status_code, r.text[:200])
        raise HTTPException(502, "STT error")
    return r.json()


@app.post("/api/stt")
async def stt(req: Request):
    """Audio (blob del MediaRecorder) -> {text}. Motor segun STT_BACKEND. El navegador saca el monto."""
    if not _rate_ok(_ip(req)):
        raise HTTPException(429, "demasiadas peticiones")
    _requiere_token(req)
    cl = req.headers.get("content-length")           # N2: cap de tamano
    if cl and cl.isdigit() and int(cl) > 5_000_000:
        raise HTTPException(413, "audio muy grande (max 5MB)")
    audio = await req.body()
    if not audio:
        raise HTTPException(400, "sin audio")
    if len(audio) > 5_000_000:
        raise HTTPException(413, "audio muy grande (max 5MB)")
    ctype = req.headers.get("content-type", "audio/webm") or "audio/webm"
    ext = "webm" if "webm" in ctype else ("mp3" if "mpeg" in ctype or "mp3" in ctype else "wav")
    try:
        if STT_BACKEND == "openrouter":
            data = await _stt_openrouter(audio, ctype, ext)
        else:
            data = await _stt_elevenlabs(audio, ctype, ext)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[stt] backend '{STT_BACKEND}' fallo:", e)
        raise HTTPException(502, f"STT backend '{STT_BACKEND}' fallo")
    return JSONResponse(data)


# ---------- Polling de respaldo (mientras haya pendientes) ----------
async def polling_respaldo():
    while True:
        await asyncio.sleep(5)
        for c in [x for x in COBROS.values() if x["estado"] == "pendiente" and x.get("codiQrId")]:
            try:
                async with httpx.AsyncClient(timeout=10) as cli:
                    r = await cli.get(f"{PEY_API_BASE}/transaction/codi/qr/{c['codiQrId']}",
                                      headers={"Authorization": f"Bearer {PEY_API_KEY}"})
                if r.status_code != 200:
                    continue
                payload = r.json()
                # [CONFIRMAR] forma exacta en docs.pey.mx/openapi.json
                lista = payload if isinstance(payload, list) \
                    else payload.get("data") or payload.get("transactions") or []
                if not lista:
                    continue
                p = lista[0]
                amt = p.get("amount")                        # A3: compara monto como el webhook
                if amt is not None and float(amt) != float(c["monto"]):
                    continue
                tx = p.get("transactionId")
                if tx and tx not in TX_VISTOS:
                    TX_VISTOS.add(tx)
                    c.update(estado="pagado", transactionId=tx, pagadoEn=ahora_iso(),
                             montoPagado=p.get("amount", c["monto"]))
                    db_guardar_cobro(c)
                    db_registrar_pago(tx, None, c["id"], c["montoPagado"], "polling")
                    await emitir("pagado", {"id": c["id"], "monto": c["montoPagado"],
                                            "hora": c["pagadoEn"], "rastreoTerminacion": "",
                                            "transactionId": tx})
            except Exception:
                pass


# ======================= mini-MCP: cobrar() =======================
def _auth_mcp(headers) -> bool:
    if not MCP_TOKEN:
        return True
    auth = headers.get("authorization", "")
    try:                                     # paridad con N5: header raro -> False, no 500
        return auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], MCP_TOKEN)
    except Exception:
        return False


@app.post("/mcp")
async def mcp(req: Request):
    if not _rate_ok(_ip(req)):                       # N1: mismo tope que /api/cobros
        raise HTTPException(429, "demasiadas peticiones")
    headers = {k.lower(): v for k, v in req.headers.items()}
    if not _auth_mcp(headers):
        return JSONResponse({"error": "no autorizado"}, status_code=401)
    body = await req.json()
    rid = body.get("id")
    method = body.get("method")
    # Saludo MCP (Streamable HTTP, respuesta JSON): sin esto un cliente real
    # (Cursor, Claude) no llega nunca a tools/list.
    if method == "initialize":
        pedida = (body.get("params") or {}).get("protocolVersion")
        return {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": pedida if isinstance(pedida, str) else "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "la-bocina", "version": VERSION}}}
    if rid is None and isinstance(method, str) and method.startswith("notifications/"):
        return Response(status_code=202)             # notificacion: no lleva respuesta
    if method == "ping":
        return {"jsonrpc": "2.0", "id": rid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": [{
            "name": "cobrar",
            "description": "Crea un cobro CoDi (QR dinamico, monto fijo) por el API de pey. "
                           "Devuelve el id del cobro y el QR en base64. El pago lo confirma "
                           "el webhook firmado; consulta el estado en GET /api/cobros/{id}.",
            "inputSchema": {"type": "object", "properties": {
                "monto": {"type": "number", "description": "Monto en MXN, mayor a 0"},
                "concepto": {"type": "string", "description": "Concepto del cobro"},
            }, "required": ["monto"]},
        }]}}
    if method == "tools/call":
        params = body.get("params", {}) or {}
        if params.get("name") != "cobrar":
            return JSONResponse({"jsonrpc": "2.0", "id": rid,
                                 "error": {"code": -32601, "message": "tool no existe"}}, status_code=404)
        args = params.get("arguments", {}) or {}
        try:
            monto = float(args.get("monto"))
        except (TypeError, ValueError):
            return JSONResponse({"jsonrpc": "2.0", "id": rid,
                                 "error": {"code": -32602, "message": "monto invalido"}}, status_code=400)
        try:
            cobro = await _nuevo_cobro(monto, args.get("concepto"), canal="mcp")
        except HTTPException as e:               # candado / pey caido -> error de la tool, legible
            return {"jsonrpc": "2.0", "id": rid, "result": {
                "content": [{"type": "text", "text": f"No se pudo cobrar: {e.detail}"}],
                "isError": True}}
        return {"jsonrpc": "2.0", "id": rid, "result": {
            "content": [{"type": "text", "text": json.dumps(
                {"id": cobro["id"], "estado": cobro["estado"], "monto": cobro["monto"]})}],
            "isError": False,
            "cobroId": cobro["id"], "qrImage": cobro["qrImage"]}}
    return JSONResponse({"jsonrpc": "2.0", "id": rid,
                         "error": {"code": -32601, "message": "metodo no soportado"}}, status_code=400)
