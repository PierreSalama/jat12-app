// Applications — the lean list from /api/applications with a status filter. Row click opens a timeline
// drawer (/api/applications/:id/timeline → events + emails). The list ships the ApplicationLean
// projection only; the heavy timeline is fetched on drawer open (payload discipline).

import { h, clear, fmt, openDrawer } from '../main.js';
import type { RouteContext } from '../main.js';

interface ApplicationLean {
  id: string;
  job_id: string;
  profile_id: string;
  status: string;
  via: string | null;
  submitted_at: number | null;
  next_action: string | null;
  due_at: number | null;
  needs_review: number;
  created_at: number;
  updated_at: number;
}
interface AppsPage { rows: ApplicationLean[]; total: number; }

interface EventRow {
  id: string;
  at: number;
  kind: string;
  summary: string | null;
  source: string | null;
}
interface EmailLean {
  id: string;
  from_name: string;
  from_addr: string;
  subject: string;
  snippet: string;
  sent_at: number | null;
  category: string | null;
}
interface Timeline { events: { rows: EventRow[]; total: number }; emails: EmailLean[]; }

const STATUS_OPTIONS = [
  '', 'tracked', 'submitted', 'acknowledged', 'assessment',
  'interview_1', 'interview_2', 'interview_final', 'offer', 'hired', 'rejected', 'withdrawn', 'ghosted',
];

export function mountApplications(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Applications'), h('span', { class: 'muted totals' }, '')));

  const filter = h('select', { class: 'select' },
    ...STATUS_OPTIONS.map((s) => h('option', { value: s }, s === '' ? 'All statuses' : fmt.statusLabel(s)))) as HTMLSelectElement;
  el.append(h('div', { class: 'page-toolbar' }, h('label', { class: 'field' }, h('span', null, 'Status'), filter)));

  const box = h('div', { class: 'glass', style: 'overflow:auto' });
  el.append(box);

  async function load(): Promise<void> {
    clear(box);
    box.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const status = filter.value;
    const path = `/applications?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`;
    let page: AppsPage;
    try {
      page = await api.get<AppsPage>(path);
    } catch (e) {
      clear(box);
      box.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load applications'));
      return;
    }
    (el.querySelector('.totals') as HTMLElement).textContent = `${fmt.count(page.total)} total`;
    render(page.rows);
  }

  function render(rows: ApplicationLean[]): void {
    clear(box);
    if (rows.length === 0) {
      box.append(h('div', { class: 'empty' }, 'No applications match this filter.'));
      return;
    }
    const tbl = h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        h('th', null, 'Status'), h('th', null, 'Via'), h('th', null, 'Submitted'),
        h('th', null, 'Next action'), h('th', null, 'Updated'))),
    );
    const tbody = h('tbody');
    for (const a of rows) {
      tbody.append(
        h('tr', { onClick: () => openTimeline(a) },
          h('td', null, h('span', { class: `chip status-${a.status}` }, fmt.statusLabel(a.status))),
          h('td', null, a.via ?? '—'),
          h('td', null, fmt.when(a.submitted_at) || '—'),
          h('td', null, a.next_action ?? '—'),
          h('td', null, fmt.ago(a.updated_at)),
        ),
      );
    }
    tbl.append(tbody);
    box.append(tbl);
  }

  function openTimeline(a: ApplicationLean): void {
    openDrawer(`Application · ${fmt.statusLabel(a.status)}`, async () => {
      const t = await api.get<Timeline>(`/applications/${encodeURIComponent(a.id)}/timeline`);
      const body = h('div', null);

      body.append(
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Status'),
          h('span', { class: `chip status-${a.status}` }, fmt.statusLabel(a.status))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Submitted'), h('span', null, fmt.when(a.submitted_at) || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Job ID'), h('span', { class: 'mono' }, a.job_id)),
      );

      body.append(h('h3', { style: 'margin:24px 0 8px;font-size:14px' }, `Timeline (${fmt.count(t.events.total)})`));
      if (t.events.rows.length === 0) {
        body.append(h('div', { class: 'empty' }, 'No events recorded yet.'));
      } else {
        const tl = h('div', { class: 'timeline' });
        for (const ev of t.events.rows) {
          tl.append(h('div', { class: 'tl-row' },
            h('span', { class: 'when' }, fmt.when(ev.at)),
            h('span', { class: 'what' }, h('strong', null, ev.kind.replace(/_/g, ' ')),
              ev.summary ? ` — ${ev.summary}` : '')));
        }
        body.append(tl);
      }

      body.append(h('h3', { style: 'margin:24px 0 8px;font-size:14px' }, `Emails (${t.emails.length})`));
      if (t.emails.length === 0) {
        body.append(h('div', { class: 'empty' }, 'No matched emails.'));
      } else {
        const list = h('div', { class: 'rows' });
        for (const m of t.emails) {
          list.append(h('div', { class: 'glass row-card' },
            h('div', { class: 'grow' },
              h('div', { class: 'title' }, m.subject || '(no subject)'),
              h('div', { class: 'subtitle' }, `${m.from_name || m.from_addr} · ${fmt.when(m.sent_at)}`),
              h('div', { class: 'subtitle muted' }, m.snippet))));
        }
        body.append(list);
      }
      return body;
    });
  }

  filter.addEventListener('change', () => void load());
  void load();
}
