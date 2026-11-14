/**
 * Parser fijo de frases de cobro (SPRINT / DIVISION).
 * Sin LLM: dígitos y números en español (lo que suele devolver el STT).
 * Busca el monto en cualquier parte de la frase («quiero pagar treinta y cinco…»).
 */

export type ParseCobroOk = {
  ok: true;
  monto: number;
  /** Solo si la frase trae «al 55…»; el canal push es stretch. */
  telefono?: string;
};

export type ParseCobroFail = {
  ok: false;
  mensaje: string;
};

export type ParseCobroResult = ParseCobroOk | ParseCobroFail;

const MSG_NO = "No entendí el monto";

const UNIDADES: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const DECENAS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const CENTENAS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

function esInicioNumero(tok: string): boolean {
  return (
    /^\d/.test(tok) ||
    tok === "mil" ||
    UNIDADES[tok] != null ||
    DECENAS[tok] != null ||
    CENTENAS[tok] != null
  );
}

/** Quita acentos y deja letras, dígitos, punto decimal y espacios. */
function normalizar(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9.\s]/gi, " ")
    // Solo conserva «.» entre dígitos (35.50); «veintitres.» → «veintitres»
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae teléfono «al 55 1234 5678» al final (10 dígitos). */
function sacarTelefono(texto: string): { resto: string; telefono?: string } {
  const m = texto.match(/\bal\s+([\d\s]{10,})\s*$/);
  if (!m) return { resto: texto };
  const digits = m[1]!.replace(/\D/g, "");
  if (digits.length !== 10) return { resto: texto };
  return {
    resto: texto.slice(0, m.index).trim(),
    telefono: digits,
  };
}

function pesosValido(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= 1_000_000;
}

function msgFallo(oido: string): string {
  const corto = oido.length > 60 ? `${oido.slice(0, 57)}…` : oido;
  return corto ? `${MSG_NO}. Oí: «${corto}»` : MSG_NO;
}

/**
 * Consume tokens de número en español desde el inicio del slice.
 * Devuelve valor + cuántos tokens usó, o null.
 */
function consumirNumeroPalabras(tokens: string[]): { valor: number; n: number } | null {
  if (tokens.length === 0) return null;

  let i = 0;
  let total = 0;
  const start = 0;

  if (tokens[i] === "mil") {
    total += 1000;
    i += 1;
  } else if (
    i + 1 < tokens.length &&
    tokens[i + 1] === "mil" &&
    (UNIDADES[tokens[i]!] != null || DECENAS[tokens[i]!] != null)
  ) {
    const miles = UNIDADES[tokens[i]!] ?? DECENAS[tokens[i]!];
    if (miles == null || miles < 1) return null;
    total += miles * 1000;
    i += 2;
  }

  if (i < tokens.length && CENTENAS[tokens[i]!] != null) {
    total += CENTENAS[tokens[i]!]!;
    i += 1;
  }

  if (i < tokens.length && DECENAS[tokens[i]!] != null) {
    total += DECENAS[tokens[i]!]!;
    i += 1;
    if (i < tokens.length && tokens[i] === "y") {
      i += 1;
      if (i < tokens.length && UNIDADES[tokens[i]!] != null && UNIDADES[tokens[i]!]! < 10) {
        total += UNIDADES[tokens[i]!]!;
        i += 1;
      } else {
        return null;
      }
    }
  } else if (i < tokens.length && UNIDADES[tokens[i]!] != null) {
    total += UNIDADES[tokens[i]!]!;
    i += 1;
  }

  if (i === start) return null;
  return { valor: total, n: i };
}

/** Centavos: «50», «5»→50, «cincuenta», «veintitres». */
function parseCentavosDesde(tokens: string[], from: number): { cents: number; n: number } | null {
  if (from >= tokens.length) return null;
  const tok = tokens[from]!;

  if (/^\d{1,2}$/.test(tok)) {
    const cents = tok.length === 1 ? Number(tok) * 10 : Number(tok);
    return { cents, n: 1 };
  }

  const palabras = consumirNumeroPalabras(tokens.slice(from));
  if (palabras && palabras.valor > 0 && palabras.valor < 100) {
    // «cinco» solo tras «con» → 50 céntimos (mismo criterio que dígito 1)
    if (palabras.n === 1 && UNIDADES[tok] != null && UNIDADES[tok]! < 10) {
      return { cents: UNIDADES[tok]! * 10, n: 1 };
    }
    return { cents: palabras.valor, n: palabras.n };
  }

  return null;
}

function montoDesdeTokens(
  tokens: string[],
  start: number,
): { monto: number } | null {
  const slice = tokens.slice(start);

  // «un centavo»
  if (
    (slice[0] === "un" || slice[0] === "uno" || slice[0] === "1") &&
    (slice[1] === "centavo" || slice[1] === "centavos")
  ) {
    return { monto: 0.01 };
  }
  if (slice[0] === "centavo" || slice[0] === "centavos") {
    return { monto: 0.01 };
  }

  // «un peso»
  if (
    (slice[0] === "un" || slice[0] === "uno" || slice[0] === "1") &&
    (slice[1] === "peso" || slice[1] === "pesos")
  ) {
    return { monto: 1 };
  }

  // Dígitos: 35.50 / 35,50
  if (slice[0] && /^(\d+)[.,](\d{1,2})$/.test(slice[0])) {
    const m = slice[0].match(/^(\d+)[.,](\d{1,2})$/)!;
    const enteros = Number(m[1]);
    const frac = m[2]!.padEnd(2, "0").slice(0, 2);
    return { monto: enteros + Number(frac) / 100 };
  }

  // Dígitos: 35 [pesos] [con 50]
  if (slice[0] && /^\d+$/.test(slice[0])) {
    const enteros = Number(slice[0]);
    let j = 1;
    if (slice[j] === "pesos" || slice[j] === "peso" || slice[j] === "mxn") j += 1;
    let cents = 0;
    if (slice[j] === "con") {
      const c = parseCentavosDesde(slice, j + 1);
      if (c) cents = c.cents;
    }
    return { monto: enteros + cents / 100 };
  }

  // Palabras: treinta y cinco [pesos] [con veintitres]
  const entero = consumirNumeroPalabras(slice);
  if (!entero) return null;

  let j = entero.n;
  let cents = 0;
  if (slice[j] === "pesos" || slice[j] === "peso" || slice[j] === "mxn") j += 1;
  if (slice[j] === "con") {
    const c = parseCentavosDesde(slice, j + 1);
    if (c) cents = c.cents;
  }

  if (entero.valor > 0 || cents > 0) {
    return { monto: entero.valor + cents / 100 };
  }
  return null;
}

/**
 * Interpreta una transcripción STT → monto en pesos.
 * Acepta dígitos y palabras; el monto puede ir a mitad de frase.
 */
export function parseFraseCobro(raw: string): ParseCobroResult {
  const oido = raw.trim();
  let texto = normalizar(raw);
  if (!texto) return { ok: false, mensaje: msgFallo(oido) };

  const { resto, telefono } = sacarTelefono(texto);
  texto = resto
    .replace(/\b(?:cobrale|cobra|cobrar|cobrenle|cobren)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!texto) return { ok: false, mensaje: msgFallo(oido) };

  const tokens = texto.split(" ");

  // Prueba cada posición donde podría empezar un monto (salta «quiero pagar…»).
  for (let i = 0; i < tokens.length; i++) {
    if (!esInicioNumero(tokens[i]!)) continue;
    const hit = montoDesdeTokens(tokens, i);
    if (hit && pesosValido(hit.monto)) {
      return wrap(hit.monto, telefono, oido);
    }
  }

  return { ok: false, mensaje: msgFallo(oido) };
}

function wrap(monto: number, telefono: string | undefined, oido: string): ParseCobroResult {
  if (!pesosValido(monto)) return { ok: false, mensaje: msgFallo(oido) };
  const redondeado = Math.round(monto * 100) / 100;
  return telefono
    ? { ok: true, monto: redondeado, telefono }
    : { ok: true, monto: redondeado };
}

/** Centavos enteros → dígitos del teclado («35.00» → «3500»). */
export function pesosADigitos(pesos: number): string {
  const cents = Math.round(pesos * 100);
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return String(cents);
}
