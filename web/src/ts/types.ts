/** Contratos de cobro / eventos (Rafael PASO 2 + DIVISION §4). */

export type Canal = "qr" | "push" | "voz";

export type EstadoCobro =
  | "pendiente"
  | "pagado"
  | "entregado"
  | "expirado"
  | "tardio"
  | "error";

/** Vista de la pantalla del cajero (incluye idle / sin conexión). */
export type VistaCaja =
  | "idle"
  | "creando"
  | EstadoCobro
  | "sin_conexion";

export interface CobroCreado {
  id: string;
  estado: EstadoCobro;
  monto: number;
  canal: Canal;
  qrImage?: string;
  expiraEn?: string;
  concepto?: string;
}

export interface CobroDetalle extends CobroCreado {
  creadoEn?: string;
  montoPagado?: number;
  pagadoEn?: string;
  rastreoTerminacion?: string;
  transactionId?: string;
  entregadoEn?: string;
  mensajeError?: string;
}

export interface EventoPagado {
  id: string;
  monto: number;
  hora: string;
  rastreoTerminacion: string;
  transactionId: string;
}

export interface EventoTardio {
  id: string;
  monto: number;
  rastreoTerminacion?: string;
}

export interface EventoError {
  id: string;
  mensaje: string;
}

export interface EventoEntregado {
  id: string;
  entregadoEn: string;
}

export type EventoServidor =
  | { tipo: "creado"; data: CobroCreado }
  | { tipo: "pagado"; data: EventoPagado }
  | { tipo: "expirado"; data: { id: string } }
  | { tipo: "tardio"; data: EventoTardio }
  | { tipo: "error"; data: EventoError }
  | { tipo: "entregado"; data: EventoEntregado };

export interface CrearCobroBody {
  monto: number;
  concepto: string;
  canal: Canal;
  telefono?: string;
}
