import type { Viewport } from '@fieldnotes/core';
import { required } from './layout';

const HINT_MS = 2500;

function wheelHint(): string {
  // `userAgentData` is not in the DOM typings yet.
  const nav: Navigator & { userAgentData?: { platform: string } } = navigator;
  const platform = nav.userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform) ? 'Hold ⌘ to zoom' : 'Hold Ctrl to zoom';
}

/** Wires the toolbar, zoom readout, Draw on this board and the wheel hint; returns a disposer. */
export function wireControls(root: HTMLElement, viewport: Viewport): () => void {
  const tools = [...root.querySelectorAll<HTMLButtonElement>('[data-hero-tool]')];
  const zoom = required<HTMLElement>(root, '[data-hero-zoom]');
  const engage = required<HTMLButtonElement>(root, '[data-hero-engage]');
  const hint = required<HTMLElement>(root, '[data-hero-hint]');
  const abort = new AbortController();
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  for (const button of tools) {
    const name = button.dataset.heroTool;
    if (name) button.addEventListener('click', () => viewport.setTool(name), abort);
  }
  engage.hidden = !matchMedia('(any-pointer: coarse)').matches;
  engage.addEventListener(
    'click',
    () => viewport.setEmbeddedEngaged(!viewport.isEmbeddedEngaged()),
    abort,
  );

  const unsubscribe = [
    viewport.toolManager.onChange((name) => {
      for (const button of tools) {
        button.setAttribute('aria-pressed', String(button.dataset.heroTool === name));
      }
    }),
    viewport.camera.onChange(() => {
      zoom.textContent = `${Math.round(viewport.camera.zoom * 100)}%`;
    }),
    // Core's own Escape lands here too, so the site adds no Escape handler.
    viewport.onEmbeddedEngagedChange((engaged) => {
      engage.textContent = engaged ? 'Done' : 'Draw on this board';
      viewport.setTool(engaged ? 'pencil' : 'select');
    }),
  ];
  const offWheel = viewport.onWheelPassThrough(() => {
    offWheel();
    hint.textContent = wheelHint();
    hint.hidden = false;
    hintTimer = setTimeout(() => (hint.hidden = true), HINT_MS);
  });

  return () => {
    abort.abort();
    offWheel();
    clearTimeout(hintTimer);
    for (const off of unsubscribe) off();
  };
}
