// Overview — the funnel command strip (from /api/summary), the global Apply on/off switch
// (POST /api/apply/start|stop), recent runs (/api/runs), and the Needs-You count.

import { h, clear, fmt, toast, nav } from '../main.js';
import type { RouteContext, Summary } from '../main.js';

interface RunLean {
  id: string;
  job_id: string;
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

// the funnel stages we surface as cards, in pipeline order.
const FUNNEL_STAGES = ['submitted', 'acknowledged', 'assessment', 'interview_1', 'offer', 'hired'] as const;

export function mountOverview(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(
    h('div', { class: 'page-head' },
      h('h1', null, 'Overview'),
      h('span', { class: 'muted' }, 'Your pipeline at a glance')),
  );

  const applyCard = h('div', { class: 'glass pad', style: 'display:flex;align-items:center;gap:16px;margin-bottom:24px' });
  el.append(applyCard);

  const cards = h('div', { class: 'card-grid' });
  el.append(cards);

  el.append(h('h2', { style: 'font-size:16px;margin:32px 0 12px' }, 'Recent runs'));
  const runsBox = h('div', { class: 'glass', style: 'overflow:auto' });
  el.append(runsBox);

  // --- apply switch ---
  const swLabel = h('div', null, h('div', { class: 'title' }, 'Auto-apply'), h('div', { class: 'subtitle muted' }, '…'));
  const sw = h('div', { class: 'switch', role: 'switch', 'aria-label': 'Auto-apply' });
  let applying = false;
  let busy = false;

  async function setApply(next: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await api.post(next ? '/apply/start' : '/apply/stop');
      applying = next;
      renderSwitch();
      toast(next ? 'Auto-apply started' : 'Auto-apply paused');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to toggle', 'error');
    } finally {
      busy = false;
    }
  }
  sw.addEventListener('click', () => void setApply(!applying));

  function renderSwitch(): void {
    sw.classList.toggle('on', applying);
    (swLabel.querySelector('.subtitle') as HTMLElement).textContent = applying ? 'Running' : 'Paused';
  }
  applyCard.append(sw, swLabel);

  // --- data ---
  async function load(): Promise<void> {
    const [summary, runs] = await Promise.all([
      api.get<Summary>('/summary'),
      api.get<RunsPage>('/runs?limit=8'),
    ]);
    applying = summary.applying;
    renderSwitch();
    renderCards(summary);
    renderRuns(runs.rows);
  }

  function renderCards(s: Summary): void {
    clear(cards);
    for (const stage of FUNNEL_STAGES) {
      cards.append(
        h('div', { class: 'glass kpi' },
          h('div', { class: 'label' }, fmt.statusLabel(stage)),
          h('div', { class: 'value' }, fmt.count(s.funnel[stage] ?? 0))),
      );
    }
    const needsCard = h('div', { class: 'glass kpi', style: 'cursor:pointer', onClick: () => nav('needs-you') },
      h('div', { class: 'label' }, 'Needs you'),
      h('div', { class: `value ${s.needsYou > 0 ? 'danger' : ''}` }, fmt.count(s.needsYou)));
    cards.append(needsCard);
    cards.append(
      h('div', { class: 'glass kpi' },
        h('div', { class: 'label' }, 'Runs (24h)'),
        h('div', { class: 'value' }, fmt.count(s.runs.total))),
    );
  }

  function renderRuns(rows: RunLean[]): void {
    clear(runsBox);
    if (rows.length === 0) {
      runsBox.append(h('div', { class: 'empty' }, 'No runs yet — start auto-apply to begin.'));
      return;
    }
    const tbl = h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        h('th', null, 'State'), h('th', null, 'Lane'), h('th', null, 'Route'),
        h('th', null, 'Steps'), h('th', null, 'Updated'))),
    );
    const tbody = h('tbody');
    for (const r of rows) {
      tbody.append(
        h('tr', { onClick: () => nav('runs') },
          h('td', null, h('span', { class: 'chip' }, fmt.runStateLabel(r.state))),
          h('td', null, h('span', { class: `src-dot src-${r.lane}` }), ' ', r.lane),
          h('td', null, r.route ?? '—'),
          h('td', { class: 'num' }, String(r.steps_count)),
          h('td', null, fmt.ago(r.updated_at)),
        ),
      );
    }
    tbl.append(tbody);
    runsBox.append(tbl);
  }

  void load().catch((e: unknown) => toast(e instanceof Error ? e.message : 'Failed to load overview', 'error'));

  // refresh recent runs on an interval while this page is mounted
  const timer = window.setInterval(() => void load().catch(() => { /* transient */ }), 6000);
  ctx.onCleanup(() => clearInterval(timer));
}
