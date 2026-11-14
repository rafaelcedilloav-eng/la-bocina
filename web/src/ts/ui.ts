import {
  appendDigito,
  formatMonto,
  getState,
  parseMonto,
  type CajaState,
} from "./state";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"] as const;

export interface CajaUI {
  render: (s: CajaState) => void;
  onCobrar: (handler: () => void) => void;
  onMic: (handler: () => void) => void;
  onNuevo: (handler: () => void) => void;
  onEntregar: (handler: () => void) => void;
  onFixturePagado: (handler: () => void) => void;
  setMicListening: (on: boolean) => void;
}

function qrSrc(base64?: string): string | null {
  if (!base64) return null;
  if (base64.startsWith("data:")) return base64;
  return `data:image/png;base64,${base64}`;
}

function segundosRestantes(expiraEn?: string): number | null {
  if (!expiraEn) return null;
  const t = Date.parse(expiraEn);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

function etiquetaVista(vista: CajaState["vista"]): string {
  switch (vista) {
    case "idle":
      return "Listo";
    case "creando":
      return "Creando…";
    case "pendiente":
      return "Esperando pago";
    case "pagado":
      return "PAGADO";
    case "entregado":
      return "Entregado";
    case "expirado":
      return "Vencido";
    case "tardio":
      return "Tardío";
    case "error":
      return "Error";
    case "sin_conexion":
      return "Sin conexión";
    default:
      return "";
  }
}

function formatHora(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function mountUI(root: HTMLElement): CajaUI {
  root.innerHTML = `
    <header class="caja-brand">
      <p class="caja-eyebrow">CoDi · cajero</p>
      <h1 class="caja-title">La Bocina</h1>
      <button
        type="button"
        class="caja-mic"
        data-el="mic"
        aria-label="Cobrar por voz"
        title="Di: cóbrale 35 pesos"
      >
        <svg class="caja-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z"
          />
        </svg>
        <span class="caja-mic-label" data-el="mic-label">Hablar</span>
      </button>
    </header>

    <section class="caja-stage" aria-live="polite">
      <p class="caja-status" data-el="status"></p>
      <p class="caja-monto" data-el="monto">$0.00</p>
      <p class="caja-msg" data-el="msg" hidden></p>
      <div class="caja-qr-wrap" data-el="qr-wrap" hidden>
        <img class="caja-qr" data-el="qr" alt="Código QR CoDi" />
        <p class="caja-timer" data-el="timer"></p>
      </div>
      <dl class="caja-meta" data-el="meta" hidden></dl>
    </section>

    <section class="caja-pad" aria-label="Teclado numérico">
      <div class="caja-keys" data-el="keys"></div>
      <div class="caja-actions">
        <button type="button" class="caja-btn caja-btn-primary" data-el="cobrar">Cobrar</button>
        <button type="button" class="caja-btn caja-btn-primary" data-el="entregar" hidden>Marcar entregado</button>
        <button type="button" class="caja-btn caja-btn-ghost" data-el="nuevo" hidden>Nuevo cobro</button>
        <button type="button" class="caja-btn caja-btn-fixture" data-el="fx-pagado" hidden>Simular pagado</button>
      </div>
    </section>
  `;

  const keysEl = root.querySelector<HTMLElement>("[data-el=keys]")!;
  for (const k of KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "caja-key";
    b.dataset.key = k;
    b.textContent = k;
    b.addEventListener("click", () => appendDigito(k));
    keysEl.appendChild(b);
  }

  const cobrarBtn = root.querySelector<HTMLButtonElement>("[data-el=cobrar]")!;
  const micBtn = root.querySelector<HTMLButtonElement>("[data-el=mic]")!;
  const micLabel = root.querySelector<HTMLElement>("[data-el=mic-label]")!;
  const nuevoBtn = root.querySelector<HTMLButtonElement>("[data-el=nuevo]")!;
  const entregarBtn = root.querySelector<HTMLButtonElement>("[data-el=entregar]")!;
  const fxBtn = root.querySelector<HTMLButtonElement>("[data-el=fx-pagado]")!;

  let cobrarHandler: (() => void) | null = null;
  let micHandler: (() => void) | null = null;
  let nuevoHandler: (() => void) | null = null;
  let entregarHandler: (() => void) | null = null;
  let fxHandler: (() => void) | null = null;
  let micListening = false;

  cobrarBtn.addEventListener("click", () => cobrarHandler?.());
  micBtn.addEventListener("click", () => micHandler?.());
  nuevoBtn.addEventListener("click", () => nuevoHandler?.());
  entregarBtn.addEventListener("click", () => entregarHandler?.());
  fxBtn.addEventListener("click", () => fxHandler?.());

  const qs = new URLSearchParams(window.location.search);
  const showFixtureControls = qs.get("fixture") === "1";

  function render(s: CajaState): void {
    root.dataset.vista = s.vista;

    const status = root.querySelector<HTMLElement>("[data-el=status]")!;
    const montoEl = root.querySelector<HTMLElement>("[data-el=monto]")!;
    const msg = root.querySelector<HTMLElement>("[data-el=msg]")!;
    const qrWrap = root.querySelector<HTMLElement>("[data-el=qr-wrap]")!;
    const qr = root.querySelector<HTMLImageElement>("[data-el=qr]")!;
    const timer = root.querySelector<HTMLElement>("[data-el=timer]")!;
    const meta = root.querySelector<HTMLElement>("[data-el=meta]")!;

    status.textContent = etiquetaVista(s.vista);

    const montoVista =
      s.vista === "pagado" || s.vista === "tardio" || s.vista === "entregado"
        ? (s.cobro?.montoPagado ?? s.cobro?.monto ?? parseMonto(s.digitos))
        : (s.cobro?.monto ?? parseMonto(s.digitos));

    montoEl.textContent = formatMonto(montoVista);

    if (s.mensaje) {
      msg.hidden = false;
      msg.textContent = s.mensaje;
    } else {
      msg.hidden = true;
      msg.textContent = "";
    }

    const src = qrSrc(s.cobro?.qrImage);
    const showQr = Boolean(src) && s.vista === "pendiente";
    qrWrap.hidden = !showQr;
    if (src && showQr) {
      qr.src = src;
    } else {
      qr.removeAttribute("src");
    }

    const secs = segundosRestantes(s.cobro?.expiraEn);
    if (s.vista === "pendiente" && secs != null) {
      timer.textContent = `${secs}s`;
      timer.hidden = false;
    } else {
      timer.hidden = true;
      timer.textContent = "";
    }

    if (s.vista === "pagado" || s.vista === "tardio" || s.vista === "entregado") {
      meta.hidden = false;
      const hora = s.cobro?.pagadoEn ?? s.cobro?.entregadoEn ?? "";
      const term = s.cobro?.rastreoTerminacion ?? "";
      meta.innerHTML = `
        ${hora ? `<div><dt>Hora</dt><dd>${escapeHtml(formatHora(hora))}</dd></div>` : ""}
        ${term ? `<div><dt>Rastreo</dt><dd>…${escapeHtml(term)}</dd></div>` : ""}
      `;
    } else {
      meta.hidden = true;
      meta.innerHTML = "";
    }

    const canType =
      s.vista === "idle" ||
      s.vista === "error" ||
      s.vista === "expirado" ||
      s.vista === "sin_conexion";
    keysEl.querySelectorAll<HTMLButtonElement>(".caja-key").forEach((b) => {
      b.disabled = !canType;
    });

    const montoOk = parseMonto(s.digitos) > 0;
    const canCobrarVista =
      s.vista === "idle" ||
      s.vista === "error" ||
      s.vista === "expirado" ||
      s.vista === "sin_conexion";
    cobrarBtn.hidden = !canCobrarVista;
    cobrarBtn.disabled = !montoOk || s.vista === "creando" || micListening;
    micBtn.hidden = !(canCobrarVista || micListening);
    // Mientras escucha debe poder tocarse → Detener.
    micBtn.disabled = s.vista === "creando";
    micBtn.classList.toggle("is-listening", micListening);
    micBtn.setAttribute("aria-busy", micListening ? "true" : "false");
    micBtn.setAttribute(
      "aria-label",
      micListening ? "Detener dictado" : "Cobrar por voz",
    );
    micLabel.textContent = micListening ? "Detener" : "Hablar";
    nuevoBtn.hidden = !(
      s.vista === "pagado" ||
      s.vista === "entregado" ||
      s.vista === "tardio" ||
      s.vista === "sin_conexion" ||
      s.vista === "error"
    );
    // Entregar solo existe sobre un cobro PAGADO (el server lo exige igual: 409 si no).
    entregarBtn.hidden = s.vista !== "pagado";
    fxBtn.hidden = !(showFixtureControls && s.vista === "pendiente");
  }

  function setMicListening(on: boolean): void {
    micListening = on;
    render(getState());
  }

  render(getState());

  return {
    render,
    onCobrar(handler) {
      cobrarHandler = handler;
    },
    onMic(handler) {
      micHandler = handler;
    },
    onNuevo(handler) {
      nuevoHandler = handler;
    },
    onEntregar(handler) {
      entregarHandler = handler;
    },
    onFixturePagado(handler) {
      fxHandler = handler;
    },
    setMicListening,
  };
}

export function bindRender(
  ui: CajaUI,
  subscribe: (fn: (s: CajaState) => void) => () => void,
): void {
  subscribe(ui.render);
  window.setInterval(() => {
    const s = getState();
    if (s.vista === "pendiente") ui.render(s);
  }, 1000);
}
