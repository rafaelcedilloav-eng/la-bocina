# Seguridad y cumplimiento

La Bocina maneja dinero real, así que la seguridad va desde el primer commit. El
servidor (`server/main.py`) fue revisado línea por línea, en varias rondas, por Égida,
nuestro agente de seguridad, y endurecido el mismo día. Las etiquetas `A1`–`A7` y
`N1`–`N5` en los comentarios del código son los hallazgos de esas rondas.

## Implementado

1. **Validación criptográfica de webhooks (anti-falsificación).** El webhook de pago
   se verifica con el esquema de Standard Webhooks: se lee el **cuerpo crudo** y se
   calcula HMAC-SHA256 con el secreto de pey **antes** de parsear el JSON. La
   comparación es en tiempo constante y falla cerrado: sin secreto configurado, sin
   encabezados o con firma inválida, responde `401` y **nunca** activa la Bocina.
2. **Anti-replay.** El `webhook-timestamp` debe estar a ±5 minutos de la hora del
   servidor.
3. **Idempotencia durable.** Doble candado: el encabezado `webhook-id` y el
   `transactionId` de pey, **persistidos en SQLite**. Un webhook repetido se ignora:
   la Bocina canta una sola vez por pago, también después de reiniciar el servidor.
4. **Verificación de monto.** Si el monto pagado no coincide con el del cobro, el
   cobro pasa a `error` y nunca a `pagado`. La consulta de respaldo aplica la misma
   regla.
5. **No custodia.** El dinero va del banco del cliente **directo** a la CLABE del
   comercio. La Bocina nunca lo toca. Ver los tres candados en el README.
6. **Gestión de secretos.** La API key de pey, el secreto del webhook y la llave de
   voz viven solo en variables de entorno (`server/.env`), fuera del repo. El
   `.gitignore` las blinda, igual que la base de datos con el ledger de pagos.
7. **Control de acceso y límite de peticiones.** Las rutas que crean cobros o gastan
   voz exigen token Bearer y tienen un tope de 20 peticiones por minuto por IP. El
   mini-MCP tiene su propio token y el mismo tope.
8. **La llave de voz no sale del servidor.** El navegador le habla a `/api/tts` y
   `/api/stt`; nunca al proveedor. El audio de entrada tiene tope de 5 MB.
9. **Errores sin fuga.** Las respuestas de error de pey se registran en el log del
   servidor y al cliente solo le llega el código. Encabezados o JSON malformados
   responden `400`/`401`, no `500`.
10. **Auditoría y trazabilidad.** Cada pago se registra en un ledger persistente con
    su `transactionId`, monto, hora y origen (webhook o respaldo).
11. **Datos personales.** La demo cobra solo por QR: no guarda teléfonos ni datos del
    pagador. De la clave de rastreo solo se muestran y se dicen los 2 últimos
    caracteres.

## Cómo comprobarlo

`server/pruebas/prueba_humo.py` ataca un servidor local con: firma forjada con otro
secreto, timestamp de hace una hora, webhook sin encabezados, el mismo webhook
repetido, el mismo `transactionId` con otro `webhook-id`, y un pago con monto
distinto. Ninguno debe producir un `pagado`. Ver [`../server/pruebas/README.md`](../server/pruebas/README.md).

## Límites conocidos

Los decimos nosotros antes de que alguien los encuentre.

- **El token de la pantalla no es un secreto.** Viaja en el JavaScript que descarga
  el navegador, así que cualquiera que abra la pantalla puede leerlo. Sirve para
  frenar el abuso casual. Lo que protege el dinero es otra cosa: crear un cobro solo
  genera un QR que paga **a la cuenta del comercio**, y un cobro solo pasa a `pagado`
  por un webhook firmado.
- **Los `GET` y el canal de eventos son abiertos.** Quien conozca la URL puede ver los
  cobros que se crean (identificador, monto y QR). No hay datos personales en ellos.
  Para un despliegue con varios comercios esto necesita sesión por caja.
- **CORS abierto**, para que la pantalla pueda vivir en otro origen durante el
  desarrollo.
- **Estado en un solo proceso.** Los cobros viven en memoria con espejo en SQLite. Es
  una réplica; no hay alta disponibilidad.
- **El servidor no marca cobros vencidos.** El QR deja de aceptarse en pey a los 360
  segundos y la pantalla lo retira, pero el servidor no tiene un estado "vencido".
- **Modo `cuenta_registrada` sin usar.** En las pruebas reales el aviso de pago llegó con
  `bankAccountId: null`. En ese modo el servidor exige ese campo y, al no venir, ignora
  el pago. Por eso hoy solo se usa `credencial_propia`, donde la cuenta ligada a la API
  key es la del comercio y el pago se liga al cobro por `codiQrId`.
- **Un solo comercio por credencial.** El modelo de plataforma requiere autorización
  escrita (candado 3).

## En el diseño, para cuando crezca

- **Cobros por teléfono** (`POST /codi/pn`): enmascarar el teléfono en logs
  (`55-****-5678`) y, de guardarse, con hash y sal (LFPDPPP).
- Sesión por caja y por comercio en lugar de un token compartido.
