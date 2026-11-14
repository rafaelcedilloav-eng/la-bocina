# Contrato interno — para que los tres construyan contra la misma interfaz

Base pey: `https://api.pey.mx` · Auth: `Authorization: Bearer <PEY_API_KEY>` ·
**No hay ambiente de pruebas: todo es produccion.**

## Nuestras rutas (diseno propio)

| Ruta | Para que |
|---|---|
| `GET /` | Pantalla del cajero |
| `POST /api/cobros` | Crea un cobro: `{ monto, concepto, canal: "qr"\|"push", telefono? }` |
| `GET /api/cobros/:id` | Estado de un cobro |
| `GET /api/eventos` | Canal de eventos (SSE) hacia la pantalla |
| `POST /webhooks/pey` | Recibe y **verifica** los webhooks de pey |
| `/mcp` | Herramienta `cobrar(monto, concepto)` para agentes (bonus) |
| `GET /salud` | Modo de comercio y estado de la cuenta, **sin secretos** |

Estados de un cobro: `creado -> pendiente -> pagado` · o `expirado` (360 s) · o
`error` (pey 4xx/5xx).

## pey — crear QR: `POST /codi/qr`

```json
{ "amount": 35, "concept": "Venta mostrador", "expiration": 360,
  "numRef": "1234567", "generateImage": true,
  "bankAccountId": "<id cuenta ACTIVE>", "metadata": { "cobroId": "c_0001" } }
```
- `amount` >= 0 (0 = el pagador escribe el monto; **nosotros SIEMPRE monto fijo**).
- `expiration`: 0 = sin vencimiento; si se usa, minimo 360 s.
- `numRef`: 1 a 7 digitos. `metadata`: hasta 50 pares, regresan como texto.
- `201` -> `id`, `qrString`, `qrImage` (base64, pintamos con esa imagen, sin libreria QR).

## pey — cobro al celular: `POST /codi/pn`

```json
{ "phoneNumber": "5512345678", "amount": 35, "concept": "Venta mostrador",
  "expiration": 360, "bankAccountId": "<id cuenta ACTIVE>",
  "metadata": { "cobroId": "c_0002" } }
```
- `phoneNumber`: exactamente 10 digitos. `amount`: >0 y <= 1,000,000. `expiration` >= 360.
- `200` -> `transactionId`, `codiId`. Requiere el cel ligado al banco (DiMo): puede fallar.

## pey — cuentas: `POST /bank-account` y `GET /bank-account/{id}`

- Alta: `alias`, `name`, `clabe`, `entity` (`PERSON`|`BUSINESS`) -> `id`, `codiStatus`.
- Estados: `PENDING` -> `PROCESSING` -> `ACTIVE` -> `ERROR`. Una cuenta nueva puede
  tardar hasta 5 dias habiles. (La CLABE de prueba, segun tutorial, activa de inmediato.)

## Webhook de pago: `codi.qr.payment_received`

Campos: `type`, `amount`, `apiKeyId`, `bankAccountId` (si se mando al crear),
`codiQrId`, `concept`, `datePaid`, `numRef`, `transactionId`, `metadata`.
Dentro de `metadata`: `trackingKey` (clave de rastreo de Banxico), `clabe`/`bankCode`
del pagador, `accountType`, `description`, `externalMetadata` (lo que mandamos).

- **Firma:** Standard Webhooks. Se verifica con el **CUERPO CRUDO**, antes de parsear a JSON.
- **Idempotencia:** header `webhook-id` + guardar `transactionId` (cantar una sola vez).
- **Liga con el cobro:** `codiQrId` == el `id` que devolvio `POST /codi/qr`.
- Solo **un webhook por API key**. Historial en *Webhook Logs* del portal.

## Respaldo (polling mientras haya cobros pendientes)

- `GET /transaction/codi/qr/{id}` (20/pag) · `GET /transaction/api-key` (80/pag).
- Confirmar nombres exactos de campos en `docs.pey.mx/openapi.json` al empezar.

## Lo que el API NO tiene

Devoluciones · division de un pago entre cuentas · sandbox · servidor MCP propio.

## Los tres candados (resumen; detalle en README y SPRINT.md)

1. Ningun cobro sin `bankAccountId` (o credencial de un solo comercio). Prefiere fallar.
2. `payment-link` **nunca** en el codigo de ventas (va a la cuenta de la API key).
3. Un comercio por credencial hasta tener autorizacion escrita de Koshi.
   Extra: webhook con `bankAccountId` inesperado -> se ignora y se registra.
