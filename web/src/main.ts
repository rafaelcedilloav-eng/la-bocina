import "./css/caja.css";
import {
  crearCobro,
  entregarCobro,
  pollCobro,
  watchEventos,
  type StopWatch,
} from "./ts/api";
import { cantarPagado, installAudioUnlock, unlockAudio } from "./ts/bocina";
import { fixtureCrearCobro, fixturePagado, useFixtures } from "./ts/fixtures";
import { parseFraseCobro } from "./ts/parser";
import { iniciarGrabacion, transcribirAudio, type Grabacion } from "./ts/voz";
import {
  applyDetalle,
  getState,
  parseMonto,
  resetIdle,
  setCreando,
  setDigitosDesdePesos,
  setError,
  setExpirado,
  setMensajeIdle,
  setPagado,
  setPendiente,
  setSinConexion,
  setTardio,
  subscribe,
} from "./ts/state";
import type { Canal, EventoPagado, EventoServidor } from "./ts/types";
import { bindRender, mountUI } from "./ts/ui";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app no encontrado");
}

const ui = mountUI(app);
bindRender(ui, subscribe);
installAudioUnlock(app);

let stopPoll: StopWatch | null = null;
let stopSse: StopWatch | null = null;

function clearWatchers(): void {
  stopPoll?.();
  stopPoll = null;
}

function confirmarPagado(ev: EventoPagado): void {
  if (setPagado(ev)) void cantarPagado(ev);
}

function wireCobroWatch(id: string): void {
  clearWatchers();
  // Poll 2s = oído confiable a verde; la Bocina dispara en el mismo camino.
  stopPoll = pollCobro(id, (detalle) => {
    const ev = applyDetalle(detalle);
    if (ev) {
      void cantarPagado(ev);
      clearWatchers();
    }
  });
}

function onServidorEvent(ev: EventoServidor): void {
  const actual = getState().cobro?.id;

  switch (ev.tipo) {
    case "creado": {
      // Fuente de verdad para cobros del MCP (o POST propio si llega antes).
      if (getState().vista === "idle" || getState().vista === "creando") {
        const cobro = {
          ...ev.data,
          expiraEn:
            ev.data.expiraEn ?? new Date(Date.now() + 360_000).toISOString(),
        };
        setPendiente(cobro);
        wireCobroWatch(cobro.id);
      }
      break;
    }
    case "pagado": {
      if (actual && actual !== ev.data.id) return;
      confirmarPagado(ev.data);
      clearWatchers();
      break;
    }
    case "expirado": {
      if (actual && actual !== ev.data.id) return;
      setExpirado(ev.data.id);
      clearWatchers();
      break;
    }
    case "tardio": {
      if (actual && actual !== ev.data.id) return;
      setTardio(ev.data);
      clearWatchers();
      break;
    }
    case "error": {
      if (actual && actual !== ev.data.id) return;
      setError(ev.data.mensaje, ev.data.id);
      clearWatchers();
      break;
    }
    case "entregado": {
      if (actual && actual !== ev.data.id) return;
      applyDetalle({
        // Conserva hora de pago y rastreo que ya pinta la pantalla.
        ...(getState().cobro ?? { monto: 0, canal: "qr" as const }),
        id: ev.data.id,
        estado: "entregado",
        entregadoEn: ev.data.entregadoEn,
      });
      clearWatchers();
      break;
    }
  }
}

if (!useFixtures()) {
  // SSE + poll: lo que llegue primero gana. Un blip de SSE no pinta verde ni “sin conexión”
  // (el poll sigue; sin_conexion solo si falla crear cobro / red).
  stopSse = watchEventos(onServidorEvent);
}

async function iniciarCobro(canal: Canal = "qr"): Promise<void> {
  const monto = parseMonto(getState().digitos);
  if (monto <= 0) return;

  if (useFixtures()) {
    setCreando();
    window.setTimeout(() => {
      const cobro = fixtureCrearCobro(monto);
      setPendiente(cobro);
    }, 200);
    return;
  }

  setCreando();
  try {
    const cobro = await crearCobro({
      monto,
      concepto: "Venta",
      canal,
    });
    setPendiente(cobro);
    wireCobroWatch(cobro.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/sin respuesta|no respondió|tunnel|sin conexión|failed to fetch|network/i.test(msg)) {
      setSinConexion(msg);
    } else {
      setError(msg);
    }
  }
}

ui.onCobrar(() => {
  void iniciarCobro("qr");
});

/** Hablar → Detener (tope 12 s). Segundo toque corta; no hay timer fijo de 3 s. */
let grabacionActiva: Grabacion | null = null;

ui.onMic(() => {
  if (grabacionActiva) {
    grabacionActiva.stop();
    return;
  }

  const vista = getState().vista;
  if (
    vista !== "idle" &&
    vista !== "error" &&
    vista !== "expirado" &&
    vista !== "sin_conexion"
  ) {
    return;
  }

  void (async () => {
    setMensajeIdle("");
    try {
      // Gesto → «Listo» (primera vez) desbloquea TTS para el pagado.
      await unlockAudio();
      const grabacion = await iniciarGrabacion(12_000);
      grabacionActiva = grabacion;
      ui.setMicListening(true);
      setMensajeIdle("Habla… toca Detener cuando termines");

      const clip = await grabacion.blob;
      grabacionActiva = null;
      ui.setMicListening(false);

      if (clip.size < 200) {
        setMensajeIdle("No capturé audio. Intenta de nuevo.");
        return;
      }

      setMensajeIdle("Transcribiendo…");
      const texto = await transcribirAudio(clip);
      const parsed = parseFraseCobro(texto);
      if (!parsed.ok) {
        setMensajeIdle(parsed.mensaje);
        return;
      }
      setDigitosDesdePesos(parsed.monto);
      await iniciarCobro("voz");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMensajeIdle(
        /permission|NotAllowed|denied/i.test(msg)
          ? "Permiso de micrófono denegado"
          : msg.length > 120
            ? `${msg.slice(0, 100)}…`
            : msg || "No se pudo escuchar. Usa el teclado.",
      );
    } finally {
      grabacionActiva = null;
      ui.setMicListening(false);
    }
  })();
});

/**
 * Vencimiento: pey deja de aceptar el QR a los 360 s. La pantalla lo retira para que
 * nadie lo capture ni lo pague tarde. Un pago que aun así llegue entra por SSE.
 */
window.setInterval(() => {
  const s = getState();
  if (s.vista !== "pendiente" || !s.cobro?.expiraEn) return;
  if (Date.parse(s.cobro.expiraEn) > Date.now()) return;
  clearWatchers();
  setExpirado(s.cobro.id);
}, 1000);

ui.onNuevo(() => {
  clearWatchers();
  resetIdle();
});

/** Entregar: acción verificable sobre un cobro pagado (`POST /api/cobros/:id/entregar`). */
let entregando = false;

ui.onEntregar(() => {
  const s = getState();
  if (entregando || s.vista !== "pagado" || !s.cobro) return;
  const cobro = s.cobro;

  if (useFixtures()) {
    applyDetalle({ ...cobro, estado: "entregado", entregadoEn: new Date().toISOString() });
    return;
  }

  entregando = true;
  void (async () => {
    try {
      const detalle = await entregarCobro(cobro.id);
      // Conserva lo que ya pinta la pantalla y encima lo que confirmó el server.
      applyDetalle({ ...cobro, ...detalle, estado: "entregado" });
    } catch (err) {
      console.warn("[entregar] falló; el cobro sigue pagado", err);
    } finally {
      entregando = false;
    }
  })();
});

ui.onFixturePagado(() => {
  const s = getState();
  if (!s.cobro || s.vista !== "pendiente") return;
  confirmarPagado(fixturePagado(s.cobro.id, s.cobro.monto));
});

window.addEventListener("beforeunload", () => {
  clearWatchers();
  stopSse?.();
});
