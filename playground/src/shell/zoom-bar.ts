import type { Viewport } from '@fieldnotes/core';
import { icon } from './icons';
import type { IconName } from './icons';

const STEP = 1.2;

function button(label: string, content: IconName | null, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-button';
  el.setAttribute('aria-label', label);
  el.title = label;
  if (content) el.append(icon(content));
  el.addEventListener('click', run);
  return el;
}

/** Renders zoom, fit, undo and redo for `viewport` into `root`; returns a cleanup. */
export function renderZoomBar(root: HTMLElement, viewport: Viewport): () => void {
  const { camera, history } = viewport;
  // zoomAt takes wrapper-local coordinates; the dom layer's rect is camera-transformed.
  const zoomTo = (level: number): void => {
    const { w, h } = viewport.getCanvasSize();
    camera.zoomAt(level, { x: w / 2, y: h / 2 });
  };
  const zoomOut = button('Zoom out', 'zoom-out', () => zoomTo(camera.zoom / STEP));
  const percent = button('Reset zoom', null, () => zoomTo(1));
  const zoomIn = button('Zoom in', 'zoom-in', () => zoomTo(camera.zoom * STEP));
  for (const el of [zoomOut, percent, zoomIn]) el.classList.add('wide-only');
  const undo = button('Undo', 'undo', () => viewport.undo());
  const redo = button('Redo', 'redo', () => viewport.redo());
  const fit = button('Fit to content', 'fit', () => viewport.fitToContent());
  root.replaceChildren(zoomOut, percent, zoomIn, fit, undo, redo);

  const syncZoom = (): void => {
    percent.textContent = `${Math.round(camera.zoom * 100)}%`;
  };
  const syncHistory = (): void => {
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
  };
  syncZoom();
  syncHistory();
  const offCamera = camera.onChange(syncZoom);
  const offHistory = history.onChange(syncHistory);
  return () => {
    offCamera();
    offHistory();
  };
}
