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
        if (state) state.current = undefined;
        else this.drop(room);
      }
      throw error;
    }
    if (this.generations.get(room) !== generation) return false;
    const state = this.rooms.get(room);
    if (!state) {
      // With no settled set yet, no member holds an element, so the load settles at once.
      this.rooms.set(room, { current: next, settled: next });
      return true;
    }
    if (state.current && sameGates(state.current, next)) return false;
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

  /** Sets settled to the set in force. */
  markSettled(room: string): void {
    const state = this.rooms.get(room);
    if (state?.current) state.settled = state.current;
  }

  isPending(room: string): boolean {
    return this.current(room) !== this.settled(room);
  }

  drop(room: string): void {
    this.rooms.delete(room);
    this.generations.delete(room);
  }
}
