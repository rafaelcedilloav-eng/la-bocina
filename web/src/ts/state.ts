import type {
  CobroCreado,
  CobroDetalle,
  EventoPagado,
  EventoTardio,
  VistaCaja,
} from "./types";

export interface CajaState {
  vista: VistaCaja;
  /** Dígitos crudos del teclado (centavos implícitos vía parseMonto). */
  digitos: string;
  cobro: CobroDetalle | null;
  mensaje: string;
  /** transactionIds ya procesados (idempotencia local). */
  cantados: Set<string>;
}

type Listener = (s: CajaState) => void;

const listeners = new Set<Listener>();

let state: CajaState = {
  vista: "idle",
  digitos: "",
  cobro: null,
  mensaje: "",
  cantados: new Set(),
};

export function getState(): CajaState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  const snap = state;
  for (const fn of listeners) fn(snap);
}

function patch(partial: Partial<CajaState>): void {
  state = { ...state, ...partial };
  emit();
}

/** Interpreta digitos como pesos: "3500" → 35.00, "35" → 0.35, "1" → 0.01 */
export function parseMonto(digitos: string): number {
  if (!digitos) return 0;
  const cents = Number.parseInt(digitos, 10);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

export function formatMonto(pesos: number): string {
  return pesos.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
}

export function appendDigito(d: string): void {
  if (
    state.vista !== "idle" &&
    state.vista !== "error" &&
    state.vista !== "expirado" &&
    state.vista !== "sin_conexion"
  ) {
    return;
  }

  let digitos = state.digitos;
  let base: Partial<CajaState> = {};
  if (
    state.vista === "error" ||
    state.vista === "expirado" ||
    state.vista === "sin_conexion"
  ) {
    digitos = state.vista === "sin_conexion" ? state.digitos : "";
    base = { vista: "idle", cobro: null, mensaje: "" };
  }

  if (d === "⌫") {
    patch({ ...base, digitos: digitos.slice(0, -1) });
    return;
  }
  if (d === "C") {
    patch({ ...base, digitos: "" });
    return;
  }
  if (!/^\d$/.test(d)) return;
  if (digitos.length >= 8) return;
  patch({ ...base, digitos: digitos + d });
}

export function resetIdle(mensaje = ""): void {
  patch({
    vista: "idle",
    digitos: "",
    cobro: null,
    mensaje,
  });
}

/** Deja el teclado listo con un mensaje (parser / STT fallido). */
export function setMensajeIdle(mensaje: string): void {
  patch({
    vista: "idle",
    cobro: null,
    mensaje,
  });
}

/** Fija el monto en dígitos del pad (p. ej. tras STT) y limpia cobro previo. */
export function setDigitosDesdePesos(pesos: number): void {
  const cents = Math.round(pesos * 100);
  if (!Number.isFinite(cents) || cents <= 0) return;
  patch({
    vista: "idle",
    digitos: String(cents),
    cobro: null,
    mensaje: "",
  });
}

export function setCreando(): void {
  patch({ vista: "creando", cobro: null, mensaje: "Creando cobro…" });
}

export function setPendiente(cobro: CobroCreado): void {
  patch({
    vista: "pendiente",
    cobro: { ...cobro },
    mensaje: "",
  });
}

/** @returns true si es la primera vez que confirmamos este transactionId (disparar Bocina). */
export function setPagado(ev: EventoPagado): boolean {
  if (state.cantados.has(ev.transactionId)) return false;
  const prev = state.cobro;
  if (prev && prev.id !== ev.id) return false;
  const cantados = new Set(state.cantados);
  cantados.add(ev.transactionId);
  patch({
    vista: "pagado",
    cantados,
    cobro: {
      ...(prev ?? { id: ev.id, estado: "pagado", monto: ev.monto, canal: "qr" }),
      estado: "pagado",
      montoPagado: ev.monto,
      pagadoEn: ev.hora,
      rastreoTerminacion: ev.rastreoTerminacion,
      transactionId: ev.transactionId,
    },
    mensaje: "",
  });
  return true;
}

export function setExpirado(id: string): void {
  if (state.cobro && state.cobro.id !== id) return;
  if (state.vista === "pagado" || state.vista === "entregado") return;
  patch({
    vista: "expirado",
    cobro: state.cobro ? { ...state.cobro, estado: "expirado" } : state.cobro,
    mensaje: "Se venció. No entregues. Dicta de nuevo.",
  });
}

export function setTardio(ev: EventoTardio): void {
  if (state.cobro && state.cobro.id !== ev.id) return;
  patch({
    vista: "tardio",
    cobro: {
      ...(state.cobro ?? { id: ev.id, estado: "tardio", monto: ev.monto, canal: "qr" }),
      estado: "tardio",
      montoPagado: ev.monto,
      rastreoTerminacion: ev.rastreoTerminacion,
    },
    mensaje: "Pago recibido tarde: no entregar sin revisar.",
  });
}

export function setError(mensaje: string, id?: string): void {
  if (id && state.cobro && state.cobro.id !== id) return;
  patch({
    vista: "error",
    mensaje,
    // Sin QR en error: evita el ícono roto si la respuesta falló a medias.
    cobro: state.cobro
      ? { ...state.cobro, estado: "error", mensajeError: mensaje, qrImage: undefined }
      : null,
  });
}

export function setSinConexion(mensaje = "Sin conexión con el servidor"): void {
  patch({ vista: "sin_conexion", mensaje });
}

/** @returns EventoPagado si acabamos de pasar a pagado (para la Bocina). */
export function applyDetalle(detalle: CobroDetalle): EventoPagado | null {
  if (state.cobro && state.cobro.id !== detalle.id) return null;

  if (detalle.estado === "pagado" && detalle.transactionId) {
    const ev: EventoPagado = {
      id: detalle.id,
      monto: detalle.montoPagado ?? detalle.monto,
      hora: detalle.pagadoEn ?? new Date().toISOString(),
      rastreoTerminacion: detalle.rastreoTerminacion ?? "????",
      transactionId: detalle.transactionId,
    };
    return setPagado(ev) ? ev : null;
  }

  if (detalle.estado === "expirado") {
    setExpirado(detalle.id);
    return null;
  }

  if (detalle.estado === "tardio") {
    setTardio({
      id: detalle.id,
      monto: detalle.montoPagado ?? detalle.monto,
      rastreoTerminacion: detalle.rastreoTerminacion,
    });
    return null;
  }

  if (detalle.estado === "error") {
    setError(detalle.mensajeError ?? "Error en el cobro", detalle.id);
    return null;
  }

  if (detalle.estado === "entregado") {
    patch({
      vista: "entregado",
      cobro: { ...detalle },
      mensaje: "",
    });
    return null;
  }

  if (detalle.estado === "pendiente") {
    patch({
      vista: "pendiente",
      cobro: { ...(state.cobro ?? detalle), ...detalle },
      mensaje: "",
    });
  }
  return null;
}
