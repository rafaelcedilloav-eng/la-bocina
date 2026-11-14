/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** Bearer para POSTs al server de Rafael (`lbk_…`). GET/SSE sin header. */
  readonly VITE_API_TOKEN?: string;
  readonly VITE_USE_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
