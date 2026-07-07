# JAT 12 (Aurora)

Ground-up rebuild of the job auto-apply system. **The desktop app is the brain; the Chrome extension is only hands and eyes.** Site knowledge is hot-updatable JSON data, not code. Replaces v11 after cutover.

> Full design: [`docs/plan/00-MASTER-PLAN.md`](docs/plan/00-MASTER-PLAN.md) + pillars `01`–`07` + [`DECISIONS-LOCKED.md`](docs/plan/DECISIONS-LOCKED.md).

## The eight structural laws (each kills a v11 production failure class)

1. **The page never thinks** — extension is a stateless sensor/actuator; the app owns a 13-state apply-run machine persisted per step; any extension death = *resume by re-reading the live page*, never restart.
2. **Site knowledge is data** — versioned JSON adapters, hot-reloadable; a LinkedIn DOM change is a data edit, unknown pages capture-and-park to learn.
3. **Busy = one SQL query** — worker slots are `apply_runs` rows, never open tabs; all pacing in one scheduler.
4. **Supply lanes are independent** — per-source refill gates; a wedged lane never starves another; telemetry rows only on yield.
5. **One writer, honest truth** — better-sqlite3 WAL, main-process only; `submitted` requires real evidence *by CHECK constraint*.
6. **Push is a patch** — PatchBus sends the changed row over IPC; "refetch everything" doesn't exist.
7. **Humans solve walls** — never solve captchas; ~60s unattended park + breaker.
8. **Tokens rot, releases don't** — token-health UI + one-click re-auth; tokenless public-repo auto-update; unpacked-extension path.

## Stack

Electron 42 · TypeScript (type-check only; esbuild emits) · better-sqlite3 (WAL) · vanilla renderer + raw WebGL2 (no framework) · Hono REST + `ws` on 127.0.0.1:**7845** · zod contracts · vitest + Playwright. **AI = Codex CLI (your ChatGPT/OpenAI subscription login), no API keys** — if Codex isn't signed in, brand-new screening questions park for you.

## Layout

```
shared/   @jat12/shared — contracts, constants, normalizers (the anti-drift package)
app/      Electron brain: src/main (scheduler, engine, db, server), src/preload, src/renderer (Aurora)
extension/ thin MV3: sensor.ts, actuator.ts, sw.ts (dist/ is the load-unpacked target)
adapters/ site recipes as JSON data
tools/    build, gates, importer, canary, release
tests/    unit · integration · replay · e2e (fixture-replay) · fixtures
```

## Dev

```bash
npm install          # workspaces; native better-sqlite3 builds/prebuild
npm run typecheck
npm test             # vitest unit/integration
npm run dev          # dev identity (port 7846, userData jat12-app-dev)
npm run build:ext    # extension -> extension/dist ; load unpacked in chrome://extensions
```

Release: tag `v12.*` on **`PierreSalama/jat12-app`** → CI → GitHub release + electron-updater. v11 (`Job-ext-app`) is never touched.

## Status

**M0 (scaffold) in progress.** Foundation up: workspaces, shared contract package (constants, ported normalizers + tests, status vocabulary). Next: DB migration `001-core`, `/health` server, CI green, then **M1 — a real LinkedIn apply that survives an extension-kill** (the milestone that retires the architecture risk).
