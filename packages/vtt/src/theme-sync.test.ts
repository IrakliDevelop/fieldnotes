import { afterEach, describe, expect, it, vi } from 'vitest';
import { Viewport, createStroke } from '@fieldnotes/core';
import { SyncClient, createCurrentCapabilities } from '@fieldnotes/sync';
import type { SyncTransport } from '@fieldnotes/sync';

interface SentOp {
  kind: string;
  element?: { id: string };
  ops?: SentOp[];
}

interface SentEnvelope {
  op: SentOp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOp(value: unknown): SentOp {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('expected sync op');
  const element =
    isRecord(value.element) && typeof value.element.id === 'string'
      ? { id: value.element.id }
      : undefined;
  const ops = Array.isArray(value.ops) ? value.ops.map(parseOp) : undefined;
  return { kind: value.kind, element, ops };
}

function parseEnvelope(message: string): SentEnvelope {
  const parsed: unknown = JSON.parse(message);
  if (!isRecord(parsed)) {
    throw new Error('expected sync envelope');
  }
  return { op: parseOp(parsed.op) };
}

function containsStrokeUpsert(op: SentOp, id: string): boolean {
  return (
    (op.kind === 'upsert' && op.element?.id === id) ||
    (op.kind === 'batch' && op.ops?.some((batchOp) => containsStrokeUpsert(batchOp, id)) === true)
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme changes', () => {
  it('do not send sync operations and leave store updates live', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const flushFrame = (): void => {
      const frame = frames.entries().next().value;
      if (!frame) throw new Error('expected a pending animation frame');
      frames.delete(frame[0]);
      frame[1](0);
    };
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });

    let mediaListener: ((event: MediaQueryListEvent) => void) | undefined;
    const media = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);

    const viewport = new Viewport(document.createElement('div'));
    const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
    viewport.store.add(stroke);
    const sent: string[] = [];
    let receive: (message: string) => void = () => undefined;
    const transport: SyncTransport = {
      send(message) {
        sent.push(message);
        if (parseEnvelope(message).op.kind === 'capabilities') {
          receive(
            JSON.stringify({
              from: 'peer',
              op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
            }),
          );
        }
      },
      onMessage(handler) {
        receive = handler;
        return () => undefined;
      },
      close: vi.fn(),
    };
    const client = new SyncClient({
      store: viewport.store,
      transport,
      clientId: 'a',
      flushIntervalMs: 0,
    });

    try {
      client.start();
      await vi.waitFor(() => {
        expect(sent.some((message) => parseEnvelope(message).op.kind === 'request-snapshot')).toBe(
          true,
        );
      });
      const countAfterSnapshot = sent.length;

      viewport.setTheme('dark');
      viewport.requestRender();
      flushFrame();
      viewport.setTheme('system');
      media.matches = false;
      if (!mediaListener) throw new Error('expected system theme listener');
      mediaListener({ matches: false } as MediaQueryListEvent);
      flushFrame();
      viewport.setTheme('light');
      await Promise.resolve();

      expect(sent).toHaveLength(countAfterSnapshot);
      viewport.store.update(stroke.id, { color: '#ff0000' });
      await vi.waitFor(() => {
        expect(sent.slice(countAfterSnapshot)).toHaveLength(1);
        expect(
          containsStrokeUpsert(parseEnvelope(sent[countAfterSnapshot] ?? '').op, stroke.id),
        ).toBe(true);
      });
    } finally {
      client.dispose();
      viewport.destroy();
    }
  });
});
