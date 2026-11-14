import type {
  CobroCreado,
  CobroDetalle,
  CrearCobroBody,
  EventoServidor,
} from "./types";

/**
 * Base del API de Rafael (cobros + voz TTS/STT).
 * En `npm run dev` → same-origin; Vite proxifica al tunnel.
 * En build, `VITE_API_BASE` apunta al tunnel/host.
 */
export function apiBase(): string {
  const raw = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  if (import.meta.env.DEV) return "";
  return raw;
}

function url(path: string): string {
  const base = apiBase();
  return `${base}${path}`;
}

/** Bearer para POSTs (cobros, tts, stt, entregar). GET/SSE van sin header. */
export function authHeaders(): Record<string, string> {
  const token = String(import.meta.env.VITE_API_TOKEN ?? "").trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

const CREAR_TIMEOUT_MS = 25_000;

/** Mensajes legibles: Cloudflare HTML / timeouts no van crudos a la caja. */
export function humanizeApiError(raw: string, status?: number): string {
  const t = raw.trim();
  if (status === 401 || /no autorizado|unauthorized/i.test(t)) {
    return "No autorizado. Revisa VITE_API_TOKEN en .env.";
  }
  if (
    /Proxy Read Timeout|524|origin web server did not return|Cloudflare Tunnel error|Error 5\d\d/i.test(
      t,
    ) ||
    status === 524 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return "El server de cobros no respondió a tiempo. Revisa el tunnel de Rafael y vuelve a cobrar.";
  }
  if (/Failed to fetch|NetworkError|Load failed|aborted|AbortError|timed out|timeout/i.test(t)) {
    return "Sin respuesta del server de cobros. ¿Está arriba el tunnel?";
  }
  if (t.startsWith("<!") || t.includes("<html")) {
    return "El server de cobros devolvió un error de red. Intenta de nuevo en un momento.";
  }
  if (t.length > 180) return `${t.slice(0, 160)}…`;
  return t || `Error HTTP ${status ?? ""}`.trim();
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { detail?: unknown; mensaje?: string };
    if (typeof body.mensaje === "string") return humanizeApiError(body.mensaje, res.status);
    if (typeof body.detail === "string") return humanizeApiError(body.detail, res.status);
    if (Array.isArray(body.detail)) {
      const joined = body.detail
        .map((d) =>
          typeof d === "object" && d && "msg" in d
            ? String((d as { msg: string }).msg)
            : JSON.stringify(d),
        )
        .join("; ");
      return humanizeApiError(joined, res.status);
    }
    return humanizeApiError(JSON.stringify(body), res.status);
  } catch {
    return humanizeApiError(text || res.statusText || `HTTP ${res.status}`, res.status);
  }
}

async function fetchJson<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const ctrl = new AbortController();
  const ms = timeoutMs ?? 15_000;
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url(path), {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(await readError(res));
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        humanizeApiError("timed out: el server no respondió a tiempo"),
      );
    }
    if (err instanceof TypeError) {
      throw new Error(humanizeApiError(err.message || "Failed to fetch"));
    }
    if (err instanceof Error) {
      throw new Error(humanizeApiError(err.message));
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function crearCobro(body: CrearCobroBody): Promise<CobroCreado> {
  const data = await fetchJson<CobroCreado>(
    "/api/cobros",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    },
    CREAR_TIMEOUT_MS,
  );
  if (!data.expiraEn) {
    data.expiraEn = new Date(Date.now() + 360_000).toISOString();
  }
  return data;
}

export async function getCobro(id: string): Promise<CobroDetalle> {
  return fetchJson<CobroDetalle>(`/api/cobros/${encodeURIComponent(id)}`);
}

/** `POST /api/cobros/:id/entregar` — requiere Bearer. */
export async function entregarCobro(id: string): Promise<CobroDetalle> {
  return fetchJson<CobroDetalle>(`/api/cobros/${encodeURIComponent(id)}/entregar`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
}

/** Bocina: `POST /api/tts` `{texto}` → audio (ElevenLabs en el server de Rafael). */
export async function hablarTts(texto: string): Promise<Blob> {
  const res = await fetch(url("/api/tts"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ texto }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.blob();
}

/** Mic → monto: `POST /api/stt` body audio → `{ text }`. */
export async function transcribirStt(audioBlob: Blob): Promise<string> {
  const contentType = (audioBlob.type || "audio/webm").split(";")[0]!.trim() || "audio/webm";
  const res = await fetch(url("/api/stt"), {
    method: "POST",
    headers: { "Content-Type": contentType, ...authHeaders() },
    body: audioBlob,
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = (await res.json()) as { text?: string; texto?: string };
  const texto = (data.text ?? data.texto ?? "").trim();
  if (!texto) throw new Error("STT: texto vacío");
  return texto;
}

export type StopWatch = () => void;

/**
 * Escucha `GET /api/eventos` (SSE). Reconecta con backoff suave.
 * El navegador entrega `event.type` = nombre SSE (`pagado`, `creado`, …).
 */
export function watchEventos(
  onEvent: (ev: EventoServidor) => void,
  onStatus?: (ok: boolean, detail?: string) => void,
): StopWatch {
  let stopped = false;
  let es: EventSource | null = null;
  let retryMs = 1000;
  let timer: number | null = null;

  const known = new Set([
    "creado",
    "pagado",
    "expirado",
    "tardio",
    "error",
    "entregado",
  ]);

  function handleMessage(tipo: string, raw: string): void {
    let data: unknown = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw };
      }
    }
    if (!known.has(tipo)) {
      // Algunos servers mandan todo en `message` con {tipo|event|type}
      if (tipo === "message" && data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const t = String(obj.tipo ?? obj.event ?? obj.type ?? "");
        if (known.has(t)) {
          handleMessage(t, JSON.stringify(obj.data ?? obj));
        }
      }
      return;
    }
    onEvent({ tipo, data } as EventoServidor);
  }

  function connect(): void {
    if (stopped) return;
    es = new EventSource(url("/api/eventos"));

    es.onopen = () => {
      retryMs = 1000;
      onStatus?.(true);
    };

    es.onerror = () => {
      onStatus?.(false, "SSE interrumpido");
      es?.close();
      es = null;
      if (stopped) return;
      timer = window.setTimeout(() => {
        retryMs = Math.min(retryMs * 1.5, 8000);
        connect();
      }, retryMs);
    };

    for (const name of known) {
      es.addEventListener(name, (e) => {
        handleMessage(name, (e as MessageEvent).data ?? "");
      });
    }
    es.onmessage = (e) => handleMessage("message", e.data ?? "");
  }

  connect();

  return () => {
    stopped = true;
    if (timer != null) window.clearTimeout(timer);
    es?.close();
    es = null;
  };
}

/** Poll `GET /api/cobros/:id` cada `intervalMs` mientras haya cobro pendiente. */
export function pollCobro(
  id: string,
  onDetalle: (d: CobroDetalle) => void,
  onFail?: (err: Error) => void,
  intervalMs = 2000,
): StopWatch {
  let stopped = false;
  let timer: number | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const d = await getCobro(id);
      onDetalle(d);
      if (d.estado !== "pendiente") {
        stop();
        return;
      }
    } catch (err) {
      onFail?.(err instanceof Error ? err : new Error(String(err)));
    }
    if (!stopped) {
      timer = window.setTimeout(() => {
        void tick();
      }, intervalMs);
    }
  }

  function stop(): void {
    stopped = true;
    if (timer != null) window.clearTimeout(timer);
    timer = null;
  }

  void tick();
  return stop;
}
