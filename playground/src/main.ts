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

const mount = (id: string | null): void => {
  const scene = SCENES.find((s) => s.id === id) ?? whiteboard;
  current?.instance.dispose();
  current = null;
  stage.replaceChildren();
  let instance: SceneInstance;
  try {
    instance = scene.mount({ stage, shell, room: null });
  } catch {
    shell.toast("Couldn't open that scene");
    return;
  }
  current = { id: scene.id, instance };
  window.__playground = { sceneId: scene.id, viewport: instance.viewport };
  history.replaceState(null, '', `?scene=${scene.id}`);
  shell.refresh();
};

mount(new URLSearchParams(location.search).get('scene'));
