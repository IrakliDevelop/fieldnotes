import type { Viewport } from '@fieldnotes/core';
import type { IconName } from './shell/icons';

export type SceneId = 'whiteboard' | 'tabletop' | 'embeds';

export interface FlyoutItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Called when picked; the shell then activates the owning tool. */
  select(): void;
}

export interface ToolSpec {
  /** Name the tool is registered under on the viewport (`viewport.setTool(name)`). */
  readonly name: string;
  readonly label: string;
  readonly icon: IconName;
  /** Single key that activates it: '1'..'9', '0', or a lowercase letter. */
  readonly key: string;
  readonly flyout?: readonly FlyoutItem[];
  /** Runs before the tool is activated by click or key (e.g. open a file picker). */
  beforeActivate?(): void;
}

export type StyleControl =
  | 'stroke-color'
  | 'fill-color'
  | 'stroke-width'
  | 'opacity'
  | 'font-size'
  | 'arrow-style'
  | 'arrange';

export interface StyleSpec {
  /** Controls for the active tool; for 'select', the shell derives them from the selection. */
  controlsFor(toolName: string): readonly StyleControl[];
  /** Optional scene-owned section rendered under the generic controls (grid, fog). */
  extraSection?(toolName: string): HTMLElement | null;
}

export interface Peer {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface Room {
  readonly id: string;
  /** 'host' started the room in this tab (sessionStorage flag); 'guest' joined via link. */
  readonly role: 'host' | 'guest';
}

export interface Shell {
  toast(message: string): void;
  setPeers(peers: readonly Peer[]): void;
  /** Re-reads tools/styles after a scene changes them (e.g. GM vs player). */
  refresh(): void;
}

export interface SceneContext {
  readonly stage: HTMLElement;
  readonly shell: Shell;
  readonly room: Room | null;
}

export interface SceneInstance {
  readonly viewport: Viewport;
  readonly tools: readonly ToolSpec[];
  readonly styles: StyleSpec;
  /** Replaces the board with the scene's sample and fits the view. */
  loadSample(): void;
  dispose(): void;
}

export interface Scene {
  readonly id: SceneId;
  readonly label: string;
  mount(ctx: SceneContext): SceneInstance;
}
