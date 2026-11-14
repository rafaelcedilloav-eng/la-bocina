// Maneja la pantalla del cajero REAL en un navegador headless (CDP) contra el server local.
// Uso: node pantalla_e2e.mjs <ruta msedge/chrome> <secreto b64> <mcp token> [carpeta capturas]
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [exe, SECRETO, MCP_TOKEN, CAPTURAS] = process.argv.slice(2);
const BASE = "http://127.0.0.1:8000";
const PUERTO = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fallos = [];
const paso = (n, ok, d = "") => {
  console.log((ok ? "  OK    " : "  FALLA ") + n + (d ? `  [${d}]` : ""));
  if (!ok) fallos.push(n);
};

const perfil = mkdtempSync(join(tmpdir(), "bocina-e2e-"));
const nav = spawn(exe, [
  "--headless=new", `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`,
  "--no-first-run", "--window-size=430,900", "--autoplay-policy=no-user-gesture-required",
  "about:blank",
], { stdio: "ignore" });

let ws;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
      target = l.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("el navegador no abrió CDP");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pend = new Map();
  const consola = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === "Runtime.consoleAPICalled")
      consola.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Runtime.exceptionThrown")
      consola.push("EXCEPCION: " + d.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise((res) => {
    const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => {
    const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  const vista = () => js(`document.querySelector("#app").dataset.vista`);
  const esperaVista = async (v, seg = 8) => {
    const fin = Date.now() + seg * 1000;
    while (Date.now() < fin) { if ((await vista()) === v) return true; await sleep(150); }
    return false;
  };
  const visible = (el) => js(`(() => { const e = document.querySelector("[data-el=${el}]"); return !!e && !e.hidden; })()`);
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const foto = async (nombre) => {
    if (!CAPTURAS) return;
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(CAPTURAS, nombre), Buffer.from(r.result.data, "base64"));
  };

  // Oído propio al SSE para saber el id de cada cobro creado.
  const creados = [];
  (async () => {
    const r = await fetch(`${BASE}/api/eventos`);
    const dec = new TextDecoder(); let buf = "";
    for await (const ch of r.body) {
      buf += dec.decode(ch, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const blo = buf.slice(0, i); buf = buf.slice(i + 2);
        if (blo.startsWith("data:")) {
          const e = JSON.parse(blo.slice(5));
          if (e.evento === "creado") creados.push(e.id);
        }
      }
    }
  })().catch(() => {});

  const pagar = async (cobroId) => {
    const det = await (await fetch(`${BASE}/api/cobros/${cobroId}`)).json();
    const cuerpo = JSON.stringify({
      type: "codi.qr.payment_received", amount: det.monto, codiQrId: det.codiQrId,
      transactionId: "tx_" + randomUUID().slice(0, 12), datePaid: new Date().toISOString(),
      metadata: { trackingKey: "MBAN0100221114000000042" },
    });
    const wid = "msg_" + randomUUID(); const ts = String(Math.floor(Date.now() / 1000));
    const firma = createHmac("sha256", Buffer.from(SECRETO, "base64")).update(`${wid}.${ts}.${cuerpo}`).digest("base64");
    const r = await fetch(`${BASE}/webhooks/pey`, {
      method: "POST", body: cuerpo,
      headers: { "content-type": "application/json", "webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": "v1," + firma },
    });
    return r.status;
  };

  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url: BASE + "/" });
  await sleep(1500);

  console.log("== A. teclado -> QR -> pago -> verde -> entregar");
  paso("la pantalla carga en idle", (await vista()) === "idle");
  paso("Entregar oculto en idle", !(await visible("entregar")));
  for (const k of ["1", "0", "0"]) await click(`.caja-key[data-key="${k}"]`);
  paso("monto tecleado $1.00", (await js(`document.querySelector("[data-el=monto]").textContent`)).includes("1.00"));
  await click("[data-el=cobrar]");
  paso("pasa a pendiente", await esperaVista("pendiente"));
  paso("QR visible (imagen de pey)", (await visible("qr-wrap")) &&
    (await js(`document.querySelector("[data-el=qr]").naturalWidth > 0`)));
  await foto("1_qr_pendiente.png");
  paso("Entregar oculto mientras no hay pago", !(await visible("entregar")));
  await sleep(300);
  const idA = creados.at(-1);
  paso("webhook firmado aceptado", (await pagar(idA)) === 200);
  paso("pantalla VERDE (pagado)", await esperaVista("pagado"));
  paso("muestra terminación de rastreo …42", (await js(`document.querySelector("[data-el=meta]").textContent`)).includes("42"));
  paso("aparece el botón Marcar entregado", await visible("entregar"));
  await sleep(1200);
  await foto("2_pagado_verde.png");
  await click("[data-el=entregar]");
  paso("pasa a entregado", await esperaVista("entregado"));
  paso("el server lo confirma", (await (await fetch(`${BASE}/api/cobros/${idA}`)).json()).estado === "entregado");
  paso("Entregar se oculta; conserva rastreo", !(await visible("entregar")) &&
    (await js(`document.querySelector("[data-el=meta]").textContent`)).includes("42"));
  await foto("3_entregado.png");

  console.log("== B. un agente cobra por MCP -> el QR aparece solo (SSE)");
  await click("[data-el=nuevo]");
  paso("vuelve a idle", await esperaVista("idle"));
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${MCP_TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "cobrar", arguments: { monto: 1, concepto: "café" } } }),
  });
  const idB = (await r.json()).result.cobroId;
  paso("sin tocar la pantalla: pendiente + QR", (await esperaVista("pendiente")) && (await visible("qr-wrap")));
  paso("webhook firmado aceptado", (await pagar(idB)) === 200);
  paso("pantalla VERDE por el cobro del agente", await esperaVista("pagado"));
  await foto("4_mcp_pagado.png");

  console.log("== C. el QR vence a los 360 s y se retira");
  await click("[data-el=nuevo]");
  await esperaVista("idle");
  for (const k of ["5", "0", "0"]) await click(`.caja-key[data-key="${k}"]`);
  await click("[data-el=cobrar]");
  paso("cobro nuevo en pendiente con QR", (await esperaVista("pendiente")) && (await visible("qr-wrap")));
  await sleep(300);
  const idC = creados.at(-1);
  await js(`(() => { const real = Date.now.bind(Date); Date.now = () => real() + 400000; })()`); // adelanta el reloj 400 s
  paso("pasa a vencido", await esperaVista("expirado", 5));
  paso("el QR desaparece y avisa que no se entregue", !(await visible("qr-wrap")) &&
    (await js(`document.querySelector("[data-el=msg]").textContent`)).includes("No entregues"));
  await sleep(2500);
  paso("no vuelve a pendiente por la consulta de respaldo", (await vista()) === "expirado");
  paso("un pago que aun así llega sí se canta", (await pagar(idC)) === 200 && (await esperaVista("pagado")));

  const errores = consola.filter((l) => /^(error|EXCEPCION)/.test(l));
  paso("sin errores en consola", errores.length === 0, errores.slice(0, 3).join(" | "));
  console.log("consola:", consola.slice(-4));
} finally {
  try { ws?.close(); } catch {}
  nav.kill();
}
console.log(fallos.length ? `\nFALLARON ${fallos.length}: ${fallos.join("; ")}` : "\nTODO VERDE");
process.exit(fallos.length ? 1 : 0);
