# Fase 1: Bocina (ElevenLabs TTS) idempotente

Type: prototype
Status: resolved
Claimed by: oscar
Blocked by: 01, 02, 03, 09

## Question

¿Cómo implementamos la Bocina vía nuestro mini-proxy (`POST /api/voz/hablar`) para que: un toque diga “Listo” y habilite audio; al `pagado` cante el monto del evento **una sola vez por `transactionId`**; frase configurable; si falla TTS caiga a tono + verde — ejercitable con `?fake=1`?

## Answer

- Módulo `src/ts/bocina.ts`: `unlockAudio` / `installAudioUnlock`, `cantarPagado`, `fraseDePagado` / `montoATexto`.
- Enganche en `main.ts`: poll (`applyDetalle` → EventoPagado) y SSE `pagado` y fixture llaman `cantarPagado` solo si `setPagado` es primera vez.
- Frase: `{monto} recibidos. Clave de rastreo, terminación {terminacion}. Entrega el pedido.`
- Monto = `ev.monto` (evento), no el tecleado.
- `?fake=1` → `speechSynthesis` / tono; sin key en el bundle.
- Fallo TTS → tono + verde igual (`setPagado` no depende del audio).
