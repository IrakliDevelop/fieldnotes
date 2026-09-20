import { describe, it, expect, vi } from 'vitest';
import type { SyncOp } from '@fieldnotes/sync';
import { createFogClientPlugin } from './sync';
import { FogManager } from './fog/fog-manager';

describe('createFogClientPlugin', () => {
  it('keeps fog edits made before the first start() and publishes them on connect', () => {
    const manager = new FogManager();
    const plugin = createFogClientPlugin({ manager });

    // Offline: the DM sets up fog before the sync client has ever started.
    manager.initialize({ bounds: { x: 0, y: 0, w: 256, h: 128 }, cellSize: 1 });
    manager.applyRegion(
      { kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
      'reveal',
    );
    const offlineState = manager.getState();
    expect(offlineState).not.toBeNull();

    const send = vi.fn<(op: SyncOp) => void>();
    if (!plugin.start) throw new Error('fog client plugin must expose start()');
    plugin.start({ clientId: 'dm', send });
    // The hub has no fog for this room: the offline edits are the truth.
    plugin.applySnapshot?.({ pluginName: 'fog', version: 1, data: null }, { phase: 'initial' });

    expect(manager.getState()?.definition.generation).toBe(offlineState?.definition.generation);
    const kinds = send.mock.calls.map(([op]) => op.kind);
    expect(kinds).toContain('fog-meta');
    expect(kinds).toContain('fog-patch');
  });
});
