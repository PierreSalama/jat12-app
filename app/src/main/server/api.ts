// The REST API the Aurora UI + the extension popup call. Loopback-only; every /api route except the
// pairing hand-off requires the X-JAT12-Token header. Read routes are lean DAL projections (payload
// discipline); control routes drive the run-service + importer. PatchBus (live push over /drive) is
// layered on top later — these are the request/response surface.
import { Hono } from 'hono';
import { IDENTITY, PROTOCOL_VERSION } from '@jat12/shared';
import type { Dal } from '../db/dal/index.js';
import type { RunService } from '../engine/run-service.js';
import type { Registry } from '../adapters/registry.js';
import { planImport, executeImport } from '../importer/v11.js';

export interface ApiDeps {
  dal: Dal;
  runService: RunService;
  registry: Registry;
  token: string;
  version: string;
  /** mount extra routes on the AUTHED /api sub-app (e.g. the Gmail routes). */
  extend?: (api: Hono) => void;
  /** override the "is v11 running?" gate (tests inject a deterministic stub). */
  v11Probe?: () => Promise<boolean>;
}

function intParam(v: string | undefined, def: number): number {
  const n = v === undefined ? def : Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Live-process gate (plan §5.1): a running v11 answers on :7744; importing then could read a
 *  half-written snapshot. Belt to the importer's lock-dir suspenders. */
async function v11IsRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:7744/health', { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export function mountApi(app: Hono, deps: ApiDeps): void {
  const { dal, runService, registry } = deps;

  // --- public: the loopback pairing hand-off (extension popup fetches the token on a user click) ---
  const pub = new Hono();
  pub.get('/pair/token', (c) =>
    c.json({ token: deps.token, productName: IDENTITY.productName, version: deps.version, protocol: PROTOCOL_VERSION }),
  );
  app.route('/api', pub);

  // --- protected: everything else ---
  const api = new Hono();
  api.use('*', async (c, next) => {
    if (c.req.header(IDENTITY.authHeader) !== deps.token) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  api.get('/version', (c) => c.json({ version: deps.version, protocol: PROTOCOL_VERSION }));

  api.get('/summary', (c) =>
    c.json({
      funnel: dal.applications.funnel({ days: 90 }),
      runs: dal.runs.stats({ hours: 24 }),
      needsYou: dal.runs.listLean({ state: 'needs_human', limit: 200 }).total,
      applying: runService.isRunning(),
    }),
  );

  api.get('/jobs', (c) => {
    const q = c.req.query();
    const p: NonNullable<Parameters<typeof dal.jobs.listLean>[0]> = { limit: intParam(q.limit, 100), offset: intParam(q.offset, 0) };
    if (q.source) p.source = q.source;
    if (q.q) p.q = q.q;
    return c.json(dal.jobs.listLean(p));
  });
  api.get('/jobs/:id', (c) => {
    const d = dal.jobs.getDetail(c.req.param('id'));
    return d ? c.json(d) : c.json({ error: 'not_found' }, 404);
  });

  api.get('/applications', (c) => {
    const q = c.req.query();
    const p: NonNullable<Parameters<typeof dal.applications.listLean>[0]> = { limit: intParam(q.limit, 100), offset: intParam(q.offset, 0) };
    if (q.status) p.status = q.status as NonNullable<typeof p.status>;
    return c.json(dal.applications.listLean(p));
  });
  api.get('/applications/:id/timeline', (c) => {
    const id = c.req.param('id');
    return c.json({ events: dal.events.timeline(id), emails: dal.emails.listForApplication(id) });
  });

  api.get('/runs', (c) => {
    const q = c.req.query();
    const p: NonNullable<Parameters<typeof dal.runs.listLean>[0]> = { limit: intParam(q.limit, 100), offset: intParam(q.offset, 0) };
    if (q.state) p.state = q.state as NonNullable<typeof p.state>;
    if (q.lane) p.lane = q.lane as NonNullable<typeof p.lane>;
    return c.json(dal.runs.listLean(p));
  });
  api.get('/runs/:id/steps', (c) => c.json({ steps: dal.runs.getSteps(c.req.param('id')) }));

  // the Needs-You queue: runs waiting on a human (walls) or a review, with their pending questions
  api.get('/needs-you', (c) => {
    const human = dal.runs.listLean({ state: 'needs_human', limit: 200 }).rows;
    const review = dal.runs.listLean({ state: 'ready_for_review', limit: 200 }).rows;
    return c.json({ needsHuman: human, readyForReview: review });
  });
  // answer a parked question, then re-queue the run (needs_human → queued) so it resumes
  api.post('/runs/:id/answer', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json()) as { answers?: { profileId: string; label: string; value: string; kind?: 'qa' | 'field' }[] };
    for (const a of body.answers ?? []) dal.answers.record(a.profileId, { kind: a.kind ?? 'qa', label: a.label, value: a.value, provenance: 'user', locked: true });
    const run = dal.runs.get(id);
    if (run && run.state === 'needs_human') dal.runs.transition(id, 'queued');
    return c.json({ ok: true });
  });

  api.get('/documents', (c) => c.json({ rows: dal.documents.listLean() }));
  api.get('/emails', (c) => {
    const q = c.req.query();
    const p: NonNullable<Parameters<typeof dal.emails.listLean>[0]> = { limit: intParam(q.limit, 100), offset: intParam(q.offset, 0) };
    if (q.category) p.category = q.category;
    return c.json(dal.emails.listLean(p));
  });
  api.get('/emails/suggestions', (c) => c.json({ rows: dal.emails.unmatchedSuggestions() }));

  api.get('/settings', (c) => c.json(dal.settings.all()));
  api.put('/settings/:section/:key', async (c) => {
    const body = (await c.req.json()) as { value: unknown };
    try {
      dal.settings.set(c.req.param('section'), c.req.param('key'), body.value);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'bad_setting' }, 400);
    }
  });

  api.get('/adapters', (c) =>
    c.json({ rows: registry.all().map((a) => ({ id: a.id, version: a.version, source: a.source, hosts: a.hosts, priority: a.priority, pages: a.pages.length })) }),
  );
  api.get('/secrets/health', (c) => c.json({ rows: dal.secrets.health() }));

  // run-service control (the minimal single-lane driver; #4 is the full scheduler)
  api.get('/apply/status', (c) => c.json({ running: runService.isRunning() }));
  api.post('/apply/start', (c) => { runService.start(); return c.json({ running: true }); });
  api.post('/apply/stop', (c) => { runService.stop(); return c.json({ running: false }); });

  // v11 import wizard
  api.post('/import/plan', async (c) => {
    const { sourcePath } = (await c.req.json()) as { sourcePath: string };
    if (await (deps.v11Probe ?? v11IsRunning)()) return c.json({ error: 'V11_RUNNING', message: 'Quit JAT v11 first — the import reads a consistent snapshot.' }, 409);
    try {
      return c.json(planImport(sourcePath));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return c.json({ error: err.code ?? 'import_plan_failed', message: err.message }, 400);
    }
  });
  api.post('/import/execute', async (c) => {
    const { sourcePath } = (await c.req.json()) as { sourcePath: string };
    if (await (deps.v11Probe ?? v11IsRunning)()) return c.json({ error: 'V11_RUNNING', message: 'Quit JAT v11 first — the import reads a consistent snapshot.' }, 409);
    try {
      return c.json(executeImport(dal.ctx.db, sourcePath));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return c.json({ error: err.code ?? 'import_failed', message: err.message }, 400);
    }
  });

  deps.extend?.(api); // extra authed routes (Gmail) mount here, under the same token guard

  app.route('/api', api);
}
