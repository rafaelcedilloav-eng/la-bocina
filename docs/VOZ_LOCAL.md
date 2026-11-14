# Voz sin ElevenLabs: TTS local + STT en el navegador

El server ya elige motor de TTS con la variable `TTS_BACKEND` (en `.env`). Oscar NO cambia
nada en su frontend: mismo `POST /api/tts {texto} -> audio`. Solo cambias la variable y reinicias.

## Opción A — Kokoro (LO MEJOR LOCAL: corre en la PC, Apache-2.0, CPU)
```powershell
cd D:\Dev\proyectos\la-bocina\server
.\.venv\Scripts\Activate.ps1
pip install "kokoro>=0.9.4" soundfile
# espeak-ng (fonemas, necesario para español):
winget install eSpeak-NG.eSpeak-NG     # o: scoop install espeak-ng
```
En `.env`:
```
TTS_BACKEND=kokoro
KOKORO_VOICE=ef_dora      # es: ef_dora(F), em_alex, em_santa(M)
KOKORO_LANG=e
```
Reinicia uvicorn. **Primera llamada descarga el modelo (~327MB).**

> **Gotcha de Windows:** si Kokoro no encuentra espeak, apunta la DLL antes de lanzar:
> `$env:PHONEMIZER_ESPEAK_LIBRARY="C:\Program Files\eSpeak NG\libespeak-ng.dll"`
> **Truco de números:** el G2P español de Kokoro es flojo con dígitos. Manda el monto
> EN PALABRAS ("treinta y cinco pesos"), no "35". El server arma ese texto, así que fácil.

## Opción B — edge-tts (RED DE SEGURIDAD: gratis, sin llave, canta en 2 min)
No es local (usa Microsoft) pero es gratis, sin cuenta ni cuota, voz es-MX excelente.
```powershell
pip install edge-tts
```
En `.env`:
```
TTS_BACKEND=edge
EDGE_VOICE=es-MX-DaliaNeural    # o es-MX-JorgeNeural (voz masculina)
```
Reinicia uvicorn. Listo.

## Opción C — Qwen3-TTS (máxima calidad, PERO necesita GPU)
Para el deploy en la Tiny si tiene buena GPU. Ya lo probaron. Mejor calidad y code-switching
es/en, ~97ms. Se integra como un backend más en `_tts_*` (pídemelo y lo cablean).

## STT (voz -> monto): usa el navegador, NO ElevenLabs
ElevenLabs Scribe también falla y además es de pago. El navegador (Chrome) hace STT es-MX
nativo, gratis, sin llave, sin proxy. Oscar cambia su STT por esto:
```js
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new Rec();
rec.lang = 'es-MX';
rec.onresult = (e) => {
  const texto = e.results[0][0].transcript;   // ej. "cobra treinta y cinco pesos"
  // de aqui sacas el monto y llamas POST /api/cobros
};
rec.start();
```
Así `/api/stt` queda como respaldo (si algun dia quieren STT de servidor), pero la demo no lo necesita.

## Recomendación de reloj (hackathon)
1. **AHORA, para que cante en la demo:** `TTS_BACKEND=edge` (2 min, garantizado).
2. **En paralelo / para el producto local:** monta Kokoro con calma y cambia a `TTS_BACKEND=kokoro`.
3. **STT:** Oscar al navegador nativo, ya.
