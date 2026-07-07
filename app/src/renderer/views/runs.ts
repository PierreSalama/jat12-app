// Mission Control — the live run list (/api/runs) with a state filter, and a run's step transcript
// (/api/runs/:id/steps) fetched on demand into the detail drawer. Polls while mounted so an active
// run is watchable; the poll is disposed on route change (leak discipline).

import { h, clear, fmt, openDrawer } from '../main.js';
import type { RouteContext } from '../main.js';

interface RunLean {
  id: string;
  job_id: string;
  profile_id: string;
  source: string;
  lane: string;
  state: string;
  route: string | null;
  park_kind: string | null;
  steps_count: number;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}
interface RunsPage { rows: RunLean[]; total: number; }

interface RunStep {
  run_id: string;
  seq: number;
  at: number;
  phase: string;
  action: string | null;
  target: string | null;
  detail: string | null;
  snapshot_hash: string | null;
  duration_ms: number | null;
  ok: boolean;
}

const STATE_OPTIONS = [
  '', 'queued', 'leased', 'navigating', 'classifying', 'driving', 'verifying', 'waiting_page',
  'needs_human', 'submitted', 'ready_for_review', 'parked', 'skipped', 'failed',
];

export function mountRuns(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Mission Control'),
    h('span', { class: 'muted totals' }, '')));

  const filter = h('select', { class: 'select' },
    ...STATE_OPTIONS.map((s) => h('option', { value: s }, s === '' ? 'All states' : fmt.runStateLabel(s)))) as HTMLSelectElement;
  const laneFilter = h('select', { class: 'select' },
    ...['', 'linkedin', 'indeed', 'ats'].map((l) => h('option', { value: l }, l === '' ? 'All lanes' : l))) as HTMLSelectElement;
  el.append(h('div', { class: 'page-toolbar' },
    h('label', { class: 'field' }, h('span', null, 'State'), filter),
    h('label', { class: 'field' }, h('span', null, 'Lane'), laneFilter)));

  const box = h('div', { class: 'glass', style: 'overflow:auto' });
  el.append(box);

  async function load(): Promise<void> {
    const params = new URLSearchParams({ limit: '100' });
    if (filter.value) params.set('state', filter.value);
    if (laneFilter.value) params.set('lane', laneFilter.value);
    let page: RunsPage;
    try {
      page = await api.get<RunsPage>(`/runs?${params.toString()}`);
    } catch (e) {
      clear(box);
      box.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load runs'));
      return;
    }
    (el.querySelector('.totals') as HTMLElement).textContent = `${fmt.count(page.total)} runs`;
    render(page.rows);
  }

  function render(rows: RunLean[]): void {
    clear(box);
    if (rows.length === 0) {
      box.append(h('div', { class: 'empty' }, 'No runs match this filter.'));
      return;
    }
    const tbl = h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        h('th', null, 'State'), h('th', null, 'Lane'), h('th', null, 'Source'),
        h('th', null, 'Route'), h('th', null, 'Park'), h('th', null, 'Steps'), h('th', null, 'Updated'))),
    );
    const tbody = h('tbody');
    for (const r of rows) {
      tbody.append(
        h('tr', { onClick: () => openSteps(r) },
          h('td', null, h('span', { class: 'chip' }, fmt.runStateLabel(r.state))),
          h('td', null, h('span', { class: `src-dot src-${r.lane}` }), ' ', r.lane),
          h('td', null, r.source),
          h('td', null, r.route ?? '—'),
          h('td', null, r.park_kind ? fmt.parkKindLabel(r.park_kind) : '—'),
          h('td', { class: 'num' }, String(r.steps_count)),
          h('td', null, fmt.ago(r.updated_at)),
        ),
      );
    }
    tbl.append(tbody);
    box.append(tbl);
  }

  function openSteps(r: RunLean): void {
    openDrawer(`Run · ${fmt.runStateLabel(r.state)}`, async () => {
      const { steps } = await api.get<{ steps: RunStep[] }>(`/runs/${encodeURIComponent(r.id)}/steps`);
      const body = h('div', null);
      body.append(
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Source · Lane'), h('span', null, `${r.source} · ${r.lane}`)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Route'), h('span', null, r.route ?? '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Job ID'), h('span', { class: 'mono' }, r.job_id)),
      );
      body.append(h('h3', { style: 'margin:24px 0 8px;font-size:14px' }, `Steps (${steps.length})`));
      if (steps.length === 0) {
        body.append(h('div', { class: 'empty' }, 'No steps recorded.'));
      } else {
        const list = h('div', { class: 'step-list' });
        for (const s of steps) {
          list.append(h('div', { class: `step ${s.ok ? '' : 'bad'}` },
            h('span', { class: 'phase' }, s.phase),
            h('span', null, s.action ?? ''),
            h('span', null, [s.target, s.detail].filter(Boolean).join(' · ') || '')));
        }
        body.append(list);
      }
      return body;
    });
  }

  filter.addEventListener('change', () => void load());
  laneFilter.addEventListener('change', () => void load());
  void load();
  const timer = window.setInterval(() => void load().catch(() => { /* transient */ }), 4000);
  ctx.onCleanup(() => clearInterval(timer));
}
