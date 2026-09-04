import { describe, it, expect } from 'vitest';
import { FogManager } from './fog-manager';
import type { FogChangeEvent, FogStateV1 } from './types';
import type { Command } from '../history/types';
import { encodeBase64, createTileBytes } from './tile-codec';

function makeManager(options?: { onCommand?: (cmd: Command) => void }) {
  let genId = 0;
  return new FogManager({
    idFactory: () => `test-gen-${++genId}`,
    ...options,
  });
}

function getState(m: FogManager): FogStateV1 {
  const s = m.getState();
  expect(s).not.toBeNull();
  return s as FogStateV1;
}

describe('FogManager', () => {
  it('starts with null state and off view', () => {
    const m = makeManager();
    expect(m.getState()).toBeNull();
    expect(m.getViewMode()).toBe('off');
  });

  it('initialize creates a covered state', () => {
    const m = makeManager();
    const state = m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 } });
    expect(state.definition.base).toBe('covered');
    expect(state.definition.generation).toBe('test-gen-1');
    expect(state.tiles).toEqual([]);
    expect(m.getState()).toStrictEqual(state);
  });

  it('initialize with custom base', () => {
    const m = makeManager();
    const state = m.initialize({ bounds: { x: 0, y: 0, w: 512, h: 512 }, base: 'revealed' });
    expect(state.definition.base).toBe('revealed');
  });

  it('initialize pushes a FogResetCommand', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 512, h: 512 } });
    expect(commands).toHaveLength(1);
  });

  it('undo and redo of a reset always allocate fresh generation ids', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (command) => commands.push(command) });
    const initial = m.initialize({ bounds: { x: 0, y: 0, w: 128, h: 128 } });
    m.reset('revealed');
    const resetGeneration = getState(m).definition.generation;
    const resetCommand = commands[1];
    expect(resetCommand).toBeDefined();
    resetCommand?.undo(null as never);
    const undoGeneration = getState(m).definition.generation;
    expect(undoGeneration).not.toBe(initial.definition.generation);
    expect(undoGeneration).not.toBe(resetGeneration);
    resetCommand?.execute(null as never);
    expect(getState(m).definition.generation).not.toBe(resetGeneration);
    expect(getState(m).definition.generation).not.toBe(undoGeneration);
  });

  it('applyRegion reveals cells and pushes one command', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    m.applyRegion({ kind: 'rectangle', from: { x: 10, y: 10 }, to: { x: 50, y: 50 } }, 'reveal');
    expect(commands).toHaveLength(2);
    const state = getState(m);
    expect(state.tiles.length).toBeGreaterThan(0);
  });

  it('one multi-tile region is one undo', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 512, h: 512 }, cellSize: 1 });
    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 400, y: 400 } }, 'reveal');
    expect(commands).toHaveLength(2);
    const regionCmd = commands[1] as Command;
    const stateBefore = getState(m);
    expect(stateBefore.tiles.length).toBeGreaterThan(1);

    regionCmd.undo(null as never);
    const stateAfterUndo = getState(m);
    expect(stateAfterUndo.tiles.length).toBe(0);

    regionCmd.execute(null as never);
    const stateAfterRedo = getState(m);
    expect(stateAfterRedo.tiles.length).toBeGreaterThan(1);
  });

  it('undo/redo emits correct change events', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });

    const events: FogChangeEvent[] = [];
    m.on('change', (e) => events.push(e));

    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, 'reveal');
    expect(events).toHaveLength(1);
    expect((events[0] as FogChangeEvent).kind).toBe('tiles');

    const regionCmd = commands[1] as Command;
    events.length = 0;
    regionCmd.undo(null as never);
    expect(events).toHaveLength(1);
    expect((events[0] as FogChangeEvent).kind).toBe('tiles');

    events.length = 0;
    regionCmd.execute(null as never);
    expect(events).toHaveLength(1);
  });

  it('noop region creates no command or event', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 } });
    const initialCmdCount = commands.length;

    const events: FogChangeEvent[] = [];
    m.on('change', (e) => events.push(e));

    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, 'conceal');
    expect(commands).toHaveLength(initialCmdCount);
    expect(events).toHaveLength(0);
  });

  it('reset creates new generation and clears tiles', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }, 'reveal');
    expect(getState(m).tiles.length).toBeGreaterThan(0);

    const oldGen = getState(m).definition.generation;
    m.reset('covered');
    expect(getState(m).tiles).toEqual([]);
    expect(getState(m).definition.generation).not.toBe(oldGen);
    expect(getState(m).definition.base).toBe('covered');
  });

  it('disable sets state to null', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 } });
    m.disable();
    expect(m.getState()).toBeNull();
  });

  it('disable on null state is noop', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.disable();
    expect(commands).toHaveLength(0);
  });

  it('bounds expansion preserves existing tiles', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, 'reveal');
    const tileCount = getState(m).tiles.length;
    m.setBounds({ x: 0, y: 0, w: 512, h: 512 });
    expect(getState(m).tiles.length).toBe(tileCount);
    expect(getState(m).definition.bounds.w).toBe(512);
  });

  it('bounds shrink drops wholly out-of-bounds tiles', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 512, h: 512 }, cellSize: 1 });
    m.applyRegion(
      { kind: 'rectangle', from: { x: 200, y: 200 }, to: { x: 400, y: 400 } },
      'reveal',
    );
    const tilesBeforeShrink = getState(m).tiles.length;
    const oldGeneration = getState(m).definition.generation;
    m.setBounds({ x: 0, y: 0, w: 100, h: 100 });
    expect(getState(m).tiles.length).toBeLessThan(tilesBeforeShrink);
    expect(getState(m).definition.generation).not.toBe(oldGeneration);
  });

  it('rejects invalid bounds atomically', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    const before = m.getState();
    expect(() => m.setBounds({ x: Number.NaN, y: 0, w: 100, h: 100 })).toThrow();
    expect(m.getState()).toEqual(before);
  });

  it('remote patch with origin does not push command', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    const initialCmdCount = commands.length;

    const bytes = createTileBytes(true);
    const data = encodeBase64(bytes);
    m.applyPatchDirect({ tiles: [{ x: 0, y: 0, data }] }, { origin: 'remote' });
    expect(commands).toHaveLength(initialCmdCount);
  });

  it('remote load with origin does not push command', () => {
    const commands: Command[] = [];
    const m = makeManager({ onCommand: (c) => commands.push(c) });
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    const initialCmdCount = commands.length;

    const newState: FogStateV1 = {
      definition: {
        version: 1,
        generation: 'remote-gen',
        bounds: { x: 0, y: 0, w: 256, h: 256 },
        cellSize: 1,
        tileCells: 128,
        base: 'covered',
      },
      tiles: [],
    };
    m.loadState(newState, { origin: 'remote' });
    expect(commands).toHaveLength(initialCmdCount);
  });

  it('view mode changes emit view events but not change events', () => {
    const m = makeManager();
    const changes: FogChangeEvent[] = [];
    const views: string[] = [];
    m.on('change', (e) => changes.push(e));
    m.on('view', (e) => views.push(e.mode));

    m.setViewMode('editor');
    expect(views).toEqual(['editor']);
    expect(changes).toHaveLength(0);

    m.setViewMode('player');
    expect(views).toEqual(['editor', 'player']);

    m.setViewMode('player');
    expect(views).toEqual(['editor', 'player']);
  });

  it('unsubscribe works', () => {
    const m = makeManager();
    const events: FogChangeEvent[] = [];
    const unsub = m.on('change', (e) => events.push(e));
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 } });
    expect(events).toHaveLength(1);
    unsub();
    m.reset('revealed');
    expect(events).toHaveLength(1);
  });

  it('throwing listener does not break other listeners', () => {
    const m = makeManager();
    const events: FogChangeEvent[] = [];
    m.on('change', () => {
      throw new Error('boom');
    });
    m.on('change', (e) => events.push(e));
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 } });
    expect(events).toHaveLength(1);
  });

  it('dispose clears all listeners', () => {
    const m = makeManager();
    const events: FogChangeEvent[] = [];
    m.on('change', (e) => events.push(e));
    m.dispose();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 } });
    expect(events).toHaveLength(0);
  });

  it('snapshot immutability', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 256, h: 256 }, cellSize: 1 });
    m.applyRegion({ kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, 'reveal');
    const s1 = getState(m);
    m.applyRegion({ kind: 'rectangle', from: { x: 60, y: 60 }, to: { x: 100, y: 100 } }, 'reveal');
    const s2 = getState(m);
    expect(s1).not.toBe(s2);
    expect(s1.tiles).not.toBe(s2.tiles);
  });

  it('loadState validates and rejects malformed state', () => {
    const m = makeManager();
    expect(() => m.loadState({ definition: { version: 99 } } as unknown as FogStateV1)).toThrow();
    expect(m.getState()).toBeNull();
  });
});
