import { hablarTts } from "./api";
import type { EventoPagado } from "./types";

/** Frase configurable. Placeholders: {monto}, {recibido}, {terminacion} */
export const FRASE_PAGADO =
  "{monto} {recibido}. Clave de rastreo, terminación {terminacion}. Entrega el pedido.";

const DIGITO: Record<string, string> = {
  "0": "cero",
  "1": "uno",
  "2": "dos",
  "3": "tres",
  "4": "cuatro",
  "5": "cinco",
  "6": "seis",
  "7": "siete",
  "8": "ocho",
  "9": "nueve",
};

const UNIDADES = [
  "",
  "un",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
];

const DECENAS = [
  "",
  "",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

const CENTENAS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

let unlocked = false;
let unlocking: Promise<void> | null = null;
const cantadosBocina = new Set<string>();
let currentAudio: HTMLAudioElement | null = null;

function useFakeVoz(): boolean {
  return new URLSearchParams(window.location.search).get("fake") === "1";
}

function enteroATexto(n: number): string {
  if (n === 0) return "cero";
  if (n === 100) return "cien";
  if (n < 20) return UNIDADES[n]!;
  if (n < 30) {
    return n === 20 ? "veinte" : `veinti${UNIDADES[n - 20]}`;
  }
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? DECENAS[d]! : `${DECENAS[d]} y ${UNIDADES[u]}`;
  }
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    const cabeza = c === 1 && r === 0 ? "cien" : CENTENAS[c]!;
    return r === 0 ? cabeza : `${cabeza} ${enteroATexto(r)}`;
  }
  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const r = n % 1000;
    const cabeza = miles === 1 ? "mil" : `${enteroATexto(miles)} mil`;
    return r === 0 ? cabeza : `${cabeza} ${enteroATexto(r)}`;
  }
  return String(n);
}

/** Monto del evento → frase hablable (“treinta y cinco pesos”, “un centavo”). */
export function montoATexto(pesos: number): string {
  const centsTotal = Math.round(pesos * 100);
  if (centsTotal <= 0) return "cero pesos";
  if (centsTotal === 1) return "un centavo";
  if (centsTotal < 100) {
    return `${enteroATexto(centsTotal)} centavos`;
  }
  const enteros = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  const pesoWord = enteros === 1 ? "peso" : "pesos";
  const cabeza =
    enteros === 1 ? `un ${pesoWord}` : `${enteroATexto(enteros)} ${pesoWord}`;
  if (cents === 0) return cabeza;
  if (cents === 1) return `${cabeza} con un centavo`;
  return `${cabeza} con ${enteroATexto(cents)} centavos`;
}

export function terminacionATexto(term: string): string {
  const clean = term.replace(/\D/g, "") || term;
  return [...clean]
    .map((ch) => DIGITO[ch] ?? ch)
    .join(", ");
}

export function fraseDePagado(
  monto: number,
  rastreoTerminacion: string,
  plantilla = FRASE_PAGADO,
): string {
  const montoTxt = montoATexto(monto);
  const recibido = /(peso|centavo)$/.test(montoTxt) ? "recibido" : "recibidos";
  return plantilla
    .replaceAll("{monto}", montoTxt)
    .replaceAll("{recibido}", recibido)
    .replaceAll("{terminacion}", terminacionATexto(rastreoTerminacion));
}

function stopCurrent(): void {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.removeAttribute("src");
  currentAudio = null;
}

function tonoFallback(volumen = 0.15, ms = 180): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = volumen;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, ms);
  } catch {
    /* sin audio disponible */
  }
}

async function playBlob(blob: Blob, volume = 1): Promise<void> {
  stopCurrent();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = volume;
  currentAudio = audio;
  try {
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio error"));
    });
  } finally {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
  }
}

function hablarFake(texto: string, volume = 0.35): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      tonoFallback(volume);
      resolve();
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-MX";
    u.volume = volume;
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => {
      tonoFallback(volume);
      resolve();
    };
    synth.speak(u);
  });
}

/** Un gesto del usuario desbloquea audio autoplay (iOS/Chrome). */
export function unlockAudio(): Promise<void> {
  if (unlocked) return Promise.resolve();
  if (unlocking) return unlocking;

  unlocking = (async () => {
    try {
      if (useFakeVoz()) {
        await hablarFake("Listo", 0.25);
      } else {
        try {
          const blob = await hablarTts("Listo");
          await playBlob(blob, 0.35);
        } catch {
          tonoFallback(0.12, 120);
        }
      }
      unlocked = true;
    } finally {
      unlocking = null;
    }
  })();

  return unlocking;
}

/** Primer toque en la UI → unlock (idempotente). */
export function installAudioUnlock(root: HTMLElement = document.body): void {
  const once = () => {
    void unlockAudio();
    root.removeEventListener("pointerdown", once, true);
  };
  root.addEventListener("pointerdown", once, true);
}

/**
 * Canta una sola vez por transactionId el monto del **evento**.
 * Verde no depende de esto: si falla TTS, tono + sigue.
 */
export async function cantarPagado(ev: EventoPagado): Promise<void> {
  if (cantadosBocina.has(ev.transactionId)) return;
  cantadosBocina.add(ev.transactionId);

  const frase = fraseDePagado(ev.monto, ev.rastreoTerminacion);

  try {
    if (!unlocked) {
      // Intento best-effort; si el browser bloquea, cae a tono.
      await unlockAudio();
    }
    if (useFakeVoz()) {
      await hablarFake(frase, 0.85);
      return;
    }
    const blob = await hablarTts(frase);
    await playBlob(blob, 1);
  } catch (err) {
    console.warn("[bocina] TTS falló; tono de respaldo", err);
    tonoFallback(0.2, 220);
  }
}
