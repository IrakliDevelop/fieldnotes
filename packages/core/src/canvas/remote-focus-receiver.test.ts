// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteFocusReceiver, type FocusRole } from './remote-focus-receiver';
import { toFocusPresence, type FocusAudience } from './focus-presence';
import { makeHost } from './__test-utils__/overlay-host';

function makeAnimator() {
  return {
    animateTo: vi.fn(),
    jumpTo: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
}

const VIEW = { x: 0, y: 0, w: 400, h: 300 };

beforeEach(() => {
  globalThis.requestAnimationFrame = vi.fn(() => 1) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof cancelAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('role x audience matrix', () => {
  const cases: [FocusRole, FocusAudience, boolean][] = [
    ['player', 'all', true],
    ['player', 'players', true],
    ['player', 'display', false],
    ['display', 'all', true],
    ['display', 'players', false],
    ['display', 'display', true],
    ['dm', 'all', false],
    ['dm', 'players', false],
    ['dm', 'display', false],
  ];

  for (const [role, audience, accepted] of cases) {
    it(`${role} + audience:${audience} -> ${accepted ? 'accept' : 'ignore'}`, () => {
      const { host } = makeHost();
      const animator = makeAnimator();
      const receiver = new RemoteFocusReceiver(host, {
        role,
        animator: animator as never,
      });
      const result = receiver.apply('peer-1', toFocusPresence(VIEW, audience));
      expect(result).toBe(accepted);
      expect(animator.animateTo).toHaveBeenCalledTimes(accepted ? 1 : 0);
    });
  }
});

describe('payload guarding', () => {
  it('returns false for foreign presence kinds without animating', () => {
    const { host } = makeHost();
    const animator = makeAnimator();
    const receiver = new RemoteFocusReceiver(host, { role: 'player', animator: animator as never });
    expect(receiver.apply('peer', { kind: 'poke', feature: 'initiative' })).toBe(false);
    expect(receiver.apply('peer', { kind: 'ping', x: 1, y: 2 })).toBe(false);
    expect(receiver.apply('peer', null)).toBe(false);
    expect(animator.animateTo).not.toHaveBeenCalled();
  });
});

describe('arrival pulse', () => {
  it('draws exactly one pulse at the rect center on accept', () => {
    const { host, getRenderer } = makeHost();
    const animator = makeAnimator();
    const receiver = new RemoteFocusReceiver(host, { role: 'player', animator: animator as never });
    receiver.apply('peer', toFocusPresence({ x: 100, y: 50, w: 400, h: 300 }, 'all'));

    const drawnAt: number[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number) => drawnAt.push(x)),
      stroke: vi.fn(),
      fill: vi.fn(),
      set globalAlpha(v: number) {
        void v;
      },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    getRenderer()?.(ctx);
    expect(drawnAt.length).toBeGreaterThan(0);
    for (const x of drawnAt) expect(x).toBeCloseTo(300, 6); // 100 + 400/2
  });

  it('replaces rather than stacks for the same sender', () => {
    const { host, getRenderer } = makeHost();
    const receiver = new RemoteFocusReceiver(host, {
      role: 'player',
      animator: makeAnimator() as never,
    });
    receiver.apply('peer', toFocusPresence({ x: 0, y: 0, w: 100, h: 100 }, 'all'));
    receiver.apply('peer', toFocusPresence({ x: 1000, y: 0, w: 100, h: 100 }, 'all'));

    const centers = new Set<number>();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number) => centers.add(Math.round(x))),
      stroke: vi.fn(),
      fill: vi.fn(),
      set globalAlpha(v: number) {
        void v;
      },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    getRenderer()?.(ctx);
    expect(centers.has(50)).toBe(false); // old pulse gone
    expect(centers.has(1050)).toBe(true); // newest target only
  });

  it('keeps different senders separate', () => {
    const { host, getRenderer } = makeHost();
    const receiver = new RemoteFocusReceiver(host, {
      role: 'player',
      animator: makeAnimator() as never,
    });
    receiver.apply('dm-a', toFocusPresence({ x: 0, y: 0, w: 100, h: 100 }, 'all'));
    receiver.apply('dm-b', toFocusPresence({ x: 1000, y: 0, w: 100, h: 100 }, 'all'));

    const centers = new Set<number>();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number) => centers.add(Math.round(x))),
      stroke: vi.fn(),
      fill: vi.fn(),
      set globalAlpha(v: number) {
        void v;
      },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    getRenderer()?.(ctx);
    expect(centers.has(50)).toBe(true);
    expect(centers.has(1050)).toBe(true);
  });

  it('pulse: false registers no overlay at all', () => {
    const { host } = makeHost();
    const registerSpy = vi.spyOn(host, 'registerOverlay');
    new RemoteFocusReceiver(host, {
      role: 'player',
      animator: makeAnimator() as never,
      pulse: false,
    });
    expect(registerSpy).not.toHaveBeenCalled();
  });
});

describe('disposal', () => {
  it('is idempotent, unregisters, and does NOT dispose the animator', () => {
    const { host, unregister } = makeHost();
    const animator = makeAnimator();
    const receiver = new RemoteFocusReceiver(host, { role: 'player', animator: animator as never });
    receiver.dispose();
    receiver.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(animator.dispose).not.toHaveBeenCalled();
  });

  it('ignores payloads after disposal', () => {
    const { host } = makeHost();
    const animator = makeAnimator();
    const receiver = new RemoteFocusReceiver(host, { role: 'player', animator: animator as never });
    receiver.dispose();
    expect(receiver.apply('peer', toFocusPresence(VIEW, 'all'))).toBe(false);
    expect(animator.animateTo).not.toHaveBeenCalled();
  });
});
