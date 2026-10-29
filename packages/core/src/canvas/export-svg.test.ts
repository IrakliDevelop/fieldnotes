// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { exportSvg } from './export-svg';
import {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createText,
  createShape,
} from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createFrame } from '../elements/frame-element';
import { ElementRegistry } from '../elements/element-registry';
import { HtmlPainterRegistry, HtmlPainterMissingError } from './html-painter-registry';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  HtmlElement,
} from '../elements/types';
import { createRenderHooks } from './render-hooks';

const HTML_MARKER = 'data-distinctive-html-marker-xyz';

function htmlEl(): HtmlElement {
  return {
    id: 'html-1',
    type: 'html' as const,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    htmlType: 'chart',
    data: { marker: HTML_MARKER },
  };
}

function buildStore() {
  const store = new ElementStore();
  store.add(
    createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 50, pressure: 0.5 },
      ],
      position: { x: 0, y: 0 },
      width: 4,
    }),
  );
  store.add(
    createShape({
      position: { x: 100, y: 100 },
      size: { w: 80, h: 60 },
      shape: 'rectangle',
      fillColor: '#ff0000',
    }),
  );
  store.add(createArrow({ from: { x: 200, y: 200 }, to: { x: 300, y: 250 } }));
  store.add(createText({ position: { x: 0, y: 200 }, text: 'Hello\nWorld', color: '#123456' }));
  store.add(createNote({ position: { x: 400, y: 0 }, size: { w: 120, h: 80 }, text: 'Note' }));
  store.add(
    createImage({
      position: { x: 0, y: 400 },
      size: { w: 100, h: 100 },
      src: 'data:image/png;base64,iVBORw0KGgo=',
    }),
  );
  store.add(htmlEl());
  return store;
}

describe('exportSvg', () => {
  it('uses exact frame content bounds and excludes the frame and overlapping roots', async () => {
    const store = new ElementStore();
    const frame = createFrame({
      position: { x: 10.0625, y: 20.0625 },
      size: { w: 80.0625, h: 48.0625 },
    });
    frame.id = 'frame';
    const child = createShape({
      parentId: frame.id,
      position: { x: 20, y: 50 },
      size: { w: 10, h: 10 },
      fillColor: '#00ff00',
    });
    const overlap = createShape({
      position: { x: 10, y: 44 },
      size: { w: 80, h: 24 },
      fillColor: '#ff0000',
    });
    store.add(frame);
    store.add(child);
    store.add(overlap);

    const svg = await exportSvg(store, {
      frameId: frame.id,
      padding: 0.0625,
      background: '#123456',
    });

    expect(svg).toContain('width="80.1875" height="24.1875" viewBox="10 44 80.1875 24.1875"');
    expect(svg).toContain('<rect x="10" y="44" width="80.1875" height="24.1875" fill="#123456" />');
    expect(svg).toContain('#00ff00');
    expect(svg).not.toContain('#ff0000');
    expect(svg).not.toContain('Frame');
  });

  it('composes frame membership, filtered-parent clips, layer opacity, and exact background', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:frame-clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:frame-clip',
        data: {},
      }),
      bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 20, h: 20 }),
      clipBounds: (element) => ({ x: element.position.x, y: element.position.y, w: 20, h: 20 }),
      emitSvg: () => '',
    });
    const store = new ElementStore(registry);
    const frame = createFrame({
      position: { x: 10.0625, y: 20.0625 },
      size: { w: 80.0625, h: 48.0625 },
    });
    frame.id = 'svg-frame';
    frame.layerId = 'faded';
    store.add(frame);
    store.add({
      id: 'clip',
      type: 'extension',
      extensionType: 'test:frame-clip',
      position: { x: 20, y: 50 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: 'faded',
      parentId: frame.id,
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip',
          position: { x: 22, y: 52 },
          size: { w: 8, h: 8 },
          fillColor: '#00ff00',
          layerId: 'faded',
        }),
        { id: 'included' },
      ),
    );
    store.add(
      Object.assign(
        createShape({ position: { x: 22, y: 52 }, size: { w: 8, h: 8 }, fillColor: '#ff0000' }),
        { id: 'overlap' },
      ),
    );

    const svg = await exportSvg(
      store,
      {
        frameId: frame.id,
        padding: 0.0625,
        background: '#123456',
        filter: (element) => element.id !== 'clip',
      },
      { isLayerVisible: () => true, getLayer: () => ({ opacity: 0.5 }) } as never,
    );

    expect(svg).toContain('viewBox="10 44 80.1875 24.1875"');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('#00ff00');
    expect(svg).toContain('#123456');
    expect(svg).not.toContain('#ff0000');
  });

  it('runs empty-frame SVG hooks in order and fails capabilities closed', async () => {
    const store = new ElementStore();
    const frame = createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 48 } });
    store.add(frame);
    const order: string[] = [];
    const hooks = createRenderHooks();
    hooks.svgExport.register(
      { afterElements: () => order.push('registered') },
      { satisfies: ['x'] },
    );

    const context = {
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,hook');

    try {
      const svg = await exportSvg(store, {
        frameId: frame.id,
        padding: 2,
        afterElements: () => order.push('legacy'),
        renderHooks: hooks,
        requiredCapabilities: ['x'],
      });
      expect(order).toEqual(['legacy', 'registered']);
      expect(svg).toContain('viewBox="-2 22 84 28"');
      await expect(
        exportSvg(store, {
          frameId: frame.id,
          renderHooks: hooks,
          requiredCapabilities: ['missing'],
        }),
      ).rejects.toThrow('missing');
    } finally {
      getContext.mockRestore();
      toDataUrl.mockRestore();
    }
  });

  it('emits exact scene-order clips without masking clipping parents', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:clip',
        data: {},
      }),
      bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 100, h: 100 }),
      clipBounds: (el) =>
        el.id === 'clip-a' ? { x: 10, y: 10, w: 80, h: 80 } : { x: 40, y: 10, w: 50, h: 60 },
      emitSvg: (el) => `<rect data-fragment="${el.id}" />`,
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'clip-a',
      type: 'extension',
      extensionType: 'test:clip',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip-a',
          position: { x: 20, y: 20 },
          size: { w: 10, h: 10 },
          index: 'a1',
        }),
        { id: 'child' },
      ),
    );
    store.add({
      id: 'clip-b',
      type: 'extension',
      extensionType: 'test:clip',
      parentId: 'clip-a',
      position: { x: 40, y: 10 },
      index: 'a2',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip-b',
          position: { x: 45, y: 20 },
          size: { w: 10, h: 10 },
          index: 'a3',
        }),
        { id: 'grandchild' },
      ),
    );

    const svg = await exportSvg(store, { elementRegistry: registry });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const clips = [...doc.querySelectorAll('clipPath')];
    const groups = [...doc.querySelectorAll('g[clip-path]')];

    expect(doc.querySelector('[data-fragment="clip-a"]')?.parentElement?.tagName).toBe('svg');
    expect(
      clips.map((clip) => {
        const rect = clip.querySelector('rect');
        return [
          rect?.getAttribute('x'),
          rect?.getAttribute('y'),
          rect?.getAttribute('width'),
          rect?.getAttribute('height'),
        ];
      }),
    ).toEqual([
      ['10', '10', '80', '80'],
      ['10', '10', '80', '80'],
      ['40', '10', '50', '60'],
    ]);
    expect(groups.map((group) => group.getAttribute('clip-path'))).toEqual([
      'url(#fieldnotes-export-clip-0)',
      'url(#fieldnotes-export-clip-1)',
      'url(#fieldnotes-export-clip-2)',
    ]);
    expect(groups.map((group) => group.firstElementChild?.getAttribute('x'))).toEqual([
      '20',
      null,
      '45',
    ]);
    expect(groups[1]?.querySelector('[data-fragment="clip-b"]')).not.toBeNull();
    expect(clips.map((clip) => clip.id)).toEqual([
      'fieldnotes-export-clip-0',
      'fieldnotes-export-clip-1',
      'fieldnotes-export-clip-2',
    ]);
  });

  it('skips two colliding prefixes from extension and hook ids', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:colliding-clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:colliding-clip',
        data: {},
      }),
      bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 100, h: 100 }),
      clipBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      emitSvg: (el) =>
        el.id === 'parent'
          ? '<g id = "fieldnotes-export-clip-0" data-consumer="extension" />'
          : `<rect data-fragment="${el.id}" />`,
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'parent',
      type: 'extension',
      extensionType: 'test:colliding-clip',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'parent',
          position: { x: 10, y: 10 },
          size: { w: 5, h: 5 },
          index: 'a1',
        }),
        { id: 'first' },
      ),
    );
    store.add(
      Object.assign(
        createShape({
          parentId: 'parent',
          position: { x: 20, y: 20 },
          size: { w: 5, h: 5 },
          index: 'a2',
        }),
        { id: 'second' },
      ),
    );
    const hooks = createRenderHooks();
    hooks.svgExport.register({
      afterElements: ({ appendSvg }) =>
        appendSvg(
          '<g id\t=\t\'fieldnotes-export-clip-1-1\' data-id="fieldnotes-export-clip-2-0" data-consumer="hook" />',
        ),
    });

    const svg = await exportSvg(store, { elementRegistry: registry, renderHooks: hooks });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
    const generated = [...doc.querySelectorAll('clipPath')].map((node) => node.id);

    expect(generated).toEqual(['fieldnotes-export-clip-2-0', 'fieldnotes-export-clip-2-1']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg).toContain('id = "fieldnotes-export-clip-0"');
    expect(svg).toContain("id\t=\t'fieldnotes-export-clip-1-1'");
    expect(svg).toContain('data-id="fieldnotes-export-clip-2-0"');
    expect(
      [...doc.querySelectorAll('g[clip-path]')].map((node) => node.getAttribute('clip-path')),
    ).toEqual(['url(#fieldnotes-export-clip-2-0)', 'url(#fieldnotes-export-clip-2-1)']);
  });

  it('reuses deterministic export-local ids for identical exports', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:deterministic-clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:deterministic-clip',
        data: {},
      }),
      bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 100, h: 100 }),
      clipBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'parent',
      type: 'extension',
      extensionType: 'test:deterministic-clip',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      createShape({
        parentId: 'parent',
        position: { x: 10, y: 10 },
        size: { w: 5, h: 5 },
        index: 'a1',
      }),
    );

    const ids = async () => {
      const doc = new DOMParser().parseFromString(
        await exportSvg(store, { elementRegistry: registry }),
        'image/svg+xml',
      );
      return [...doc.querySelectorAll('clipPath, g[clip-path]')].map(
        (node) => node.id || node.getAttribute('clip-path'),
      );
    };
    expect(await ids()).toEqual(await ids());
  });

  it('does not derive generated ids from hostile element ids', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:hostile-clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:hostile-clip',
        data: {},
      }),
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      clipBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'clip',
      type: 'extension',
      extensionType: 'test:hostile-clip',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip',
          position: { x: 10, y: 10 },
          size: { w: 5, h: 5 },
          index: 'a1',
        }),
        { id: 'hostile & <id> /?' },
      ),
    );

    const svg = await exportSvg(store, { elementRegistry: registry });
    expect(
      [...svg.matchAll(/(?:id|clip-path)="([^"]+)"/g)].map((match) => match[1]).join(''),
    ).not.toContain('hostile');
  });

  it('keeps raw view-box geometry for an omitted large descendant', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:empty',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:empty',
        data: {},
      }),
      bounds: (el) => ({
        x: el.position.x,
        y: el.position.y,
        w: el.id === 'large' ? 1000 : 100,
        h: el.id === 'large' ? 800 : 100,
      }),
      clipBounds: (el) => (el.id === 'clip' ? { x: 0, y: 0, w: 100, h: 100 } : null),
      emitSvg: () => '',
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'clip',
      type: 'extension',
      extensionType: 'test:empty',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add({
      id: 'large',
      type: 'extension',
      extensionType: 'test:empty',
      parentId: 'clip',
      position: { x: 500, y: 500 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(createShape({ position: { x: 10, y: 10 }, size: { w: 5, h: 5 }, index: 'a2' }));
    expect(await exportSvg(store, { elementRegistry: registry })).toContain(
      'viewBox="0 0 1500 1300"',
    );
  });

  it('omits hidden and empty descendants before preparation or definition allocation', async () => {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:classify',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:classify',
        data: {},
      }),
      bounds: (el) =>
        el.id === 'null' ? null : { x: el.position.x, y: el.position.y, w: 100, h: 100 },
      clipBounds: (el) => (el.id === 'clip' ? { x: 0, y: 0, w: 100, h: 100 } : null),
      emitSvg: (el) => (el.id === 'empty' ? '' : `<rect data-fragment="${el.id}" />`),
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'clip',
      type: 'extension',
      extensionType: 'test:classify',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip',
          position: { x: 10, y: 10 },
          size: { w: 10, h: 10 },
          index: 'a1',
        }),
        { id: 'visible' },
      ),
    );
    store.add(
      Object.assign(
        createShape({
          parentId: 'clip',
          position: { x: 200, y: 200 },
          size: { w: 10, h: 10 },
          index: 'a2',
        }),
        { id: 'disjoint' },
      ),
    );
    store.add({
      id: 'null',
      type: 'extension',
      extensionType: 'test:classify',
      parentId: 'clip',
      position: { x: 10, y: 10 },
      index: 'a3',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    store.add({
      id: 'empty',
      type: 'extension',
      extensionType: 'test:classify',
      parentId: 'clip',
      position: { x: 10, y: 10 },
      index: 'a4',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    const dom = htmlEl();
    dom.id = 'dom-disjoint';
    dom.parentId = 'clip';
    dom.position = { x: 200, y: 10 };
    dom.index = 'a5';
    const canvas = markerElement({
      id: 'canvas-disjoint',
      parentId: 'clip',
      position: { x: 200, y: 20 },
      index: 'a6',
    });
    store.add(dom);
    store.add(canvas);
    store.add(
      Object.assign(
        createShape({
          parentId: 'missing',
          position: { x: 500, y: 500 },
          size: { w: 10, h: 10 },
        }),
        { id: 'unresolved' },
      ),
      { origin: 'remote' },
    );
    const renderHtml = vi.fn();
    const painters = registryWith('rk-marker');
    const paint = vi.fn();
    painters.register('rk-marker', paint);

    const onHtmlError = vi.fn();
    const svg = await exportSvg(store, {
      renderHtml,
      htmlPainters: painters,
      expectedCanvasTypes: new Set(['rk-marker']),
      strictMissingCanvasHtml: true,
      elementRegistry: registry,
      onHtmlError,
    });

    expect(renderHtml).not.toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
    expect(onHtmlError).not.toHaveBeenCalled();
    expect(svg).toContain('x="10"');
    expect(svg).not.toContain('data-fragment="empty"');
    expect(svg).not.toContain('x="200"');
    expect(svg.match(/<clipPath/g)).toHaveLength(1);
  });

  it('leaves background full-canvas overlay and hook output outside element clips', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const order: string[] = [];
      const registry = new ElementRegistry();
      registry.register({
        type: 'test:outputs',
        legacyTypes: [],
        decodeLegacy: () => {
          throw new Error('no legacy');
        },
        validateData: () => true,
        unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
        wrap: ({ type: _type, ...base }) => ({
          ...base,
          type: 'extension',
          extensionType: 'test:outputs',
          data: {},
        }),
        bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
        clipBounds: (el) => (el.id === 'clip' ? { x: 0, y: 0, w: 100, h: 100 } : null),
        emitSvg: (el) => {
          order.push(el.id);
          return '';
        },
      });
      registry.register({
        type: 'test:full-output',
        legacyTypes: [],
        decodeLegacy: () => {
          throw new Error('no legacy');
        },
        validateData: () => true,
        unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
        wrap: ({ type: _type, ...base }) => ({
          ...base,
          type: 'extension',
          extensionType: 'test:full-output',
          data: {},
        }),
        bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
        fullCanvas: true,
        emitSvg: (el) => {
          order.push(el.id);
          return '<g data-full="true" />';
        },
      });
      const store = new ElementStore(registry);
      store.add({
        id: 'clip',
        type: 'extension',
        extensionType: 'test:outputs',
        position: { x: 0, y: 0 },
        index: 'a0',
        version: 1,
        locked: false,
        layerId: '',
        data: {},
      });
      store.add({
        id: 'last',
        type: 'extension',
        extensionType: 'test:outputs',
        position: { x: 20, y: 20 },
        index: 'a3',
        version: 1,
        locked: false,
        layerId: '',
        data: {},
      });
      store.add(
        Object.assign(
          createShape({
            parentId: 'clip',
            position: { x: 10, y: 10 },
            size: { w: 10, h: 10 },
            index: 'a1',
          }),
          { id: 'ordinary' },
        ),
      );
      store.add({
        id: 'full',
        type: 'extension',
        extensionType: 'test:full-output',
        position: { x: 0, y: 0 },
        index: 'a2',
        version: 1,
        locked: false,
        layerId: '',
        data: {},
      });
      const hooks = createRenderHooks();
      hooks.svgExport.register({
        afterElements: ({ appendSvg }) => {
          order.push('hook');
          appendSvg('<g id="fieldnotes-export-clip-0" data-hook="true" />');
        },
      });

      const doc = new DOMParser().parseFromString(
        await exportSvg(store, {
          elementRegistry: registry,
          background: '#fff',
          afterElements: () => order.push('overlay'),
          renderHooks: hooks,
        }),
        'image/svg+xml',
      );
      const root = doc.documentElement;
      const visible = [...root.children].filter((node) => node.tagName !== 'defs');
      expect(order).toEqual(['clip', 'full', 'last', 'overlay', 'hook']);
      expect(visible.map((node) => node.tagName)).toEqual(['rect', 'g', 'g', 'image', 'g']);
      expect(root.querySelector('[data-full="true"]')?.closest('g[clip-path]')).toBeNull();
      expect(root.querySelector('[data-hook="true"]')?.closest('g[clip-path]')).toBeNull();
      expect(root.querySelector('image')?.closest('g[clip-path]')).toBeNull();
      expect(root.querySelector('rect[fill="#fff"]')?.closest('g[clip-path]')).toBeNull();
      expect(root.querySelector('g[clip-path] > rect')).not.toBeNull();
      expect(root.querySelector('clipPath')?.id).toBe('fieldnotes-export-clip-1-0');
    } finally {
      restore();
    }
  });

  it('passes the computed padded view box to inline extension SVG emitters', async () => {
    let receivedViewBox: { x: number; y: number; w: number; h: number } | undefined;
    const definition: ElementTypeDefinition<BaseElement> = {
      type: 'test:inline-svg',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:inline-svg',
        data: {},
      }),
      bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 30, h: 40 }),
      emitSvg: (_el, _allElements, viewBox) => {
        receivedViewBox = viewBox;
        return '<rect data-inline-extension="true" />';
      },
    };
    const registry = new ElementRegistry();
    registry.register(definition);
    const store = new ElementStore(registry);
    const element: ExtensionElementEnvelope = {
      id: 'inline-svg',
      type: 'extension',
      extensionType: 'test:inline-svg',
      position: { x: 100, y: 200 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    };
    store.add(element);

    const svg = await exportSvg(store, { elementRegistry: registry, padding: 7 });

    expect(receivedViewBox).toEqual({ x: 93, y: 193, w: 44, h: 54 });
    expect(svg).toContain('viewBox="93 193 44 54"');
    expect(svg).toContain('data-inline-extension="true"');
  });

  it('passes frame inline emitters the original scene but gates output by membership', async () => {
    const received: { id: string; scene: string[] }[] = [];
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:frame-inline',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:frame-inline',
        data: {},
      }),
      bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
      emitSvg: (element, allElements) => {
        received.push({ id: element.id, scene: allElements.map(({ id }) => id) });
        return `<rect data-frame-inline="${element.id}" />`;
      },
    });
    registry.register({
      type: 'test:frame-full',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:frame-full',
        data: {},
      }),
      bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
      fullCanvas: true,
      emitSvg: (element, allElements) => {
        received.push({ id: element.id, scene: allElements.map(({ id }) => id) });
        return `<rect data-frame-full="${element.id}" />`;
      },
    });
    const store = new ElementStore(registry);
    const frame = createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    frame.id = 'frame';
    const inline = {
      id: 'inline-child',
      type: 'extension' as const,
      extensionType: 'test:frame-inline',
      position: { x: 20, y: 30 },
      index: 'b',
      version: 1,
      locked: false,
      layerId: '',
      parentId: frame.id,
      data: {},
    };
    const root = { ...inline, id: 'inline-root', index: 'c', parentId: undefined };
    const full = {
      ...inline,
      id: 'full-root',
      index: 'd',
      parentId: undefined,
      extensionType: 'test:frame-full',
    };
    store.add(frame);
    store.add(inline);
    store.add(root);
    store.add(full);

    const frameSvg = await exportSvg(store, { frameId: frame.id, elementRegistry: registry });
    expect(frameSvg).toContain('data-frame-inline="inline-child"');
    expect(frameSvg).not.toContain('inline-root');
    expect(frameSvg).not.toContain('full-root');
    expect(received).toEqual([
      { id: inline.id, scene: ['frame', 'inline-child', 'inline-root', 'full-root'] },
    ]);

    received.length = 0;
    await exportSvg(store, {
      elementRegistry: registry,
      filter: (element) => element.id === inline.id || element.id === full.id,
    });
    expect(received).toEqual([
      { id: inline.id, scene: ['frame', 'inline-child', 'inline-root', 'full-root'] },
      { id: full.id, scene: ['inline-child', 'full-root'] },
    ]);
  });

  it.each([
    [{ padding: -1 }, 'padding'],
    [{ rasterScale: 0 }, 'rasterScale'],
    [{ maxDimension: Number.POSITIVE_INFINITY }, 'maxDimension'],
    [{ htmlTimeoutMs: 0 }, 'htmlTimeoutMs'],
  ])('rejects invalid options %o', async (options, optionName) => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    await expect(exportSvg(store, options)).rejects.toThrow(optionName);
  });

  it('rejects output exceeding its configured size limits', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
    await expect(exportSvg(store, { maxPixels: 9_999 })).rejects.toThrow('maximum of 9999 pixels');
  });

  it('wraps exported elements in their layer opacity', async () => {
    const store = new ElementStore();
    store.add(createShape({ layerId: 'faded', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
    const layerManager = {
      isLayerVisible: () => true,
      getLayer: () => ({ opacity: 0.25 }),
    };

    const svg = await exportSvg(store, {}, layerManager as never);

    expect(svg).toContain('<g opacity="0.25"><rect');
  });

  it('returns an empty svg for an empty store', async () => {
    const svg = await exportSvg(new ElementStore());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 0 0"');
  });

  it('produces a well-formed svg with a viewBox reflecting content + padding', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { background: '#fff', padding: 10 });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

    const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
    expect(vb).not.toBeNull();
    if (vb) {
      const x = Number(vb[1]);
      const y = Number(vb[2]);
      const w = Number(vb[3]);
      const h = Number(vb[4]);
      // content spans roughly x:[0..520], y:[0..500]; padding 10 pushes origin negative
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(w).toBeGreaterThan(500);
      expect(h).toBeGreaterThan(450);
    }
  });

  it('emits a background rect when background is provided', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { background: '#fff' });
    expect(svg).toMatch(/<rect[^>]*fill="#fff"/);
  });

  it('emits paths for stroke and arrow', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toContain('<path');
    // arrowhead polygon
    expect(svg).toContain('<polygon');
  });

  it('emits a rect for the rectangle shape', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toMatch(/<rect[^>]*fill="#ff0000"/);
  });

  it('rasterizes text elements to an <image> and never emits literal HTML tags', async () => {
    // Text now renders RICH via the shared canvas renderer, rasterized to a data-URI
    // <image> (like notes). Under a working canvas it is an <image>; under jsdom's
    // null-context degradation the text is simply skipped — either way no raw <text>
    // node carrying the literal markup is emitted.
    const store = new ElementStore();
    store.add(
      createText({
        position: { x: 0, y: 200 },
        size: { w: 200, h: 60 },
        text: 'Line 1<b>bold</b>',
        color: '#123456',
      }),
    );

    const origCreate = document.createElement.bind(document);
    const ctxStub = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 40 }),
      fillStyle: '',
      font: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(ctxStub as never);
        vi.spyOn(el as HTMLCanvasElement, 'toDataURL').mockReturnValue(
          'data:image/png;base64,AAAA',
        );
      }
      return el;
    });

    const svg = await exportSvg(store);
    vi.restoreAllMocks();

    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
    // No raw <text> emitter and no literal/escaped markup leaking into the SVG.
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('&lt;b&gt;');
  });

  it('emits an image element (data-uri passthrough)', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('excludes html embeds', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).not.toContain(HTML_MARKER);
  });

  it('embeds html renderer output as a rotated raster image', async () => {
    const store = new ElementStore();
    const html = htmlEl();
    html.rotation = Math.PI / 2;
    store.add(html);
    const source = document.createElement('canvas');
    const originalCreate = document.createElement.bind(document);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = originalCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(node as HTMLCanvasElement, 'getContext').mockReturnValue(ctx as never);
        vi.spyOn(node as HTMLCanvasElement, 'toDataURL').mockReturnValue(
          'data:image/png;base64,HTML',
        );
      }
      return node;
    });

    const svg = await exportSvg(store, { renderHtml: () => source });
    vi.restoreAllMocks();

    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 200, 200);
    expect(svg).toContain('data:image/png;base64,HTML');
    expect(svg).toMatch(/<g transform="rotate\(90 /);
  });

  it('snaps a bound arrow endpoint to the target edge, not its raw center', async () => {
    const store = new ElementStore();
    // Note spans x:[300..400], y:[180..220]; its center is (350, 200).
    const note = createNote({ position: { x: 300, y: 180 }, size: { w: 100, h: 40 } });
    store.add(note);
    // Arrow comes in horizontally from the left, terminating at the note CENTER.
    const arrow = createArrow({ from: { x: 100, y: 200 }, to: { x: 350, y: 200 } });
    arrow.toBinding = { elementId: note.id };
    store.add(arrow);

    const svg = await exportSvg(store);

    // Binding no longer forces dashing — a bound arrow with no strokeStyle is SOLID.
    expect(svg).not.toContain('stroke-dasharray');

    const path = svg.match(/<path d="M[^"]*L([\d.]+) ([\d.]+)"/);
    expect(path).not.toBeNull();
    if (path) {
      const endX = Number(path[1]);
      const endY = Number(path[2]);
      // Snapped to the left edge of the note (x≈300), NOT the raw center (x=350).
      expect(endX).toBeCloseTo(300, 0);
      expect(endX).toBeLessThan(350);
      expect(endY).toBeCloseTo(200, 0);
    }

    // The arrowhead polygon tip sits at the snapped endpoint too, not the center.
    const poly = svg.match(/<polygon points="([\d.]+),([\d.]+)/);
    expect(poly).not.toBeNull();
    if (poly) {
      expect(Number(poly[1])).toBeCloseTo(300, 0);
      expect(Number(poly[1])).toBeLessThan(350);
    }
  });

  it('keeps frame arrows bound to excluded targets without emitting their output', async () => {
    const store = new ElementStore();
    const frame = createFrame({ position: { x: 100, y: 100 }, size: { w: 240, h: 164 } });
    frame.id = 'arrow-frame';
    const target = createShape({
      position: { x: 400, y: 180 },
      size: { w: 100, h: 40 },
      fillColor: '#ff00ff',
    });
    target.id = 'excluded-target';
    const arrow = createArrow({ from: { x: 200, y: 200 }, to: { x: 450, y: 200 } });
    arrow.id = 'included-arrow';
    arrow.parentId = frame.id;
    arrow.toBinding = { elementId: target.id };
    store.add(frame);
    store.add(arrow);
    store.add(target);

    const svg = await exportSvg(store, { frameId: frame.id });
    const path = svg.match(/<path d="M[^"]*L([\d.]+) ([\d.]+)"/);
    const arrowhead = svg.match(/<polygon points="([\d.]+),([\d.]+)/);

    expect(path?.slice(1)).toEqual(['400', '200']);
    expect(arrowhead?.slice(1)).toEqual(['400', '200']);
    expect(svg).not.toContain('#ff00ff');
  });

  it('emits stroke-dasharray="8 4" for a dashed arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'dashed' }));
    const svg = await exportSvg(store);
    expect(svg).toContain('stroke-dasharray="8 4"');
  });

  it('emits stroke-dasharray="2 4" for a dotted arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'dotted' }));
    const svg = await exportSvg(store);
    expect(svg).toContain('stroke-dasharray="2 4"');
  });

  it('omits stroke-dasharray for a solid arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'solid' }));
    const svg = await exportSvg(store);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('renders a bound solid arrow without dasharray (decoupled from binding)', async () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 300, y: 180 }, size: { w: 100, h: 40 } });
    store.add(note);
    const arrow = createArrow({ from: { x: 100, y: 200 }, to: { x: 350, y: 200 } });
    arrow.toBinding = { elementId: note.id };
    store.add(arrow);
    const svg = await exportSvg(store);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('wraps rotated elements in a rotation group', async () => {
    const store = new ElementStore();
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    shape.rotation = Math.PI / 2;
    store.add(shape);
    const svg = await exportSvg(store);
    expect(svg).toMatch(/<g transform="rotate\(90 /);
  });

  it('respects the filter option', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { filter: (el) => el.type === 'shape' });
    expect(svg).toMatch(/<rect[^>]*fill="#ff0000"/);
    expect(svg).not.toContain('<polygon');
  });

  it('skips elements on hidden layers', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, layerId: 'hidden' }));
    store.add(
      createShape({
        position: { x: 200, y: 200 },
        size: { w: 50, h: 50 },
        fillColor: '#00ff00',
        layerId: 'visible',
      }),
    );
    const layerManager = { isLayerVisible: (id: string) => id === 'visible' };
    const svg = await exportSvg(store, {}, layerManager as never);
    expect(svg).toMatch(/<rect[^>]*fill="#00ff00"/);
    // hidden shape would sit at origin; visible shape at 200,200 — viewBox origin near 200
    const vb = svg.match(/viewBox="([\d.]+) ([\d.]+)/);
    expect(vb).not.toBeNull();
    if (vb) {
      expect(Number(vb[1])).toBeGreaterThanOrEqual(200);
    }
  });

  it('degrades note to a background-color rect when canvas raster is unavailable (jsdom)', async () => {
    // jsdom canvas.getContext returns null, so the note emitter falls back to a
    // colored placeholder rect rather than a rasterized <image>.
    const store = new ElementStore();
    store.add(
      createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 60 },
        backgroundColor: '#abcabc',
        text: 'x',
      }),
    );
    const svg = await exportSvg(store);
    // Either a rasterized image (if canvas works) or a placeholder rect.
    const hasImage = svg.includes('<image');
    const hasPlaceholder = /<rect[^>]*fill="#abcabc"/.test(svg);
    expect(hasImage || hasPlaceholder).toBe(true);
  });
});

// --- canvas-routed html raster helpers -------------------------------------------------
//
// jsdom's HTMLCanvasElement.getContext('2d') returns null (no `canvas` npm package is
// installed in this workspace — confirmed via `pnpm ls canvas -r`), so real pixel
// rasterization is unavailable. To genuinely test "did the localizing transform run"
// rather than merely "was fillRect called with plausible-looking arguments", the mock
// below implements a small software affine-transform + pixel-buffer simulation: it tracks
// the real cumulative matrix through save/scale/translate/rotate calls exactly as a real
// CanvasRenderingContext2D would, and fillRect marks pixels in a same-sized buffer only
// where that matrix actually places them. A missing localizing translate therefore maps
// fillRect's coordinates outside the buffer for real, not by assertion — the resulting
// data URI (still prefixed `data:image/png;base64,` so it matches the SVG's <image> href
// regex) carries a JSON-encoded alpha buffer that `opaquePixelRatio` decodes and measures.

interface FakeMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const FAKE_IDENTITY: FakeMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function matMul(m1: FakeMatrix, m2: FakeMatrix): FakeMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function matApply(m: FakeMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// This file always runs under `@vitest-environment jsdom` (see the top-of-file pragma),
// so the browser-global btoa/atob are always present — no Node Buffer fallback needed.
function toBase64(json: string): string {
  return btoa(json);
}

function fromBase64(encoded: string): string {
  return atob(encoded);
}

/** Builds a fake 2D context + matching toDataURL backed by a real simulated pixel buffer. */
function createFakeRasterContext(
  width: number,
  height: number,
  rotateLog: number[],
): { ctx: CanvasRenderingContext2D; toDataURL: () => string } {
  const alpha = new Uint8ClampedArray(Math.max(0, width * height));
  let current: FakeMatrix = FAKE_IDENTITY;
  const stack: FakeMatrix[] = [];
  let globalAlpha = 1;

  const ctx = {
    save: () => stack.push(current),
    restore: () => {
      const m = stack.pop();
      if (m) current = m;
    },
    scale: (sx: number, sy: number) => {
      current = matMul(current, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    translate: (dx: number, dy: number) => {
      current = matMul(current, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
    },
    rotate: (theta: number) => {
      rotateLog.push(theta);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      current = matMul(current, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
    },
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillRect: (x: number, y: number, w: number, h: number) => {
      const corners = [
        matApply(current, x, y),
        matApply(current, x + w, y),
        matApply(current, x, y + h),
        matApply(current, x + w, y + h),
      ];
      const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
      const maxX = Math.min(width, Math.ceil(Math.max(...corners.map((c) => c.x))));
      const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
      const maxY = Math.min(height, Math.ceil(Math.max(...corners.map((c) => c.y))));
      for (let py = minY; py < maxY; py++) {
        for (let px = minX; px < maxX; px++) {
          alpha[py * width + px] = 255;
        }
      }
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    fillStyle: '#000000',
  } as unknown as CanvasRenderingContext2D;

  const toDataURL = (): string => {
    const payload = JSON.stringify({ width, height, alpha: Array.from(alpha) });
    return `data:image/png;base64,${toBase64(payload)}`;
  };

  return { ctx, toDataURL };
}

/** Fraction of pixels with nonzero alpha in a data URI produced by createFakeRasterContext. */
async function opaquePixelRatio(dataUri: string): Promise<number> {
  const commaIndex = dataUri.indexOf(',');
  const base64 = commaIndex === -1 ? '' : dataUri.slice(commaIndex + 1);
  const parsed = JSON.parse(fromBase64(base64)) as { alpha: number[] };
  if (parsed.alpha.length === 0) return 0;
  const opaque = parsed.alpha.filter((a) => a > 0).length;
  return opaque / parsed.alpha.length;
}

/** Routes every `document.createElement('canvas')` to a fake raster context/buffer.
 *  Returns the rotate-call log (shared across every canvas created while installed,
 *  since these tests only ever raster one html element at a time) and a restore fn. */
function installFakeRasterCanvas(): { rotateLog: number[]; restore: () => void } {
  const rotateLog: number[] = [];
  const origCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const node = origCreate(tag);
    if (tag === 'canvas') {
      const canvasEl = node as HTMLCanvasElement;
      vi.spyOn(canvasEl, 'getContext').mockImplementation(() => {
        const { ctx, toDataURL } = createFakeRasterContext(
          canvasEl.width,
          canvasEl.height,
          rotateLog,
        );
        vi.spyOn(canvasEl, 'toDataURL').mockImplementation(toDataURL);
        return ctx as never;
      });
    }
    return node;
  });
  return { rotateLog, restore: () => spy.mockRestore() };
}

function markerElement(overrides: Partial<HtmlElement> = {}): HtmlElement {
  return {
    id: 'marker-1',
    type: 'html',
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    htmlType: 'rk-marker',
    ...overrides,
  };
}

function storeWith(el: HtmlElement): ElementStore {
  const store = new ElementStore();
  store.add(el);
  return store;
}

/** A registry with an active painter for `htmlType` that does nothing (pixel-agnostic). */
function registryWith(htmlType: string): HtmlPainterRegistry {
  const registry = new HtmlPainterRegistry();
  registry.expect([htmlType]);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  registry.register(htmlType, () => {});
  return registry;
}

function layersWithOpacity(opacity: number): {
  isLayerVisible: () => boolean;
  getLayer: () => { opacity: number };
} {
  return {
    isLayerVisible: () => true,
    getLayer: () => ({ opacity }),
  };
}

describe('exportSvg — required render capabilities', () => {
  function shapeStore(): ElementStore {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
    return store;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['a store with content', shapeStore()],
    ['an empty store', new ElementStore()],
  ])('rejects a missing required capability without render hooks for %s', async (_, store) => {
    await expect(exportSvg(store, { requiredCapabilities: ['x', 'y'] })).rejects.toThrow(
      'Required render capabilities are missing on svgExport: x, y',
    );
  });

  it('rejects a requirement stored on the registry, as a viewport export inherits it', async () => {
    const renderHooks = createRenderHooks();
    renderHooks.svgExport.setRequiredCapabilities(['x']);

    await expect(exportSvg(shapeStore(), { renderHooks })).rejects.toThrow(
      'Required render capabilities are missing on svgExport: x',
    );
  });

  it('resolves when a registered, enabled hook satisfies the requirement', async () => {
    const renderHooks = createRenderHooks();
    renderHooks.svgExport.register(
      { afterElements: ({ appendSvg }) => appendSvg('<g id="fog"/>') },
      { satisfies: ['x'] },
    );

    const svg = await exportSvg(shapeStore(), { renderHooks, requiredCapabilities: ['x'] });

    expect(svg).toContain('<g id="fog"/>');
  });

  it('reports a throwing optional hook and still resolves', async () => {
    const reportSpy = vi.fn();
    vi.stubGlobal('reportError', reportSpy);
    const renderHooks = createRenderHooks();
    renderHooks.svgExport.register({
      afterElements: () => {
        throw new Error('decor failed');
      },
    });
    renderHooks.svgExport.register({
      afterElements: ({ appendSvg }) => appendSvg('<g id="later"/>'),
    });

    const svg = await exportSvg(shapeStore(), { renderHooks });

    expect(svg).toContain('<g id="later"/>');
    expect(reportSpy).toHaveBeenCalledWith(new Error('decor failed'));
  });

  it('rejects when the hook satisfying a required capability throws', async () => {
    vi.stubGlobal('reportError', vi.fn());
    const renderHooks = createRenderHooks();
    renderHooks.svgExport.register(
      {
        afterElements: () => {
          throw new Error('fog failed');
        },
      },
      { satisfies: ['x'] },
    );

    await expect(
      exportSvg(shapeStore(), { renderHooks, requiredCapabilities: ['x'] }),
    ).rejects.toThrow('Required render capabilities are missing on svgExport: x');
  });
});

describe('exportSvg canvas-routed html', () => {
  function clippedHtmlStore(html: HtmlElement[]): {
    store: ElementStore;
    registry: ElementRegistry;
  } {
    const registry = new ElementRegistry();
    registry.register({
      type: 'test:html-clip',
      legacyTypes: [],
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
      wrap: ({ type: _type, ...base }) => ({
        ...base,
        type: 'extension',
        extensionType: 'test:html-clip',
        data: {},
      }),
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      clipBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    });
    const store = new ElementStore(registry);
    store.add({
      id: 'clip-parent',
      type: 'extension',
      extensionType: 'test:html-clip',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: html[0]?.layerId ?? '',
      data: {},
    });
    for (const element of html) store.add({ ...element, parentId: 'clip-parent' });
    return { store, registry };
  }

  it('rasterises a marker at a NONZERO position into non-blank pixels', async () => {
    // Discriminating: a missing localizing transform paints outside the offscreen
    // canvas and yields a fully transparent raster, which an <image>-presence
    // assertion alone would happily accept.
    const { restore } = installFakeRasterCanvas();
    try {
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', ({ ctx, size }) => {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, size.w, size.h);
      });
      const el = markerElement({ position: { x: 640, y: 480 } });
      const svg = await exportSvg(storeWith(el), { htmlPainters: registry });
      const dataUri = /href="(data:image\/[^"]+)"/.exec(svg)?.[1];
      if (dataUri === undefined) throw new Error('expected an embedded raster data URI');
      expect(await opaquePixelRatio(dataUri)).toBeGreaterThan(0.9);
    } finally {
      restore();
    }
  });

  it('does not double-apply rotation: the raster is unrotated, the <image> carries rotate()', async () => {
    const { rotateLog, restore } = installFakeRasterCanvas();
    try {
      const svg = await exportSvg(storeWith(markerElement({ rotation: 0.3 })), {
        htmlPainters: registryWith('rk-marker'),
      });
      expect(svg).toContain('<image');
      expect(svg).toMatch(/rotate\(/);
      expect(rotateLog.length).toBe(0); // spy installed on the offscreen context
    } finally {
      restore();
    }
  });

  it('wraps a translucent layer once in a <g opacity> and not in the raster', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      // Poison value: if the painter never runs (e.g. the marker is silently dropped
      // instead of routed to canvas), this stays -1 and the assertion fails — it must
      // not be able to pass just because nothing ran.
      let observed = -1;
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', ({ ctx }) => {
        observed = ctx.globalAlpha;
      });
      const svg = await exportSvg(
        storeWith(markerElement()),
        { htmlPainters: registry },
        layersWithOpacity(0.5) as never,
      );
      expect(observed).toBe(1);
      expect(svg).toContain('<g opacity="0.5">');
    } finally {
      restore();
    }
  });

  it('wraps canvas-routed and DOM-raster HTML images in their effective clip groups', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const canvasElement = markerElement({ id: 'canvas', position: { x: 10, y: 10 } });
      const domElement = htmlEl();
      domElement.id = 'dom';
      domElement.position = { x: 40, y: 20 };
      domElement.index = 'a2';
      const { store, registry: elementRegistry } = clippedHtmlStore([canvasElement, domElement]);
      const painters = registryWith('rk-marker');
      const paint = vi.fn();
      painters.register('rk-marker', paint);
      const source = document.createElement('canvas');
      const renderHtml = vi.fn(() => source);

      const doc = new DOMParser().parseFromString(
        await exportSvg(store, { elementRegistry, htmlPainters: painters, renderHtml }),
        'image/svg+xml',
      );
      const images = [...doc.querySelectorAll('image')];
      expect(renderHtml).toHaveBeenCalledTimes(1);
      expect(paint).toHaveBeenCalledTimes(1);
      expect(images.map((image) => image.parentElement?.getAttribute('clip-path'))).toEqual([
        'url(#fieldnotes-export-clip-0)',
        'url(#fieldnotes-export-clip-1)',
      ]);
    } finally {
      restore();
    }
  });

  it('keeps clipped HTML inside one translucent layer opacity group', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      let alpha = -1;
      const painters = new HtmlPainterRegistry();
      painters.expect(['rk-marker']);
      painters.register('rk-marker', ({ ctx }) => {
        alpha = ctx.globalAlpha;
      });
      const element = markerElement({ layerId: 'faded' });
      const { store, registry } = clippedHtmlStore([element]);
      const doc = new DOMParser().parseFromString(
        await exportSvg(
          store,
          { elementRegistry: registry, htmlPainters: painters },
          layersWithOpacity(0.5) as never,
        ),
        'image/svg+xml',
      );
      const opacity = doc.querySelector('g[opacity="0.5"]');
      expect(alpha).toBe(1);
      expect(opacity?.querySelector(':scope > g[clip-path] > image')).not.toBeNull();
      expect(doc.querySelector('defs')?.parentElement?.tagName).toBe('svg');
      expect(doc.querySelectorAll('g[opacity="0.5"]')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('throws HtmlPainterMissingError under strictMissingCanvasHtml', async () => {
    await expect(
      exportSvg(storeWith(markerElement()), {
        expectedCanvasTypes: new Set(['rk-marker']),
        strictMissingCanvasHtml: true,
      }),
    ).rejects.toBeInstanceOf(HtmlPainterMissingError);
  });

  it('reports missing-painter without throwing when strict is off', async () => {
    const onHtmlError = vi.fn();
    const svg = await exportSvg(storeWith(markerElement()), {
      expectedCanvasTypes: new Set(['rk-marker']),
      onHtmlError,
    });
    expect(svg).not.toContain('<image');
    expect(onHtmlError).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'marker-1', reason: 'missing-painter' }),
    );
  });

  it('reports missing-painter for a painter unregistered during the html await', async () => {
    // Routing is resolved BEFORE `await renderHtmlElements(...)`, the painter is looked up
    // after. Unregistering inside that window used to drop the element with no diagnostic.
    const { restore } = installFakeRasterCanvas();
    try {
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const unregister = registry.register('rk-marker', () => {});
      const store = new ElementStore();
      store.add(markerElement({ id: 'legacy-embed', htmlType: 'legacy-embed' })); // DOM-routed
      store.add(markerElement());
      const onHtmlError = vi.fn();

      const svg = await exportSvg(store, {
        htmlPainters: registry,
        onHtmlError,
        // Runs inside the awaited window, after routing was decided.
        renderHtml: () => {
          unregister();
          return null;
        },
      });

      expect(svg).toContain('<svg');
      expect(onHtmlError).toHaveBeenCalledWith(
        expect.objectContaining({ elementId: 'marker-1', reason: 'missing-painter' }),
      );
    } finally {
      restore();
    }
  });

  it('does NOT ask renderHtml for canvas-routed elements', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const renderHtml = vi.fn();
      await exportSvg(storeWith(markerElement()), {
        htmlPainters: registryWith('rk-marker'),
        renderHtml,
      });
      expect(renderHtml).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  // Supplementary to the brief's Step 1 list (mirrors A7's export-image coverage):
  // Step 3 also requires forwarding paintHtmlElement's own diagnostics into onHtmlError
  // with matching reasons — verify the wiring, not just the routing.
  it('forwards a painter-threw diagnostic to onHtmlError with the cause', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const boom = new Error('boom');
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', () => {
        throw boom;
      });
      const onHtmlError = vi.fn();
      const svg = await exportSvg(storeWith(markerElement()), {
        htmlPainters: registry,
        onHtmlError,
      });
      // The offscreen canvas is still encoded (blank) even though the painter threw.
      expect(svg).toContain('<image');
      expect(onHtmlError).toHaveBeenCalledWith({
        elementId: 'marker-1',
        htmlType: 'rk-marker',
        reason: 'painter-threw',
        cause: boom,
      });
    } finally {
      restore();
    }
  });

  it('forwards a degenerate-size diagnostic to onHtmlError without invoking the painter', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const registry = registryWith('rk-marker');
      const painted = vi.fn();
      registry.register('rk-marker', painted);
      const onHtmlError = vi.fn();
      // A zero-width marker alone would collapse export bounds to 0×h and fail dimension
      // validation before painting is ever reached; a normal shape keeps the overall
      // canvas non-degenerate so the diagnostic path under test is exercised.
      const store = new ElementStore();
      store.add(createShape({ position: { x: 200, y: 200 }, size: { w: 50, h: 50 } }));
      store.add(markerElement({ size: { w: 0, h: 100 } }));
      // The raster still encodes (blank) for a degenerate element, same as A7's
      // exportImage — 'degenerate-size' is a paint-time diagnostic, not an encode
      // failure, so the assertions that matter are: painter untouched, diagnostic fired.
      await exportSvg(store, { htmlPainters: registry, onHtmlError });
      expect(painted).not.toHaveBeenCalled();
      expect(onHtmlError).toHaveBeenCalledWith(
        expect.objectContaining({ elementId: 'marker-1', reason: 'degenerate-size' }),
      );
    } finally {
      restore();
    }
  });
});
