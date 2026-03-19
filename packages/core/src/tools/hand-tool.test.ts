import { describe, it, expect, vi } from 'vitest';
import { HandTool } from './hand-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('HandTool', () => {
  it('has name "hand"', () => {
    expect(new HandTool().name).toBe('hand');
  });

  it('pans the camera on drag', () => {
    const tool = new HandTool();
    const camera = new Camera();
    const ctx = makeCtx({ camera });
    const startX = camera.position.x;
    const startY = camera.position.y;

    tool.onPointerDown(pt(100, 100), ctx);
    tool.onPointerMove(pt(150, 120), ctx);

    expect(camera.position.x).toBe(startX + 50);
    expect(camera.position.y).toBe(startY + 20);
  });

  it('does not pan when not pressing', () => {
    const tool = new HandTool();
    const camera = new Camera();
    const ctx = makeCtx({ camera });
    const startX = camera.position.x;

    tool.onPointerMove(pt(150, 120), ctx);

    expect(camera.position.x).toBe(startX);
  });

  it('stops panning on pointer up', () => {
    const tool = new HandTool();
    const camera = new Camera();
    const ctx = makeCtx({ camera });

    tool.onPointerDown(pt(100, 100), ctx);
    tool.onPointerMove(pt(150, 120), ctx);
    tool.onPointerUp(pt(150, 120), ctx);

    const posAfterUp = { ...camera.position };
    tool.onPointerMove(pt(200, 200), ctx);

    expect(camera.position.x).toBe(posAfterUp.x);
    expect(camera.position.y).toBe(posAfterUp.y);
  });
});
