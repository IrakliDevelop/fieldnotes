import type { Viewport } from '@fieldnotes/core';
import type { FogManager } from '@fieldnotes/vtt';
import { attachPersistence } from './persistence';
import { connectRoom, leaveRoom, readRoom } from './room';
import type { Room, Scene, SceneId, SceneInstance } from './scene';
import { renderCollaborate } from './shell/collaborate';
import { addMenuItems } from './shell/menu';
import { createShell } from './shell/shell';
import type { Mounted } from './shell/shell';
import { embeds } from './scenes/embeds';
import { currentFog, fogClientPlugins, tabletop } from './scenes/tabletop';
import { whiteboard } from './scenes/whiteboard';
import { renderWidgetForExport } from './widgets';

declare global {
  interface Window {
    __playground: {
      sceneId: SceneId;
      viewport: Viewport;
      fog?: FogManager;
      laserSenders?: () => number;
      strokePreviews?: () => number;
    };
  }
}

const SCENES: readonly Scene[] = [whiteboard, tabletop, embeds];

const stage = document.getElementById('stage');
const chrome = document.getElementById('chrome');
if (!stage || !chrome) throw new Error('Missing #stage or #chrome');

let current: Mounted | null = null;
let room: Room | null = readRoom();
const shell = createShell(
  chrome,
  SCENES,
  () => current,
  (id) => {
    leave();
    mount(id);
  },
);

let firstMount = true;
// Test and demo hook: a scene with nothing saved starts empty instead of with its sample.
const blank = new URLSearchParams(location.search).has('blank');

/** A mounted scene's persistence, room connection and menu items. */
interface Attached {
  /** Hands the live board to `room`: autosave stops, the board stays. */
  enter(room: Room): void;
  dispose(): void;
}
let attached: Attached | null = null;

const leave = (): void => {
  if (!room) return;
  leaveRoom(room);
  room = null;
};

// Leave room reloads the scene with its own saved board.
const leaveAndRemount = (): void => {
  leave();
  mount(current?.id ?? null);
};

const enterRoom = (next: Room): void => {
  if (!current) return;
  room = next;
  history.replaceState(null, '', `?scene=${current.id}&room=${next.id}`);
  attached?.enter(next);
  refreshCollaborate();
};

const topRight = chrome.querySelector<HTMLElement>('[data-chrome="top-right"]');
if (!topRight) throw new Error('Missing top-right zone');
const refreshCollaborate = renderCollaborate(topRight, {
  room: () => room,
  sceneId: () => current?.id ?? null,
  start: enterRoom,
  leave: leaveAndRemount,
  toast: shell.toast,
});
addMenuItems('room', [
  {
    id: 'leave-room',
    label: 'Leave room',
    icon: 'x',
    run: leaveAndRemount,
    hidden: () => room === null,
  },
]);

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** Wires persistence, the room and the file/board menu to a mounted scene. */
function attach(instance: SceneInstance, sceneId: SceneId): Attached {
  const { viewport } = instance;
  const disposed = new AbortController();
  // An abort also stops the pending persistence load from republishing a destroyed viewport.
  try {
    let detach: (() => void) | null = null;
    let connection: { dispose(): void } | null = null;
    const join = (joined: Room): void => {
      connection = connectRoom(viewport, sceneId, joined, {
        plugins: fogClientPlugins(),
        onPeers: shell.setPeers,
      });
    };
    // Published once the board is loaded so tests never race the initial restore.
    const publish = (): void => {
      const fog = sceneId === 'tabletop' ? currentFog() : null;
      // A room joined before the load finished already installed its presence hooks.
      const { laserSenders, strokePreviews } = window.__playground ?? {};
      window.__playground = {
        sceneId,
        viewport,
        ...(fog && { fog }),
        ...(laserSenders && { laserSenders }),
        ...(strokePreviews && { strokePreviews }),
      };
    };
    const joining = room;
    if (joining?.role === 'guest') {
      // A guest starts empty; the room's snapshot fills the board.
      publish();
      join(joining);
    } else {
      void attachPersistence(viewport, sceneId, {
        onFirstVisit: () => {
          if (!blank) instance.loadSample();
        },
        toast: shell.toast,
        // In a room the board belongs to the room; the saved board stays as it was.
        autosave: joining === null,
        signal: disposed.signal,
      }).then((dispose) => {
        if (disposed.signal.aborted) {
          dispose();
          return;
        }
        // Collaborate clicked before the load finished: the room already owns the board.
        if (connection) dispose();
        else detach = dispose;
        publish();
        if (joining) join(joining);
      });
    }

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
        {
          id: 'open-json',
          label: 'Open JSON',
          icon: 'upload',
          run: () => input.click(),
          // Replacing layers wholesale emits no per-layer events, so peers would never see it.
          hidden: () => room !== null,
        },
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
              .exportImage({
                scale: 2,
                padding: 32,
                background: '#ffffff',
                renderHtml: renderWidgetForExport,
              })
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
              .exportSVG({ padding: 32, renderHtml: renderWidgetForExport })
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
    return {
      enter: (next) => {
        detach?.();
        detach = null;
        join(next);
      },
      dispose: () => {
        disposed.abort();
        detach?.();
        connection?.dispose();
        input.remove();
        for (const remove of removers) remove();
      },
    };
  } catch (error) {
    disposed.abort();
    throw error;
  }
}

const mount = (id: string | null): void => {
  const scene = SCENES.find((s) => s.id === id) ?? whiteboard;
  const isFirst = firstMount;
  firstMount = false;
  attached?.dispose();
  attached = null;
  current?.instance?.dispose();
  stage.replaceChildren();
  try {
    const instance = scene.mount({ stage, shell, room });
    current = { id: scene.id, instance };
    try {
      attached = attach(instance, scene.id);
    } catch (error) {
      instance.dispose();
      throw error;
    }
    history.replaceState(
      null,
      '',
      room
        ? `?scene=${scene.id}&room=${room.id}${room.role === 'guest' ? '&guest' : ''}`
        : `?scene=${scene.id}${blank ? '&blank' : ''}`,
    );
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
  refreshCollaborate();
};

mount(new URLSearchParams(location.search).get('scene'));
