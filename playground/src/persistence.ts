import { AutoSave, IndexedDBAdapter } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import type { SceneId } from './scene';

/** Restores the scene's saved board (or calls `onFirstVisit`) and optionally autosaves it; resolves to a disposer. */
export async function attachPersistence(
  viewport: Viewport,
  sceneId: SceneId,
  opts: {
    onFirstVisit: () => void;
    toast: (message: string) => void;
    autosave: boolean;
    /** Aborted when the mount is disposed; a load resolving afterwards is ignored. */
    signal?: AbortSignal;
  },
): Promise<() => void> {
  const key = `scene:${sceneId}`;
  const adapter = new IndexedDBAdapter({ dbName: 'fieldnotes-playground' });
  let warned = false;
  const warn = (): void => {
    if (warned) return;
    warned = true;
    opts.toast('Saving is unavailable in this browser');
  };
  const autoSave = new AutoSave(viewport.store, viewport.camera, {
    key,
    adapter,
    layerManager: viewport.layerManager,
    elementRegistry: viewport.elementRegistry,
    pluginStateManager: viewport.plugins,
    changeEmitters: [{ onChange: (listener) => viewport.onStateChange(listener) }],
    onError: warn,
  });
  // Read through the adapter so a storage failure and an unreadable board get different toasts.
  const json = await adapter.load(key).catch(() => {
    warn();
    return null;
  });
  if (opts.signal?.aborted) return () => autoSave.stop();
  if (json === null) {
    opts.onFirstVisit();
  } else {
    try {
      viewport.loadJSON(json);
    } catch {
      opts.toast("Couldn't restore your board");
      opts.onFirstVisit();
    }
  }
  viewport.history.clear();
  if (opts.autosave) autoSave.start();
  return () => autoSave.stop();
}
