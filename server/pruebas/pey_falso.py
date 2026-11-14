"""pey simulado para pruebas locales: NO es pey, no mueve dinero."""
import base64, io, struct, zlib, uuid
from fastapi import FastAPI, Request
app = FastAPI()

def png(n=29, s=8):
    import random
    random.seed(7)
    w = n * s
    rows = b""
    cells = [[random.random() < 0.5 for _ in range(n)] for _ in range(n)]
    for y in range(w):
        rows += b"\x00" + bytes(0 if cells[y // s][x // s] else 255 for x in range(w))
    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, w, 8, 0, 0, 0, 0))
            + ch(b"IDAT", zlib.compress(rows)) + ch(b"IEND", b""))

QR = base64.b64encode(png()).decode()
VISTOS = []

@app.post("/codi/qr")
async def qr(req: Request):
    body = await req.json()
    VISTOS.append({"auth": req.headers.get("authorization"), "body": body})
    return __import__("fastapi").responses.JSONResponse(
        {"id": "qr_" + uuid.uuid4().hex[:10], "qrString": "FALSO", "qrImage": QR}, status_code=201)

@app.get("/transaction/codi/qr/{qid}")
def tx(qid: str):
    return []

@app.get("/_vistos")
def vistos():
    return VISTOS
