import type { Bounds } from '../core/types';
import type { CanvasElement } from '../elements/types';
import type { ElementRegistry } from '../elements/element-registry';
import type { LayerManager } from '../layers/layer-manager';
import type { Layer } from '../layers/types';
import type { CanvasState } from '../core/state-serializer';
import { exportState } from '../core/state-serializer';
import { boundsIntersect } from '../elements/element-bounds';
import { getElementRect } from './export-image';

/** Envelope `type` of a scene embedded in an exported PNG or SVG. */
export const SCENE_METADATA_TYPE = 'fieldnotes/scene';
/** `iTXt` keyword of the PNG chunk holding the embedded scene. */
export const SCENE_PNG_KEYWORD = 'fieldnotes:scene';
export const MAX_SCENE_EMBED_BYTES = 16 * 1024 * 1024;

/** Export options for embedding the exported elements as a loadable scene. */
export interface SceneEmbedOptions {
  /** Embed the exported elements as a loadable scene. Default false. The scene holds every element inside the export bounds regardless of what paints over it (fog, hooks, full-canvas extensions): never embed in an export meant for viewers who must not see those elements. */
  embedScene?: boolean;
  /** Called when the scene exceeds 16 MiB and is left out; the export still succeeds. */
  onSceneOmitted?: (info: { bytes: number; limit: number }) => void;
}

/** The scene document embedded in an exported PNG or SVG. */
export interface SceneEnvelope {
  type: typeof SCENE_METADATA_TYPE;
  version: 1;
  state: CanvasState;
}

const DEFAULT_LAYER: Layer = {
  id: 'default-layer',
  name: 'Layer 1',
  visible: true,
  locked: false,
  order: 0,
  opacity: 1,
};

export function buildSceneEnvelope(
  elements: readonly CanvasElement[],
  bounds: Bounds,
  layerManager: LayerManager | undefined,
  registry: ElementRegistry,
): SceneEnvelope {
  const kept = elements.filter((el) => {
    if (el.type === 'html' && el.transient === true) return false;
    const rect = getElementRect(el, registry);
    return rect !== null && boundsIntersect(rect, bounds);
  });
  const keptIds = new Set(kept.map((el) => el.id));
  const layerIds = new Set(kept.map((el) => el.layerId));
  const layers = layerManager
    ? layerManager.getLayers().filter((layer) => layerIds.has(layer.id))
    : [DEFAULT_LAYER];
  const state = exportState(
    kept,
    { position: { x: bounds.x, y: bounds.y }, zoom: 1 },
    layers,
    undefined,
    undefined,
    registry,
  );
  for (const el of state.elements) {
    // ownerId and audience are host fields outside the element types.
    for (const key of ['editor', 'ownerId', 'audience']) Reflect.deleteProperty(el, key);
    if (!layerManager) el.layerId = DEFAULT_LAYER.id;
    // A frame export, filter or cull can drop a target; dangling references fail validation on load.
    if (el.parentId !== undefined && !keptIds.has(el.parentId)) delete el.parentId;
    if (el.type === 'text' && el.containerId !== undefined && !keptIds.has(el.containerId)) {
      delete el.containerId;
    }
    if (el.type === 'arrow') {
      if (el.fromBinding && !keptIds.has(el.fromBinding.elementId)) delete el.fromBinding;
      if (el.toBinding && !keptIds.has(el.toBinding.elementId)) delete el.toBinding;
    }
  }
  return { type: SCENE_METADATA_TYPE, version: 1, state };
}

export function serializeSceneEnvelope(
  envelope: SceneEnvelope,
  options: SceneEmbedOptions,
): string | null {
  const json = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_SCENE_EMBED_BYTES) {
    options.onSceneOmitted?.({ bytes, limit: MAX_SCENE_EMBED_BYTES });
    return null;
  }
  return json;
}
