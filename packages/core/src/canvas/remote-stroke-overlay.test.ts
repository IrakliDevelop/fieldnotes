import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RemoteStrokeOverlay,
  isStrokePreviewPresence,
  toStrokePreviewPresence,
  type RemoteStrokeOverlayHost,
} from './remote-stroke-overlay';
import type { OverlayRenderer } from './render-loop';
import { ElementStore } from '../elements/element-store';
import { createStroke } from '../elements/element-factory';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeHost(): RemoteStrokeOverlayHost & { registered: OverlayRenderer[] } {
  const host = {
    store: new ElementStore(),
    registered: [] as OverlayRenderer[],
    requestRender: vi.fn(),
    registerOverlay(draw: OverlayRenderer): () => void {
      host.registered.push(draw);
      return () => {
        host.registered = host.registered.filter((d) => d !== draw);
      };
    },
  };
  return host;
}

/** Counts the previews drawn by one overlay pass (one save per preview). */
function drawnPreviews(host: { registered: OverlayRenderer[] }): number {
  let saves = 0;
  const ctx = {
    save: () => (saves += 1),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  for (const draw of host.registered) draw(ctx);
  return saves;
}

const stroke = (id: string): unknown =>
  toStrokePreviewPresence({
    id,
    points: [
      [0, 0, 0.5],
      [10, 10, 0.5],
      [20, 5],
    ],
    color: '#ff0000',
    width: 4,
  });

describe('RemoteStrokeOverlay', () => {
  it('draws an applied preview until it is dropped', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    expect(overlay.apply('a', stroke('s1'))).toBe(true);
    expect(overlay.activeSenderCount).toBe(1);
    expect(drawnPreviews(host)).toBe(1);
  });

  it('ignores payloads that are not stroke previews', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    expect(overlay.apply('a', { kind: 'laser', points: [] })).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('drops a preview when the committed element appears in the store', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('a', stroke('s1'));
    overlay.apply('a', stroke('s2'));
    host.store.add({ ...createStroke({ points: [] }), id: 's1' });
    expect(drawnPreviews(host)).toBe(1);
    host.store.add({ ...createStroke({ points: [] }), id: 's2' });
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('ignores a late preview for an already committed element', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    host.store.add({ ...createStroke({ points: [] }), id: 's1' });
    overlay.apply('a', stroke('s1'));
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('drops a preview after 3 s without an update', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('a', stroke('s1'));
    vi.advanceTimersByTime(2000);
    overlay.apply('a', stroke('s1'));
    vi.advanceTimersByTime(2999);
    expect(overlay.activeSenderCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(overlay.activeSenderCount).toBe(0);
    expect(host.requestRender).toHaveBeenCalledTimes(3);
  });

  it('drops a preview on cleared', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('a', stroke('s1'));
    expect(overlay.apply('a', toStrokePreviewPresence({ id: 's1', cleared: true }))).toBe(true);
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('drops a sender on remove (presence-leave)', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('a', stroke('s1'));
    overlay.apply('b', stroke('s2'));
    overlay.remove('a');
    expect(overlay.activeSenderCount).toBe(1);
    expect(drawnPreviews(host)).toBe(1);
  });

  it('keys previews by sender and id and keeps four per sender', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('b', stroke('s1'));
    for (const id of ['s1', 's2', 's3', 's4', 's5']) overlay.apply('a', stroke(id));
    expect(drawnPreviews(host)).toBe(5);
    overlay.apply('a', toStrokePreviewPresence({ id: 's1', cleared: true }));
    expect(drawnPreviews(host)).toBe(5);
    overlay.apply('a', toStrokePreviewPresence({ id: 's2', cleared: true }));
    expect(drawnPreviews(host)).toBe(4);
  });

  it('dispose unregisters the overlay and stops watching the store', () => {
    const host = makeHost();
    const overlay = new RemoteStrokeOverlay(host);
    overlay.apply('a', stroke('s1'));
    overlay.dispose();
    expect(host.registered).toEqual([]);
    expect(overlay.apply('a', stroke('s2'))).toBe(false);
    host.store.add({ ...createStroke({ points: [] }), id: 's1' });
    vi.advanceTimersByTime(5000);
    expect(host.requestRender).toHaveBeenCalledTimes(1);
  });
});

describe('isStrokePreviewPresence', () => {
  const valid = { kind: 'stroke', id: 's', points: [[0, 0, 0.5]], color: '#000', width: 2 };

  it.each([
    ['a full preview', valid, true],
    ['a highlighter preview', { ...valid, opacity: 0.4, blendMode: 'multiply' }, true],
    ['a cleared preview', { kind: 'stroke', id: 's', cleared: true }, true],
    ['cleared other than true', { kind: 'stroke', id: 's', cleared: false }, false],
    ['another kind', { ...valid, kind: 'laser' }, false],
    ['a missing id', { ...valid, id: undefined }, false],
    ['a non-finite coordinate', { ...valid, points: [[0, Infinity]] }, false],
    ['a one-number point', { ...valid, points: [[0]] }, false],
    ['a four-number point', { ...valid, points: [[0, 0, 0, 0]] }, false],
    ['121 points', { ...valid, points: Array.from({ length: 121 }, () => [0, 0]) }, false],
    ['zero width', { ...valid, width: 0 }, false],
    ['infinite width', { ...valid, width: Infinity }, false],
    ['a missing color', { ...valid, color: undefined }, false],
    ['a non-finite opacity', { ...valid, opacity: NaN }, false],
    ['another blend mode', { ...valid, blendMode: 'screen' }, false],
    ['null', null, false],
  ])('%s → %s', (_name, data, expected) => {
    expect(isStrokePreviewPresence(data)).toBe(expected);
  });

  it('accepts 120 points', () => {
    const points = Array.from({ length: 120 }, () => [0, 0]);
    expect(isStrokePreviewPresence({ ...valid, points })).toBe(true);
  });
});
