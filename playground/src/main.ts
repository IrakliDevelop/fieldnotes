import type { Viewport } from '@fieldnotes/core';
import type { FogManager } from '@fieldnotes/vtt';
import { attachPersistence } from './persistence';
import type { Scene, SceneId, SceneInstance } from './scene';
import { addMenuItems } from './shell/menu';
import { createShell } from './shell/shell';
import type { Mounted } from './shell/shell';
import { embeds } from './scenes/embeds';
import { currentFog, tabletop } from './scenes/tabletop';
import { whiteboard } from './scenes/whiteboard';

declare global {
  interface Window {
    __playground: { sceneId: SceneId; viewport: Viewport; fog?: FogManager };
  }
}

const SCENES: readonly Scene[] = [whiteboard, tabletop, embeds];

const stage = document.getElementById('stage');
const chrome = document.getElementById('chrome');
if (!stage || !chrome) throw new Error('Missing #stage or #chrome');

let current: Mounted | null = null;
const shell = createShell(
  chrome,
  SCENES,
  () => current,
  (id) => mount(id),
);

let firstMount = true;
// Test and demo hook: a scene with nothing saved starts empty instead of with its sample.
const blank = new URLSearchParams(location.search).has('blank');
let teardown: (() => void) | null = null;

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** Wires autosave and the file/board menu to a mounted scene; returns its teardown. */
function attach(instance: SceneInstance, sceneId: SceneId): () => void {
  const { viewport } = instance;
  const disposed = new AbortController();
  let detach: (() => void) | null = null;
  void attachPersistence(viewport, sceneId, {
    onFirstVisit: () => {
      if (!blank) instance.loadSample();
    },
    toast: shell.toast,
    autosave: true,
    signal: disposed.signal,
  }).then((dispose) => {
    if (disposed.signal.aborted) {
      dispose();
      return;
    }
    detach = dispose;
    // Published once the board is loaded so tests never race the initial restore.
    const fog = sceneId === 'tabletop' ? currentFog() : null;
    window.__playground = fog ? { sceneId, viewport, fog } : { sceneId, viewport };
  });

  // iOS Safari only delivers change events to a file input that is in the document.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      viewport.loadJSON(await file.text());
    } catch {
      shell.toast("Couldn't open that file");
    }
  });

  const removers = [
    addMenuItems('file', [
      { id: 'open-json', label: 'Open JSON', icon: 'upload', run: () => input.click() },
      {
        id: 'save-json',
        label: 'Save JSON',
        icon: 'download',
        run: () =>
          download(
            `fieldnotes-${sceneId}.json`,
            new Blob([viewport.exportJSON()], { type: 'application/json' }),
          ),
      },
      {
        id: 'export-png',
        label: 'Export PNG',
        icon: 'image',
        run: () =>
          viewport
            .exportImage({ scale: 2, padding: 32, background: '#ffffff' })
            .then((blob) => {
              if (blob) download(`fieldnotes-${sceneId}.png`, blob);
              else shell.toast('Nothing to export');
            })
            .catch(() => shell.toast('Export failed')),
      },
      {
        id: 'export-svg',
        label: 'Export SVG',
        icon: 'file',
        run: () =>
          viewport
            .exportSVG({ padding: 32 })
            .then((svg) =>
              download(`fieldnotes-${sceneId}.svg`, new Blob([svg], { type: 'image/svg+xml' })),
            )
            .catch(() => shell.toast('Export failed')),
      },
    ]),
    addMenuItems('board', [
      {
        id: 'load-sample',
        label: 'Load sample',
        icon: 'template',
        run: () => instance.loadSample(),
      },
      {
        id: 'reset-board',
        label: 'Reset board',
        icon: 'refresh',
        run: () => instance.loadSample(),
      },
    ]),
  ];
  return () => {
    disposed.abort();
    detach?.();
    input.remove();
    for (const remove of removers) remove();
  };
}

const mount = (id: string | null): void => {
  const scene = SCENES.find((s) => s.id === id) ?? whiteboard;
  const isFirst = firstMount;
  firstMount = false;
  teardown?.();
  teardown = null;
  current?.instance?.dispose();
  stage.replaceChildren();
  try {
    const instance = scene.mount({ stage, shell, room: null });
    current = { id: scene.id, instance };
    teardown = attach(instance, scene.id);
    history.replaceState(null, '', `?scene=${scene.id}${blank ? '&blank' : ''}`);
  } catch {
    stage.replaceChildren();
    current = { id: scene.id, instance: null };
    Reflect.deleteProperty(window, '__playground');
    shell.toast("Couldn't open that scene");
    if (isFirst && scene !== whiteboard) {
      mount(whiteboard.id);
      return;
    }
  }
  shell.refresh();
};

mount(new URLSearchParams(location.search).get('scene'));
