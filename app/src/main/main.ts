// Electron main = the brain's entrypoint. Boots the single writer (better-sqlite3), migrates,
// starts the loopback server, opens the window. Structural law 3/5: one process owns the DB and
// the port; a second instance must never race it — hence the single-instance lock below.
import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './db/index.js';
import { startServer, type RunningServer } from './server/index.js';
import { IDENTITY } from '@jat12/shared';

const HERE = dirname(fileURLToPath(import.meta.url)); // dist/main at runtime
const DEV = !app.isPackaged || process.env.JAT_DEV === '1';
const SMOKE = process.env.JAT_SMOKE === '1'; // headless boot proof: migrate, serve, self-check, exit

let server: RunningServer | undefined;
let db: Database | undefined;

// Only one instance may own the DB + port. Second launch exits immediately (M0: no window focus yet).
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

function migrationsDir(): string {
  // esbuild copies migrations beside the bundle; packaged app ships them as an extraResource.
  return app.isPackaged
    ? join(process.resourcesPath, 'db', 'migrations')
    : join(HERE, 'db', 'migrations');
}

async function boot(): Promise<void> {
  // Dev identity: separate userData + port so `npm run dev` never touches a prod install.
  if (DEV) app.setPath('userData', join(app.getPath('appData'), IDENTITY.userDataDev));

  const dbFile = join(app.getPath('userData'), 'jat12.db');
  const opened = openDatabase({ file: dbFile, migrationsDir: migrationsDir() });
  db = opened.db;
  server = await startServer({ db, version: app.getVersion(), startedAt: Date.now(), dev: DEV });
  console.log(`[jat12] db schema v${opened.migration.to} @ ${dbFile}`);
  console.log(`[jat12] brain on http://127.0.0.1:${server.port}${DEV ? ' (dev)' : ''}`);

  ipcMain.handle('app:ping', () => ({ ok: true, version: app.getVersion() }));

  if (SMOKE) {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = (await res.json()) as { ok?: boolean; schema?: number };
    console.log('[jat12] smoke /health ->', JSON.stringify(body));
    await shutdown();
    app.exit(res.ok && body.ok === true && body.schema === 1 ? 0 : 1);
    return;
  }

  createWindow();
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(join(HERE, '..', 'renderer', 'index.html'));
}

async function shutdown(): Promise<void> {
  await server?.close().catch(() => {});
  server = undefined;
  db?.close();
  db = undefined;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void shutdown();
});

app.whenReady().then(boot).catch((err: unknown) => {
  console.error('[jat12] boot failed', err);
  app.exit(1);
});
