# Voz de entrada: MediaRecorder → ElevenLabs STT → parser fijo

Type: prototype
Status: open
Blocked by: 02, 05, 09

## Question

¿Cómo queda el flujo de micrófono: gesto de usuario → capturar audio → `POST /api/voz/transcribir` (mini-proxy → **ElevenLabs Scribe**) → **parser fijo** (frases del SPRINT, sin LLM) → monto en pantalla → `POST /api/cobros` — dejando el teclado listo si STT/red fallan o el parser no entiende?
