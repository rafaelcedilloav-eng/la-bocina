# La Bocina · división de tareas · sábado 14-nov

**Camino crítico: un PAGO REAL confirmado por webhook antes que cualquier interfaz.**
Track: #5 «Cobro al entregar». Rúbrica: una pantalla, un cobro, una acción verificable, confirmada desde el servidor, que no se ejecuta dos veces.

> **Avisos de quien armó esto (10:55):**
> - `D:\Dev\proyectos\la-bocina` (CONTRATO.md, README, .env.example) **no existe en esta máquina**; no pude leerlo. Los nombres de campos y variables de aquí salen del SPRINT y de mi criterio. Si el CONTRATO.md dice otra cosa, **manda el CONTRATO** y se corrige aquí en dos minutos.
> - Lo marcado **[track #5]** es lo único que agrego al SPRINT: el paso «Entregado» y el estado de pago tardío. Es lo que la rúbrica llama acción verificable.
> - Son casi las 11:00. Las puertas de abajo son las del SPRINT §9; si el arranque no está hecho, todo se recorre 30 min y **lo paga el mini-MCP**, no el ensayo.

---

## 1) RAFAEL · el cómo (servidor)

**Stack:** Python + FastAPI, un proceso, una réplica, estado en memoria. `.env` fuera del repo desde el commit 1.

**Orden de construcción:** `/salud` → `POST /webhooks/pey` → `POST /api/cobros` → pago real → respaldo → `GET /api/cobros/:id` → `/api/eventos` → entregar → `/mcp`.

### Endpoints

**`POST /api/cobros`** · crea un cobro
- Entra: `monto` (pesos, hasta 2 decimales, > 0), `concepto` (texto, por defecto «Venta»), `canal` (`"qr"` | `"push"`), `telefono` (10 dígitos, solo si `push`).
- Hace: valida el candado 1 → llama a pey `POST /codi/qr` con `amount` = el monto recibido (**fijo, nunca 0**), `concept`, `expiration: 360`, `numRef` (1 a 7 dígitos), `generateImage: true`, `bankAccountId` (en modo `cuenta_registrada`), `metadata.cobroId`.
- Sale `201`: `id`, `estado: "pendiente"`, `monto`, `canal`, `qrImage` (base64 tal cual lo da pey), `expiraEn`.
- Errores: `400` monto o teléfono inválido · `503` cuenta no activa (candado 1) · `502` pey respondió 4xx/5xx (el cobro queda en `error` con el mensaje).
- Guarda el `id` de pey (`codiQrId`) junto al cobro: es la liga con el webhook.

**`GET /api/cobros/:id`** · estado de un cobro
- Sale: `id`, `estado`, `monto`, `concepto`, `canal`, `creadoEn`, `expiraEn`, y si aplica `montoPagado`, `pagadoEn`, `rastreoTerminacion` (últimos 4 de `trackingKey`), `transactionId`, `entregadoEn`, `mensajeError`.
- `404` si no existe.

**`GET /api/eventos`** · SSE hacia la pantalla
- Eventos: `creado` (trae lo mismo que el 201; sirve para cobros que crea el MCP), `pagado`, `expirado`, `tardio`, `error`, `entregado`.
- `pagado` trae: `id`, `monto` (**el del webhook**), `hora`, `rastreoTerminacion`, `transactionId`.
- Latido cada 15 s para que la conexión no se caiga.

**`POST /webhooks/pey`** · el único lugar donde nace un PAGADO
1. Leer el **cuerpo crudo** (bytes). No convertir a JSON todavía.
2. Verificar la firma Standard Webhooks con el secreto y los encabezados `webhook-id`, `webhook-timestamp`, `webhook-signature`. Firma inválida → `401`, cero cambios, se registra.
3. `webhook-id` ya visto → `200` y nada más.
4. Ya con JSON: solo se atiende `codi.qr.payment_received` (y `codi.pn.payment_received` si hay push).
5. Buscar el cobro por `codiQrId`. Si no existe → `200` y registro.
6. **Candado extra:** si trae `bankAccountId` y no es el esperado → se ignora y se registra.
7. `transactionId` ya visto → `200` y nada más.
8. Comparar `amount` con el monto del cobro. Distinto → estado `error` («monto no coincide»), no se libera.
9. Cobro `pendiente` → `pagado`; emite `pagado`. Cobro `expirado` o ya `pagado` con otro `transactionId` → `tardio`; emite `tardio` **[track #5]**.
10. Responder `200` rápido siempre que la firma sea válida.

**`POST /api/cobros/:id/entregar`** **[track #5]** · la acción verificable
- Solo desde `pagado`. Pasa a `entregado`, guarda `entregadoEn`, emite `entregado`.
- Segunda llamada → devuelve el mismo resultado sin repetir nada. Desde otro estado → `409`.

**`GET /salud`**
- Sale: `modo` (`cuenta_registrada` | `credencial_propia`), `cuentaEstado`, `cobrosPendientes`, `ultimoWebhook` (hora), `version`. **Sin secretos.**

**`/mcp`** (bonus, tope 60 min)
- Una herramienta: `cobrar(monto, concepto)`. Llama **la misma función interna** que `POST /api/cobros`. Protegida con token propio. Devuelve `id`, liga a la pantalla y, si espera, el estado final con `rastreoTerminacion`.

### Estados

`creado → pendiente → pagado → entregado` · `expirado` (360 s) · `error` · `tardio`

### Respaldo del webhook
Mientras haya cobros `pendiente`: consultar `GET /transaction/codi/qr/{id}` cada 5 s. Si aparece un pago, entra por **la misma función** que el webhook (mismos pasos 7 a 9). Abrir `docs.pey.mx/openapi.json` para los nombres exactos de los campos.

### Candados (desde el commit 1)
1. **Ningún cobro sin cuenta destino.** Modo declarado en configuración. En `cuenta_registrada`: al arrancar se consulta `GET /bank-account/{id}`; si no está `ACTIVE`, no se crean cobros y `/salud` lo dice. En `credencial_propia`: no se manda `bankAccountId` y se rechaza cobrar para otra cuenta.
2. **`/payment-link/create` no existe en el código de ventas.** Una línea en el README lo dice.
3. **Un comercio por credencial** hasta tener permiso escrito de Koshi/pey.
4. **Extra:** webhook con `bankAccountId` ajeno se ignora.

**Invariantes de la rúbrica:** firma verificada en servidor · idempotencia (`webhook-id` + `transactionId` + entrega única) · monto dictado = monto cobrado = monto cantado.

### Despliegue
URL HTTPS fija + túnel desde la laptop como respaldo. Sin despliegues después del congelamiento.

### Variables (ajustar a `.env.example`)
`PEY_API_KEY`, `PEY_WEBHOOK_SECRET`, `PEY_BANK_ACCOUNT_ID`, `MODO_COMERCIO`, `MCP_TOKEN`, `BASE_URL`.

### Necesitas de otros
- De **Gabriel**: API key, secreto del webhook, `bankAccountId` y su estado. **Por canal privado, nunca en el chat del equipo ni en el repo.**
- Le das a Gabriel: la URL pública de `/webhooks/pey` en cuanto exista.
- Le das a Oscar: aviso en cuanto `POST /api/cobros` y `/api/eventos` respondan de verdad.

---

## 2) OSCAR · el qué (pantalla, voz, Bocina)

**Una sola pantalla** (`GET /`), pensada para Android con Chrome, letra enorme.

**Orden de construcción:** pantalla con datos falsos → teclado → QR → estados → Bocina → conexión real → micrófono y parser.

### Qué construyes
- **Teclado numérico siempre visible.** Es el camino que nunca falla.
- **Monto gigante** antes y durante el QR.
- **QR:** se pinta directo con `qrImage` (base64) que devuelve el servidor. Sin librería de QR.
- **Dos oídos para el mismo aviso:** escucha `GET /api/eventos` y, mientras haya cobro pendiente, pregunta `GET /api/cobros/:id` cada 2 s. Lo que llegue primero gana.
- **Pantalla verde PAGADO** con monto, hora y terminación de la clave de rastreo.
- **Botón «Entregado» [track #5]:** aparece solo en PAGADO; llama `POST /api/cobros/:id/entregar`; se desactiva al primer toque; la pantalla queda en ENTREGADO con la hora.
- **Bocina (voz de salida):** síntesis del navegador, voz es-MX.
  - Se desbloquea con el toque del micrófono (ese toque dice «Listo» bajito).
  - Frase: «Treinta y cinco pesos recibidos. Clave de rastreo, terminación cuatro, dos. Entrega el pedido.» Texto configurable.
  - Canta **el monto que trae el evento**, no el que se dictó.
  - **Una sola vez por `transactionId`:** lleva la lista de los ya cantados, porque el aviso llega por dos caminos.
  - Sin voz en español → tono + pantalla verde.
- **Pantalla siempre encendida** mientras hay cobro pendiente.
- **Cobros que no creaste tú:** si llega un evento `creado` (lo manda el MCP), la pantalla muestra ese QR sola.

### Voz de entrada
Reconocimiento del navegador en `es-MX` (pide HTTPS y permiso de micrófono). **Parser fijo, sin IA:**

| Frase | Resultado |
|---|---|
| «cóbrale 35 pesos» · «cobra 35» · «35 pesos» | QR por $35.00 |
| «cóbrale 35 con 50» · «35.50» | QR por $35.50 |
| «cóbrale un peso» | QR por $1.00 |
| «cóbrale un centavo» | QR por $0.01 |
| «cóbrale 35 pesos al 55 1234 5678» | Push por $35.00 (solo si el push se construye) |
| Cualquier otra cosa | «No entendí el monto»; el teclado queda listo |

### Estados que la pantalla debe saber mostrar
| Estado | Qué ve el repartidor |
|---|---|
| `pendiente` | Monto gigante + QR + cuenta regresiva de 360 s |
| `pagado` | Verde, canta, botón «Entregado» |
| `entregado` | Verde fijo con hora; listo para el siguiente |
| `expirado` | «Se venció. No entregues. Dicta de nuevo.» |
| `tardio` | Ámbar: «Pago recibido tarde: no entregar sin revisar.» **No canta «entrega».** |
| `error` | Rojo con el mensaje del servidor en una línea legible |
| Sin conexión | «Sin conexión con el servidor»; nunca se pinta verde por cuenta propia |

### Regla de oro
La pantalla **nunca** se pone verde por un clic, un temporizador o lo dictado. Solo por lo que diga el servidor.

### Mientras Rafael no tiene pago real
Trabajas con **datos falsos dentro del front** (un archivo de ejemplo con las mismas formas de la sección 4). No se agrega ninguna ruta de «simular pago» al servidor: se quita el modo falso antes de desplegar.

### Necesitas de otros
- De **Rafael**: las formas exactas de la sección 4 (ya están) y el aviso de «ya responde de verdad».
- De **Gabriel**: prueba de voz con el ruido real de la sala.

---

## 3) GABRIEL · para quién y por qué (pey, README, formulario, pitch)

### Ya, antes que nada
1. **Portal de pey** (`portal.pey.mx` o `portal.mipey.mx`: el que cargue): perfil → *Finanzas*: cuenta tipo `codi` con la CLABE de prueba `012180015826225713` (Ramón Orraca Lascurain) → *Desarrollador*: crear API key → engrane de la key: crear webhook con la URL que te dé Rafael. **El secreto se muestra una sola vez: guárdalo.**
2. **Entrega a Rafael por canal privado:** API key, secreto del webhook, `bankAccountId` y su estado.
3. **Tres preguntas a pey, en persona:**
   - Varios comercios con una sola API key: ¿cómo se pide la autorización de la cláusula 5.4? Que lo confirmen a `legal@pey.mx`.
   - ¿La CLABE de prueba vale para la demo? ¿Con `POST /bank-account` queda activa de inmediato?
   - ¿Podemos decir «clave de rastreo de Banxico» en la confirmación por voz?
   - Anota cada respuesta con la hora: va al README.
4. **Formulario** (forms.gle): copia todos los campos. Sabemos que pide nombre, descripción, repo público (obligatorio), liga a la app en vivo, video (opcional) y correos.

### Pagos de prueba (dos teléfonos, bancos distintos si se puede)
Cada pago es de $0.01 y **no regresa**. Anota en una tabla:
- Segundos entre «autorizar» y que llegue el webhook (*Webhook Logs* del portal).
- ¿La app del banco deja editar el monto?
- ¿El mismo QR acepta un segundo pago?
- ¿Un QR vencido todavía se puede pagar?
- Banco y teléfono de cada prueba.

Estos cuatro datos deciden qué se promete en el pitch. La rúbrica lo pide literal: «prueba las notificaciones».

### Entregables tuyos
- **README final:** qué es · cómo usa el API de pey · los candados · cómo cumplimos la rúbrica (confirmación en servidor, no ejecutar dos veces, qué pasa con pagos tardíos, fallas y devoluciones) · **qué es simulado** (el paquete y el repartidor; el pago es real) · cómo probarlo · qué no se construyó hoy · respuestas de pey con hora · librerías de terceros.
- **Devoluciones, dicho tal cual:** pey no las tiene; el comercio transfiere de vuelta a la CLABE del pagador que trae el webhook.
- **Pantallazo falso:** «transferencia exitosa» genérica, hecha por nosotros, **sin logotipo ni nombre de ningún banco real**.
- **Pitch de 30 s** con cronómetro; una persona habla, otra opera.
- **Video de respaldo** de un cobro real completo (se graba en el ensayo).
- **Revisión del repo:** ventana de incógnito y búsqueda de llaves en **todo el historial**.
- **Formulario enviado el domingo a las 11:00**, con captura del acuse.

### Necesitas de otros
- De **Rafael**: URL del webhook; aviso de cada cobro de prueba para pagarlo.
- De **Oscar**: la pantalla en un teléfono real para el ensayo y el video.

---

## 4) INTERACCIONES · el contrato entre los tres

### Pantalla → Servidor
| Llamada | Entra | Sale |
|---|---|---|
| `POST /api/cobros` | `monto`, `concepto`, `canal`, `telefono?` | `201`: `id`, `estado`, `monto`, `canal`, `qrImage`, `expiraEn` |
| `GET /api/cobros/:id` | — | estado completo (respaldo cada 2 s) |
| `POST /api/cobros/:id/entregar` | — | `estado: "entregado"`, `entregadoEn` |

### Servidor → Pantalla (`GET /api/eventos`)
| Evento | Trae | La pantalla |
|---|---|---|
| `creado` | lo mismo que el `201` | muestra el QR (cobros del MCP) |
| `pagado` | `id`, `monto`, `hora`, `rastreoTerminacion`, `transactionId` | verde + canta una vez |
| `entregado` | `id`, `entregadoEn` | cierra el pedido |
| `expirado` | `id` | «Se venció» |
| `tardio` | `id`, `monto`, `rastreoTerminacion` | ámbar, no canta «entrega» |
| `error` | `id`, `mensaje` | rojo |

### Servidor ↔ pey
| Dirección | Qué | Dato clave |
|---|---|---|
| → pey | `POST /codi/qr` | monto fijo, `expiration: 360`, `generateImage: true`, `bankAccountId` |
| ← pey | webhook `codi.qr.payment_received` | firma con cuerpo crudo; `codiQrId` liga con el cobro; `transactionId` y `webhook-id` para no repetir |
| → pey | `GET /transaction/codi/qr/{id}` | respaldo cada 5 s |
| → pey | `GET /bank-account/{id}` | candado 1, al arrancar |

### Acuerdos de forma (para no discutirlos después)
- Montos en **pesos con decimales** en todo el sistema, igual que pey (`35`, `35.5`, `0.01`).
- Horas en ISO con zona horaria.
- `rastreoTerminacion` = últimos 4 caracteres de `trackingKey`.
- La pantalla solo conoce el `id` nuestro; nunca ve llaves, secretos ni la CLABE del pagador.

### Quién depende de quién
```
Gabriel ── API key + secreto + bankAccountId ──► Rafael
Rafael  ── URL pública del webhook ────────────► Gabriel (la registra en el portal)
Rafael  ── cobro de prueba creado ─────────────► Gabriel (lo paga y mide)
Rafael  ── endpoints reales ───────────────────► Oscar (deja los datos falsos)
Oscar   ── pantalla en teléfono real ──────────► Gabriel (ensayo, video, pitch)
```
**Cuello de botella #1:** las credenciales de pey. Sin ellas Rafael solo puede armar la verificación de firma y la estructura.
**Cuello de botella #2:** la URL pública. Sin ella no hay webhook.

---

## 5) ORDEN Y PUERTAS (SPRINT §9)

| Hora | Rafael | Oscar | Gabriel | Puerta de salida |
|---|---|---|---|---|
| **10:00–10:30** | Repo público, despliegue «hola», URL fija, `.env` fuera | Esqueleto: monto, QR, estado | Portal, preguntas a pey, campos del formulario | URL responde; sabemos qué pide el formulario |
| **10:30–11:30** | Candado 1, `POST /codi/qr`, webhook con firma, respaldo | Pantalla con datos falsos; verde, ámbar y rojo | Pagar pruebas con dos teléfonos; medir | **Un pago real confirmado por webhook, en el log** |
| **11:30–12:30** | SSE, idempotencia, vencimiento, `entregar` | QR real, verde, Bocina, teclado, botón «Entregado» | Borrador del README, pantallazo falso | **Héroe por teclado en un teléfono real** |
| **12:30–13:15** | Errores de pey; casos feos (webhook repetido, tardío, doble toque) | Micrófono y parser | Probar la voz con el ruido de la sala | **Héroe por voz, tres veces seguidas** |
| **13:15–13:45** | Etiquetar la versión que funciona | Comer | Comer | Nadie toca la ruta del héroe sin volver a probarla |
| **13:45–14:45** | `/mcp` con token | El cobro del agente aparece solo | Pitch con cronómetro | El agente cobra y canta, **o se corta a las 14:45** |
| **14:45–15:30** | Endurecer el héroe (push solo si sobra) | Letra enorme, errores legibles | README final | **15:30: se congela el código** |
| **15:30–16:15** | Vigilar servidor, túnel abierto | Demo cinco veces, wifi y datos; grabar video | Incógnito; llaves en el historial | Demo estable, video guardado, repo limpio |
| **16:15–17:00** | Cero código | Pitch con Gabriel | Pitch; borrador del formulario | Todo listo para enviar |
| **Dom 9:00–11:00** | Revisar que la app siga viva | Video final | **Enviar formulario a las 11:00** | Acuse capturado |

### Reglas de decisión
- **11:30 sin pago real confirmado:** los tres al cobro. Nada de interfaz hasta que salga.
- **12:30 sin héroe por teclado:** se cancela el mini-MCP; esa hora es del héroe.
- **13:15 sin voz confiable:** la demo va con teclado. La Bocina sigue siendo el momento.
- **14:45 sin MCP:** se corta. No se le roba tiempo al ensayo.
- **15:30:** nadie escribe una función más. Solo textos y arreglos de una línea, probados.

### Recorte, de arriba hacia abajo
1. Push al celular · 2. Mini-MCP · 3. Montos con palabras raras · 4. Voz de entrada (queda teclado)

**Nunca se corta:** pago real, firma verificada, idempotencia, monto igual, PAGADO → «Entregado» una sola vez, estado de pago tardío, repo público, app en vivo.
