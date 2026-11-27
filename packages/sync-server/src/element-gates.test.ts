import { describe, it, expect } from 'vitest';
import type { SyncElement } from '@fieldnotes/sync';
import { gatesAllow, RoomElementGates } from './element-gates';
import { MemoryHubBackend } from './memory-hub-backend';
import type { ElementReadGate, PluginViewer, ServerSyncPlugin } from './sync-plugin';
import { v2Shape } from './test-support/v2-ops';

const element: SyncElement = v2Shape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
const viewer: PluginViewer = { room: 'R', role: 'player' };
const backend = new MemoryHubBackend();

function plugin(name: string, gate: () => ElementReadGate | undefined): ServerSyncPlugin {
  return { name, elementReadGate: async () => gate() };
}

describe('gatesAllow', () => {
  it.each([
    ['true', () => true, true],
    ['false', () => false, false],
    ["'yes'", () => 'yes', false],
    [
      'a throw',
      () => {
        throw new Error('broken gate');
      },
      false,
    ],
  ])('a gate returning %s allows: %s', (_, gate, expected) => {
    expect(gatesAllow([() => true, gate as ElementReadGate], element, viewer)).toBe(expected);
  });
});

describe('RoomElementGates', () => {
  it('is inactive without a gate plugin', () => {
    expect(new RoomElementGates([{ name: 'plain' }]).active).toBe(false);
  });

  it('reports a change on first load and on a new function, not on the same functions', async () => {
    const first: ElementReadGate = () => true;
    const stable: ElementReadGate = () => true;
    let changing = first;
    const gates = new RoomElementGates([
      plugin('a', () => changing),
      plugin('b', () => stable),
      plugin('c', () => undefined),
    ]);

    expect(gates.active).toBe(true);
    expect(gates.isLoaded('R')).toBe(false);
    expect(gates.current('R')).toBeUndefined();
    expect(await gates.refresh('R', backend)).toBe(true);
    expect(gates.current('R')).toEqual([first, stable]);
    expect(await gates.refresh('R', backend)).toBe(false);
    changing = () => true;
    expect(await gates.refresh('R', backend)).toBe(true);
    expect(gates.current('R')).toEqual([changing, stable]);
  });

  it('settles to deny until markSettled, then pends on the next change', async () => {
    let gate: ElementReadGate = () => true;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    await gates.refresh('R', backend);

    expect(gates.settled('R')).toBe('deny');
    expect(gates.isPending('R')).toBe(true);
    gates.markSettled('R');
    expect(gates.settled('R')).toEqual([gate]);
    expect(gates.isPending('R')).toBe(false);
    const old = gate;
    gate = () => false;
    await gates.refresh('R', backend);
    expect(gates.isPending('R')).toBe(true);
    expect(gates.settled('R')).toEqual([old]);
  });

  it('drop unloads the room', async () => {
    const gates = new RoomElementGates([plugin('a', () => () => true)]);
    await gates.refresh('R', backend);
    gates.markSettled('R');

    gates.drop('R');

    expect(gates.isLoaded('R')).toBe(false);
    expect(gates.current('R')).toBeUndefined();
    expect(gates.settled('R')).toBe('deny');
  });
});
