// Inbox — the email feed (/api/emails, lean) plus the classified-but-unmatched suggestions pane
// (/api/emails/suggestions). Body is quarantined server-side; the list ships snippet + category only.

import { h, clear, fmt } from '../main.js';
import type { RouteContext } from '../main.js';

interface EmailLean {
  id: string;
  account_id: string;
  from_addr: string;
  from_name: string;
  subject: string;
  snippet: string;
  sent_at: number | null;
  category: string | null;
  classified_by: string | null;
  created_at: number;
}
interface EmailsPage { rows: EmailLean[]; total: number; }

export function mountInbox(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Inbox'),
    h('span', { class: 'muted' }, 'Matched status emails and classifier suggestions')));

  const category = h('select', { class: 'select' },
    ...['', 'rejection', 'interview', 'assessment', 'offer', 'acknowledgement', 'other']
      .map((c) => h('option', { value: c }, c === '' ? 'All categories' : c))) as HTMLSelectElement;
  el.append(h('div', { class: 'page-toolbar' }, h('label', { class: 'field' }, h('span', null, 'Category'), category)));

  const feedBox = h('div', { class: 'rows' });
  const suggestBox = h('div', { class: 'rows' });
  el.append(
    h('div', { style: 'display:grid;grid-template-columns:1fr;gap:24px' },
      h('div', null, h('h2', { style: 'font-size:16px;margin:0 0 12px' }, 'Feed'), feedBox),
      h('div', null, h('h2', { style: 'font-size:16px;margin:0 0 12px' }, 'Unmatched suggestions'), suggestBox)),
  );

  function emailCard(m: EmailLean): HTMLElement {
    return h('div', { class: 'glass row-card' },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, m.subject || '(no subject)'),
        h('div', { class: 'subtitle' }, `${m.from_name || m.from_addr} · ${fmt.when(m.sent_at)}`),
        h('div', { class: 'subtitle muted' }, m.snippet)),
      m.category ? h('span', { class: 'chip' }, m.category) : null);
  }

  async function loadFeed(): Promise<void> {
    clear(feedBox);
    feedBox.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const path = `/emails?limit=100${category.value ? `&category=${encodeURIComponent(category.value)}` : ''}`;
    try {
      const page = await api.get<EmailsPage>(path);
      clear(feedBox);
      if (page.rows.length === 0) feedBox.append(h('div', { class: 'empty' }, 'No emails in this view.'));
      else for (const m of page.rows) feedBox.append(emailCard(m));
    } catch (e) {
      clear(feedBox);
      feedBox.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load emails'));
    }
  }

  async function loadSuggestions(): Promise<void> {
    clear(suggestBox);
    try {
      const { rows } = await api.get<{ rows: EmailLean[] }>('/emails/suggestions');
      if (rows.length === 0) suggestBox.append(h('div', { class: 'empty' }, 'No unmatched suggestions.'));
      else for (const m of rows) suggestBox.append(emailCard(m));
    } catch (e) {
      suggestBox.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load suggestions'));
    }
  }

  category.addEventListener('change', () => void loadFeed());
  void loadFeed();
  void loadSuggestions();
}
