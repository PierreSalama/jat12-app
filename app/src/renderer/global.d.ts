// Ambient declaration of the preload bridge (`window.jat12`). The sandboxed renderer reaches the main
// process ONLY through this surface — it mirrors app/src/preload/preload.ts exactly. Kept in sync by
// hand (the preload is CJS, so it can't share a type module with the ESM renderer without a build hop).

export interface Jat12Config {
  /** loopback port the Hono REST + /drive server listens on (7845 prod, 7846 dev). */
  port: number;
  /** the pairing token — sent as the `authHeader` on every /api request. */
  token: string;
  /** app.getVersion() — shown in the statusbar. */
  version: string;
  /** dev build flag (drives the dev-only affordances). */
  dev: boolean;
}

export interface Jat12Ping {
  ok: boolean;
  version: string;
}

export interface Jat12Bridge {
  /** wire protocol version (a mismatch surfaces a skew banner rather than silent corruption). */
  readonly protocol: number;
  /** "JAT 12" — the product name. */
  readonly productName: string;
  /** the request header the token rides on: "X-JAT12-Token". */
  readonly authHeader: string;
  /** resolve the loopback config (port + token + version) the renderer needs to call the API. */
  config(): Promise<Jat12Config>;
  /** a cheap liveness probe against the main process. */
  ping(): Promise<Jat12Ping>;
}

declare global {
  interface Window {
    readonly jat12: Jat12Bridge;
  }
}

export {};
