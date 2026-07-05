import type { Camera } from '@fieldnotes/core';
import type { SyncClient } from '@fieldnotes/sync';

interface CursorData {
  x: number;
  y: number;
  name: string;
  color: string;
}

// Sends this client's pointer as presence (throttled to rAF) and renders peers' cursors as DOM chips,
// reprojected on camera change. Lives for the page's lifetime.
export function mountCursors(
  host: HTMLElement,
  overlay: HTMLElement,
  camera: Camera,
  client: SyncClient,
  me: { name: string; color: string },
): void {
  let pending: { x: number; y: number } | null = null;
  let raf = 0;
  host.addEventListener('pointermove', (e) => {
    const rect = host.getBoundingClientRect();
    const world = camera.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    pending = world;
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending)
          client.sendPresence({ x: pending.x, y: pending.y, name: me.name, color: me.color });
      });
  });

  const chips = new Map<string, { el: HTMLElement; world: { x: number; y: number } }>();
  const place = (el: HTMLElement, world: { x: number; y: number }) => {
    const s = camera.worldToScreen(world);
    el.style.transform = `translate(${s.x}px, ${s.y}px)`;
  };

  client.onPresence((from, data) => {
    const d = data as CursorData;
    if (typeof d?.x !== 'number' || typeof d?.y !== 'number') return;
    let chip = chips.get(from);
    if (!chip) {
      const el = document.createElement('div');
      el.className = 'peer-cursor';
      overlay.appendChild(el);
      chip = { el, world: { x: d.x, y: d.y } };
      chips.set(from, chip);
    }
    chip.world = { x: d.x, y: d.y };
    chip.el.style.setProperty('--c', d.color ?? '#3b82f6');
    chip.el.textContent = d.name ?? from;
    place(chip.el, chip.world);
  });

  client.onPresenceLeave((from) => {
    chips.get(from)?.el.remove();
    chips.delete(from);
  });

  camera.onChange(() => {
    for (const chip of chips.values()) place(chip.el, chip.world);
  });
}
