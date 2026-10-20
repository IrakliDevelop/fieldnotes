import { PeerRoster, RemoteCursorOverlay, type Viewport } from '@fieldnotes/core';

const BALLPOINT = '#2F55A4';
const LOOP_MS = 20000;
const RADIUS = { x: 50, y: 40 };

/** The scripted Mira cursor. */
export interface Mira {
  roster: PeerRoster;
  /** Parks Mira at her A3 position until `restart`. */
  stop(): void;
  /** Starts the loop again from her A3 position. */
  restart(): void;
  dispose(): void;
}

/** Shows Mira at `home` (world px) and loops her slowly while `hero` is on screen and visible. */
export function startMira(viewport: Viewport, home: { x: number; y: number }, hero: Element): Mira {
  const roster = new PeerRoster({ staleMs: 0 });
  const overlay = new RemoteCursorOverlay(viewport, roster, {
    colorFor: () => BALLPOINT,
    labelFont: '18px Kalam',
  });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let phase = 0;
  let last = 0;
  let frame = 0;
  let onScreen = false;
  let stopped = false;

  const place = (): void => {
    const angle = phase * 2 * Math.PI;
    roster.apply('mira', {
      kind: 'awareness',
      id: 'mira',
      name: 'Mira',
      color: BALLPOINT,
      cursor: {
        x: home.x + RADIUS.x * (1 - Math.cos(angle)),
        y: home.y + RADIUS.y * Math.sin(angle),
      },
    });
  };
  const tick = (now: number): void => {
    phase = (phase + Math.max(0, now - last) / LOOP_MS) % 1;
    last = now;
    place();
    frame = requestAnimationFrame(tick);
  };
  const sync = (): void => {
    const run = !stopped && onScreen && !document.hidden && !reduce.matches;
    if (run && frame === 0) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!run && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const park = (stop: boolean): void => {
    stopped = stop;
    phase = 0;
    place();
    sync();
  };
  const restart = (): void => park(false);

  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? false;
    sync();
  });
  observer.observe(hero);
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', restart);
  place();

  return {
    roster,
    stop: () => park(true),
    restart,
    dispose: () => {
      park(true);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduce.removeEventListener('change', restart);
      overlay.dispose();
      roster.dispose();
    },
  };
}
