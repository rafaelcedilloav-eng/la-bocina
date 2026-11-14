# pey — arranque rapido (lo primero del sabado)

## 1. Dar de alta la cuenta y la llave

1. Entra al **portal de pey** (la hoja de hoy dice `portal.pey.mx`; el tutorial decia
   `portal.mipey.mx` — usa el que cargue) y crea perfil.
2. En **Finanzas**: agrega una cuenta de pago tipo `codi` con una CLABE pre-autorizada.
   - Documentada: `012180015826225713`, titular **Ramon Orraca Lascurain**. Activa de
     inmediato segun el tutorial. **Los pagos que recibe NO se devuelven.**
3. En **Desarrollador**: crea la **API key** (es el Bearer token → `PEY_API_KEY`).
4. En el engrane de la key: crea el **webhook** apuntando a tu `PUBLIC_URL/webhooks/pey`.
   El **secreto se muestra una sola vez** → guardalo en `PEY_WEBHOOK_SECRET`.

> Ojo Candado 1: si registras la CLABE con `POST /bank-account` y queda `ACTIVE`, usa
> `COMMERCE_MODE=cuenta_registrada`. Si queda `PENDING`, usa `credencial_propia` (la
> llave y su cuenta son de un solo comercio: es legitimo).

## 2. Primera prueba con curl (monto de 1 centavo)

```bash
curl -X POST https://api.pey.mx/codi/qr \
  -H "Authorization: Bearer $PEY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount":0.01,"concept":"prueba","expiration":360,"numRef":"1","generateImage":true}'
```
Toma el `qrImage`/`qrString`, pagalo desde la app de un banco con CoDi, y mira si llega
el webhook en *Webhook Logs*.

## 3. Las cuatro pruebas que valen oro

| Prueba | Como | Si sale mal |
|---|---|---|
| ¿La API key cobra sin validacion extra? | el curl de arriba, pagado | 10:00: buscar a pey en la sala |
| ¿El banco muestra el monto fijo y no deja cambiarlo? | mirar la pantalla del pagador | el pitch no puede decir "monto clavado" |
| ¿Un mismo QR acepta varios pagos? | pagarlo 2 veces, 2 telefonos | se genera un QR por juez (por voz son 2 seg) |
| ¿Llega el webhook y en cuanto? | *Webhook Logs* | si tarda, el polling de respaldo pasa a principal |

## 4. Antes de escribir codigo

Abre `docs.pey.mx/openapi.json` y confirma los nombres exactos de los campos de
`/transaction/*` y del webhook de push.

## Las tres preguntas a pey EN PERSONA (antes de 10:30)

1. Plataforma multi-comercio: ¿como pedimos la autorizacion de la clausula 5.4?
   (que lo confirmen a `legal@pey.mx`).
2. ¿La CLABE de prueba sirve para la demo de hoy y queda activa de inmediato con
   `POST /bank-account`?
3. ¿Podemos decir "clave de rastreo de Banxico" en la confirmacion por voz?

Lo que contesten se anota en el README con la hora.
