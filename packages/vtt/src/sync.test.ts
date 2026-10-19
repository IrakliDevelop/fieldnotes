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

  it('serves fog that existed before the plugin was created in its snapshot', () => {
    const manager = new FogManager();
    manager.initialize({ bounds: { x: 0, y: 0, w: 256, h: 128 }, cellSize: 1 });
    manager.applyRegion(
      { kind: 'rectangle', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
      'reveal',
    );
    const existing = manager.getState();
    if (!existing) throw new Error('fog not initialised');

    const plugin = createFogClientPlugin({ manager });
    plugin.start?.({ clientId: 'host', send: vi.fn() });
    const data = plugin.createSnapshot?.();
    expect(data).toMatchObject({
      meta: { definition: { generation: existing.definition.generation } },
    });
    expect(JSON.stringify(data)).toContain(existing.tiles[0]?.data);

    const peer = new FogManager();
    const peerPlugin = createFogClientPlugin({ manager: peer });
    peerPlugin.start?.({ clientId: 'guest', send: vi.fn() });
    peerPlugin.applySnapshot?.({ pluginName: 'fog', version: 1, data }, { phase: 'initial' });
    expect(peer.getState()).toEqual(existing);
  });
});
