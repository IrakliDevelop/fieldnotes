import { describe, expect, it } from 'vitest';
import { ElementStore, HistoryStack, createShape } from '@fieldnotes/core';
import { UpdateElementCommand } from '../../core/src/history/commands';
import type { CanvasElement } from '@fieldnotes/core';
import { createCurrentCapabilities } from './capabilities';
import { SyncClient } from './sync-client';
import type { SyncOp } from './protocol';
import type { SyncTransport } from './sync-transport';

function shape(version: number, fillColor: string): CanvasElement {
  return {
    ...createShape({
      index: 'a0',
      version,
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      fillColor,
    }),
    id: 'x',
  };
}

function setup() {
  const store = new ElementStore();
  const sent: SyncOp[] = [];
  let receive: (message: string) => void = () => undefined;
  const transport: SyncTransport = {
    send: (message) => sent.push((JSON.parse(message) as { op: SyncOp }).op),
    onMessage: (handler) => {
      receive = handler;
      return () => {
        receive = () => undefined;
      };
    },
    close: () => undefined,
  };
  const client = new SyncClient({ store, transport, clientId: 'A', flushIntervalMs: 0 });
  client.start();
  receive(
    JSON.stringify({
      from: 'B',
      op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
    }),
  );
  return { store, sent, client };
}

describe('SyncClient history replay', () => {
  it('publishes an exact history undo above its recorded version', () => {
    const { store, sent } = setup();
    const before = shape(1, '#111111');
    const after = shape(2, '#222222');
    store.add(before);
    store.update(before.id, after);
    const history = new HistoryStack();
    history.push(new UpdateElementCommand(before.id, before, after));

    history.undo(store);

    expect(store.getById(before.id)).toMatchObject({ version: 1, fillColor: '#111111' });
    expect(sent.at(-1)).toMatchObject({
      kind: 'upsert',
      element: { id: 'x', version: 3, editor: 'A', fillColor: '#111111' },
    });
  });
});
