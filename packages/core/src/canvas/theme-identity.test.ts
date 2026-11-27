/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomNodeManager } from './dom-node-manager';
import { exportPdf } from './export-pdf';
import { exportSvg } from './export-svg';
import { Viewport } from './viewport';
import { paletteFeature } from './features/palette-feature';
import type { RenderLoop } from './render-loop';
import {
  createHtmlElement,
  createNote,
  createStroke,
  createText,
} from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createFrame } from '../elements/frame-element';
import { NoteToolbar } from '../elements/note-toolbar';
import { installRecordingContexts } from '../test-helpers/recording-contexts';

const recordingRestores: (() => void)[] = [];

afterEach(() => {
  for (const restore of recordingRestores.splice(0)) restore();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('light identity', () => {
  it('a synced note node keeps its base inline style', () => {
    const domLayer = document.createElement('div');
    const manager = new DomNodeManager({
      domLayer,
      onEditRequest: () => undefined,
      isEditingElement: () => false,
    });
    const note = createNote({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 50 },
      backgroundColor: '#ffeb3b',
      textColor: '#000000',
    });
    const text = createText({ position: { x: 20, y: 30 }, text: 'Text', color: '#1a1a1a' });
    manager.syncDomNode(note);
    manager.syncDomNode(text);
    expect(manager.getNode(note.id)?.style.cssText).toBe(
      'position: absolute; pointer-events: auto; display: block; left: 10px; top: 20px; width: 100px; height: 50px; z-index: 0; opacity: 1; transform-origin: 50% 50%; background-color: rgb(255, 235, 59); color: rgb(0, 0, 0); padding: 8px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); font-size: 18px; overflow: hidden; cursor: default; user-select: none; word-wrap: break-word; box-sizing: border-box;',
    );
    expect(manager.getNode(text.id)?.style.cssText).toBe(
      'position: absolute; pointer-events: auto; display: block; left: 20px; top: 30px; width: 200px; height: 28px; z-index: 0; opacity: 1; transform-origin: 50% 50%; padding: 2px; font-size: 16px; color: rgb(26, 26, 26); text-align: left; background: none; border: medium; box-shadow: none; overflow: visible; cursor: default; user-select: none; word-wrap: break-word; white-space: normal; box-sizing: border-box; line-height: 1.4;',
    );

    const placeholders = new DomNodeManager({
      domLayer,
      onEditRequest: () => undefined,
      isEditingElement: () => false,
      htmlPlaceholders: true,
    });
    const html = createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    placeholders.syncDomNode(html);
    const placeholder = domLayer.querySelector<HTMLElement>('.fn-html-placeholder');
    expect(placeholder?.style.border).toBe('1px dashed rgb(161, 161, 170)');
    expect(placeholder?.style.color).toBe('rgb(113, 113, 122)');
  });

  it('the note toolbar writes no text colour', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const toolbar = new NoteToolbar();
    toolbar.show(anchor);
    const element = toolbar.getElement();
    expect(element?.style.color).toBe('');
    expect(element?.querySelector('button')?.style.color).toBe('');
    expect(element?.querySelector('select')?.style.color).toBe('');
    expect(element?.style.background).toBe('rgb(255, 255, 255)');
    expect(element?.style.border).toBe('1px solid rgb(204, 204, 204)');
    toolbar.hide();
  });

  it('the dialog root carries no theme marks', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewport = new Viewport(container, { plugins: [paletteFeature()] });
    viewport.palette.open();
    const dialog = container.querySelector<HTMLElement>('.fieldnotes-palette.fieldnotes-dialog');
    expect(dialog?.getAttribute('data-fieldnotes-theme')).toBeNull();
    expect(dialog?.style.colorScheme).toBe('');
    expect(dialog?.style.getPropertyValue('--fieldnotes-palette-theme-bg')).toBe('');
    viewport.destroy();
  });

  it('the built-in minimap keeps its light chrome', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewport = new Viewport(container, { minimap: true });
    const minimap = container.querySelector<HTMLElement>('[data-fieldnotes-minimap]');
    expect(minimap?.style.background).toBe('rgba(255, 255, 255, 0.85)');
    expect(minimap?.style.border).toBe('1px solid rgba(0, 0, 0, 0.15)');
    viewport.destroy();
  });

  it('a light SVG with a highlighter keeps multiply and no isolation', async () => {
    const store = new ElementStore();
    store.add(
      createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 50, y: 50, pressure: 0.5 },
        ],
        position: { x: 0, y: 0 },
        width: 4,
        blendMode: 'multiply',
        color: '#ffeb3b',
        opacity: 0.4,
      }),
    );
    const svg = await exportSvg(store);
    expect(svg).toContain('mix-blend-mode:multiply');
    expect(svg).not.toContain('isolation');
    expect(svg).not.toContain('<g');
  });

  it('a light PDF content stream starts with the image operator', async () => {
    const recording = installRecordingContexts();
    recordingRestores.push(recording.restore);
    const store = new ElementStore();
    store.add(createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 184 } }));
    const pdf = await exportPdf(store, { dpi: 18 });
    if (!pdf) throw new Error('PDF missing');
    const value = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
    const stream = value.match(/stream\n(q [^]+?)\nendstream/)?.[1];
    expect(stream).toMatch(/^q \d/);
    expect(stream).toMatch(/cm \/Im0 Do Q$/);
    expect(stream).not.toContain(' re f');
  });

  it('the board clears and draws dots as on base', () => {
    const recording = installRecordingContexts();
    recordingRestores.push(recording.restore);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewport = new Viewport(container);
    const renderLoop = (viewport as unknown as { renderLoop: RenderLoop }).renderLoop;
    renderLoop.setCanvasSize(800, 600);
    viewport.requestRender();
    renderLoop.flush();
    const canvas = container.querySelector('canvas');
    if (!canvas) throw new Error('base canvas missing');
    const calls = recording.callsOf(canvas);
    const names = calls.map((call) => call.name);
    const clearRectIndex = names.indexOf('clearRect');
    const drawImageIndex = names.indexOf('drawImage');
    expect(clearRectIndex).toBeGreaterThanOrEqual(0);
    expect(drawImageIndex).toBeGreaterThanOrEqual(0);
    expect(clearRectIndex).toBeLessThan(drawImageIndex);
    expect(calls).not.toContainEqual(
      expect.objectContaining({ name: 'fillRect', args: [0, 0, 800, 600] }),
    );
    const pattern = calls.find((call) => call.name === 'drawImage')?.args[0];
    if (!(pattern instanceof HTMLCanvasElement)) throw new Error('pattern canvas missing');
    expect(recording.callsOf(pattern).find((call) => call.name === 'arc')?.fillStyle).toBe(
      '#d0d0d0',
    );
    viewport.destroy();
  });
});
