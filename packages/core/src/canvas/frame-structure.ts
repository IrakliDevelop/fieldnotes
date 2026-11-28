import type { CanvasElement } from '../elements/types';

export interface FrameStructure {
  readonly visibleCount: number;
  readonly firstDomIndex: number;
  readonly hybridActive: boolean;
  readonly layerGroups: ReadonlyMap<string, readonly number[]>; // layerId -> scene ranks
  readonly hybridRuns: ReadonlyMap<number, readonly number[]>; // paint order -> scene ranks
  readonly hybridOrders: ReadonlySet<number>;
  readonly fullCanvas: readonly number[]; // scene ranks
  readonly dom: readonly { rank: number; order: number }[]; // DOM elements on visible layers
  readonly hiddenDom: readonly number[]; // DOM elements on hidden layers
}

export function buildFrameStructure(
  elements: readonly CanvasElement[],
  isLayerVisible: (layerId: string) => boolean,
  isDomElement: (element: CanvasElement) => boolean,
  isFullCanvasElement: (element: CanvasElement) => boolean,
): FrameStructure {
  let visibleCount = 0;
  let firstDomIndex = -1;
  let hybridActive = false;
  for (const element of elements) {
    if (!isLayerVisible(element.layerId)) continue;
    if (!hybridActive) {
      const isDom = isDomElement(element);
      if (firstDomIndex < 0 && isDom) firstDomIndex = visibleCount;
      else if (firstDomIndex >= 0 && !isDom) hybridActive = true;
    }
    visibleCount++;
  }

  const layerGroups = new Map<string, number[]>();
  const hybridRuns = new Map<number, number[]>();
  const hybridOrders = new Set<number>();
  const fullCanvas: number[] = [];
  const dom: { rank: number; order: number }[] = [];
  const hiddenDom: number[] = [];
  let activeHybridOrder: number | null = null;
  let paintOrder = 0;

  elements.forEach((element, rank) => {
    if (!isLayerVisible(element.layerId)) {
      if (isDomElement(element)) hiddenDom.push(rank);
      return;
    }
    const order = ++paintOrder;
    if (isDomElement(element)) {
      activeHybridOrder = null;
      dom.push({ rank, order });
      return;
    }
    // Full-canvas elements take a paint order but do not end the open hybrid run.
    if (isFullCanvasElement(element)) {
      fullCanvas.push(rank);
      return;
    }
    if (hybridActive && order > firstDomIndex + 1) {
      activeHybridOrder ??= order;
      let run = hybridRuns.get(activeHybridOrder);
      if (!run) {
        run = [];
        hybridRuns.set(activeHybridOrder, run);
        hybridOrders.add(activeHybridOrder);
      }
      run.push(rank);
      return;
    }
    let group = layerGroups.get(element.layerId);
    if (!group) {
      group = [];
      layerGroups.set(element.layerId, group);
    }
    group.push(rank);
  });

  return {
    visibleCount,
    firstDomIndex,
    hybridActive,
    layerGroups,
    hybridRuns,
    hybridOrders,
    fullCanvas,
    dom,
    hiddenDom,
  };
}
