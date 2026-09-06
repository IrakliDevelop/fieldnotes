import { describe, it, expect } from 'vitest';
import { FogManager } from './fog-manager';
import { createFogPluginHandle } from './fog-plugin-handle';
import type { FogStateV1 } from './types';

function makeFogState(): FogStateV1 {
  return {
    definition: {
      version: 1,
      generation: 'test-gen',
      bounds: { x: 0, y: 0, w: 256, h: 256 },
      cellSize: 4,
      tileCells: 128,
      base: 'covered',
    },
    tiles: [],
  };
}

describe('createFogPluginHandle', () => {
  it('exportState returns fog manager state', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    manager.loadState(makeFogState());
    const exported = handle.exportState?.();
    expect(exported).toEqual(makeFogState());
  });

  it('exportState returns null when no fog state', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(handle.exportState?.()).toBeNull();
  });

  it('loadState restores fog state', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    const fogState = makeFogState();
    handle.loadState?.(fogState);
    expect(manager.getState()).toEqual(fogState);
  });

  it('loadState with null clears fog', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    manager.loadState(makeFogState());
    handle.loadState?.(null);
    expect(manager.getState()).toBeNull();
  });

  it('loadState with undefined clears fog', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    manager.loadState(makeFogState());
    handle.loadState?.(undefined);
    expect(manager.getState()).toBeNull();
  });

  it('validateState accepts valid fog state', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(() => handle.validateState?.(makeFogState())).not.toThrow();
  });

  it('validateState accepts null and undefined', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(() => handle.validateState?.(null)).not.toThrow();
    expect(() => handle.validateState?.(undefined)).not.toThrow();
  });

  it('validateState rejects invalid fog state', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(() => handle.validateState?.({ bad: 'data' })).toThrow();
  });

  it('stateVersion is 1', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(handle.stateVersion).toBe(1);
  });

  it('dispose does not throw', () => {
    const manager = new FogManager();
    const handle = createFogPluginHandle(manager);
    expect(() => handle.dispose()).not.toThrow();
  });
});
