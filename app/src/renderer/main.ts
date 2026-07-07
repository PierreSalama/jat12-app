// Aurora renderer entry — the vanilla-ESM SPA. On load it resolves the loopback config over the
// preload bridge, builds a token-authed `api()` helper, mounts a left-nav shell + hash router, and
// polls /api/summary for the topbar funnel + applying toggle. No framework: a tiny hyperscript helper
// (`h`) + per-page mount/unmount modules. Everything talks to the Hono REST API on 127.0.0.1.

import { mountOverview } from './views/overview.js';
import { mountApplications } from './views/applications.js';
import { mountNeedsYou } from './views/needs-you.js';
import { mountRuns } from './views/runs.js';
import { mountDocuments } from './views/documents.js';
import { mountInbox } from './views/inbox.js';
import { mountSettings } from './views/settings.js';
import { mountImport } from './views/import.js';

// ---------------------------------------------------------------------------
// hyperscript — the one DOM builder the whole renderer uses.
// ---------------------------------------------------------------------------

type Child = Node | string | number | null | undefined | false;

/** Attribute/prop bag: `class`/`className`, `on*` event handlers, `dataset`, and plain attributes. */
export interface Props {
  class?: string;
  className?: string;
  id?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  disabled?: boolean;
  style?: string;
  dataset?: Record<string, string>;
  [key: string]: unknown;
}

/** Create an element. `h('div', {class:'x'}, child, child)`. Event props are `onClick`, `onInput`, … */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = String(v);
      else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' || k === 'disabled' || k === 'checked') {
        // reflect these onto the DOM property (attributes don't drive form state reliably)
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  el.append(...flatten(children));
  return el;
}

function flatten(children: Child[]): Array<Node | string> {
  const out: Array<Node | string> = [];
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    out.push(typeof c === 'number' ? String(c) : c);
  }
  return out;
}

/** Replace all children of a container in one shot. */
export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

// ---------------------------------------------------------------------------
// api helper — token-authed fetch against the loopback brain.
// ---------------------------------------------------------------------------

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  base: string;
}

/** Build the api client from the resolved config. Every call carries the pairing token header and
 *  times out at 10s; non-2xx responses reject with an Error carrying the parsed `error`/`message`. */
export function makeApi(port: number, token: string, authHeader: string): ApiClient {
  const base = `http://127.0.0.1:${port}/api`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const init: RequestInit = {
        method,
        headers: { [authHeader]: token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        signal: ctrl.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(base + path, init);
      const text = await res.text();
      const data: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = data as { error?: string; message?: string } | null;
        throw new Error(err?.message ?? err?.error ?? `${method} ${path} → ${res.status}`);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    base,
    get: <T>(p: string) => call<T>('GET', p),
    post: <T>(p: string, b?: unknown) => call<T>('POST', p, b),
    put: <T>(p: string, b?: unknown) => call<T>('PUT', p, b),
  };
}

// ---------------------------------------------------------------------------
// toast + drawer singletons (imperative, no framework state).
// ---------------------------------------------------------------------------

let toastStack: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (!toastStack) {
    toastStack = h('div', { class: 'toast-stack' });
    document.body.append(toastStack);
  }
  const el = h('div', { class: `toast ${kind}` }, message);
  toastStack.append(el);
  const ttl = kind === 'error' ? 7000 : 4000;
  setTimeout(() => el.remove(), ttl);
}

/** Open the right-hand detail drawer with a title and a body node (or a promise resolving to one). */
export function openDrawer(title: string, bodyOrLoader: Node | (() => Promise<Node>)): void {
  closeDrawer();
  const scrim = h('div', { class: 'drawer-scrim', onClick: closeDrawer });
  const body = h('div', { class: 'drawer-body' });
  const drawer = h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-label': title },
    h(
      'div',
      { class: 'drawer-head' },
      h('h2', null, title),
      h('button', { class: 'btn ghost drawer-close', onClick: closeDrawer, title: 'Close (Esc)' }, '✕'),
    ),
    body,
  );
  scrim.dataset.drawer = '1';
  drawer.dataset.drawer = '1';
  document.body.append(scrim, drawer);

  if (typeof bodyOrLoader === 'function') {
    body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    bodyOrLoader()
      .then((node) => {
        clear(body);
        body.append(node);
      })
      .catch((e: unknown) => {
        clear(body);
        body.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load'));
      });
  } else {
    body.append(bodyOrLoader);
  }
}

export function closeDrawer(): void {
  for (const el of Array.from(document.querySelectorAll('[data-drawer]'))) el.remove();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// ---------------------------------------------------------------------------
// formatting — one place for dates/counts/labels (mirrors the shared status contract's labels).
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  tracked: 'Tracked', submitted: 'Submitted', acknowledged: 'Acknowledged', assessment: 'Assessment',
  interview_1: 'Interview 1', interview_2: 'Interview 2', interview_final: 'Final interview',
  offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn', ghosted: 'Ghosted',
};

const RUN_STATE_LABELS: Record<string, string> = {
  queued: 'Queued', leased: 'Leased', navigating: 'Navigating', classifying: 'Reading page',
  driving: 'Driving form', verifying: 'Verifying submit', waiting_page: 'Waiting for page',
  needs_human: 'Needs you', submitted: 'Submitted', ready_for_review: 'Ready for review',
  parked: 'Parked', skipped: 'Skipped', failed: 'Failed',
};

const PARK_KIND_LABELS: Record<string, string> = {
  needs_answer: 'Needs an answer', resume_required: 'Résumé needed', captcha: 'CAPTCHA — you solve it',
  cloudflare: 'Cloudflare wall — you clear it', login: 'Sign-in needed', account_wall: 'Account required',
  awaiting_review: 'Ready for review', external_redirect: 'External site', rate_limited: 'Rate limited',
  other: 'Parked',
};

export const fmt = {
  statusLabel: (s: string): string => STATUS_LABELS[s] ?? s,
  runStateLabel: (s: string): string => RUN_STATE_LABELS[s] ?? s,
  parkKindLabel: (s: string): string => PARK_KIND_LABELS[s] ?? s,
  count: (n: number): string => new Intl.NumberFormat().format(n),
  /** epoch-ms → short local date-time; blank for null/0. */
  when(ts: number | null | undefined): string {
    if (!ts) return '';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },
  /** epoch-ms → relative "3m ago"/"2h ago"; blank for null. */
  ago(ts: number | null | undefined): string {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
  },
};

// ---------------------------------------------------------------------------
// shared response types (lean projections the API ships; snake_case per the DAL contract).
// ---------------------------------------------------------------------------

export interface Summary {
  funnel: Record<string, number>;
  runs: { byState: Record<string, number>; total: number };
  needsYou: number;
  applying: boolean;
}

export interface RouteContext {
  api: ApiClient;
  /** register a cleanup fn to run on route change (dispose timers/intervals). */
  onCleanup(fn: () => void): void;
}

type PageMount = (el: HTMLElement, ctx: RouteContext) => void;

interface RouteDef {
  path: string;
  label: string;
  icon: string;
  mount: PageMount;
}

const ROUTES: RouteDef[] = [
  { path: 'overview', label: 'Overview', icon: '◎', mount: mountOverview },
  { path: 'applications', label: 'Applications', icon: '▤', mount: mountApplications },
  { path: 'needs-you', label: 'Needs You', icon: '✋', mount: mountNeedsYou },
  { path: 'runs', label: 'Mission Control', icon: '⚡', mount: mountRuns },
  { path: 'documents', label: 'Documents', icon: '▢', mount: mountDocuments },
  { path: 'inbox', label: 'Inbox', icon: '✉', mount: mountInbox },
  { path: 'settings', label: 'Settings', icon: '⚙', mount: mountSettings },
  { path: 'import', label: 'Import', icon: '⇩', mount: mountImport },
];

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const cfg = await window.jat12.config();
  const api = makeApi(cfg.port, cfg.token, window.jat12.authHeader);

  const app = document.getElementById('app');
  if (!app) return;
  clear(app);

  // --- shell scaffold ---
  const rail = h('nav', { class: 'shell-rail' });
  const topbar = h('header', { class: 'shell-topbar' });
  const content = h('main', { class: 'shell-content' });
  const statusbar = h('footer', { class: 'shell-statusbar' });
  const shell = h('div', { class: 'shell' }, rail, topbar, content, statusbar);
  app.append(shell);

  // --- rail links ---
  rail.append(h('div', { class: 'rail-brand' }, 'JAT 12'));
  const needsBadge = h('span', { class: 'badge', style: 'display:none' });
  const railLinks = new Map<string, HTMLElement>();
  for (const r of ROUTES) {
    const link = h(
      'a',
      { class: 'rail-link', href: `#/${r.path}` },
      h('span', { class: 'ico' }, r.icon),
      h('span', null, r.label),
      r.path === 'needs-you' ? needsBadge : null,
    );
    railLinks.set(r.path, link);
    rail.append(link);
  }

  // --- topbar: title, run pill, token dot ---
  const topTitle = h('span', { class: 'topbar-title' }, 'Overview');
  const runDot = h('span', { class: 'state-dot' });
  const runLabel = h('span', null, 'Paused');
  const runPill = h(
    'button',
    { class: 'run-pill', title: 'Auto-apply state — click to open Mission Control', onClick: () => nav('runs') },
    runDot,
    runLabel,
  );
  const tokenDot = h('span', { class: 'token-dot', title: 'Token health' });
  topbar.append(topTitle, h('span', { class: 'topbar-spacer' }), runPill, tokenDot);

  // --- statusbar ---
  const sseMode = h('span', null, `brain · 127.0.0.1:${cfg.port}`);
  const versionChip = h('span', null, `v${cfg.version}${cfg.dev ? ' (dev)' : ''}`);
  statusbar.append(sseMode, h('span', { class: 'topbar-spacer' }), versionChip);

  // --- summary poller (topbar funnel + applying toggle) ---
  async function pollSummary(): Promise<void> {
    try {
      const s = await api.get<Summary>('/summary');
      runDot.className = `state-dot ${s.applying ? 'ok' : ''}`;
      runLabel.textContent = s.applying ? 'Applying' : 'Paused';
      if (s.needsYou > 0) {
        needsBadge.textContent = String(s.needsYou);
        needsBadge.style.display = '';
      } else {
        needsBadge.style.display = 'none';
      }
    } catch {
      runDot.className = 'state-dot danger';
      runLabel.textContent = 'Offline';
    }
  }

  // token health drives the topbar dot
  async function pollTokens(): Promise<void> {
    try {
      const { rows } = await api.get<{ rows: Array<{ status: string }> }>('/secrets/health');
      const anyDead = rows.some((r) => r.status === 'revoked');
      const anyExpiring = rows.some((r) => r.status === 'expired');
      tokenDot.className = `token-dot ${anyDead ? 'danger' : anyExpiring ? 'warn' : rows.length ? 'ok' : ''}`;
    } catch {
      tokenDot.className = 'token-dot';
    }
  }

  void pollSummary();
  void pollTokens();
  const summaryTimer = window.setInterval(() => void pollSummary(), 4000);
  const tokenTimer = window.setInterval(() => void pollTokens(), 30_000);
  window.addEventListener('beforeunload', () => {
    clearInterval(summaryTimer);
    clearInterval(tokenTimer);
  });

  // --- router ---
  let cleanups: Array<() => void> = [];

  function renderRoute(): void {
    // dispose the previous page
    for (const fn of cleanups) {
      try { fn(); } catch { /* a page's cleanup must never break navigation */ }
    }
    cleanups = [];
    closeDrawer();

    const path = (location.hash.replace(/^#\//, '') || 'overview').split('?')[0] ?? 'overview';
    const def = ROUTES.find((r) => r.path === path) ?? ROUTES[0]!;

    for (const [p, link] of railLinks) link.classList.toggle('active', p === def.path);
    topTitle.textContent = def.label;

    clear(content);
    const pageEl = h('section', { class: 'page' });
    content.append(pageEl);

    const ctx: RouteContext = { api, onCleanup: (fn) => cleanups.push(fn) };
    try {
      def.mount(pageEl, ctx);
    } catch (e) {
      clear(pageEl);
      pageEl.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Page failed to render'));
    }
  }

  window.addEventListener('hashchange', renderRoute);
  if (!location.hash) location.hash = '#/overview';
  renderRoute();
}

/** Programmatic navigation used by the run pill + cross-page links. */
export function nav(path: string): void {
  location.hash = `#/${path}`;
}

boot().catch((e: unknown) => {
  const app = document.getElementById('app');
  if (app) {
    clear(app);
    app.append(
      h('div', { class: 'page' }, h('div', { class: 'banner danger' },
        `Failed to reach the app brain: ${e instanceof Error ? e.message : String(e)}`)),
    );
  }
});
