import type { Viewport } from '@fieldnotes/core';
import type { Scene, SceneId, SceneInstance } from './scene';
import { createShell } from './shell/shell';
import type { Mounted } from './shell/shell';
import { embeds } from './scenes/embeds';
import { tabletop } from './scenes/tabletop';
import { whiteboard } from './scenes/whiteboard';

declare global {
  interface Window {
    __playground: { sceneId: SceneId; viewport: Viewport };
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

const mount = (id: string | null): void => {
  const scene = SCENES.find((s) => s.id === id) ?? whiteboard;
  const isFirst = firstMount;
  firstMount = false;
  current?.instance?.dispose();
  stage.replaceChildren();
  let instance: SceneInstance | undefined;
  try {
    instance = scene.mount({ stage, shell, room: null });
    current = { id: scene.id, instance };
    window.__playground = { sceneId: scene.id, viewport: instance.viewport };
    history.replaceState(null, '', `?scene=${scene.id}`);
  } catch {
    // Drop a half-built viewport's DOM and listeners with the failed scene.
    instance?.dispose();
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
