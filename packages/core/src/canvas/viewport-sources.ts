import type { Viewport } from './viewport';
import type { SelectionStyleDetails } from './selection-ops';
import type { CanvasElement, ElementType } from '../elements/types';
import type { ElementStyle } from '../elements/element-style';
import type { Layer } from '../layers/types';

/** A subscribable viewport value with a referentially stable snapshot, for UI bindings. */
export interface ViewportSource<T> {
  /** Calls `onChange` after any change that may alter the snapshot. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** Current value; returns the previous reference when nothing observable changed. */
  getSnapshot(): T;
}

/** Camera position and zoom level. */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Undo/redo availability. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/** Layer list in order plus the active layer id. */
export interface LayersState {
  layers: Layer[];
  activeLayerId: string;
}

/** The current selection and which selection operations are meaningful for it. */
export interface SelectionOpsState {
  selectedIds: string[];
  canGroup: boolean;
  canUngroup: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  /** `true`/`false` when uniformly locked/unlocked, `null` when empty or mixed. */
  isLocked: boolean | null;
}

// Shared by both selection-style sources so their equality checks cannot drift apart.
const STYLE_KEYS: readonly (keyof ElementStyle)[] = [
  'color',
  'fillColor',
  'strokeWidth',
  'opacity',
  'fontSize',
  'strokeStyle',
];

function noop() {
  /* unsubscribe placeholder */
}

function subscribeSelectionAndStore(vp: Viewport, onChange: () => void): () => void {
  const offSel = vp.onSelectionChange(onChange);
  const offStore = vp.store.onChange(onChange);
  return () => {
    offSel();
    offStore();
  };
}

/** Camera position and zoom; changes whenever the camera moves or zooms. */
export function createCameraSource(vp: Viewport): ViewportSource<CameraState> {
  let cached: CameraState = { x: 0, y: 0, zoom: 1 };
  return {
    subscribe: (onChange) => vp.camera.onChange(onChange),
    getSnapshot() {
      const { position, zoom } = vp.camera;
      if (cached.x === position.x && cached.y === position.y && cached.zoom === zoom) {
        return cached;
      }
      cached = { x: position.x, y: position.y, zoom };
      return cached;
    },
  };
}

/** All elements, or those of the type `getType` returns; changes on every store mutation. */
export function createElementsSource(
  vp: Viewport,
  getType?: () => ElementType | undefined,
): ViewportSource<CanvasElement[]> {
  let cached: CanvasElement[] = [];
  return {
    subscribe: (onChange) => vp.store.onChange(onChange),
    getSnapshot() {
      const type = getType?.();
      const next = type ? vp.store.getElementsByType(type) : vp.store.getAll();
      if (cached.length === next.length && cached.every((el, i) => el === next[i])) {
        return cached;
      }
      cached = next;
      return next;
    },
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (k) =>
          k in (b as Record<string, unknown>) &&
          Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/**
 * A value derived from all elements; changes only when the selected value changes per `isEqual`
 * (default: one-level shallow compare). The cache survives the getters returning new functions.
 */
export function createElementsSelectorSource<R>(
  vp: Viewport,
  getSelector: () => (elements: CanvasElement[]) => R,
  getIsEqual?: () => ((a: R, b: R) => boolean) | undefined,
): ViewportSource<R> {
  let selected: { value: R } | null = null;
  return {
    subscribe: (onChange) => vp.store.onChange(onChange),
    getSnapshot() {
      const next = getSelector()(vp.store.getAll());
      const equal = getIsEqual?.() ?? shallowEqual;
      if (selected !== null && equal(selected.value, next)) return selected.value;
      selected = { value: next };
      return next;
    },
  };
}

/** Selected element ids; core keeps the array reference stable until the selection changes. */
export function createSelectionSource(vp: Viewport): ViewportSource<string[]> {
  return {
    subscribe: (onChange) => vp.onSelectionChange(onChange),
    getSnapshot: () => vp.getSelectedIds(),
  };
}

function selectionOpsEqual(a: SelectionOpsState, b: SelectionOpsState): boolean {
  return (
    a.selectedIds === b.selectedIds &&
    a.canGroup === b.canGroup &&
    a.canUngroup === b.canUngroup &&
    a.canAlign === b.canAlign &&
    a.canDistribute === b.canDistribute &&
    a.isLocked === b.isLocked
  );
}

/** Selection predicates (`canGroup`, `canAlign`, …, `isLocked`) for the current selection. */
export function createSelectionOpsSource(vp: Viewport): ViewportSource<SelectionOpsState> {
  let cached: SelectionOpsState | null = null;
  return {
    subscribe: (onChange) => subscribeSelectionAndStore(vp, onChange),
    getSnapshot() {
      const ids = vp.getSelectedIds();
      const n = ids.length;
      let canUngroup = false;
      let lockedCount = 0;
      for (const id of ids) {
        const el = vp.store.getById(id);
        if (!el) continue;
        if (el.groupId !== undefined) canUngroup = true;
        if (el.locked) lockedCount++;
      }
      const isLocked: boolean | null =
        n === 0 ? null : lockedCount === n ? true : lockedCount === 0 ? false : null;
      const next: SelectionOpsState = {
        selectedIds: ids,
        canGroup: n >= 2,
        canUngroup,
        canAlign: n >= 2,
        canDistribute: n >= 3,
        isLocked,
      };
      if (cached && selectionOpsEqual(cached, next)) return cached;
      cached = next;
      return next;
    },
  };
}

function styleEqual(a: ElementStyle | null, b: ElementStyle | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return STYLE_KEYS.every((k) => a[k] === b[k]);
}

/** Normalized style of the current selection; `null` when nothing is selected. */
export function createSelectionStyleSource(vp: Viewport): ViewportSource<ElementStyle | null> {
  let cached: ElementStyle | null = null;
  return {
    subscribe: (onChange) => subscribeSelectionAndStore(vp, onChange),
    getSnapshot() {
      const next = vp.getSelectionStyle();
      if (styleEqual(cached, next)) return cached;
      cached = next;
      return next;
    },
  };
}

function keysEqual(
  a: readonly (keyof ElementStyle)[],
  b: readonly (keyof ElementStyle)[],
): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

function detailsEqual(a: SelectionStyleDetails | null, b: SelectionStyleDetails | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    keysEqual(a.applicable, b.applicable) &&
    keysEqual(a.mixed, b.mixed) &&
    STYLE_KEYS.every((k) => a.common[k] === b.common[k])
  );
}

/** Per-field applicability, mixed state and common style of the selection; `null` when none. */
export function createSelectionStyleDetailsSource(
  vp: Viewport,
): ViewportSource<SelectionStyleDetails | null> {
  let cached: SelectionStyleDetails | null = null;
  return {
    subscribe: (onChange) => subscribeSelectionAndStore(vp, onChange),
    getSnapshot() {
      const next = vp.getSelectionStyleDetails();
      if (detailsEqual(cached, next)) return cached;
      cached = next;
      return next;
    },
  };
}

/** Undo/redo availability; changes only when either flag flips. */
export function createHistorySource(vp: Viewport): ViewportSource<HistoryState> {
  let cached: HistoryState = { canUndo: false, canRedo: false };
  return {
    subscribe: (onChange) => vp.history.onChange(onChange),
    getSnapshot() {
      const { canUndo, canRedo } = vp.history;
      if (cached.canUndo === canUndo && cached.canRedo === canRedo) return cached;
      cached = { canUndo, canRedo };
      return cached;
    },
  };
}

/** Layer list and active layer; changes when a layer is added, removed, reordered or edited. */
export function createLayersSource(vp: Viewport): ViewportSource<LayersState> {
  let cached: LayersState = { layers: [], activeLayerId: '' };
  return {
    subscribe: (onChange) => vp.layerManager.on('change', onChange),
    getSnapshot() {
      const layers = vp.layerManager.getLayers();
      const activeLayerId = vp.layerManager.activeLayerId;
      if (
        cached.activeLayerId === activeLayerId &&
        cached.layers.length === layers.length &&
        cached.layers.every((l, i) => {
          const next = layers[i];
          return (
            next !== undefined &&
            l.id === next.id &&
            l.name === next.name &&
            l.visible === next.visible &&
            l.locked === next.locked &&
            l.order === next.order &&
            l.opacity === next.opacity
          );
        })
      ) {
        return cached;
      }
      cached = { layers, activeLayerId };
      return cached;
    },
  };
}

/** Active tool name; `''` when no tool is active. */
export function createActiveToolSource(vp: Viewport): ViewportSource<string> {
  return {
    subscribe: (onChange) => vp.toolManager.onChange(onChange),
    getSnapshot: () => vp.toolManager.activeTool?.name ?? '',
  };
}

function optionsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const valA = a[key];
    const valB = b[key];
    if (valA === valB) continue;
    if (
      typeof valA === 'object' &&
      valA !== null &&
      typeof valB === 'object' &&
      valB !== null &&
      !Array.isArray(valA) &&
      !Array.isArray(valB)
    ) {
      const objA = valA as Record<string, unknown>;
      const objB = valB as Record<string, unknown>;
      const innerKeys = Object.keys(objA);
      if (
        innerKeys.length === Object.keys(objB).length &&
        innerKeys.every((k) => objA[k] === objB[k])
      ) {
        continue;
      }
    }
    return false;
  }
  return true;
}

/**
 * Options of the tool `getToolName` names; `null` if the tool is not registered or exposes no
 * options. The cache survives the name changing.
 */
export function createToolOptionsSource<T extends Record<string, unknown>>(
  vp: Viewport,
  getToolName: () => string,
): ViewportSource<T | null> {
  let cached: T | null = null;
  return {
    subscribe(onChange) {
      const tool = vp.toolManager.getTool(getToolName());
      if (!tool?.onOptionsChange) return noop;
      return tool.onOptionsChange(onChange);
    },
    getSnapshot() {
      const tool = vp.toolManager.getTool(getToolName());
      if (!tool?.getOptions) return null;
      const next = tool.getOptions() as T;
      if (cached && optionsEqual(cached, next)) return cached;
      cached = next;
      return next;
    },
  };
}
