"""Prueba de humo de punta a punta contra un server LOCAL y el pey simulado.

Recorre el contrato que usa la pantalla del cajero: token, cobro, SSE, webhook
firmado (y forjados), replay, entregar, mini-MCP y voz. No toca al pey real.

Uso (ver server/pruebas/README.md):
    python prueba_humo.py --token lbk_prueba_local --mcp-token mcp_prueba_local \
        --secreto <secreto de prueba en base64>
"""
import argparse, base64, hashlib, hmac, json, sys, threading, time, uuid
import httpx

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8000")
ap.add_argument("--token", required=True)
ap.add_argument("--mcp-token", default="")
ap.add_argument("--secreto", required=True, help="secreto del webhook en base64 (sin whsec_)")
ap.add_argument("--sin-voz", action="store_true", help="salta /api/tts")
a = ap.parse_args()

B = a.base.rstrip("/")
AUTH = {"Authorization": f"Bearer {a.token}"}
fallos = []


def paso(nombre, ok, detalle=""):
    print(("  OK    " if ok else "  FALLA ") + nombre + (f"  [{detalle}]" if detalle else ""))
    if not ok:
        fallos.append(nombre)


def firmar(cuerpo: bytes, wid: str, ts: str, secreto_b64: str) -> str:
    firmado = f"{wid}.{ts}.".encode() + cuerpo
    mac = hmac.new(base64.b64decode(secreto_b64), firmado, hashlib.sha256).digest()
    return "v1," + base64.b64encode(mac).decode()


def webhook(datos: dict, wid=None, ts=None, secreto=None):
    cuerpo = json.dumps(datos).encode()
    wid = wid or "msg_" + uuid.uuid4().hex
    ts = ts or str(int(time.time()))
    h = {"webhook-id": wid, "webhook-timestamp": ts, "content-type": "application/json",
         "webhook-signature": firmar(cuerpo, wid, ts, secreto or a.secreto)}
    return httpx.post(f"{B}/webhooks/pey", content=cuerpo, headers=h, timeout=10), wid


# --- oido SSE en un hilo, igual que la pantalla del cajero
eventos = []


def escuchar():
    try:
        with httpx.stream("GET", f"{B}/api/eventos", timeout=None) as r:
            for linea in r.iter_lines():
                if linea.startswith("data:"):
                    eventos.append(json.loads(linea[5:].strip()))
    except Exception:
        pass


threading.Thread(target=escuchar, daemon=True).start()
time.sleep(0.8)


def esperar(evento, cobro_id, seg=5):
    fin = time.time() + seg
    while time.time() < fin:
        if any(e.get("evento") == evento and e.get("id") == cobro_id for e in eventos):
            return True
        time.sleep(0.1)
    return False


def cuantos(evento, cobro_id):
    return sum(1 for e in eventos if e.get("evento") == evento and e.get("id") == cobro_id)


print("== salud y pantalla")
s = httpx.get(f"{B}/salud").json()
paso("/salud responde sin secretos", "modo" in s and not any("key" in k.lower() for k in s), json.dumps(s))
paso("GET / sirve algo", httpx.get(f"{B}/").status_code == 200)

print("== token en los POST")
r = httpx.post(f"{B}/api/cobros", json={"monto": 1, "concepto": "x", "canal": "qr"})
paso("POST /api/cobros sin token -> 401", r.status_code == 401, str(r.status_code))
r = httpx.post(f"{B}/api/cobros", json={"monto": 0, "canal": "qr"}, headers=AUTH)
paso("monto 0 -> 400 (siempre monto fijo)", r.status_code == 400, str(r.status_code))

print("== cobro -> QR")
r = httpx.post(f"{B}/api/cobros", json={"monto": 35.5, "concepto": "Taco", "canal": "voz"}, headers=AUTH)
c = r.json()
paso("POST /api/cobros -> 201 con qrImage", r.status_code == 201 and bool(c.get("qrImage")), str(r.status_code))
cid = c["id"]
paso("el QR es un PNG valido", base64.b64decode(c["qrImage"])[:8] == b"\x89PNG\r\n\x1a\n")
paso("GET /api/cobros/{id}/qr -> PNG",
     httpx.get(f"{B}/api/cobros/{cid}/qr").headers.get("content-type") == "image/png")
paso("SSE avisa 'creado'", esperar("creado", cid))
det = httpx.get(f"{B}/api/cobros/{cid}").json()
paso("estado pendiente (GET sin token)", det["estado"] == "pendiente")
paso("no se entrega un cobro sin pagar -> 409",
     httpx.post(f"{B}/api/cobros/{cid}/entregar", headers=AUTH).status_code == 409)

pago = {"type": "codi.qr.payment_received", "amount": 35.5, "codiQrId": det["codiQrId"],
        "transactionId": "tx_" + uuid.uuid4().hex[:12], "datePaid": "2026-11-14T21:00:00Z",
        "metadata": {"trackingKey": "MBAN0100221114000000042"}}

print("== webhook: lo forjado no canta")
otro = base64.b64encode(b"otro-secreto-que-no-es-el-bueno!!").decode()
r, _ = webhook(pago, secreto=otro)
paso("firma forjada -> 401", r.status_code == 401, str(r.status_code))
r, _ = webhook(pago, ts=str(int(time.time()) - 3600))
paso("timestamp viejo (replay) -> 401", r.status_code == 401, str(r.status_code))
r = httpx.post(f"{B}/webhooks/pey", json=pago)
paso("sin encabezados de firma -> 401", r.status_code == 401, str(r.status_code))
time.sleep(0.5)
paso("sigue pendiente tras los 3 intentos",
     httpx.get(f"{B}/api/cobros/{cid}").json()["estado"] == "pendiente" and cuantos("pagado", cid) == 0)

print("== webhook: el bueno canta UNA vez")
r, wid = webhook(pago)
paso("firma valida -> 200", r.status_code == 200, str(r.status_code))
paso("SSE avisa 'pagado'", esperar("pagado", cid))
det = httpx.get(f"{B}/api/cobros/{cid}").json()
paso("estado pagado + transactionId",
     det["estado"] == "pagado" and det.get("transactionId") == pago["transactionId"])
paso("rastreo solo en sus 2 ultimos caracteres",
     det.get("rastreoTerminacion") == "42", str(det.get("rastreoTerminacion")))
webhook(pago, wid=wid)                    # mismo webhook-id
webhook(pago)                             # webhook-id nuevo, mismo transactionId
time.sleep(0.6)
paso("los repetidos no vuelven a cantar", cuantos("pagado", cid) == 1, f"pagado x{cuantos('pagado', cid)}")

print("== entregar")
r = httpx.post(f"{B}/api/cobros/{cid}/entregar")
paso("entregar sin token -> 401", r.status_code == 401, str(r.status_code))
r = httpx.post(f"{B}/api/cobros/{cid}/entregar", headers=AUTH)
paso("entregar -> entregado", r.status_code == 200 and r.json()["estado"] == "entregado")
paso("SSE avisa 'entregado'", esperar("entregado", cid))

print("== monto que no coincide")
r = httpx.post(f"{B}/api/cobros", json={"monto": 10, "canal": "qr"}, headers=AUTH)
c2 = r.json()
d2 = httpx.get(f"{B}/api/cobros/{c2['id']}").json()
webhook({**pago, "amount": 1, "codiQrId": d2["codiQrId"], "transactionId": "tx_" + uuid.uuid4().hex[:12]})
paso("monto distinto -> 'error', nunca 'pagado'",
     esperar("error", c2["id"]) and cuantos("pagado", c2["id"]) == 0)

print("== mini-MCP cobrar()")
mh = {"Authorization": f"Bearer {a.mcp_token}"} if a.mcp_token else {}
if a.mcp_token:
    r = httpx.post(f"{B}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    paso("/mcp sin token -> 401", r.status_code == 401, str(r.status_code))
r = httpx.post(f"{B}/mcp", headers=mh, json={"jsonrpc": "2.0", "id": 0, "method": "initialize",
               "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                          "clientInfo": {"name": "prueba", "version": "0"}}})
ini = r.json().get("result", {})
paso("initialize -> saludo MCP con tools", r.status_code == 200 and "tools" in ini.get("capabilities", {})
     and ini.get("protocolVersion") == "2025-06-18")
r = httpx.post(f"{B}/mcp", headers=mh, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
paso("notifications/initialized -> 202 sin cuerpo", r.status_code == 202 and not r.content, str(r.status_code))
r = httpx.post(f"{B}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=mh)
paso("tools/list anuncia cobrar", r.json()["result"]["tools"][0]["name"] == "cobrar")
r = httpx.post(f"{B}/mcp", headers=mh, json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
               "params": {"name": "cobrar", "arguments": {"monto": 1, "concepto": "cafe"}}})
mid = r.json()["result"]["cobroId"]
r = httpx.post(f"{B}/mcp", headers=mh, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
               "params": {"name": "cobrar", "arguments": {"monto": -5}}})
paso("cobrar() con monto invalido -> isError, no 500",
     r.status_code == 200 and r.json()["result"].get("isError") is True, str(r.status_code))
paso("cobrar() crea el cobro y la pantalla lo ve por SSE", esperar("creado", mid))

if not a.sin_voz:
    print("== voz")
    r = httpx.post(f"{B}/api/tts", json={"texto": "Un peso recibido."}, timeout=60)
    paso("/api/tts sin token -> 401", r.status_code == 401, str(r.status_code))
    r = httpx.post(f"{B}/api/tts", json={"texto": "Un peso recibido."}, headers=AUTH, timeout=60)
    paso("/api/tts -> audio", r.status_code == 200 and len(r.content) > 1000
         and r.headers.get("content-type", "").startswith("audio/"),
         f"{r.status_code} {r.headers.get('content-type')} {len(r.content)}b")

print()
if fallos:
    print(f"FALLARON {len(fallos)}: " + "; ".join(fallos))
    sys.exit(1)
print("TODO VERDE")
