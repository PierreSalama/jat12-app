// Preload — the ONLY bridge between the sandboxed renderer and the main process.
// Sandboxed preloads run as CommonJS; esbuild emits this to dist/main/preload.cjs.
// M0 exposes just an identity probe; the real PatchBus/command surface arrives in M1.
import { contextBridge, ipcRenderer } from 'electron';
import { IDENTITY, PROTOCOL_VERSION } from '@jat12/shared';

contextBridge.exposeInMainWorld('jat12', {
  protocol: PROTOCOL_VERSION,
  productName: IDENTITY.productName,
  ping: () => ipcRenderer.invoke('app:ping'),
});
