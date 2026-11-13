import { describe, it, expect, vi } from 'vitest';
import { buildSceneEnvelope, MAX_SCENE_EMBED_BYTES, serializeSceneEnvelope } from './scene-embed';
import {
  createArrow,
  createHtmlElement,
  createNote,
  createShape,
  createText,
} from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { LayerManager } from '../layers/layer-manager';
import { getDefaultElementRegistry } from '../elements/default-registry';
import { CANVAS_STATE_VERSION, parseState } from '../core/state-serializer';
import type { CanvasElement } from '../elements/types';

const BOUNDS = { x: 0, y: 0, w: 300, h: 300 };
const registry = getDefaultElementRegistry();

function build(elements: CanvasElement[], layerManager?: LayerManager) {
  return buildSceneEnvelope(elements, BOUNDS, layerManager, registry);
}

describe('buildSceneEnvelope', () => {
  it('keeps only elements whose rect intersects the bounds', () => {
    const inside = createShape({ position: { x: 10, y: 10 }, size: { w: 50, h: 50 } });
    const outside = createShape({ position: { x: 1000, y: 1000 }, size: { w: 50, h: 50 } });
    const ids = build([inside, outside]).state.elements.map((el) => el.id);
    expect(ids).toEqual([inside.id]);
  });

  it('drops transient html elements', () => {
    const html = createHtmlElement({ position: { x: 10, y: 10 }, size: { w: 50, h: 50 } });
    const transient = { ...html, id: 'transient-1', transient: true };
    expect(build([html, transient]).state.elements.map((el) => el.id)).toEqual([html.id]);
  });

  it('removes hierarchy and binding references to elements outside the scene', () => {
    const culled = createShape({
      position: { x: 1000, y: 1000 },
      size: { w: 50, h: 50 },
      index: 'a0',
    });
    const kept = createShape({ position: { x: 10, y: 10 }, size: { w: 50, h: 50 }, index: 'a1' });
    const keptChild = createNote({
      position: { x: 20, y: 20 },
      size: { w: 20, h: 20 },
      parentId: kept.id,
      index: 'a2',
    });
    const orphan = createNote({
      position: { x: 100, y: 100 },
      size: { w: 20, h: 20 },
      parentId: culled.id,
      index: 'a3',
    });
    const boundText = createText({
      position: { x: 150, y: 150 },
      size: { w: 40, h: 20 },
      parentId: culled.id,
      containerId: culled.id,
      index: 'a4',
    });
    const arrow = createArrow({
      from: { x: 30, y: 30 },
      to: { x: 200, y: 200 },
      fromBinding: { elementId: kept.id },
      toBinding: { elementId: culled.id },
      index: 'a5',
    });
    const { state } = build([culled, kept, keptChild, orphan, boundText, arrow]);
    const byId = new Map(state.elements.map((el) => [el.id, el]));

    expect(byId.get(keptChild.id)?.parentId).toBe(kept.id);
    expect(byId.get(orphan.id)).not.toHaveProperty('parentId');
    expect(byId.get(boundText.id)).not.toHaveProperty('parentId');
    expect(byId.get(boundText.id)).not.toHaveProperty('containerId');
    expect(byId.get(arrow.id)).toHaveProperty('fromBinding', { elementId: kept.id });
    expect(byId.get(arrow.id)).not.toHaveProperty('toBinding');
    expect(() => parseState(JSON.stringify(state))).not.toThrow();
  });

  it('strips editor, ownerId and audience', () => {
    const note = Object.assign(createNote({ position: { x: 10, y: 10 } }), {
      editor: 'peer-1',
      ownerId: 'user-1',
      audience: 'gm',
    });
    const [embedded] = build([note]).state.elements;
    expect(embedded).toBeDefined();
    for (const key of ['editor', 'ownerId', 'audience']) {
      expect(embedded).not.toHaveProperty(key);
    }
    expect(note.ownerId).toBe('user-1');
  });

  it('keeps only the referenced layers in manager order', () => {
    const store = new ElementStore();
    const manager = new LayerManager(store);
    const first = manager.activeLayer;
    const second = manager.createLayer('Second');
    const third = manager.createLayer('Third');
    const onThird = createNote({ position: { x: 10, y: 10 }, layerId: third.id });
    const onFirst = createNote({ position: { x: 50, y: 50 }, layerId: first.id });
    const { state } = build([onThird, onFirst], manager);
    expect(state.layers?.map((layer) => layer.id)).toEqual([first.id, third.id]);
    expect(state.layers?.map((layer) => layer.id)).not.toContain(second.id);
  });

  it('synthesizes one default layer and rewrites layer ids without a manager', () => {
    const a = createNote({ position: { x: 10, y: 10 }, layerId: 'layer-a' });
    const b = createNote({ position: { x: 50, y: 50 }, layerId: '' });
    const { state } = build([a, b]);
    expect(state.layers).toEqual([
      { id: 'default-layer', name: 'Layer 1', visible: true, locked: false, order: 0, opacity: 1 },
    ]);
    expect(state.elements.map((el) => el.layerId)).toEqual(['default-layer', 'default-layer']);
    expect(a.layerId).toBe('layer-a');
  });

  it('places the camera at the bounds origin with zoom 1 and the current state version', () => {
    const { type, version, state } = buildSceneEnvelope(
      [createNote({ position: { x: 40, y: 50 } })],
      { x: 30, y: -20, w: 300, h: 300 },
      undefined,
      registry,
    );
    expect({ type, version }).toEqual({ type: 'fieldnotes/scene', version: 1 });
    expect(state.camera).toEqual({ position: { x: 30, y: -20 }, zoom: 1 });
    expect(state.version).toBe(CANVAS_STATE_VERSION);
    expect(state).not.toHaveProperty('activeLayerId');
    expect(state).not.toHaveProperty('extensions');
  });
});

describe('serializeSceneEnvelope', () => {
  it('returns the envelope JSON under the cap', () => {
    const envelope = build([createNote({ position: { x: 10, y: 10 } })]);
    const onSceneOmitted = vi.fn();
    expect(serializeSceneEnvelope(envelope, { onSceneOmitted })).toBe(JSON.stringify(envelope));
    expect(onSceneOmitted).not.toHaveBeenCalled();
  });

  it('omits a scene over 16 MiB and reports its size', () => {
    const note = {
      ...createNote({ position: { x: 10, y: 10 } }),
      text: 'x'.repeat(MAX_SCENE_EMBED_BYTES),
    };
    const onSceneOmitted = vi.fn();
    expect(serializeSceneEnvelope(build([note]), { onSceneOmitted })).toBeNull();
    expect(onSceneOmitted).toHaveBeenCalledTimes(1);
    const [info] = onSceneOmitted.mock.calls[0] ?? [];
    expect(info.limit).toBe(16 * 1024 * 1024);
    expect(info.bytes).toBeGreaterThan(16 * 1024 * 1024);
  }, 30_000);
});
