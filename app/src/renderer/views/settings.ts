// Settings — renders the full settings snapshot (/api/settings) as editable rows, PUTs each change to
// /api/settings/:section/:key, shows token health (/api/secrets/health) and installed adapters
// (/api/adapters), and drives the theme switch (persisted to appearance.theme). The theme enum in the
// shared settings contract is {aurora,light,dark,system}; each maps to a concrete CSS data-theme so the
// PUT stays valid against the server-side validator (we never invent enum values it would reject).

import { h, clear, toast, fmt } from '../main.js';
import type { RouteContext } from '../main.js';

type SettingsSnapshot = Record<string, Record<string, unknown>>;

interface SecretHealth {
  key: string;
  status: string;
  last_ok_at: number | null;
  last_error: string | null;
  expires_hint_at: number | null;
}

interface AdapterRow {
  id: string;
  version: number;
  source: string;
  hosts: string[];
  priority: number;
  pages: number;
}

// the four theme enum values the contract allows → the CSS data-theme they render as.
const THEME_TO_CSS: Record<string, string> = {
  aurora: 'aurora',
  dark: 'aurora',
  light: 'arctic-light',
  system: 'aurora',
};
const THEME_CHOICES = ['aurora', 'dark', 'light', 'system'];

// representative preview gradients per CSS theme (inline styles can't read another theme's scoped vars).
function swatchBar(cssTheme: string): string {
  const map: Record<string, string> = {
    aurora: 'linear-gradient(120deg,#89b4fa,#cba6f7,#f5c2e7)',
    'arctic-light': 'linear-gradient(120deg,#2f6fd6,#22b8cf,#7048e8)',
  };
  return `background:${map[cssTheme] ?? map.aurora}`;
}

export function applyTheme(theme: string): void {
  const css = theme === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'arctic-light' : 'aurora')
    : (THEME_TO_CSS[theme] ?? 'aurora');
  document.documentElement.dataset.theme = css;
}

export function mountSettings(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Settings'),
    h('span', { class: 'muted' }, 'Tokens, caps, pacing, appearance')));

  const nav = h('div', { class: 'settings-nav' });
  const panel = h('div', { class: 'settings-section' });
  el.append(h('div', { class: 'settings-grid' }, nav, panel));

  let snapshot: SettingsSnapshot = {};

  const SECTIONS: Array<{ id: string; label: string; render: () => void }> = [
    { id: 'appearance', label: 'Appearance', render: renderAppearance },
    { id: 'autoApply', label: 'Auto-apply', render: () => renderSection('autoApply') },
    { id: 'discovery', label: 'Discovery', render: () => renderSection('discovery') },
    { id: 'ai', label: 'AI', render: () => renderSection('ai') },
    { id: 'gmail', label: 'Gmail', render: () => renderSection('gmail') },
    { id: 'goals', label: 'Goals', render: () => renderSection('goals') },
    { id: 'notifications', label: 'Notifications', render: () => renderSection('notifications') },
    { id: 'tokens', label: 'Tokens', render: renderTokens },
    { id: 'adapters', label: 'Adapters', render: renderAdapters },
  ];

  let active = SECTIONS[0]!.id;
  for (const s of SECTIONS) {
    const btn = h('button', { class: `btn ghost ${s.id === active ? 'active' : ''}`, dataset: { sec: s.id } }, s.label);
    btn.addEventListener('click', () => {
      active = s.id;
      for (const b of Array.from(nav.querySelectorAll('button'))) {
        (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.sec === active);
      }
      s.render();
    });
    nav.append(btn);
  }

  async function put(section: string, key: string, value: unknown): Promise<void> {
    try {
      await api.put(`/settings/${section}/${key}`, { value });
      if (!snapshot[section]) snapshot[section] = {};
      snapshot[section]![key] = value;
      toast(`Saved ${section}.${key}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save', 'error');
      throw e;
    }
  }

  // ---- generic section editor (drives every knob by its runtime value type) ----
  function renderSection(section: string): void {
    clear(panel);
    const sec = snapshot[section] ?? {};
    const keys = Object.keys(sec);
    if (keys.length === 0) {
      panel.append(h('div', { class: 'empty' }, 'No settings in this section.'));
      return;
    }
    for (const key of keys) {
      panel.append(renderKnob(section, key, sec[key]));
    }
  }

  function renderKnob(section: string, key: string, value: unknown): HTMLElement {
    const control = editorFor(section, key, value);
    return h('div', { class: 'kv' }, h('span', { class: 'k' }, key), control);
  }

  function editorFor(section: string, key: string, value: unknown): HTMLElement {
    if (typeof value === 'boolean') {
      const sw = h('div', { class: `switch ${value ? 'on' : ''}`, role: 'switch' });
      let cur = value;
      sw.addEventListener('click', () => {
        const next = !cur;
        put(section, key, next).then(() => { cur = next; sw.classList.toggle('on', cur); }).catch(() => { /* toast shown */ });
      });
      return sw;
    }
    if (typeof value === 'number') {
      const inp = h('input', { class: 'input', type: 'number', value: String(value), style: 'width:120px' }) as HTMLInputElement;
      inp.addEventListener('change', () => {
        const n = Number(inp.value);
        if (Number.isFinite(n)) void put(section, key, n).catch(() => { inp.value = String(value); });
      });
      return inp;
    }
    if (Array.isArray(value)) {
      const inp = h('input', { class: 'input', value: value.join(', '), style: 'width:280px', placeholder: 'comma, separated' }) as HTMLInputElement;
      inp.addEventListener('change', () => {
        const arr = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
        void put(section, key, arr).catch(() => { inp.value = (value as string[]).join(', '); });
      });
      return inp;
    }
    // string / enum → plain text field
    const inp = h('input', { class: 'input', value: String(value ?? ''), style: 'width:280px' }) as HTMLInputElement;
    inp.addEventListener('change', () => void put(section, key, inp.value).catch(() => { inp.value = String(value ?? ''); }));
    return inp;
  }

  // ---- appearance: the theme switch (persisted, applied live) ----
  function renderAppearance(): void {
    clear(panel);
    const current = String(snapshot.appearance?.theme ?? 'aurora');
    panel.append(h('p', { class: 'muted', style: 'margin:0' }, 'Choose a theme — applied instantly and remembered.'));
    const grid = h('div', { class: 'theme-grid' });
    for (const t of THEME_CHOICES) {
      const cssTheme = t === 'system' ? 'aurora' : (THEME_TO_CSS[t] ?? 'aurora');
      const swatch = h('div', { class: `theme-swatch glass ${t === current ? 'active' : ''}`, dataset: { theme: t } },
        h('div', { class: 'bar', style: swatchBar(cssTheme) }),
        h('span', null, t));
      swatch.addEventListener('click', () => {
        applyTheme(t);
        void put('appearance', 'theme', t)
          .then(() => renderAppearance())
          .catch(() => { /* toast shown; keep applied theme optimistic */ });
      });
      grid.append(swatch);
    }
    panel.append(grid);
  }

  // ---- token health ----
  async function renderTokens(): Promise<void> {
    clear(panel);
    panel.append(h('p', { class: 'muted', style: 'margin:0' }, 'Connected credentials and their health.'));
    try {
      const { rows } = await api.get<{ rows: SecretHealth[] }>('/secrets/health');
      if (rows.length === 0) {
        panel.append(h('div', { class: 'empty' }, 'No credentials stored yet.'));
        return;
      }
      for (const s of rows) {
        const dotClass = s.status === 'ok' ? 'ok' : s.status === 'expired' ? 'warn' : s.status === 'revoked' ? 'danger' : '';
        panel.append(h('div', { class: 'kv' },
          h('span', { class: 'k' }, h('span', { class: `token-dot ${dotClass}` }), ' ', s.key),
          h('span', null,
            h('span', { class: 'chip' }, s.status),
            s.last_ok_at ? h('span', { class: 'muted', style: 'margin-left:8px;font-size:12px' }, `ok ${fmt.ago(s.last_ok_at)}`) : null,
            s.last_error ? h('div', { class: 'subtitle muted', style: 'font-size:12px' }, s.last_error) : null)));
      }
    } catch (e) {
      panel.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load token health'));
    }
  }

  // ---- adapters ----
  async function renderAdapters(): Promise<void> {
    clear(panel);
    try {
      const { rows } = await api.get<{ rows: AdapterRow[] }>('/adapters');
      if (rows.length === 0) {
        panel.append(h('div', { class: 'empty' }, 'No adapters installed.'));
        return;
      }
      const box = h('div', { class: 'glass', style: 'overflow:auto' });
      const tbl = h('table', { class: 'tbl' },
        h('thead', null, h('tr', null,
          h('th', null, 'Adapter'), h('th', null, 'Version'), h('th', null, 'Source'),
          h('th', null, 'Priority'), h('th', null, 'Hosts'), h('th', null, 'Pages'))));
      const tbody = h('tbody');
      for (const a of rows) {
        tbody.append(h('tr', null,
          h('td', null, a.id),
          h('td', { class: 'num' }, String(a.version)),
          h('td', null, a.source),
          h('td', { class: 'num' }, String(a.priority)),
          h('td', { class: 'mono', style: 'font-size:11px' }, a.hosts.join(', ')),
          h('td', { class: 'num' }, String(a.pages))));
      }
      tbl.append(tbody);
      box.append(tbl);
      panel.append(box);
    } catch (e) {
      panel.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load adapters'));
    }
  }

  // boot: load the snapshot, apply the persisted theme, render the first section.
  async function boot(): Promise<void> {
    try {
      snapshot = await api.get<SettingsSnapshot>('/settings');
      applyTheme(String(snapshot.appearance?.theme ?? 'aurora'));
      SECTIONS[0]!.render();
    } catch (e) {
      clear(panel);
      panel.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load settings'));
    }
  }

  void boot();
}
