# Pruebas de punta a punta, sin gastar un peso

Tres archivos para ensayar el recorrido completo en tu máquina, sin tocar al pey real:

| Archivo | Qué hace |
|---|---|
| `pey_falso.py` | Un pey **simulado**: responde `POST /codi/qr` con un QR de mentira. No mueve dinero. |
| `prueba_humo.py` | Recorre el contrato del API: token, cobro, eventos, webhook firmado y forjado, replay, entregar, mini-MCP y voz. |
| `pantalla_e2e.mjs` | Maneja la **pantalla real** del cajero en un navegador sin ventana: teclea, cobra, paga, entrega, y comprueba que un cobro hecho por un agente aparece solo. |

Los valores de abajo (`lbk_prueba_local`, el secreto) son de prueba y solo sirven en
tu máquina. No uses aquí las llaves reales.

## 1. Compila la pantalla con el token de prueba

```bash
cd web
npm install
VITE_API_TOKEN=lbk_prueba_local VITE_API_BASE= npm run build
```

En PowerShell: `$env:VITE_API_TOKEN='lbk_prueba_local'; $env:VITE_API_BASE=''; npm run build`

## 2. Levanta el pey simulado y el servidor

Desde `server/`, con el entorno virtual activo, en dos terminales:

```bash
# terminal 1
uvicorn pey_falso:app --app-dir pruebas --port 9999

# terminal 2
export PEY_API_KEY=llave_falsa
export PEY_API_BASE=http://127.0.0.1:9999
export PEY_WEBHOOK_SECRET=whsec_c2VjcmV0by1kZS1wcnVlYmEtbG9jYWwtMDEyMzQ1Njc4OQ==
export COMMERCE_MODE=credencial_propia
export LA_BOCINA_API_TOKEN=lbk_prueba_local
export MCP_TOKEN=mcp_prueba_local
export TTS_BACKEND=edge
uvicorn main:app --port 8000
```

Hazlo en una copia limpia o sin `server/.env`: si existe, sus valores no pisan a los
`export`, pero conviene no mezclar. La prueba crea `server/la_bocina.db`; bórrala al
terminar.

## 3. Corre las pruebas

```bash
python pruebas/prueba_humo.py --token lbk_prueba_local --mcp-token mcp_prueba_local \
    --secreto c2VjcmV0by1kZS1wcnVlYmEtbG9jYWwtMDEyMzQ1Njc4OQ==

node pruebas/pantalla_e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
    c2VjcmV0by1kZS1wcnVlYmEtbG9jYWwtMDEyMzQ1Njc4OQ== mcp_prueba_local
```

`pantalla_e2e.mjs` necesita Node 22 o más y la ruta de Edge o Chrome. Con un cuarto
argumento (una carpeta) guarda capturas de cada paso. Las dos deben terminar en
`TODO VERDE`.

## Qué no cubren

No prueban al pey real ni la calidad de la voz, y no usan el micrófono. Para eso está
el ensayo con un cobro de un peso.
