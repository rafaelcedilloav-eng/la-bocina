/** Captura de micrófono → POST /api/stt (proxy ElevenLabs en el server de Rafael). */

import { transcribirStt } from "./api";

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return undefined;
}

export type Grabacion = {
  /** Corta la grabación; `blob` se resuelve al terminar. */
  stop: () => void;
  /** Audio completo (al tocar Detener o al llegar al tope). */
  blob: Promise<Blob>;
};

const MAX_MS_DEFAULT = 12_000;

/**
 * Empieza a grabar ya (gesto de usuario).
 * El cajero toca Detener cuando termina; si no, corta al tope.
 */
export async function iniciarGrabacion(maxMs = MAX_MS_DEFAULT): Promise<Grabacion> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMimeType();
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let settled = false;

  let resolveBlob!: (b: Blob) => void;
  let rejectBlob!: (e: Error) => void;
  const blob = new Promise<Blob>((resolve, reject) => {
    resolveBlob = resolve;
    rejectBlob = reject;
  });

  const cleanupTracks = () => {
    stream.getTracks().forEach((t) => t.stop());
  };

  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  recorder.onerror = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    cleanupTracks();
    rejectBlob(new Error("No se pudo grabar audio"));
  };

  recorder.onstop = () => {
    window.clearTimeout(timer);
    cleanupTracks();
    if (settled) return;
    settled = true;
    const type = recorder.mimeType || mime || "audio/webm";
    resolveBlob(new Blob(chunks, { type }));
  };

  const stop = () => {
    if (recorder.state !== "inactive") {
      try {
        recorder.requestData?.();
      } catch {
        /* Safari / viejos */
      }
      recorder.stop();
    }
  };

  const timer = window.setTimeout(stop, maxMs);
  recorder.start(250);

  return { stop, blob };
}

export async function transcribirAudio(blob: Blob): Promise<string> {
  return transcribirStt(blob);
}
