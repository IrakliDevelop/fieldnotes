import type { SyncElement } from '@fieldnotes/sync';
import type { HubBackend } from './hub-backend';
import type { ElementReadGate, PluginViewer, ServerSyncPlugin } from './sync-plugin';

/** The element read gates in force for one room. */
export type GateSet = readonly ElementReadGate[];

/** True only when every gate returns exactly true; a throw is false. */
export function gatesAllow(gates: GateSet, element: SyncElement, viewer: PluginViewer): boolean {
  for (const gate of gates) {
    try {
      if (gate(element, viewer) !== true) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sameGates(a: GateSet, b: GateSet): boolean {
  return a.length === b.length && a.every((gate, index) => gate === b[index]);
}

interface RoomGateState {
  // Undefined after a failed refresh: withhold everything until the next load.
  current: GateSet | undefined;
  settled: GateSet;
  // Sets replaced since settled: members may hold what any of them allowed.
  since: GateSet[];
  overflowed: boolean;
}

const MAX_SINCE = 8;

function keepReplaced(state: RoomGateState, replaced: GateSet): void {
  if (state.since.length < MAX_SINCE) state.since.push(replaced);
  else state.overflowed = true;
}

/** Per-room element read gates: the set in force and the settled set. */
export class RoomElementGates {
  private readonly plugins: readonly ServerSyncPlugin[];
  private readonly rooms = new Map<string, RoomGateState>();
  // One token per generation; drop deletes it, so a refresh it overtook stores nothing.
  private readonly generations = new Map<string, object>();
  /** False when no plugin has `elementReadGate`; the hub then skips all gate work. */
  readonly active: boolean;

  constructor(plugins: readonly ServerSyncPlugin[]) {
    this.plugins = plugins.filter((plugin) => plugin.elementReadGate);
    this.active = this.plugins.length > 0;
  }

  isLoaded(room: string): boolean {
    return this.current(room) !== undefined;
  }

  /** Asks every gate plugin; returns true when the set in force changed (by identity). */
  async refresh(room: string, backend: HubBackend): Promise<boolean> {
    let generation = this.generations.get(room);
    if (!generation) {
      generation = {};
      this.generations.set(room, generation);
    }
    const next: ElementReadGate[] = [];
    try {
      for (const plugin of this.plugins) {
        const gate = await plugin.elementReadGate?.(room, backend);
        if (gate) next.push(gate);
      }
    } catch (error) {
      // Unloaded withholds every element, so a broken gate never leaves an older one in force;
      // settled stays so the next load reconciles what members already hold.
      if (this.generations.get(room) === generation) {
        const state = this.rooms.get(room);
        if (state?.current) keepReplaced(state, state.current);
        if (state) state.current = undefined;
        else this.drop(room);
      }
      throw error;
    }
    if (this.generations.get(room) !== generation) return false;
    const state = this.rooms.get(room);
    if (!state) {
      // With no settled set yet, no member holds an element, so the load settles at once.
      this.rooms.set(room, { current: next, settled: next, since: [], overflowed: false });
      return true;
    }
    if (state.current && sameGates(state.current, next)) return false;
    if (state.current) keepReplaced(state, state.current);
    state.current = next;
    return true;
  }

  /** Gates in force; `undefined` while not loaded. */
  current(room: string): GateSet | undefined {
    return this.rooms.get(room)?.current;
  }

  /** Gates as of the first load or the last finished reconcile; `'deny'` before any load. */
  settled(room: string): GateSet | 'deny' {
    return this.rooms.get(room)?.settled ?? 'deny';
  }

  /** Sets settled to the set in force and forgets the sets replaced since. */
  markSettled(room: string): void {
    const state = this.rooms.get(room);
    if (!state?.current) return;
    state.settled = state.current;
    state.since = [];
    state.overflowed = false;
  }

  /** True when the settled set or any set replaced since allowed the element; all after overflow. */
  allowedSinceSettled(room: string, element: SyncElement, viewer: PluginViewer): boolean {
    const state = this.rooms.get(room);
    if (!state) return false;
    // A remove for an element the viewer never held is a client no-op, so over-removing is safe.
    if (state.overflowed) return true;
    return (
      gatesAllow(state.settled, element, viewer) ||
      state.since.some((gates) => gatesAllow(gates, element, viewer))
    );
  }

  isPending(room: string): boolean {
    const state = this.rooms.get(room);
    // No state: unloaded, so current (undefined) differs from settled ('deny').
    if (!state) return true;
    return state.current !== state.settled || state.since.length > 0 || state.overflowed;
  }

  drop(room: string): void {
    this.rooms.delete(room);
    this.generations.delete(room);
  }
}
