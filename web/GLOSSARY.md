# La Bocina · pantalla del cajero

Lenguaje del frontend de cobro por voz. Sin detalles de implementación.

## Language

**Cobro**:
Intención de recibir un monto fijo de un cliente, con un ciclo de vida propio en pantalla.
_Avoid_: Orden, ticket, venta (la venta es el negocio; el cobro es lo que la Bocina confirma)

**Monto**:
Cantidad en pesos con hasta dos decimales que se cobra y, si el pago llega, se canta.
_Avoid_: Amount (en UI hablamos español), total

**Pantalla del cajero**:
La única vista (`GET /`) donde se dicta o teclea el monto, se muestra el QR y se confirma el pago.
_Avoid_: Dashboard, terminal, app (salvo al hablar con jueces)

**Bocina**:
La confirmación hablada del pago recibido; solo suena tras un aviso válido del servidor (o del mismo camino de UI en modo falso de desarrollo).
_Avoid_: Notificación, alerta, TTS (en conversación de dominio)

**Parser fijo**:
Reglas deterministas que sacan monto (y opcionalmente teléfono) del texto reconocido; no usa modelo de lenguaje.
_Avoid_: IA, NLU, agente

**Clave de rastreo (terminación)**:
Últimos caracteres de la clave con la que Banxico identifica la operación; es lo que la Bocina menciona al cantar.
_Avoid_: Folio bancario, referencia (numRef es otro campo)

**Entregado**:
Acción verificable opcional tras un cobro pagado; baja prioridad frente al héroe.
_Avoid_: Completado, cerrado (salvo al mapear estados del API)
