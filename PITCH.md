# La Bocina: pitch

Una persona habla y la otra opera la demo. Ensayar con cronómetro.

## Versión 30 segundos

| Tiempo | Quien habla dice | Quien opera hace |
|---|---|---|
| 0–7 s | «Cuando un repartidor entrega y le dicen "ya te transferí", no tiene cómo saberlo. Una captura se falsifica en diez segundos.» | Enseña el pantallazo falso genérico (sin logo de banco) |
| 7–20 s | «Con La Bocina solo dice: "cóbrale 35"... sale el QR con el monto fijo... el cliente paga...» | Dicta, enseña el QR, alguien paga |
| 20–25 s | (silencio: que se oiga la Bocina) | Pantalla verde y la Bocina dice el monto |
| 25–30 s | «Solo se pone verde cuando llega el aviso firmado, y libera la entrega una sola vez. Una miente. La otra canta cuando el dinero ya llegó.» | Toca «Marcar entregado» |

**Si se pasa de 30 s,** quitar «Una captura se falsifica en diez segundos».

## Versión 60 segundos (si hay más tiempo)

1. **Problema (10 s):** la captura falsa y el comerciante que no puede comprobar el pago.
2. **Demo (25 s):** igual que la de 30 s.
3. **Por qué confiar (10 s):** «La pantalla no se puede engañar: firma verificada, monto
   exacto, una sola vez. Lo revisó nuestro agente de seguridad con IA.»
4. **Para quién (10 s):** «Pensada para quien no quiere o no puede leer: te dice en voz
   alta si ya te pagaron. Y cualquier agente de IA puede cobrar con ella.»
5. **Cierre (5 s):** «Una miente. La otra canta cuando el dinero ya llegó.»

## Si dan dos minutos: el agente

En Cursor se escribe «cóbrale un peso por un café». El QR aparece solo en el teléfono
del cajero, sin que nadie lo toque. Se paga. La Bocina canta otra vez.

> «La misma función. Ya no la llamó una persona.»

## Respuestas para preguntas de los jueces

- **¿Y si el webhook no llega?** Consultamos a pey cada 5 segundos como respaldo. Sin
  confirmación no hay verde: la pantalla se queda en «Esperando pago».
- **¿Pueden falsificar el aviso de pago?** Sin el secreto, no: verificamos la firma sobre
  el cuerpo crudo y la frescura del timestamp. Lo probamos: una firma forjada recibe 401.
- **¿Y si alguien paga dos veces?** Solo el primer pago libera la entrega; el segundo se
  marca como tardío para revisarlo.
- **¿Y si el cliente paga menos?** El QR lleva monto fijo; si llegara un monto distinto,
  el cobro pasa a error y la pantalla se pone roja.
- **¿Quién custodia el dinero?** Nadie: va del banco del cliente a la cuenta del
  comercio. En la demo usamos la cuenta de prueba de pey.
- **¿Y si son muchos comercios?** Hoy es una credencial por comercio. El modelo de
  plataforma requiere autorización escrita de pey.
- **Ya existe un MCP de cobros con pey.** Sí. El nuestro no es el producto: es la prueba
  de que el cobro por voz es una función que cualquier agente puede llamar. Lo nuestro
  es la voz de entrada, la confirmación cantada y el cobro al entregar.
- **¿Modelo de negocio?** [DEFINIR: comisión por cobro, suscripción por dispositivo o
  licencia a empresas de reparto]
- **¿Qué sigue?** Cobro push, NFC, billetes por color, libreta de fiado y bitácora
  inmutable.

## Si algo falla en vivo

- **No reconoce la voz:** «Con este ruido, mi cajero usa el teclado.» Teclear. Seguir.
- **No llega la confirmación:** esperar cinco segundos; la consulta de respaldo suele
  alcanzarla. Si no, reproducir el video de respaldo.
- **Sin red:** datos móviles del teléfono.

## Reglas para el pitch

- No decir que «cumplimos» leyes o cláusulas; decir «diseñado para».
- No decir «clave de rastreo de Banxico» si pey no lo confirmó; decir «clave de rastreo».
- No decir «billetes por color» ni «te confirma el monto antes de cobrar»: todavía no
  están construidos.
- No enseñar capturas con CLABE completa, API key ni secretos.
- Tener el video de respaldo listo por si falla el wifi o el túnel.

## Anexo: formulario (forms.gle, cierra domingo 1:00 PM)

| Campo | Texto |
|---|---|
| Nombre del equipo | La Bocina (Gabriel Zavarse, Rafael Cedillo, Oscar Garavito) |
| Descripción corta | Cobro al entregar con CoDi por voz: el teléfono solo dice «pagado» cuando llega el aviso firmado de pey, verificado en el servidor, y libera la entrega una sola vez. |
| Descripción completa | La Bocina resuelve el fraude de la captura falsa al cobrar al entregar. El cajero dice el monto, aparece un QR CoDi con monto fijo y el cliente paga desde su banco. El servidor verifica la firma del webhook de pey (Standard Webhooks), revisa monto, frescura e idempotencia, y solo entonces la pantalla se pone verde y el teléfono dice en voz alta cuánto llegó; «Entregado» se libera una sola vez. Pensada para operarse sin leer: voz, monto enorme y pantalla de color. Incluye una herramienta MCP para que agentes de IA creen cobros, que aparecen solos en la pantalla del cajero. |
| Cómo usa pey | `POST /codi/qr` con monto fijo, webhook `codi.qr.payment_received` verificado con Standard Webhooks y consulta de respaldo `GET /transaction/codi/qr/{id}`. |
| Repositorio | https://github.com/rafaelcedilloav-eng/la-bocina (revisar en incógnito) |
| App en vivo | `<URL real del servidor>` (que siga activa hasta el domingo) |
| Correos | `<los tres correos>` |
| Evidencia | Captura recortada: `POST /webhooks/pey 200` y el cobro en «pagado» (sin CLABE completa ni apiKeyId) |
