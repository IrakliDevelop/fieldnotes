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
  current: GateSet;
  settled: GateSet | 'deny';
}

/** Per-room element read gates: the set in force and the set as of the last finished reconcile. */
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
    return this.rooms.has(room);
  }

  /** Asks every gate plugin; returns true when the set in force changed (by identity). */
  async refresh(room: string, backend: HubBackend): Promise<boolean> {
    let generation = this.generations.get(room);
    if (!generation) {
      generation = {};
      this.generations.set(room, generation);
    }
    const next: ElementReadGate[] = [];
    for (const plugin of this.plugins) {
      const gate = await plugin.elementReadGate?.(room, backend);
      if (gate) next.push(gate);
    }
    if (this.generations.get(room) !== generation) return false;
    const state = this.rooms.get(room);
    if (!state) {
      this.rooms.set(room, { current: next, settled: 'deny' });
      return true;
    }
    if (sameGates(state.current, next)) return false;
    state.current = next;
    return true;
  }

  /** Gates in force; `undefined` while not loaded. */
  current(room: string): GateSet | undefined {
    return this.rooms.get(room)?.current;
  }

  /** Gates as of the last finished reconcile; `'deny'` before the first. */
  settled(room: string): GateSet | 'deny' {
    return this.rooms.get(room)?.settled ?? 'deny';
  }

  /** Sets settled to the set in force. */
  markSettled(room: string): void {
    const state = this.rooms.get(room);
    if (state) state.settled = state.current;
  }

  isPending(room: string): boolean {
    return this.current(room) !== this.settled(room);
  }

  drop(room: string): void {
    this.rooms.delete(room);
    this.generations.delete(room);
  }
}
