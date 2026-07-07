// Documents — /api/documents returns { rows: DocumentLean[] }. Grid of resumes/cover letters with
// role, default star, size, source, and missing-file state. Read-only at launch scope.

import { h, clear, fmt } from '../main.js';
import type { RouteContext } from '../main.js';

interface DocumentLean {
  id: string;
  profile_id: string | null;
  name: string;
  role: string;
  label: string | null;
  mime: string | null;
  size_bytes: number;
  sha256: string | null;
  is_default: boolean;
  source: string;
  origin_path: string | null;
  missing_file: boolean;
  created_at: number;
  updated_at: number;
}

function humanBytes(n: number): string {
  if (n <= 0) return '—';
  const u = ['B', 'KB', 'MB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function mountDocuments(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Documents'),
    h('span', { class: 'muted' }, 'Resumes and cover letters')));

  const grid = h('div', { class: 'card-grid' });
  el.append(grid);

  async function load(): Promise<void> {
    clear(grid);
    grid.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    let data: { rows: DocumentLean[] };
    try {
      data = await api.get<{ rows: DocumentLean[] }>('/documents');
    } catch (e) {
      clear(grid);
      grid.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load documents'));
      return;
    }
    clear(grid);
    if (data.rows.length === 0) {
      grid.append(h('div', { class: 'empty' }, 'No documents yet.'));
      return;
    }
    for (const d of data.rows) {
      grid.append(
        h('div', { class: 'glass pad', style: 'display:flex;flex-direction:column;gap:8px' },
          h('div', { style: 'display:flex;align-items:center;gap:8px' },
            h('span', { class: 'title', style: 'font-weight:600' }, d.name),
            d.is_default ? h('span', { class: 'chip status-offer', title: 'Default for its role' }, '★ default') : null),
          h('div', { class: 'muted', style: 'font-size:12px' }, `${d.role.replace(/_/g, ' ')} · ${humanBytes(d.size_bytes)}`),
          h('div', { class: 'muted', style: 'font-size:12px' }, `source: ${d.source} · updated ${fmt.ago(d.updated_at)}`),
          d.missing_file ? h('div', { class: 'banner danger', style: 'font-size:12px' }, 'File missing on disk (metadata only)') : null),
      );
    }
  }

  void load();
}
