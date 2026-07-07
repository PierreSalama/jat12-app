// The run-service — the minimal driver that turns queued apply_runs into driven applies. It leases ONE
// queued run at a time, resolves its adapter (by the job URL) and a profile-first answer resolver, and
// hands it to driveRun(). The FULL lane scheduler (concurrency, per-source gates, the 45/24h ledger
// cap, pacing/breakers) is task #4 — this is the single-lane spine that M1 needs to actually apply.
// Depends only on the RunGateway INTERFACE, so it's testable with the same FakeExtension the survival
// test uses; the live WsGateway plugs in unchanged.
import type { Dal } from '../db/dal/index.js';
import type { RunGateway } from './gateway.js';
import { driveRun, type DriveOutcome } from './runner.js';
import { makeResolver } from './answer-resolver.js';
import type { Registry } from '../adapters/registry.js';

export interface RunServiceDeps {
  dal: Dal;
  gateway: RunGateway;
  registry: Registry;
  /** ms between idle polls for a queued run. */
  pollMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface RunService {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  /** drive exactly one queued run if present; returns its outcome or null when the queue is empty. */
  driveNext(): Promise<DriveOutcome | null>;
}

export function makeRunService(deps: RunServiceDeps): RunService {
  const { dal, gateway, registry } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const pollMs = deps.pollMs ?? 4000;
  let running = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function defaultProfileId(): string {
    const row = dal.ctx.db.prepare('SELECT id FROM profiles WHERE is_default = 1 LIMIT 1').get() as { id: string } | undefined;
    return row?.id ?? (dal.ctx.db.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string } | undefined)?.id ?? '';
  }

  async function driveNext(): Promise<DriveOutcome | null> {
    const queued = dal.runs.listLean({ state: 'queued', limit: 1 }).rows[0];
    if (!queued) return null;
    const run = dal.runs.get(queued.id);
    if (!run) return null;

    const detail = dal.jobs.getDetail(run.job_id);
    const jobUrl = detail?.job_url ?? '';
    const adapter = jobUrl ? registry.resolveForUrl(jobUrl) : null;
    if (!adapter) {
      // no adapter for this host = we can't attempt it = a relevance skip (never attempted). queued→skipped
      // is the legal, honest terminal (queued→parked is not a legal transition — parks come mid-drive).
      dal.runs.transition(run.id, 'skipped', { error: 'no_adapter_for_host' });
      log(`run ${run.id}: no adapter for ${jobUrl} → skipped`);
      return { state: 'skipped', steps: 0, resumes: 0 };
    }

    const profileId = run.profile_id || defaultProfileId();
    const prow = dal.ctx.db.prepare('SELECT data_json FROM profiles WHERE id = ?').get(profileId) as { data_json: string } | undefined;
    let profileData: Record<string, unknown> = {};
    try {
      profileData = prow ? (JSON.parse(prow.data_json) as Record<string, unknown>) : {};
    } catch {
      profileData = {};
    }

    const resolve = makeResolver({
      answers: dal.answers,
      profile: { data: profileData },
      fieldMap: adapter.fieldMap,
      profileId,
    });

    log(`run ${run.id}: driving ${jobUrl} via ${adapter.id}`);
    return driveRun(run.id, { runs: dal.runs, gateway, adapter, resolve, jobUrl, now });
  }

  async function tick(): Promise<void> {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      const outcome = await driveNext();
      if (outcome) log(`run finished: ${outcome.state}`);
    } catch (e) {
      log(`run-service tick error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight = false;
      if (running) timer = setTimeout(() => void tick(), pollMs);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      log('run-service started');
      timer = setTimeout(() => void tick(), 0);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      log('run-service stopped');
    },
    isRunning: () => running,
    driveNext,
  };
}
