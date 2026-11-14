# Sprint del sábado 14-nov: el cobro por voz que canta

**Cursor Hackatón México · CDMX · 10:00 a 17:00 · se construye y se entrega el mismo día**

> A las 17:00 existen cuatro cosas: **repo público, app en vivo, formulario enviado y pitch de 30 segundos ensayado.**
> Todo lo demás es negociable. Esas cuatro no.

Documento de ejecución. Sale del blueprint maestro del 13-nov y usa solo los hechos que quedaron verificados en fuente primaria (Banxico, DOF, docs.pey.mx, términos de pey). Lo que no está verificado aparece marcado como **[por probar]** con el momento exacto en que se prueba.

---

## 1. La idea, en una respiración

El cajero dice **"cóbrale 35 pesos"**. Aparece un QR de CoDi con ese monto fijo. El cliente lo paga desde la app de su banco. El teléfono del cajero se pone verde y **dice en voz alta que el dinero llegó**. El dinero va directo de un banco a otro, a la cuenta del comercio. Nosotros nunca lo tocamos.

No es una terminal. Es un **primitivo**: una intención dicha en voz alta que se convierte en un cobro verificado.

- **Hoy:** el cajero que ya no depende de un pantallazo.
- **Mañana:** la misma función, llamada por una máquina expendedora, un estacionamiento o un agente de IA que atiende la tienda.

**Por qué importa ahora.** El 14 de diciembre vence el plazo que Banxico dio a los bancos (Circulares 9 y 10/2026) para que todas las apps tengan el botón "Transferencias" con lectura de QR al frente. El lado de quien paga queda resuelto por regulación. El lado de quien cobra en el mostrador no lo resuelve nadie: ese es el hueco.

**Por qué duele.** Al cajero le enseñan una captura de pantalla de una transferencia. No tiene la app del banco del dueño para comprobarla. Si la captura es falsa, la mercancía ya se fue. *(Que se lo descuenten de su sueldo es el gancho del pitch; no tenemos una cifra que lo mida. Se cuenta como historia, no como estadística.)*

---

## 2. El héroe: qué tiene que pasar a las 17:00, paso por paso

| # | Qué ve o hace la persona | Qué pasa por dentro |
|---|---|---|
| 1 | El cajero toca el micrófono y dice "cóbrale 35 pesos" | El navegador reconoce la voz (es-MX). Un parser fijo saca el monto. Sin modelo de lenguaje en esta ruta. |
| 2 | La pantalla muestra **$35.00** en grande y un QR | El servidor valida el candado de cuenta y llama `POST /codi/qr` con el monto fijo. |
| 3 | El cliente abre la app de su banco, escanea y autoriza | El pago viaja por CoDi de su banco a la CLABE del comercio. |
| 4 | El teléfono del cajero se pone verde y **habla** | pey manda el webhook `codi.qr.payment_received` firmado. El servidor verifica la firma y avisa a la pantalla del cajero. |
| 5 | La pantalla queda con monto, hora y terminación de la clave de rastreo | El servidor guarda el `transactionId` para no cantar dos veces el mismo pago. |

**Regla de oro del héroe:** la Bocina solo canta lo que llegó en un webhook con firma válida. Nunca canta por un clic, por un temporizador ni por lo que el cajero dictó.

**Variante por celular (opcional, primer recorte fino):** "cóbrale 35 pesos al 55 1234 5678" manda el cobro a la app bancaria del cliente con `POST /codi/pn`. El final es el mismo: webhook `codi.pn.payment_received`, pantalla verde, Bocina.

---

## 3. Esta noche (viernes 13): quitarle al sábado lo que puede matarlo

Nada de esto es código del proyecto. Es dejar cuentas y teléfonos listos, y contestar las preguntas que todavía no tienen respuesta.

### Preparación

1. **Portal de pey** (`portal.mipey.mx`): crear perfil → en *Finanzas* agregar cuenta de pago tipo `codi` con la CLABE de prueba → en *Desarrollador* crear la API key → en el engrane de la key, crear el webhook (el secreto se muestra una sola vez: guardarlo).
   - CLABE de prueba documentada: `012180015826225713`, titular **Ramón Orraca Lascurain**. Según el tutorial se activa de inmediato y **los pagos que recibe no se devuelven**.
2. **Dos teléfonos pagadores** con CoDi activo en la app del banco. De bancos distintos si se puede.
3. **Cuenta de despliegue** lista: un solo proceso con URL HTTPS fija. Un túnel desde la laptop como respaldo.
4. **Teléfono del cajero:** Android con Chrome, volumen al máximo, fuera de modo silencio, cargador a la mano.

### Cuatro pruebas que valen oro

| Prueba | Cómo | Si sale mal |
|---|---|---|
| **[por probar]** ¿La API key con CLABE de prueba cobra sin validación adicional? | Con curl: `POST /codi/qr` por 0.01 y pagarlo desde tu banco | Mañana a las 10:00, lo primero es buscar a pey en la sala |
| **[por probar]** ¿La app del banco muestra el monto fijo y no deja cambiarlo? | Mirar la pantalla del pagador en esa misma prueba | Si deja editar, el pitch no dice "monto clavado" |
| **[por probar]** ¿Un mismo QR acepta varios pagos? | Pagarlo dos veces, desde dos teléfonos | Si no, en la demo se genera un QR por juez; por voz toma dos segundos |
| **[por probar]** ¿Llega el webhook y en cuánto? | Ver *Webhook Logs* en el portal | Si tarda, la consulta de respaldo pasa a ser el camino principal |

---

## 4. Arquitectura mínima (un proceso, cero custodia)

```
 Teléfono del cajero                 Nuestro servidor                    pey / Banxico
 ┌──────────────────┐   crear cobro   ┌──────────────────┐  POST /codi/qr  ┌───────────┐
 │ micrófono        │ ──────────────► │ candado de cuenta│ ──────────────► │ api.pey.mx│
 │ QR en pantalla   │ ◄── QR ──────── │ cobros en memoria│ ◄─ id + QR ──── │           │
 │                  │                 │                  │                 │           │
 │ pantalla verde   │ ◄── evento ──── │ verifica firma   │ ◄── webhook ─── │  (firmado)│
 │ BOCINA           │                 │ canta una vez    │                 └───────────┘
 └──────────────────┘                 └──────────────────┘
                                              ▲
 Agente de IA (Cursor, Claude) ── cobrar() ───┘   misma función interna

 El dinero NO pasa por ninguna de estas cajas:
 banco del cliente ──── CoDi / SPEI ────► CLABE del comercio
```

### Decisiones de diseño

- **Un solo proceso, estado en memoria, una réplica.** Hoy no hay base de datos. Si el proceso se reinicia se pierden los cobros pendientes, y está bien.
- **Stack: el que el equipo escriba más rápido.** Referencia: los ejemplos de pey están en Python con `requests`, y la verificación de webhooks con la librería de Standard Webhooks.
- **El QR se pinta con la imagen que devuelve pey** (`generateImage: true` → `qrImage` en base64). Sin librería de QR.
- **El aviso a la pantalla va por eventos del servidor** y la página, además, pregunta el estado cada 2 segundos. Dos caminos para el mismo aviso.
- **Respaldo del webhook:** mientras haya cobros pendientes, el servidor consulta `GET /transaction/codi/qr/{id}` cada 5 segundos.

### Rutas propias (diseño nuestro)

| Ruta | Para qué |
|---|---|
| `GET /` | Pantalla del cajero |
| `POST /api/cobros` | Crea un cobro: monto, concepto, canal (`qr` o `push`), teléfono si es push |
| `GET /api/cobros/:id` | Estado de un cobro |
| `GET /api/eventos` | Canal de eventos hacia la pantalla |
| `POST /webhooks/pey` | Recibe y verifica los webhooks |
| `/mcp` | Herramienta `cobrar()` para agentes |
| `GET /salud` | Modo de comercio y estado de la cuenta, sin secretos |

### Estados de un cobro

`creado → pendiente → pagado` · o `expirado` (a los 360 s) · o `error` (pey respondió 4xx/5xx)

---

## 5. Contrato con el API de pey (solo lo verificado)

Base: `https://api.pey.mx` · Autenticación: `Authorization: Bearer <API key>` · No hay ambiente de pruebas: todo es producción.

### Crear QR: `POST /codi/qr`

```json
{
  "amount": 35,
  "concept": "Venta mostrador",
  "expiration": 360,
  "numRef": "1234567",
  "generateImage": true,
  "bankAccountId": "<id de la cuenta ACTIVE del comercio>",
  "metadata": { "cobroId": "c_0001", "caja": "1" }
}
```

- `amount`: mayor o igual a 0. Con 0 el pagador escribe el monto; **nosotros siempre mandamos monto fijo**.
- `expiration`: 0 es sin vencimiento; si se usa, mínimo 360 segundos.
- `numRef`: de 1 a 7 dígitos.
- `metadata`: hasta 50 pares; todo regresa como texto.
- Respuesta `201`: `id`, `qrString`, `qrImage`. Errores: `400`, `500`, `503`.

### Cobro al celular: `POST /codi/pn`

```json
{
  "phoneNumber": "5512345678",
  "amount": 35,
  "concept": "Venta mostrador",
  "expiration": 360,
  "bankAccountId": "<id de la cuenta ACTIVE del comercio>",
  "metadata": { "cobroId": "c_0002" }
}
```

- `phoneNumber`: exactamente 10 dígitos. `amount`: mayor que 0 y hasta 1,000,000. `expiration`: mínimo 360.
- Respuesta `200`: `transactionId`, `codiId`.

### Cuentas: `POST /bank-account` y `GET /bank-account/{id}`

- Alta: `alias`, `name`, `clabe`, `entity` (`PERSON` o `BUSINESS`). Devuelve `id` y `codiStatus`.
- Estados: `PENDING`, `PROCESSING`, `ACTIVE`, `ERROR`. Una cuenta nueva tarda hasta 5 días hábiles en activarse.

### Webhook de pago: `codi.qr.payment_received`

Campos: `type`, `amount`, `apiKeyId`, `bankAccountId` (solo si se mandó al crear), `codiQrId`, `concept`, `datePaid`, `numRef`, `transactionId`, `metadata`.

Dentro de `metadata`: `trackingKey` (clave con la que Banxico rastrea la operación), `clabe` y `bankCode` del pagador, `accountType`, `description` y `externalMetadata` (lo que nosotros mandamos).

- **Firma:** Standard Webhooks. Se verifica con el **cuerpo crudo**, antes de convertirlo a JSON.
- **Idempotencia:** el encabezado `webhook-id`. Además guardamos `transactionId`.
- **Cómo se liga con el cobro:** `codiQrId` es el `id` que devolvió `POST /codi/qr`.
- Solo hay **un webhook por API key**. El historial está en *Webhook Logs* del portal.
- **[por probar]** que el webhook de push (`codi.pn.payment_received`) traiga los mismos campos de `metadata`.

### Respaldo

- `GET /transaction/codi/qr/{id}`: pagos de un QR, 20 por página.
- `GET /transaction/api-key`: pagos de la llave, 80 por página.
- **[por probar]** los nombres exactos de los campos de cada pago: abrir `docs.pey.mx/openapi.json` al empezar.

### Lo que el API no tiene

Devoluciones, división de un pago entre dos cuentas, ambiente de pruebas y servidor MCP propio.

---

## 6. Los tres candados, en código

Son la columna legal. Van desde el primer commit, no al final.

### Candado 1: ningún cobro sin la cuenta del comercio

El servidor arranca en uno de dos modos, declarado en configuración:

| Modo | Cuándo | Qué hace el servidor |
|---|---|---|
| `cuenta_registrada` | Tenemos un `bankAccountId` en `ACTIVE` | Al arrancar consulta `GET /bank-account/{id}`. Si no está `ACTIVE`, **no crea cobros** y `/salud` lo dice. Cada llamada a pey lleva ese `bankAccountId`. No existe ruta de código que lo omita. |
| `credencial_propia` | Una API key por comercio: la cuenta ligada a la llave **es** la del comercio | No manda `bankAccountId`. Rechaza cualquier petición que intente cobrar para otra cuenta. |

Sin el `bankAccountId`, pey manda el pago a la cuenta ligada a la API key. En un producto con varios comercios, esa sería nuestra cuenta. Por eso el servidor prefiere fallar a cobrar sin destino claro.

**[por probar] sábado 10:15:** registrar la CLABE de prueba con `POST /bank-account`. Si queda `ACTIVE`, se usa `cuenta_registrada`. Si se queda en `PENDING`, se usa `credencial_propia`, que es legítimo: la llave y su cuenta son de un solo comercio.

### Candado 2: los links de pago no cobran ventas

`POST /payment-link/create` no acepta `bankAccountId`: el dinero va a la cuenta de la API key. **No aparece en el código de ventas.** Su único uso futuro es cobrar nuestra propia suscripción. En el README va una línea que lo dice.

### Candado 3: un comercio por credencial hasta tener permiso

Registrar cuentas de comercios terceros bajo una sola API key requiere **autorización previa y por escrito de Koshi** (términos de pey, cláusulas 3.3, 5.2(d), 5.4 y Anexo C.2). Hoy la demo es de un solo comercio. Se pregunta en persona el sábado y por correo a `legal@pey.mx`.

### Candado extra, gratis: el webhook también se valida

Si el webhook trae `bankAccountId` y no es el esperado, se ignora y se registra. La Bocina no canta pagos de otra cuenta.

---

## 7. La voz: entrada y salida

### Entrada (lo que dice el cajero)

- Reconocimiento del navegador en `es-MX`. Requiere HTTPS y permiso de micrófono.
- **Parser fijo**, sin IA. Frases que debe entender:

| Frase | Resultado |
|---|---|
| "cóbrale 35 pesos" · "cobra 35" · "35 pesos" | QR por $35.00 |
| "cóbrale 35 con 50" · "35.50" | QR por $35.50 |
| "cóbrale un peso" | QR por $1.00 |
| "cóbrale un centavo" | QR por $0.01 |
| "cóbrale 35 pesos al 55 1234 5678" | Push por $35.00 a ese celular |
| Cualquier otra cosa | "No entendí el monto" y el teclado queda listo |

- El **teclado numérico siempre está visible**. La voz es el camino bonito; el teclado es el que nunca falla.
- El monto reconocido se muestra enorme antes y durante el QR. El cajero lo ve, y el cliente lo vuelve a ver en su banco.

### Salida (la Bocina)

- Síntesis de voz del navegador, voz en español de México.
- **Se desbloquea con el toque del micrófono.** Los navegadores no dejan hablar a una página sin un gesto previo: ese mismo toque dice "Listo" en volumen bajo y deja el audio habilitado.
- Pantalla siempre encendida mientras hay un cobro pendiente.
- Si el teléfono no tiene voz en español, suena un tono y la pantalla verde hace el trabajo.
- **Canta una sola vez por `transactionId`.**

### Qué dice

| Opción | Frase | Nota |
|---|---|---|
| **A (recomendada)** | "Treinta y cinco pesos recibidos. Clave de rastreo de Banxico, terminación cuatro, dos." | Dice exactamente lo que tenemos: un pago confirmado y su clave de rastreo |
| B (la original) | "Treinta y cinco pesos, verificado por Banxico." | Más corta y más fuerte. Afirma que Banxico verificó; lo que verificamos es la firma de pey |

Queda como texto configurable. Recomiendo la A en la demo: si un juez de pey pregunta "¿quién verificó?", la respuesta ya está en la frase.

### El monto que se canta

**La Bocina canta el monto que trae el webhook, no el que se dictó.** Y el monto que se dicta es el que se cobra. Si el cajero dice "35 pesos" y por dentro cobramos un centavo, el cliente vería $0.01 en su banco y la demo estaría mintiendo.

- En desarrollo: "cóbrale un centavo".
- En el pitch: "cóbrale un peso". Es un peso real que no regresa; la demo completa cuesta unos cuantos pesos.

---

## 8. El bonus: mini-MCP con una sola herramienta

Va justo después del héroe porque prueba la visión en veinte segundos.

- **Herramienta:** `cobrar(monto, concepto)`.
- **Qué hace:** llama la misma función interna que usa la pantalla del cajero. Mismo candado, mismo webhook, misma Bocina. No hay un segundo camino de cobro.
- **Qué devuelve:** el identificador del cobro, la liga a la página con el QR y, si espera, el estado final con la terminación de la clave de rastreo.
- **Protección:** un token propio. Sin él, nadie en internet puede generar cobros en nuestra pantalla.
- **La demo:** en Cursor, alguien escribe "cóbrale un peso por un café". El QR aparece en el teléfono del cajero sin que nadie lo toque. Se paga. La Bocina canta. *"Hoy es el cajero. Mañana es cualquier agente."*

**Tope de tiempo: 60 minutos.** Si a las 14:45 no corre de punta a punta, se corta y queda como una frase en el pitch.

---

## 9. Hora por hora

Roles según lo acordado el 10-nov. Si alguien está remoto, toma las tareas que no necesitan teléfono físico.

- **Rafael · el cómo:** servidor, webhook, despliegue, candados, MCP.
- **Oscar · el qué:** pantalla del cajero, voz, Bocina, guion de la demo, utilería.
- **Gabriel · para quién y por qué:** preguntas a pey, README, formulario, pitch, pagos de prueba.

| Hora | Rafael | Oscar | Gabriel | Puerta de salida |
|---|---|---|---|---|
| **10:00–10:30** Arranque | Repo público. Despliegue "hola" con URL fija. Webhook apuntando a esa URL. `.env` fuera del repo desde el primer commit. | Esqueleto de la pantalla: monto, QR, estado. | Buscar al equipo de pey: las tres preguntas de la sección 13. Abrir el formulario y copiar sus campos. | La URL pública responde. Sabemos qué pide el formulario. |
| **10:30–11:30** Cobro real sin interfaz | Candado 1 y prueba de `POST /bank-account`. `POST /codi/qr` con monto fijo. Webhook con firma verificada. Consulta de respaldo. | Pantalla conectada al servidor con datos falsos. Verde y rojo listos. | Pagar los cobros de prueba con los dos teléfonos. Anotar tiempos reales de confirmación. | **Un pago real confirmado por webhook, en el log.** |
| **11:30–12:30** Cajero y Bocina | Canal de eventos hacia la pantalla. Idempotencia por `transactionId`. Vencimiento a los 360 s. | QR real en pantalla. Pantalla verde. Bocina hablando. Teclado. | Borrador del README. Imagen del pantallazo falso. | **Héroe por teclado, en un teléfono real.** |
| **12:30–13:15** Voz de entrada | Apoyo a Oscar. Manejo de errores de pey (4xx, 503). | Micrófono y parser fijo. | Probar la voz con el ruido real de la sala. | **Héroe por voz, tres veces seguidas.** |
| **13:15–13:45** Comida | Etiquetar la versión que funciona. | Comer. | Comer. | Nadie toca la ruta del héroe sin volver a probarla. |
| **13:45–14:45** Mini-MCP | Herramienta `cobrar()` con token. Conexión desde Cursor. | El cobro del agente aparece solo en la pantalla del cajero. | Primera versión del pitch, con cronómetro. | El agente cobra y la Bocina canta. **Si no, se corta a las 14:45.** |
| **14:45–15:30** Pulido | Push con `POST /codi/pn` si el MCP ya quedó. Si no, endurecer el héroe. | Pantalla completa, letra enorme, estados de error legibles. | README final. Instrucciones para probar. | **15:30: se congela el código.** |
| **15:30–16:15** Ensayo | Vigilar el servidor. Tener el túnel de respaldo abierto. | Demo cinco veces: wifi y datos móviles. Grabar un video de un cobro real. | Revisar repo y app en ventana de incógnito. Buscar llaves en el historial del repo. | Demo estable. Video guardado. Repo limpio. |
| **16:15–16:40** Entrega | — | Pitch con Gabriel, cinco veces. | **Enviar el formulario.** | Formulario enviado, con captura del acuse. |
| **16:40–17:00** Colchón | Cero código. | Cero código. | Cero código. | — |

### Reglas de decisión, para no discutir en el momento

- **11:30 sin pago real confirmado:** los tres al cobro. No se abre nada de interfaz hasta que salga.
- **12:30 sin héroe por teclado:** se cancela el mini-MCP y esa hora se le da al héroe.
- **13:15 sin voz confiable:** la demo se hace con teclado. La Bocina sigue siendo el momento.
- **14:45 sin MCP:** se corta. No se le roba tiempo al ensayo.
- **15:30:** nadie escribe una función más. Solo textos, README y arreglos de una línea, probados.

---

## 10. Recortes, en orden de sacrificio

Se corta de arriba hacia abajo. Lo cortado no desaparece: **se cuenta en el pitch como lo que sigue.**

1. **Libreta de Fiado** (foto de la libreta → cobros al celular). No se construye hoy.
2. **Panel del dueño y termómetro de UDIs.** No se construye hoy.
3. **Cobro por push al celular.** El QR solo ya es el héroe.
4. **Montos dictados con palabras raras** ("treinta y cinco con cincuenta"). Basta con cifras y los dos casos de la demo.
5. **Mini-MCP.** Si no sale en su hora, es una frase.
6. **Voz de entrada.** Último recurso: teclado.

**Nunca se corta:** el pago real, el webhook con firma verificada, la Bocina, los candados, el repo público y el formulario.

---

## 11. La demo que no se olvida

### Utilería

- **El pantallazo falso:** una imagen de "transferencia exitosa" genérica, hecha por nosotros, **sin el logotipo ni el nombre de ningún banco real**. Tiene que verse creíble a un metro y ser nuestra de principio a fin.
- Teléfono del cajero a volumen máximo. Si la sala es grande, una bocina por cable.
- El video de respaldo de un cobro real, abierto en otra pestaña.

### Guion de 30 segundos

| Segundo | Qué se dice | Qué se hace |
|---|---|---|
| 0–7 | "Al cajero le enseñan esto. Si es falso, la mercancía ya se fue y a él le toca explicarlo." | Mostrar el pantallazo falso |
| 7–10 | "Esto miente." | Bajar el teléfono |
| 10–13 | "Cóbrale un peso." | Hablarle al teléfono del cajero; aparece el QR |
| 13–20 | "Saquen su celular. Escaneen." | Un juez paga |
| 20–23 | *(silencio)* | **La Bocina canta. Pantalla verde.** |
| 23–30 | "Esto no miente: es el pago real, directo a la cuenta del comercio. Nosotros nunca tocamos el dinero. Hoy es el cajero. Mañana es cualquier agente." | Señalar la pantalla |

**El silencio de los segundos 20 a 23 es el pitch.** No se llena con palabras: se deja que la Bocina hable.

### Si dan dos minutos

Después del segundo 30: en Cursor se escribe "cóbrale un peso por un café", el QR aparece solo en el teléfono del cajero, se paga, y canta otra vez. Cierre: "La misma función. Ya no la llamó una persona."

### Si algo falla en vivo

- **No reconoce la voz:** "Con este ruido, mi cajero usa el teclado." Teclear. Seguir.
- **No llega la confirmación:** esperar cinco segundos; la consulta de respaldo suele alcanzarla. Si no, reproducir el video: "Esto es de hace veinte minutos, aquí mismo."
- **Sin red:** datos móviles del teléfono. Tenerlos probados desde el ensayo.

### Preguntas que van a hacer

- **"¿Ustedes tocan el dinero?"** No. El pago va del banco del cliente a la cuenta del comercio. Si falta la cuenta destino, nuestro servidor se niega a cobrar.
- **"¿Y si son muchos comercios?"** Hoy es una credencial por comercio. El modelo de plataforma requiere autorización escrita de pey y ya la pedimos.
- **"¿Quién verifica el pago?"** El aviso llega firmado por pey y trae la clave de rastreo de Banxico. Sin firma válida, la Bocina no habla.
- **"Ya existe un MCP de cobros con pey."** Sí, hay al menos uno público. El nuestro no es el producto: es la prueba de que el cobro por voz es una función que cualquier agente puede llamar. Lo nuestro es la voz de entrada, la confirmación cantada y el cajero.
- **"¿Qué sigue?"** La libreta de fiado convertida en cobros al celular, y un tablero para que el dueño vea cuánto efectivo lleva frente al tope de su cuenta.

---

## 12. Entregables a las 17:00

### Repo público

- [ ] README con: qué es, cómo usa el API de pey, los tres candados, cómo probarlo, qué no se construyó hoy.
- [ ] Declaración honesta: construido el 14-nov; librerías de terceros listadas.
- [ ] `.env.example` con nombres de variables y sin valores.
- [ ] **Ninguna llave en ningún commit.** Revisar el historial, no solo el último estado.
- [ ] Probado en ventana de incógnito: abre sin iniciar sesión.

### App en vivo

- [ ] URL fija con HTTPS.
- [ ] `/salud` muestra el modo de comercio y el estado de la cuenta.
- [ ] Un cobro real completo hecho después de las 15:30.

### Formulario

- [ ] Campos copiados a las 10:00 (**no los he visto**; tener listos nombre del proyecto, una línea, liga al repo, liga a la app, integrantes, cómo usa pey y liga al video).
- [ ] Enviado a las 16:15, no a las 16:55.
- [ ] Captura del acuse.

### Pitch

- [ ] Treinta segundos con cronómetro, cinco veces.
- [ ] Una sola persona habla. Otra opera el teléfono.

### Nombre del proyecto

Dos cuidados: **no llamarlo "Cóbrale"** (ya existe un proyecto público con ese nombre sobre el API de pey) y no usar un nombre que suene a producto oficial de pey o de Banxico. "Cóbrale 35 pesos" se queda como lo que dice el cajero, no como marca. Nombre de trabajo: **La Bocina**.

---

## 13. Tres preguntas para pey, en persona, antes de las 10:30

1. **Plataforma con varios comercios.** "Queremos registrar la CLABE de cada comercio y que cada uno reciba directo en su cuenta, con una sola API key. ¿Cómo pedimos la autorización de la cláusula 5.4?" Pedir que lo confirmen por correo a `legal@pey.mx`.
2. **Cuenta de prueba.** "¿La CLABE de prueba es válida para la demo de hoy? ¿Si la registramos con `POST /bank-account` queda activa de inmediato?"
3. **El nombre y la frase.** "¿Podemos decir 'clave de rastreo de Banxico' en la confirmación por voz?"

Lo que contesten se anota en el README con la hora. Una respuesta de pey en la sala vale más que cualquier supuesto nuestro.

---

## 14. Riesgos y qué hacemos con cada uno

| Riesgo | Señal temprana | Qué hacemos |
|---|---|---|
| La API key no cobra en producción | La prueba de esta noche falla | Buscar a pey a las 10:00. Sin esto no hay héroe. |
| El webhook no llega al despliegue | *Webhook Logs* muestra errores | Revisar la URL y la firma con el cuerpo crudo. Mientras, consulta de respaldo. |
| La voz no entiende con ruido | Falla en la prueba de las 12:30 | Teclado. La Bocina sigue. |
| El teléfono no habla | Silencio tras un pago de prueba | Toque previo, volumen, modo silencio, otra voz. Tono de respaldo. |
| iPhone como teléfono del cajero | El micrófono no arranca | El cajero usa Android con Chrome. Los pagadores pueden usar cualquier teléfono. |
| El proceso se reinicia en plena demo | Cobros pendientes desaparecen | Una réplica, sin despliegues después de las 15:30. |
| Wifi saturado | Latencia en el ensayo | Datos móviles en el teléfono del cajero y en la laptop. |
| Llave filtrada en el repo | Aparece al buscar en el historial | Rotarla en el portal en el momento. |
| El juez no tiene CoDi activo | Duda al escanear | Uno de nosotros paga con el teléfono de respaldo. |

---

## 15. Lo que es hecho y lo que no

### Verificado en fuente primaria

- **Banxico:** las Circulares 9 y 10/2026 (DOF 17-jun-2026) dan a bancos y participantes del SPEI hasta el 14-dic-2026 para cumplir las Guías. Las Guías v1.1 piden el botón "Transferencias" en inicio de sesión y pantalla principal, y que el monto solo sea editable si el QR no lo trae.
- **Circular 11/2026:** cuenta nivel 2 Bis con 15,000 UDIs al mes, de las cuales solo 3,000 en efectivo. Vigente desde el 18-jun-2026.
- **Ley de Economía Digital:** DOF 4-nov-2026, vigente desde el 5-nov. Hacienda puede designar sectores de pago solo digital.
- **docs.pey.mx:** todos los endpoints, campos, límites y webhooks de la sección 5; la CLABE de prueba; los 5 días hábiles de activación.
- **Términos de pey:** cobrar para cuentas de terceros requiere autorización escrita.

### Por probar (y cuándo)

| Qué | Cuándo |
|---|---|
| La llave con CLABE de prueba cobra sin validación adicional | Esta noche |
| La app del banco bloquea la edición del monto hoy, antes del 14-dic | Esta noche |
| Un mismo QR acepta varios pagos | Esta noche |
| Tiempo real entre el pago y el webhook | Esta noche y sábado 10:30 |
| `POST /bank-account` con la CLABE de prueba queda `ACTIVE` de inmediato | Sábado 10:15 |
| Campos del webhook de push | Si se construye el push |
| Campos de los pagos en `/transaction/*` | Sábado 10:30, en `openapi.json` |
| Autorización para varios comercios | Sábado, en persona |
| Campos del formulario | Sábado 10:00 |

### Supuestos del relato (se cuentan, no se afirman como dato)

- Que el fraude del pantallazo se le descuenta al cajero.
- Cuántos comercios sufren esto.

---

## 16. La frase final

**Una miente. La otra canta cuando el dinero ya llegó.**
