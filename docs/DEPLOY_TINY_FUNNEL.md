# Dejar La Bocina viva: la Tiny + Tailscale Funnel

> Runbook para DESPUÉS de la demo/entrega. Deja la API corriendo 24/7 en la Tiny (casa,
> siempre encendida, ya en Tailscale), con URL pública estable y el proceso que revive solo.
> El frontend (pantalla) va aparte en Vercel/Cloudflare Pages.

## Arquitectura final
```
Tiny (casa, 24/7)
  uvicorn main:app  (servicio NSSM, revive en reinicio/crash)  -> 127.0.0.1:8000
  + SQLite (la_bocina.db, ledger durable)
  + Tailscale Funnel  (443 publico -> localhost:8000)
     => URL estable:  https://<tiny>.<tailnet>.ts.net
Frontend estatico (pantalla de Oscar) -> Vercel / Cloudflare Pages  (BASE = la URL ts.net)
Webhook de pey -> https://<tiny>.<tailnet>.ts.net/webhooks/pey
```

## Paso 0 — Llevar el código a la Tiny
- Si el repo ya está en GitHub: `git clone <repo>` en la Tiny.
- Si no: copia la carpeta `server/` (vía `_compartido` o Tailscale) a la Tiny.
- **El `.env` NO va por git.** Cópialo a mano a la Tiny (trae pey key, webhook secret,
  ElevenLabs key y los tokens). Confirma que la Tiny tenga Python 3.11+.

## Paso 1 — Entorno en la Tiny
```powershell
cd C:\ruta\la-bocina\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# prueba manual primero:
uvicorn main:app --host 127.0.0.1 --port 8000
#   -> /salud debe decir version 0.3-endurecido, persistencia sqlite. Ctrl+C.
```

## Paso 2 — uvicorn como SERVICIO (revive solo) con NSSM
NSSM = Non-Sucking Service Manager (si la Tiny es Linux, usa systemd — ver abajo).
```powershell
# instala nssm (scoop install nssm) y luego:
nssm install LaBocina "C:\ruta\la-bocina\server\.venv\Scripts\python.exe" ^
  "-m uvicorn main:app --host 127.0.0.1 --port 8000"
nssm set LaBocina AppDirectory "C:\ruta\la-bocina\server"
nssm set LaBocina Start SERVICE_AUTO_START
nssm start LaBocina
# logs: nssm set LaBocina AppStdout C:\ruta\logs\bocina.out.log  (y AppStderr)
```
> Sin `--reload` (es producción). Un solo worker: el SSE guarda las conexiones en memoria
> del proceso; SQLite es el estado compartido durable.

**(Alterna Linux/systemd)** `/etc/systemd/system/labocina.service` con
`ExecStart=.../.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000`,
`Restart=always`, luego `systemctl enable --now labocina`.

## Paso 3 — Tailscale Funnel (URL pública estable)
Funnel expone 443 público -> tu localhost:8000. La URL es el nombre ts.net de la Tiny (no cambia).
```powershell
# requiere HTTPS/MagicDNS activo en el tailnet (ya lo tienes) y Funnel permitido en el ACL.
tailscale funnel --bg 8000
tailscale funnel status      # te muestra la URL publica https://<tiny>.<tailnet>.ts.net
```
- Si el ACL bloquea Funnel, habilita `nodeAttrs` con `funnel` para la Tiny en la consola de Tailscale.
- **Bonus de seguridad (cierra la nota N4 de Égida):** con Funnel, el origen (8000) queda en
  `127.0.0.1`, alcanzable SOLO por Funnel. Nadie llega directo a la PC -> el rate-limit por
  IP es sólido y no se puede falsear el header.

## Paso 4 — Reapuntar el webhook de pey
En el portal de pey, cambia la URL del webhook a:
`https://<tiny>.<tailnet>.ts.net/webhooks/pey`
(El secreto del webhook NO cambia; sigue el mismo `whsec_` del `.env`.)

## Paso 5 — Frontend (pantalla de Oscar) en Vercel / Cloudflare Pages
- Es estático (HTML/JS) -> deploy directo. En su config, `BASE = https://<tiny>.<tailnet>.ts.net`.
- CORS ya está abierto (`allow_origins=["*"]`). Para producción, puedes cerrarlo al origen del frontend.
- Oscar manda `Authorization: Bearer <LA_BOCINA_API_TOKEN>` en los POST (ya está activo).

## Paso 6 — Verificar vivo
1. `https://<tiny>.<tailnet>.ts.net/salud` -> JSON v0.3.
2. Crear + pagar un QR de $0.01 -> ver `POST /webhooks/pey 200` en los logs del servicio -> `pagado`.
3. Reiniciar la Tiny -> el servicio y Funnel vuelven solos -> `/salud` responde sin tocar nada.

## Seguridad del deploy permanente (dinero real 24/7)
- [x] Tokens ON (`LA_BOCINA_API_TOKEN`, `MCP_TOKEN`) — ya configurados.
- [x] Rate-limit + ledger SQLite de auditoría.
- [ ] **Rotar la pey key** si el repo o el túnel efímero estuvieron expuestos durante el hackathon.
- [ ] Respaldo periódico de `la_bocina.db` (es tu ledger de pagos).
- [ ] Origen solo por Funnel (Paso 3). No abras el 8000 al LAN ni al internet directo.
- [ ] Vigilar los logs del servicio los primeros días.

## Resumen de durabilidad
NSSM revive uvicorn (reinicio/crash) · Tailscale corre como servicio (sobrevive reinicio) ·
`tailscale funnel --bg` persiste la config · SQLite persiste el estado. Resultado: sobrevive
cortes y reinicios, con URL estable y $0 de costo.
