# La Bocina · pantalla del cajero

Monto, teclado, micrófono, QR de CoDi, confirmación en verde, **Bocina** y botón de
entregar. Vite + TypeScript, sin framework. Hecha por Oscar; su historial de commits
se conserva en este repo.

El dinero y pey viven en [`../server`](../server). Esta carpeta solo pinta la caja y
le habla al API del servidor.

## Qué hay aquí

| Pieza | Rol |
|---|---|
| `src/main.ts` | Cablea la pantalla: cobro, eventos, voz, entregar |
| `src/ts/api.ts` | Cliente del API: cobros, eventos (SSE) con consulta de respaldo, voz |
| `src/ts/parser.ts` | **Parser fijo** de frases de cobro. Sin modelo de lenguaje |
| `src/ts/bocina.ts` | La Bocina: arma la frase y la canta una sola vez por `transactionId` |
| `src/ts/state.ts` · `ui.ts` | Estado de la caja y su pintado |
| `GLOSSARY.md` | El lenguaje del dominio |
| `.scratch/` · `PROGRESS.md` | Notas de trabajo del día del hackatón |

## Arranque

```bash
cp .env.example .env    # VITE_API_BASE y VITE_API_TOKEN
npm install
npm run dev             # http://localhost:5173
```

En desarrollo, Vite reenvía `/api/cobros`, `/api/eventos`, `/api/tts` y `/api/stt` al
servidor que diga `VITE_API_BASE`.

Para servir la pantalla desde el mismo servidor (un proceso, una URL):

```bash
npm run build           # deja web/dist; el servidor la sirve en GET /
```

En ese caso `VITE_API_BASE` puede ir vacío: la pantalla usa rutas relativas.

## Modos de prueba

- `?fixture=1`: recorre la pantalla sin servidor, con botón **Simular pagado**.
- `?fake=1`: usa la voz del navegador en lugar del servidor.

## Reglas de la pantalla

- **Nunca verde por clic o temporizador.** Solo por un `pagado` que vino del servidor.
- Dos oídos para el mismo aviso: eventos del servidor y consulta cada 2 segundos. El
  que llegue primero gana; la Bocina canta una vez.
- Un cobro creado por un agente (mini-MCP) aparece solo en la pantalla si está libre.
- El teclado siempre está visible.

## Secretos

`VITE_API_TOKEN` queda dentro del JavaScript que descarga el navegador: no es un
secreto, es un freno. Ninguna llave de pey ni de voz va en variables `VITE_*`.
