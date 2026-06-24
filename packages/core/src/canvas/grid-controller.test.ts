// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { GridController } from './grid-controller';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import type { ToolContext } from '../tools/types';

function setup() {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const requestRender = vi.fn();
  const toolContext = {
    gridSize: undefined,
    gridType: undefined,
    hexOrientation: undefined,
  } as unknown as ToolContext;
  const controller = new GridController({
    store,
    recorder,
    requestRender,
    getActiveLayerId: () => 'layer',
    toolContext,
    defaultGridSize: 24,
  });
  return { store, stack, recorder, requestRender, toolContext, controller };
}

describe('GridController', () => {
  it('add() adds a grid in one undo step', () => {
    const { store, stack, controller } = setup();
    const baseline = stack.undoCount;

    const id = controller.add({ gridType: 'square', cellSize: 40 });

    expect(store.getById(id)?.type).toBe('grid');
    expect(store.getElementsByType('grid')).toHaveLength(1);
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('add() replaces an existing grid in one undo step', () => {
    const { store, stack, controller } = setup();
    const first = controller.add({ gridType: 'square' });
    const baseline = stack.undoCount;

    const second = controller.add({ gridType: 'hex' });

    expect(second).not.toBe(first);
    expect(store.getElementsByType('grid')).toHaveLength(1);
    expect(store.getById(first)).toBeUndefined();
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('getInfo() returns null when no grid', () => {
    const { controller } = setup();
    expect(controller.getInfo()).toBeNull();
  });

  it('getInfo() reports cellRadius = cellSize for hex', () => {
    const { controller } = setup();
    controller.add({ gridType: 'hex', cellSize: 30 });
    const info = controller.getInfo();
    expect(info?.gridType).toBe('hex');
    expect(info?.cellSize).toBe(30);
    expect(info?.cellRadius).toBe(30);
  });

  it('getInfo() reports cellRadius = cellSize / 2 for square', () => {
    const { controller } = setup();
    controller.add({ gridType: 'square', cellSize: 30 });
    const info = controller.getInfo();
    expect(info?.gridType).toBe('square');
    expect(info?.cellRadius).toBe(15);
  });

  it('onChange listener fires on syncContext()', () => {
    const { controller } = setup();
    const listener = vi.fn();
    controller.onChange(listener);

    controller.syncContext();

    expect(listener).toHaveBeenCalledWith(null);
    controller.add({ gridType: 'square', cellSize: 40 });
    listener.mockClear();
    controller.syncContext();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ gridType: 'square', cellSize: 40 }),
    );
  });

  it('onChange returns an unsubscribe that stops the listener', () => {
    const { controller } = setup();
    const listener = vi.fn();
    const off = controller.onChange(listener);
    off();
    controller.syncContext();
    expect(listener).not.toHaveBeenCalled();
  });

  it('syncContext() sets toolContext fields from the grid', () => {
    const { controller, toolContext } = setup();
    controller.add({ gridType: 'hex', hexOrientation: 'flat', cellSize: 50 });

    controller.syncContext();

    expect(toolContext.gridSize).toBe(50);
    expect(toolContext.gridType).toBe('hex');
    expect(toolContext.hexOrientation).toBe('flat');
  });

  it('syncContext() falls back to defaultGridSize when no grid', () => {
    const { controller, toolContext } = setup();
    toolContext.gridSize = 99;
    toolContext.gridType = 'square';
    toolContext.hexOrientation = 'pointy';

    controller.syncContext();

    expect(toolContext.gridSize).toBe(24);
    expect(toolContext.gridType).toBeUndefined();
    expect(toolContext.hexOrientation).toBeUndefined();
  });
});
