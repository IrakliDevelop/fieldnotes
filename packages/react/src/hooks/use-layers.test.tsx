import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useLayers } from './use-layers';
import type { Viewport, Layer } from '@fieldnotes/core';

describe('useLayers', () => {
  afterEach(cleanup);

  it('returns initial layers', () => {
    let layers: Layer[] = [];
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]?.name).toBe('Layer 1');
  });

  it('returns activeLayerId', () => {
    let activeId = '';
    let layers: Layer[] = [];
    function Consumer() {
      const result = useLayers();
      activeId = result.activeLayerId;
      layers = result.layers;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(activeId).toBe(layers[0]?.id);
  });

  it('createLayer adds a new layer', () => {
    let layers: Layer[] = [];
    let create: ((name?: string) => Layer) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      create = result.createLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(layers).toHaveLength(1);

    act(() => {
      create?.('Test Layer');
    });
    expect(layers).toHaveLength(2);
    expect(layers[1]?.name).toBe('Test Layer');
  });

  it('removeLayer removes a layer', () => {
    let layers: Layer[] = [];
    let create: ((name?: string) => Layer) | null = null;
    let remove: ((id: string) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      create = result.createLayer;
      remove = result.removeLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    let newLayer: Layer | null = null;
    act(() => {
      newLayer = create?.('Temp') ?? null;
    });
    expect(layers).toHaveLength(2);

    act(() => {
      if (newLayer) remove?.(newLayer.id);
    });
    expect(layers).toHaveLength(1);
  });

  it('renameLayer renames a layer', () => {
    let layers: Layer[] = [];
    let rename: ((id: string, name: string) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      rename = result.renameLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    const layerId = layers[0]?.id ?? '';
    act(() => {
      rename?.(layerId, 'Renamed');
    });
    expect(layers.find((l) => l.id === layerId)?.name).toBe('Renamed');
  });

  it('reorderLayer changes layer order', () => {
    let layers: Layer[] = [];
    let create: ((name?: string) => Layer) | null = null;
    let reorder: ((id: string, newOrder: number) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      create = result.createLayer;
      reorder = result.reorderLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      create?.('Layer 2');
    });

    const firstLayerId = layers[0]?.id ?? '';
    act(() => {
      reorder?.(firstLayerId, 10);
    });
    expect(layers[layers.length - 1]?.id).toBe(firstLayerId);
  });

  it('setVisible toggles layer visibility', () => {
    let layers: Layer[] = [];
    let setVisible: ((id: string, v: boolean) => void) | null = null;
    let create: ((name?: string) => Layer) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      setVisible = result.setVisible;
      create = result.createLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      create?.('Layer 2');
    });

    const layerId = layers[0]?.id ?? '';
    act(() => {
      setVisible?.(layerId, false);
    });
    expect(layers.find((l) => l.id === layerId)?.visible).toBe(false);
  });

  it('setLocked toggles layer lock', () => {
    let layers: Layer[] = [];
    let setLocked: ((id: string, v: boolean) => void) | null = null;
    let create: ((name?: string) => Layer) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      setLocked = result.setLocked;
      create = result.createLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      create?.('Layer 2');
    });

    const layerId = layers[0]?.id ?? '';
    act(() => {
      setLocked?.(layerId, true);
    });
    expect(layers.find((l) => l.id === layerId)?.locked).toBe(true);
  });

  it('setOpacity changes layer opacity', () => {
    let layers: Layer[] = [];
    let setOpacity: ((id: string, v: number) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      layers = result.layers;
      setOpacity = result.setOpacity;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    const layerId = layers[0]?.id ?? '';
    act(() => {
      setOpacity?.(layerId, 0.5);
    });
    expect(layers.find((l) => l.id === layerId)?.opacity).toBe(0.5);
  });

  it('setActiveLayer switches active layer', () => {
    let activeId = '';
    let create: ((name?: string) => Layer) | null = null;
    let setActive: ((id: string) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      activeId = result.activeLayerId;
      create = result.createLayer;
      setActive = result.setActiveLayer;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    let newLayer: Layer | null = null;
    act(() => {
      newLayer = create?.('Layer 2') ?? null;
    });

    act(() => {
      if (newLayer) setActive?.(newLayer.id);
    });
    expect(activeId).toBe(newLayer?.id);
  });

  it('moveElement moves element to another layer', () => {
    let vp: Viewport | null = null;
    let create: ((name?: string) => Layer) | null = null;
    let moveEl: ((elId: string, layerId: string) => void) | null = null;
    function Consumer() {
      const result = useLayers();
      create = result.createLayer;
      moveEl = result.moveElement;
      return null;
    }

    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let newLayer: Layer | null = null;
    act(() => {
      newLayer = create?.('Layer 2') ?? null;
    });

    let elId = '';
    act(() => {
      const el = {
        type: 'note' as const,
        id: 'test-el',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        zIndex: 0,
        locked: false,
        layerId: vp?.layerManager.activeLayerId ?? '',
        text: '',
        backgroundColor: '#ffeb3b',
        textColor: '#000000',
      };
      vp?.store.add(el);
      elId = el.id;
    });

    act(() => {
      if (newLayer) moveEl?.(elId, newLayer.id);
    });
    expect(vp?.store.getById(elId)?.layerId).toBe(newLayer?.id);
  });
});
