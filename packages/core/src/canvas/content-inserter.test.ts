import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentInserter, textHtmlFromPlain } from './content-inserter';
import type { AssetResolver, ContentInserterDeps } from './content-inserter';
import { InsertQueue } from './insert-queue';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createShape } from '../elements/element-factory';
import { getDefaultElementRegistry } from '../elements/default-registry';
import { measureText, setTextMeasurer } from '../elements/text-measure';
import type { CanvasElement, ImageElement } from '../elements/types';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<ContentInserterDeps> = {}) {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const queue = new InsertQueue({
    recorder,
    isGestureActive: () => false,
    flushPendingHistory: () => undefined,
    transaction: (run) => recorder.run(run),
  });
  const calls = {
    switchToSelect: 0,
    selections: [] as string[][],
    imageErrors: [] as unknown[],
    inserted: [] as CanvasElement[][],
    addImage: 0,
  };
  const deps: ContentInserterDeps = {
    store,
    elementRegistry: getDefaultElementRegistry(),
    getActiveLayerId: () => 'layer-1',
    getTextStyle: () => null,
    insertElements: (els) => {
      calls.inserted.push(els);
      recorder.run(() => els.forEach((e) => store.add(e)));
      return true;
    },
    insertWhenIdle: (run) => queue.insertWhenIdle(run),
    transaction: (run) => recorder.run(run),
    switchToSelect: () => {
      calls.switchToSelect += 1;
    },
    setSelection: (ids) => {
      calls.selections.push(ids);
    },
    requestRender: () => undefined,
    addImage: (src, topLeft) => {
      calls.addImage += 1;
      const image = createImage({ position: topLeft, size: { w: 300, h: 200 }, src });
      recorder.run(() => store.add(image));
      return image.id;
    },
    onImageError: (info) => {
      calls.imageErrors.push(info);
    },
    ...overrides,
  };
  return { store, stack, queue, calls, inserter: new ContentInserter(deps) };
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
const images = (store: ElementStore) =>
  store.getAll().filter((e): e is ImageElement => e.type === 'image');

beforeEach(() => {
  setTextMeasurer((t) => t.length * 10);
});

afterEach(() => {
  setTextMeasurer(null);
  vi.unstubAllGlobals();
});

describe('textHtmlFromPlain', () => {
  it('textHtmlFromPlain escapes, splits lines and caps at 10,000', () => {
    expect(textHtmlFromPlain('<b>a</b>\nb')).toBe('&lt;b&gt;a&lt;/b&gt;<br>b');
    expect(textHtmlFromPlain('a\r\nb\rc')).toBe('a<br>b<br>c');
    expect(textHtmlFromPlain('x'.repeat(10_001))).toBe('x'.repeat(10_000));
  });
});

describe('ContentInserter.insertText', () => {
  it('insertText sizes with measureText, caps width at 400 and centres on the anchor', () => {
    const { store, inserter } = setup();

    const id = inserter.insertText('x'.repeat(50), { x: 1000, y: 500 });
    const el = store.getById(id ?? '');
    const short = store.getById(inserter.insertText('hi', { x: 0, y: 0 }) ?? '');

    expect(el).toMatchObject({
      size: { w: 400, h: measureText('x'.repeat(50), 16, 400).h },
      position: { x: 800 },
    });
    expect(short).toMatchObject({ size: { w: 24 } });
  });

  it('insertText uses the text tool style, sets the link, selects and is one undo step', () => {
    const { store, stack, calls, inserter } = setup({
      getTextStyle: () => ({ fontSize: 24, color: '#ff0000' }),
    });

    const id = inserter.insertText('hello', { x: 0, y: 0 }, 'https://x.y');
    const el = store.getById(id ?? '');

    expect(el).toMatchObject({
      type: 'text',
      fontSize: 24,
      color: '#ff0000',
      link: 'https://x.y',
      text: 'hello',
      layerId: 'layer-1',
      wrap: true,
      autoResize: true,
    });
    expect(calls.selections).toEqual([[id]]);
    expect(calls.switchToSelect).toBe(1);
    expect(stack.undoCount).toBe(1);
  });

  it('insertText returns null for whitespace-only text and adds nothing', () => {
    const { store, stack, inserter } = setup();

    expect(inserter.insertText(' \n\t ', { x: 0, y: 0 })).toBeNull();
    expect(store.count).toBe(0);
    expect(stack.undoCount).toBe(0);
  });
});

describe('ContentInserter.insertFiles', () => {
  it('image file waits for the resolver then inserts at the centred top-left and selects it', async () => {
    const upload = deferred<{ src: string }>();
    const uploads: unknown[][] = [];
    const assets: AssetResolver = {
      upload: (...args) => {
        uploads.push(args);
        return upload.promise;
      },
    };
    const { store, calls, inserter } = setup({ assets });
    const file = png();

    expect(inserter.insertFiles([file], { x: 500, y: 400 }, 'paste')).toBe(true);
    expect(store.count).toBe(0);
    upload.resolve({ src: 'https://cdn/x.png' });
    await flush();

    const [image] = images(store);
    expect(image?.src).toBe('https://cdn/x.png');
    expect(image?.position).toEqual({ x: 350, y: 300 });
    expect(uploads).toEqual([[file, { kind: 'paste' }]]);
    expect(calls.switchToSelect).toBe(1);
    expect(calls.selections).toEqual([[image?.id]]);
  });

  it('claimsFile claims image/* only and insertFiles agrees', () => {
    const { inserter } = setup();
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });

    expect(inserter.claimsFile(png(), 'paste')).toBe(true);
    expect(inserter.claimsFile(pdf, 'drop')).toBe(false);
    expect(inserter.insertFiles([pdf], { x: 0, y: 0 }, 'drop')).toBe(false);
  });

  it('a rejected upload reports onImageError with reason upload and inserts nothing', async () => {
    const cause = new Error('quota');
    const { store, calls, inserter } = setup({
      assets: { upload: () => Promise.reject(cause) },
    });

    inserter.insertFiles([png()], { x: 0, y: 0 }, 'drop');
    await flush();

    expect(store.count).toBe(0);
    expect(calls.imageErrors).toEqual([{ src: 'a.png', elementIds: [], cause, reason: 'upload' }]);
    expect(calls.switchToSelect).toBe(0);
  });

  it('an upload that resolves after destroy inserts nothing', async () => {
    const upload = deferred<{ src: string }>();
    const { store, queue, calls, inserter } = setup({
      assets: { upload: () => upload.promise },
    });

    inserter.insertFiles([png()], { x: 0, y: 0 }, 'drop');
    queue.destroy();
    upload.resolve({ src: 'https://cdn/x.png' });
    await flush();

    expect(store.count).toBe(0);
    expect(calls.addImage).toBe(0);
  });

  it('without a resolver the image is inlined as a data URL', async () => {
    const { store, inserter } = setup();

    inserter.insertFiles([png()], { x: 0, y: 0 }, 'drop');
    await vi.waitFor(() => expect(store.count).toBe(1));

    expect(images(store)[0]?.src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('two files insert in one undo step', async () => {
    const { store, stack, calls, inserter } = setup({
      assets: { upload: (file) => Promise.resolve({ src: `https://cdn/${file.name}` }) },
    });
    const second = new File(['b'], 'b.png', { type: 'image/png' });

    inserter.insertFiles([png(), second], { x: 0, y: 0 }, 'drop');
    await flush();

    expect(store.count).toBe(2);
    expect(stack.undoCount).toBe(1);
    expect(calls.selections).toEqual([images(store).map((e) => e.id)]);
  });

  it('a FileReader error without a resolver reports reason load and inserts nothing', async () => {
    const error = new DOMException('unreadable');
    vi.stubGlobal(
      'FileReader',
      class {
        error = error;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    const { store, calls, inserter } = setup();

    inserter.insertFiles([png()], { x: 0, y: 0 }, 'drop');
    await flush();

    expect(store.count).toBe(0);
    expect(calls.imageErrors).toEqual([
      { src: 'a.png', elementIds: [], cause: error, reason: 'load' },
    ]);
  });

  it('insertFiles returns false and inserts nothing for an unclaimed file', async () => {
    const { store, calls, inserter } = setup();

    expect(
      inserter.insertFiles(
        [new File(['x'], 'a.txt', { type: 'text/plain' })],
        { x: 0, y: 0 },
        'drop',
      ),
    ).toBe(false);
    await flush();

    expect(store.count).toBe(0);
    expect(calls.switchToSelect).toBe(0);
  });
});

describe('ContentInserter.insertElements', () => {
  const image = (src: string) =>
    createImage({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, src });
  const shape = () => createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });

  it('import re-uploads data: and blob: image srcs and drops failed ones', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) }),
    );
    const a = image('data:image/png;base64,eA==');
    const b = image('blob:https://host/1');
    const c = shape();
    const contexts: unknown[] = [];
    const cause = new Error('denied');
    let n = 0;
    const { calls, inserter } = setup({
      assets: {
        upload: (file, context) => {
          contexts.push(context);
          expect(file.type).toBe('image/png');
          n += 1;
          return n === 1 ? Promise.resolve({ src: 'https://cdn/a.png' }) : Promise.reject(cause);
        },
      },
    });

    inserter.insertElements([a, b, c], { x: 0, y: 0 });
    await flush();

    expect(calls.inserted).toEqual([[{ ...a, src: 'https://cdn/a.png' }, c]]);
    expect(calls.imageErrors).toEqual([
      { src: b.src, elementIds: [b.id], cause, reason: 'upload' },
    ]);
    expect(contexts).toEqual([{ kind: 'import' }, { kind: 'import' }]);
  });

  it('import without a resolver inlines blob: and keeps data: verbatim; a failing fetch drops the element', async () => {
    const cause = new TypeError('gone');
    vi.stubGlobal('fetch', (src: string) =>
      src === 'blob:https://host/ok'
        ? Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) })
        : Promise.reject(cause),
    );
    const ok = image('blob:https://host/ok');
    const dead = image('blob:https://host/dead');
    const inline = image('data:image/png;base64,eA==');
    const remote = image('https://cdn/r.png');
    const { calls, inserter } = setup();

    inserter.insertElements([ok, dead, inline, remote], { x: 0, y: 0 });
    await vi.waitFor(() => expect(calls.inserted).toHaveLength(1));

    expect(calls.inserted[0]).toEqual([
      { ...ok, src: 'data:image/png;base64,eA==' },
      inline,
      remote,
    ]);
    expect(calls.imageErrors).toEqual([
      { src: dead.src, elementIds: [dead.id], cause, reason: 'upload' },
    ]);
  });

  it('insertElements with nothing to upload inserts synchronously', () => {
    const remote = image('https://cdn/r.png');
    const c = shape();
    const { calls, inserter } = setup({
      assets: { upload: () => Promise.reject(new Error('unexpected')) },
    });

    inserter.insertElements([remote, c], { x: 0, y: 0 });

    expect(calls.inserted).toEqual([[remote, c]]);
  });
});
