# La Bocina

**El cobro por voz que canta cuando el dinero ya llegó.**

El cajero dice *"cóbrale 35 pesos"*. Aparece un QR de CoDi con ese monto fijo. El
cliente lo paga desde la app de su banco. El teléfono del cajero se pone verde y
**dice en voz alta que el dinero llegó**. El dinero va directo de un banco a otro, a
la cuenta del comercio: nosotros nunca lo tocamos (no custodia).

No es una terminal. Es un **primitivo**: una intención dicha en voz alta que se
convierte en un cobro verificado.

- **Hoy:** el cajero que ya no depende de un pantallazo que puede ser falso.
- **Mañana:** la misma función, llamada por una máquina expendedora, un
  estacionamiento o un agente de IA que atiende la tienda.

> Construido el 14-nov-2026 en el Cursor Hackatón México (CDMX). Fuente de verdad del
> diseño: `docs/SPRINT.md`.

---

## Cómo usa el API de pey

El dinero nunca pasa por nuestro servidor. Flujo:

1. El servidor valida el **candado de cuenta** y llama `POST /codi/qr` con el monto
   fijo → pey devuelve el QR.
2. El cliente paga desde su banco por CoDi → el dinero va **directo** a la CLABE del
   comercio.
3. pey manda el webhook firmado `codi.qr.payment_received` → el servidor **verifica la
   firma con el cuerpo crudo** → avisa a la pantalla → la Bocina canta **una vez**.

Detalle de endpoints y pruebas: **`docs/CONTRATO.md`** y **`docs/PEY_QUICKSTART.md`**.

---

## Los tres candados (la columna legal — van desde el primer commit)

1. **Ningún cobro sin la cuenta del comercio.** El servidor arranca en modo
   `cuenta_registrada` (manda siempre `bankAccountId` de una cuenta `ACTIVE`) o
   `credencial_propia` (la cuenta ligada a la API key ES la del comercio). No existe
   ruta de código que cobre sin destino claro: prefiere fallar.
2. **Los links de pago no cobran ventas.** `POST /payment-link/create` manda el dinero
   a la cuenta de la API key, no a un `bankAccountId`. **No aparece en el código de
   ventas.** Uso futuro: cobrar nuestra propia suscripción.
3. **Un comercio por credencial hasta tener permiso.** Registrar cuentas de terceros
   bajo una sola API key requiere autorización escrita de Koshi (términos de pey
   3.3, 5.2(d), 5.4, Anexo C.2). Hoy la demo es de un solo comercio.

**Candado extra:** si el webhook trae un `bankAccountId` que no es el esperado, se
ignora y se registra. La Bocina no canta pagos de otra cuenta.

---

## Cómo probarlo

1. Copia `.env.example` a `.env` y llena los valores (ver `docs/PEY_QUICKSTART.md`).
   **El `.env` NUNCA se sube al repo.**
2. Arranca el servidor (ver `server/`) y expón una URL HTTPS fija.
3. Abre la pantalla del cajero, toca el micrófono, di *"cóbrale un peso"*.
4. Paga el QR desde la app de un banco con CoDi. La pantalla se pone verde y la Bocina
   habla.
5. `/salud` muestra el modo de comercio y el estado de la cuenta, sin secretos.

---

## Qué NO se construyó hoy (va como "lo que sigue" en el pitch)

Libreta de fiado (foto → cobros al celular) · panel del dueño y termómetro de UDIs ·
cobro por push al celular (si no dio tiempo) · montos dictados con palabras complejas ·
mini-MCP (si no salió en su hora).

**Nunca se recorta:** el pago real, el webhook con firma verificada, la Bocina, los
candados, el repo público y el formulario de entrega.

---

## Equipo

- **Rafael — el cómo:** servidor, webhook, despliegue, candados, MCP.
- **Oscar — el qué:** pantalla del cajero, voz, Bocina, guion de la demo, utilería.
- **Gabriel — para quién y por qué:** preguntas a pey, README, formulario, pitch.

Correos del equipo: _(agregar en la entrega)_.

---

## Seguridad y honestidad

- `.env.example` lista los nombres de variables, sin valores. **Ninguna llave en
  ningún commit** (revisar el historial, no solo el último estado). Si una llave se
  filtra, se rota en el portal de pey en el momento.
- Librerías de terceros: se listan en los manifiestos del proyecto conforme se agregan.
- El pantallazo "falso" de la demo es genérico, **sin logo ni nombre de ningún banco
  real**.
