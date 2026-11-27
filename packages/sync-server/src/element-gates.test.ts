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

  it('settles to deny before the first load and to the loaded set on it, then pends on the next change', async () => {
    let gate: ElementReadGate = () => true;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    expect(gates.settled('R')).toBe('deny');
    await gates.refresh('R', backend);

    expect(gates.settled('R')).toEqual([gate]);
    expect(gates.isPending('R')).toBe(false);
    const old = gate;
    gate = () => false;
    await gates.refresh('R', backend);
    expect(gates.isPending('R')).toBe(true);
    expect(gates.settled('R')).toEqual([old]);
    gates.markSettled('R');
    expect(gates.settled('R')).toEqual([gate]);
    expect(gates.isPending('R')).toBe(false);
  });

  it('allows since settled what any gate set in force since then allowed, until markSettled', async () => {
    const other = { ...element, id: 'other' };
    let gate: ElementReadGate = () => false;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(false);
    await gates.refresh('R', backend);
    gate = (el) => el.id === element.id;
    await gates.refresh('R', backend);
    gate = () => false;
    await gates.refresh('R', backend);

    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(true);
    expect(gates.allowedSinceSettled('R', other, viewer)).toBe(false);
    gates.markSettled('R');
    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(false);
    expect(gates.isPending('R')).toBe(false);
  });

  it('may lack only what a remove, the last snapshot or else the settled set withheld, until markSettled', async () => {
    const other = { ...element, id: 'other' };
    let gate: ElementReadGate = (el) => el.id !== other.id;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    expect(gates.mayLack('R', 'p', element, viewer)).toBe(true);
    await gates.refresh('R', backend);

    expect(gates.mayLack('R', 'p', element, viewer)).toBe(false);
    expect(gates.mayLack('R', 'p', other, viewer)).toBe(true);
    gates.noteRemoved('R', 'p', element.id);
    expect(gates.mayLack('R', 'p', element, viewer)).toBe(true);
    expect(gates.mayLack('R', 'q', element, viewer)).toBe(false);
    gate = () => false;
    await gates.refresh('R', backend);
    gates.noteSnapshot('R', 'q');
    expect(gates.mayLack('R', 'q', element, viewer)).toBe(true);
    gate = () => true;
    await gates.refresh('R', backend);
    gates.noteSnapshot('R', 's');
    expect(gates.mayLack('R', 's', other, viewer)).toBe(false);
    gates.markSettled('R');
    expect(gates.mayLack('R', 'p', element, viewer)).toBe(false);
    expect(gates.mayLack('R', 'q', element, viewer)).toBe(false);
  });

  it('forgets the removes and snapshot of a closed connection only', async () => {
    let gate: ElementReadGate = () => true;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    await gates.refresh('R', backend);
    gate = () => false;
    await gates.refresh('R', backend);
    gates.noteSnapshot('R', 'p');
    gates.noteRemoved('R', 'p', element.id);
    gates.noteRemoved('R', 'q', element.id);
    gates.noteSnapshot('R', 'q');

    gates.forgetConnection('R', 'p');

    expect(gates.mayLack('R', 'p', element, viewer)).toBe(false);
    expect(gates.mayLack('R', 'q', element, viewer)).toBe(true);
  });

  it('ignores overflow when judging what a viewer may lack', async () => {
    const other = { ...element, id: 'other' };
    const gates = new RoomElementGates([plugin('a', () => (el) => el.id !== other.id)]);
    for (let i = 0; i < 10; i++) await gates.refresh('R', backend);

    expect(gates.allowedSinceSettled('R', other, viewer)).toBe(true);
    expect(gates.mayLack('R', 'p', element, viewer)).toBe(false);
  });

  it('records a snapshot built while unloaded as lacking everything', async () => {
    let broken = false;
    const gates = new RoomElementGates([
      plugin('a', () => {
        if (broken) throw new Error('gate down');
        return () => true;
      }),
    ]);
    await gates.refresh('R', backend);
    broken = true;
    await expect(gates.refresh('R', backend)).rejects.toThrow('gate down');

    gates.noteSnapshot('R', 'p');

    expect(gates.mayLack('R', 'p', element, viewer)).toBe(true);
    expect(gates.mayLack('R', 'q', element, viewer)).toBe(false);
  });

  it('allows everything since settled once a ninth gate set was replaced', async () => {
    let gate: ElementReadGate = () => false;
    const gates = new RoomElementGates([plugin('a', () => gate)]);
    await gates.refresh('R', backend);
    for (let i = 0; i < 8; i++) {
      gate = () => false;
      await gates.refresh('R', backend);
    }
    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(false);
    gate = () => false;
    await gates.refresh('R', backend);

    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(true);
    gates.markSettled('R');
    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(false);
    expect(gates.isPending('R')).toBe(false);
  });

  it('keeps the set a failed refresh unloaded among the sets since settled', async () => {
    let gate: ElementReadGate | 'throw' = () => false;
    const gates = new RoomElementGates([
      plugin('a', () => {
        if (gate === 'throw') throw new Error('gate down');
        return gate;
      }),
    ]);
    await gates.refresh('R', backend);
    gate = () => true;
    await gates.refresh('R', backend);
    gate = 'throw';
    await expect(gates.refresh('R', backend)).rejects.toThrow('gate down');
    gate = () => false;
    await gates.refresh('R', backend);

    expect(gates.allowedSinceSettled('R', element, viewer)).toBe(true);
  });

  it('keeps settled and unloads current when a refresh throws after a load', async () => {
    const loaded: ElementReadGate = () => true;
    let broken = false;
    const gates = new RoomElementGates([
      plugin('a', () => {
        if (broken) throw new Error('gate down');
        return loaded;
      }),
    ]);
    await gates.refresh('R', backend);
    broken = true;

    await expect(gates.refresh('R', backend)).rejects.toThrow('gate down');

    expect(gates.isLoaded('R')).toBe(false);
    expect(gates.current('R')).toBeUndefined();
    expect(gates.settled('R')).toEqual([loaded]);
    expect(gates.isPending('R')).toBe(true);
  });

  it('leaves no state when the first load throws', async () => {
    const gates = new RoomElementGates([
      plugin('a', () => {
        throw new Error('gate down');
      }),
    ]);

    await expect(gates.refresh('R', backend)).rejects.toThrow('gate down');

    expect(gates.isLoaded('R')).toBe(false);
    expect(gates.settled('R')).toBe('deny');
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

  it('discards a refresh that a drop overtook', async () => {
    let release: (gate: ElementReadGate) => void = () => undefined;
    const loading = new Promise<ElementReadGate>((resolve) => (release = resolve));
    const gates = new RoomElementGates([{ name: 'slow', elementReadGate: () => loading }]);

    const refreshing = gates.refresh('R', backend);
    gates.drop('R');
    release(() => true);

    expect(await refreshing).toBe(false);
    expect(gates.isLoaded('R')).toBe(false);
  });

  it('unloads the room when a gate plugin rejects during refresh', async () => {
    let broken = false;
    const gates = new RoomElementGates([
      {
        name: 'flaky',
        elementReadGate: async () => {
          if (broken) throw new Error('gate down');
          return () => true;
        },
      },
    ]);
    await gates.refresh('R', backend);
    broken = true;

    await expect(gates.refresh('R', backend)).rejects.toThrow('gate down');
    expect(gates.isLoaded('R')).toBe(false);
    expect(gates.current('R')).toBeUndefined();
  });

  it('keeps a newer load when an older refresh rejects', async () => {
    let fail: (error: Error) => void = () => undefined;
    const pending = new Promise<ElementReadGate>((_, reject) => (fail = reject));
    const newer: ElementReadGate = () => true;
    let calls = 0;
    const gates = new RoomElementGates([
      { name: 'racy', elementReadGate: async () => (++calls === 1 ? pending : newer) },
    ]);

    const older = gates.refresh('R', backend);
    gates.drop('R');
    await gates.refresh('R', backend);
    fail(new Error('gate down'));

    await expect(older).rejects.toThrow('gate down');
    expect(gates.isLoaded('R')).toBe(true);
    expect(gates.current('R')).toEqual([newer]);
  });
});
