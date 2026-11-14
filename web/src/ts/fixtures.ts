import type { CobroCreado, EventoPagado } from "./types";

/** PNG 1×1 gris — basta para probar el <img> sin depender de pey. */
export const FIXTURE_QR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADElEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";

let seq = 0;

export function fixtureCrearCobro(monto: number): CobroCreado {
  seq += 1;
  const id = `fx_${seq}_${Date.now().toString(36)}`;
  const expira = new Date(Date.now() + 360_000).toISOString();
  return {
    id,
    estado: "pendiente",
    monto,
    canal: "qr",
    qrImage: FIXTURE_QR_PNG_BASE64,
    expiraEn: expira,
    concepto: "Fixture",
  };
}

export function fixturePagado(id: string, monto: number): EventoPagado {
  return {
    id,
    monto,
    hora: new Date().toISOString(),
    rastreoTerminacion: "4242",
    transactionId: `tx_fx_${id}`,
  };
}

export function useFixtures(): boolean {
  const q = new URLSearchParams(window.location.search);
  if (q.get("fixture") === "1") return true;
  return import.meta.env.VITE_USE_FIXTURES === "1";
}
