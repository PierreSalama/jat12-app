// Import — the v11 → v12 wizard. A source-path input (default the typical
// %APPDATA%\jat11-app\jat.db, editable) → POST /api/import/plan renders the dry-run report → an
// "Import now" button → POST /api/import/execute renders the result. Typed refusals (V11_LOCK_PRESENT,
// NOT_FOUND, UNSUPPORTED_VERSION, OPEN_FAILED) surface as a clear banner, not a stack trace.

import { h, clear, toast, fmt } from '../main.js';
import type { RouteContext, ApiClient } from '../main.js';

// mirrors app/src/main/importer/v11.ts ImportReport (only the fields the wizard renders).
interface SectionCount { found: number; toCreate: number; skippedExisting: number; }
interface ImportReport {
  source: { path: string; sha256: string; v11_user_version: number; file_bytes: number; warnings: string[] };
  profiles: SectionCount;
  jobs: SectionCount & { mergeDedup: number };
  applications: { toCreate: number; byStatus: Record<string, number> };
  answers: { fields: SectionCount & { droppedSensitive: number }; qa: SectionCount & { droppedSensitive: number } };
  documents: SectionCount & { missingFile: number; duplicateSha: number };
  emails: SectionCount & { matchesToCreate: number; matchesDroppedNoJob: number };
  events: SectionCount;
  runs: SectionCount & { submittedVerified: number; quarantinedLegacy: number; parked: number; failed: number; skipped: number; droppedInFlight: number };
  sensitiveDropped: number;
  willImport: boolean;
}
interface ExecuteResult {
  importRunId: string;
  status: 'ok' | 'partial' | 'failed';
  report: ImportReport;
  sectionErrors: { section: string; error: string }[];
}

// a plausible default; the renderer can't read env, so the user confirms/edits it.
const DEFAULT_PATH = 'C:\\Users\\%USERNAME%\\AppData\\Roaming\\jat11-app\\jat.db';

export function mountImport(el: HTMLElement, ctx: RouteContext): void {
  const { api } = ctx;

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Import from v11'),
    h('span', { class: 'muted' }, 'Carry your JAT v11 data into v12 — jobs, memory, documents, emails')));

  const pathInput = h('input', { class: 'input', value: DEFAULT_PATH, style: 'flex:1;min-width:360px' }) as HTMLInputElement;
  const planBtn = h('button', { class: 'btn primary' }, 'Preview import (dry run)') as HTMLButtonElement;
  el.append(h('div', { class: 'glass pad import-step', style: 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap' },
    h('label', { class: 'field', style: 'flex:1' }, h('span', null, 'v11 database path'), pathInput),
    planBtn));

  const note = h('p', { class: 'muted', style: 'font-size:12px' },
    'v11 must be closed during import (its database is opened read-only, but a live lock will refuse the plan).');
  el.append(note);

  const reportBox = h('div', null);
  el.append(reportBox);

  planBtn.addEventListener('click', () => {
    const path = pathInput.value.trim();
    if (!path) { toast('Enter the v11 database path', 'error'); return; }
    runPlan(api, path, reportBox, () => runExecute(api, path, reportBox));
  });

  // enter-to-plan
  pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') planBtn.click(); });
}

function runPlan(api: ApiClient, path: string, box: HTMLElement, onImportNow: () => void): void {
  clear(box);
  box.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' Reading v11 database…'));
  api.post<ImportReport>('/import/plan', { sourcePath: path })
    .then((report) => {
      clear(box);
      box.append(renderReport(report, false));
      const importBtn = h('button', { class: 'btn primary', style: 'margin-top:16px' },
        report.willImport ? 'Import now' : 'Nothing to import') as HTMLButtonElement;
      importBtn.disabled = !report.willImport;
      importBtn.addEventListener('click', onImportNow);
      box.append(importBtn);
    })
    .catch((e: unknown) => {
      clear(box);
      box.append(renderImportError(e));
    });
}

function runExecute(api: ApiClient, path: string, box: HTMLElement): void {
  clear(box);
  box.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' Importing…'));
  api.post<ExecuteResult>('/import/execute', { sourcePath: path })
    .then((result) => {
      clear(box);
      const kind = result.status === 'ok' ? 'ok' : result.status === 'partial' ? 'info' : 'danger';
      box.append(h('div', { class: `banner ${kind}` },
        `Import ${result.status} · run ${result.importRunId}`));
      if (result.sectionErrors.length > 0) {
        const errs = h('div', { class: 'rows', style: 'margin-top:12px' });
        for (const se of result.sectionErrors) {
          errs.append(h('div', { class: 'banner danger' }, `${se.section}: ${se.error}`));
        }
        box.append(errs);
      }
      box.append(renderReport(result.report, true));
      toast(`Import ${result.status}`, result.status === 'failed' ? 'error' : 'info');
    })
    .catch((e: unknown) => {
      clear(box);
      box.append(renderImportError(e));
    });
}

function renderImportError(e: unknown): HTMLElement {
  const msg = e instanceof Error ? e.message : String(e);
  // the typed refusals from the importer come through as the message; give the lock one a clear callout.
  if (/lock/i.test(msg)) {
    return h('div', { class: 'banner danger' },
      h('span', null, 'v11 appears to be running (database is locked). Close JAT v11 completely, then try again.'));
  }
  if (/not.?found/i.test(msg)) {
    return h('div', { class: 'banner danger' }, `No v11 database at that path. Check the location and try again. (${msg})`);
  }
  return h('div', { class: 'banner danger' }, `Import failed: ${msg}`);
}

function cell(n: number, label: string): HTMLElement {
  return h('div', { class: 'glass report-cell' }, h('div', { class: 'n' }, fmt.count(n)), h('div', { class: 'l' }, label));
}

function renderReport(r: ImportReport, executed: boolean): HTMLElement {
  const wrap = h('div', { style: 'margin-top:16px' });
  wrap.append(h('h2', { style: 'font-size:16px;margin:0 0 12px' }, executed ? 'Import result' : 'Dry-run report'));

  if (r.source.warnings.length > 0) {
    wrap.append(h('div', { class: 'banner info', style: 'margin-bottom:12px' }, r.source.warnings.join(' · ')));
  }

  const grid = h('div', { class: 'report-grid' });
  grid.append(
    cell(r.jobs.toCreate, executed ? 'jobs imported' : 'jobs to import'),
    cell(r.jobs.mergeDedup, 'jobs deduped'),
    cell(r.applications.toCreate, 'applications'),
    cell(r.answers.fields.toCreate, 'profile fields'),
    cell(r.answers.qa.toCreate, 'learned answers'),
    cell(r.documents.toCreate, 'documents'),
    cell(r.documents.missingFile, 'docs missing file'),
    cell(r.emails.toCreate, 'emails'),
    cell(r.emails.matchesToCreate, 'email matches'),
    cell(r.events.toCreate, 'timeline events'),
    cell(r.runs.submittedVerified, 'verified submits'),
    cell(r.runs.quarantinedLegacy, 'legacy quarantined'),
    cell(r.sensitiveDropped, 'sensitive dropped'),
  );
  wrap.append(grid);

  wrap.append(h('p', { class: 'muted', style: 'font-size:12px;margin-top:12px' },
    `Source: ${r.source.path} · v11 schema v${r.source.v11_user_version} · ${fmt.count(r.source.file_bytes)} bytes`));
  return wrap;
}
