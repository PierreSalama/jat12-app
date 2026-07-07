import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../../app/src/main/db/index.js';
import { makeDal, defaultContext, type Dal, type Sealer } from '../../app/src/main/db/dal/index.js';
import { loadBuiltins, makeRegistry } from '../../app/src/main/adapters/registry.js';
import { makeRunService } from '../../app/src/main/engine/run-service.js';
import { mountApi } from '../../app/src/main/server/api.js';
import type { RunGateway } from '../../app/src/main/engine/gateway.js';
import { LINKEDIN_DAILY_CAP } from '@jat12/shared';

const fakeSealer: Sealer = { available: () => true, seal: (p) => Buffer.from(p), open: (b) => Buffer.from(b).toString() };
const unusedGateway: RunGateway = {
  command: () => Promise.reject(new Error('gateway should not be called in these tests')),
  awaitResume: () => Promise.reject(new Error('no')),
};
const TOKEN = 'test-token';
const auth = { headers: { 'X-JAT12-Token': TOKEN } };

describe('REST API + run-service wiring', () => {
  let db: Database;
  let dal: Dal;
  let app: Hono;
  let runService: ReturnType<typeof makeRunService>;
  let registry: ReturnType<typeof makeRegistry>;

  beforeEach(() => {
    ({ db } = openDatabase({ file: ':memory:' }));
    dal = makeDal(defaultContext(db), { sealer: fakeSealer });
    registry = makeRegistry(loadBuiltins());
    runService = makeRunService({ dal, gateway: unusedGateway, registry, pollMs: 999999 });
    app = new Hono();
    // inject a deterministic "v11 not running" so the import tests don't depend on a real :7744
    mountApi(app, { dal, runService, registry, token: TOKEN, version: '12.0.0', v11Probe: () => Promise.resolve(false) });

    db.prepare('INSERT INTO profiles (id, name, is_default, created_at, updated_at) VALUES (?,?,1,?,?)').run('p1', 'Pierre', 1, 1);
    db.prepare('INSERT INTO jobs (id, source, title, company, job_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('j1', 'linkedin', 'Engineer', 'Aurora', 'https://www.linkedin.com/jobs/view/1', 1, 1, 1, 1);
    dal.applications.ensure('j1', 'p1');
  });
  afterEach(() => { runService.stop(); db.close(); });

  it('serves the loopback pairing token WITHOUT auth', async () => {
    const res = await app.request('/api/pair/token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; productName: string };
    expect(body.token).toBe(TOKEN);
    expect(body.productName).toBe('JAT 12');
  });

  it('rejects protected routes without the token, allows them with it', async () => {
    expect((await app.request('/api/summary')).status).toBe(401);
    const res = await app.request('/api/summary', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { funnel: Record<string, number>; applying: boolean };
    expect(body.applying).toBe(false);
    expect(typeof body.funnel).toBe('object');
  });

  it('lists jobs and adapters', async () => {
    const jobs = (await (await app.request('/api/jobs', auth)).json()) as { rows: { id: string }[]; total: number };
    expect(jobs.total).toBe(1);
    expect(jobs.rows[0]!.id).toBe('j1');
    const adapters = (await (await app.request('/api/adapters', auth)).json()) as { rows: { id: string }[] };
    expect(adapters.rows.some((a) => a.id === 'linkedin-easy-apply')).toBe(true);
  });

  it('toggles the run-service via the API', async () => {
    await app.request('/api/apply/start', { method: 'POST', ...auth });
    expect(runService.isRunning()).toBe(true);
    const st = (await (await app.request('/api/apply/status', auth)).json()) as { running: boolean };
    expect(st.running).toBe(true);
    await app.request('/api/apply/stop', { method: 'POST', ...auth });
    expect(runService.isRunning()).toBe(false);
  });

  it('surfaces a typed importer error for a bad source path', async () => {
    const res = await app.request('/api/import/plan', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: 'F:/definitely/not/a/real/jat.db' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy(); // NOT_FOUND / OPEN_FAILED
  });

  it('refuses import while v11 is running (409 V11_RUNNING)', async () => {
    const app2 = new Hono();
    mountApi(app2, { dal, runService, registry, token: TOKEN, version: '12.0.0', v11Probe: () => Promise.resolve(true) });
    const res = await app2.request('/api/import/plan', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: 'anything' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('V11_RUNNING');
  });

  it('run-service SKIPS a run whose job host has no adapter (queued→skipped, never attempted)', async () => {
    db.prepare('INSERT INTO jobs (id, source, job_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('j2', 'other', 'https://example.com/careers/1', 1, 1, 1, 1);
    const appl = dal.applications.ensure('j2', 'p1');
    const run = dal.runs.enqueue(appl.id, { source: 'other', lane: 'ats', jobId: 'j2', profileId: 'p1' });
    const outcome = await runService.driveNext();
    expect(outcome?.state).toBe('skipped');
    expect(dal.runs.get(run.id)!.error).toContain('no_adapter');
  });

  it('respects the LinkedIn 45/24h ledger cap — a capped source stays queued, never driven', async () => {
    const t = Date.now();
    const ins = db.prepare("INSERT INTO apply_ledger (run_id, source, account_key, submitted_at) VALUES (?, 'linkedin', 'default', ?)");
    for (let i = 0; i < LINKEDIN_DAILY_CAP; i++) ins.run('r' + i, t - 1000); // fill the rolling window
    const appl = dal.applications.ensure('j1', 'p1'); // j1 is a linkedin job
    const run = dal.runs.enqueue(appl.id, { source: 'linkedin', lane: 'linkedin', jobId: 'j1', profileId: 'p1' });

    const outcome = await runService.driveNext(); // unusedGateway would throw if it tried to drive
    expect(outcome).toBeNull(); // over cap → nothing driven this tick
    expect(dal.runs.get(run.id)!.state).toBe('queued'); // left for a later window
  });
});
