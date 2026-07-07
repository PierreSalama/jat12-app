// Needs-You Inbox — /api/needs-you returns { needsHuman, readyForReview }. Walls (needsHuman) are
// grouped by park kind: captcha/login/cloudflare/account_wall are honest parks (open-in-browser, no
// auto-solve); a needs_answer run gets an inline answer form → POST /api/runs/:id/answer which writes
// the answer to per-profile memory and re-queues the run. readyForReview cards offer a Confirm.

import { h, clear, fmt, toast } from '../main.js';
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
interface NeedsYou { needsHuman: RunLean[]; readyForReview: RunLean[]; }

// which park kinds are answerable inline vs. honest walls the user must clear in a real browser tab.
const ANSWERABLE = new Set(['needs_answer', 'resume_required']);

export function mountNeedsYou(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Needs You'),
    h('span', { class: 'muted' }, 'Answer what the engine got stuck on')));

  const container = h('div', null);
  el.append(container);

  async function load(): Promise<void> {
    clear(container);
    container.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    let data: NeedsYou;
    try {
      data = await api.get<NeedsYou>('/needs-you');
    } catch (e) {
      clear(container);
      container.append(h('div', { class: 'banner danger' }, e instanceof Error ? e.message : 'Failed to load'));
      return;
    }
    clear(container);
    if (data.needsHuman.length === 0 && data.readyForReview.length === 0) {
      container.append(h('div', { class: 'empty' }, 'Nothing needs you right now. 🎉'));
      return;
    }

    // group walls by park kind
    const byKind = new Map<string, RunLean[]>();
    for (const r of data.needsHuman) {
      const k = r.park_kind ?? 'other';
      const bucket = byKind.get(k);
      if (bucket) bucket.push(r);
      else byKind.set(k, [r]);
    }

    for (const [kind, runs] of byKind) {
      const group = h('div', { class: 'needs-group' }, h('h3', null, `${fmt.parkKindLabel(kind)} · ${runs.length}`));
      for (const r of runs) group.append(renderWall(r, kind));
      container.append(group);
    }

    if (data.readyForReview.length > 0) {
      const group = h('div', { class: 'needs-group' }, h('h3', null, `Ready for review · ${data.readyForReview.length}`));
      for (const r of data.readyForReview) group.append(renderReview(r));
      container.append(group);
    }
  }

  function renderWall(r: RunLean, kind: string): HTMLElement {
    const card = h('div', { class: 'glass qcard' });
    card.append(
      h('div', { class: 'q' }, `${r.source} · ${r.lane}`),
      h('div', { class: 'meta' }, `Run ${r.id} · parked ${fmt.ago(r.updated_at)}`),
    );

    if (ANSWERABLE.has(kind)) {
      card.append(renderAnswerForm(r));
    } else {
      // honest park: a real wall the user clears in a browser tab. No auto-solve affordance.
      card.append(h('div', { class: 'banner info' },
        h('span', null, `This is a ${fmt.parkKindLabel(kind)}. Open the site and clear it yourself — the engine will not solve it.`)));
    }
    return card;
  }

  function renderAnswerForm(r: RunLean): HTMLElement {
    const labelInput = h('input', { class: 'input', placeholder: 'Question / field label', style: 'flex:1;min-width:200px' }) as HTMLInputElement;
    const valueInput = h('input', { class: 'input', placeholder: 'Your answer', style: 'flex:1;min-width:160px' }) as HTMLInputElement;
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Answer & re-queue');

    const form = h('form', null, labelInput, valueInput, submit) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const label = labelInput.value.trim();
      const value = valueInput.value.trim();
      if (!label || !value) {
        toast('Enter both a label and an answer', 'error');
        return;
      }
      (submit as HTMLButtonElement).disabled = true;
      api.post(`/runs/${encodeURIComponent(r.id)}/answer`, {
        answers: [{ profileId: r.profile_id, label, value, kind: 'qa' }],
      })
        .then(() => {
          toast('Answer saved to memory — run re-queued');
          void load();
        })
        .catch((err: unknown) => {
          (submit as HTMLButtonElement).disabled = false;
          toast(err instanceof Error ? err.message : 'Failed to submit answer', 'error');
        });
    });
    return form;
  }

  function renderReview(r: RunLean): HTMLElement {
    const confirm = h('button', { class: 'btn' }, 'Confirm submitted');
    confirm.addEventListener('click', () => {
      // ready_for_review runs are usually already-submitted; the answer endpoint re-queues (no-op
      // answers) so the run leaves the queue. This mirrors the "Confirm submitted" habit.
      (confirm as HTMLButtonElement).disabled = true;
      api.post(`/runs/${encodeURIComponent(r.id)}/answer`, { answers: [] })
        .then(() => { toast('Marked reviewed'); void load(); })
        .catch((e: unknown) => {
          (confirm as HTMLButtonElement).disabled = false;
          toast(e instanceof Error ? e.message : 'Failed', 'error');
        });
    });
    return h('div', { class: 'glass qcard' },
      h('div', { class: 'q' }, `${r.source} · ${r.lane}`),
      h('div', { class: 'meta' }, `Run ${r.id} · ${fmt.ago(r.updated_at)}`),
      h('div', null, confirm));
  }

  void load();
  const timer = window.setInterval(() => void load().catch(() => { /* transient */ }), 8000);
  ctx.onCleanup(() => clearInterval(timer));
}
