# mini-MCP: `cobrar()` para agentes

Hoy cobra el cajero. Mañana, cualquier agente. Esta es la prueba: una sola herramienta
que llama a **la misma función interna** que la pantalla del cajero. Mismo candado,
mismo webhook firmado, misma Bocina. No hay un segundo camino de cobro.

El servidor vive dentro de `server/main.py`, en `POST /mcp`. Habla JSON-RPC sobre
HTTP (transporte *Streamable HTTP* de MCP, con respuestas JSON). Soporta `initialize`,
`ping`, `tools/list` y `tools/call`.

## La herramienta

| | |
|---|---|
| Nombre | `cobrar` |
| Argumentos | `monto` (número, MXN, mayor a 0) · `concepto` (texto, opcional) |
| Devuelve | El identificador del cobro, su estado y el QR en base64 |

El agente **crea** el cobro; no puede marcarlo pagado. Eso solo lo hace el webhook
firmado de pey. El estado se consulta en `GET /api/cobros/{id}`.

## Conectar un cliente

En Cursor, `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "la-bocina": {
      "url": "https://TU-SERVIDOR/mcp",
      "headers": { "Authorization": "Bearer TU_MCP_TOKEN" }
    }
  }
}
```

Después, en el chat: *"cóbrale un peso por un café"*. El QR aparece solo en el
teléfono del cajero.

## Probar con curl

```bash
curl -X POST https://TU-SERVIDOR/mcp \
  -H "Authorization: Bearer TU_MCP_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"cobrar","arguments":{"monto":1,"concepto":"café"}}}'
```

## Protección

- Token propio (`MCP_TOKEN`), distinto del de la pantalla. Sin él, nadie en internet
  puede generar cobros en la pantalla del cajero.
- El mismo límite de peticiones que `/api/cobros`.
- Los mismos tres candados: si la cuenta del comercio no está lista, `cobrar()`
  responde con error en lugar de cobrar.
