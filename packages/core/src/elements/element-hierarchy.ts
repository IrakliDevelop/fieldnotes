import type { ElementRegistry } from './element-registry';
import type { CanvasElement } from './types';
import type { Bounds } from '../core/types';
import { reportFailure } from '../core/report-failure';

const MAX_DEPTH = 32;

function compare(a: CanvasElement, b: CanvasElement): number {
  if (a.index !== b.index) return a.index < b.index ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isFullCanvas(element: CanvasElement, registry: ElementRegistry): boolean {
  return (
    element.type === 'extension' && registry.getAdapter(element.extensionType)?.fullCanvas === true
  );
}

function invalidHierarchy(): never {
  throw new Error(
    'Invalid hierarchy: missing, cyclic, cross-layer, full-canvas, or over-depth parent relationship',
  );
}

export function validateAddedElement(
  element: CanvasElement,
  elements: ReadonlyMap<string, CanvasElement>,
  registry: ElementRegistry,
): void {
  const seen = new Set<string>();
  let current: CanvasElement | undefined = element;
  let depth = 0;
  while (current?.parentId !== undefined) {
    if (isFullCanvas(current, registry) || seen.has(current.id)) invalidHierarchy();
    seen.add(current.id);
    const parent = elements.get(current.parentId);
    if (
      parent === undefined ||
      parent.id === current.id ||
      parent.layerId !== current.layerId ||
      isFullCanvas(parent, registry) ||
      ++depth > MAX_DEPTH
    ) {
      invalidHierarchy();
    }
    current = parent;
  }
}

export class ElementHierarchy {
  readonly scene: readonly CanvasElement[];
  private readonly sceneElements: CanvasElement[];
  private readonly children = new Map<string, CanvasElement[]>();
  private readonly descendants = new Map<string, CanvasElement[]>();
  private readonly ranks = new Map<string, number>();
  private readonly siblingRanks = new Map<string, number>();
  private readonly ancestorRanks = new Map<string, readonly { id: string; rank: number }[]>();
  private clips: Map<string, Bounds | null | undefined> | null = null;

  constructor(
    elements: ReadonlyMap<string, CanvasElement>,
    private readonly registry: ElementRegistry,
    layerOrder: ReadonlyMap<string, number>,
  ) {
    const valid = new Map<string, boolean>();
    for (const element of elements.values()) {
      const seen = new Set<string>();
      let current: CanvasElement | undefined = element;
      let depth = 0;
      let isValid = true;
      while (current?.parentId !== undefined) {
        if (isFullCanvas(current, registry) || seen.has(current.id)) {
          isValid = false;
          break;
        }
        seen.add(current.id);
        const parent = elements.get(current.parentId);
        if (
          parent === undefined ||
          parent.id === current.id ||
          parent.layerId !== current.layerId ||
          isFullCanvas(parent, registry) ||
          ++depth > MAX_DEPTH
        ) {
          isValid = false;
          break;
        }
        current = parent;
      }
      valid.set(element.id, isValid);
    }

    const roots: CanvasElement[] = [];
    for (const element of elements.values()) {
      if (!valid.get(element.id)) continue;
      if (element.parentId === undefined) roots.push(element);
      else {
        const siblings = this.children.get(element.parentId) ?? [];
        this.children.set(element.parentId, [...siblings, element]);
      }
    }
    for (const [id, children] of this.children) this.children.set(id, [...children].sort(compare));
    roots.sort((a, b) => {
      const layerA = layerOrder.get(a.layerId) ?? 0;
      const layerB = layerOrder.get(b.layerId) ?? 0;
      return layerA === layerB ? compare(a, b) : layerA - layerB;
    });
    const scene: CanvasElement[] = [];
    const add = (element: CanvasElement, ancestors: readonly string[]): void => {
      this.ranks.set(element.id, scene.length);
      this.ancestorRanks.set(
        element.id,
        ancestors.map((id) => ({ id, rank: this.descendants.get(id)?.length ?? 0 })),
      );
      scene.push(element);
      for (const ancestor of ancestors) {
        const descendants = this.descendants.get(ancestor);
        if (descendants) descendants.push(element);
      }
      this.descendants.set(element.id, []);
      const children = this.children.get(element.id) ?? [];
      for (const [rank, child] of children.entries()) {
        this.siblingRanks.set(child.id, rank);
        add(child, [...ancestors, element.id]);
      }
    };
    for (const root of roots) add(root, []);
    this.sceneElements = scene;
    this.scene = scene;
  }

  getChildren(id: string): readonly CanvasElement[] {
    return this.children.get(id) ?? [];
  }

  getDescendants(id: string): readonly CanvasElement[] {
    return this.descendants.get(id) ?? [];
  }

  rank(id: string): number | undefined {
    return this.ranks.get(id);
  }

  getEffectiveClip(id: string): Bounds | null | undefined {
    this.clips ??= this.buildClips();
    const clip = this.clips.get(id);
    return clip ? { ...clip } : clip;
  }

  private buildClips(): Map<string, Bounds | null | undefined> {
    const clips = new Map<string, Bounds | null | undefined>();
    const intersect = (a: Bounds, b: Bounds): Bounds | undefined => {
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const right = Math.min(a.x + a.w, b.x + b.w);
      const bottom = Math.min(a.y + a.h, b.y + b.h);
      return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : undefined;
    };
    const visit = (element: CanvasElement, inherited: Bounds | null | undefined): void => {
      clips.set(element.id, inherited ? { ...inherited } : inherited);
      let childClip = inherited;
      const children = this.children.get(element.id) ?? [];
      if (children.length > 0 && inherited !== undefined && element.type === 'extension') {
        const adapter = this.registry.getAdapter(element.extensionType);
        if (!adapter) childClip = undefined;
        else if (adapter.clipBounds) {
          try {
            const clip = adapter.clipBounds(element);
            if (clip !== null) {
              if (
                !Number.isFinite(clip.x) ||
                !Number.isFinite(clip.y) ||
                !Number.isFinite(clip.w) ||
                !Number.isFinite(clip.h) ||
                clip.w < 0 ||
                clip.h < 0
              ) {
                throw new Error('clipBounds must return finite, non-negative bounds');
              }
              if (clip.w === 0 || clip.h === 0) childClip = undefined;
              else {
                const next = { ...clip };
                childClip = inherited ? intersect(inherited, next) : next;
              }
            }
          } catch (error) {
            reportFailure(error, 'extension clipBounds failed');
            childClip = undefined;
          }
        }
      }
      for (const child of children) visit(child, childClip);
    };
    for (const element of this.scene) {
      if (element.parentId === undefined) visit(element, null);
    }
    return clips;
  }

  replace(previous: CanvasElement, current: CanvasElement): number | undefined {
    const rank = this.ranks.get(previous.id);
    if (rank === undefined) return undefined;
    this.sceneElements[rank] = current;
    if (previous.parentId !== undefined) {
      const siblings = this.children.get(previous.parentId);
      const siblingRank = this.siblingRanks.get(previous.id);
      if (siblings && siblingRank !== undefined) siblings[siblingRank] = current;
    }
    for (const ancestor of this.ancestorRanks.get(previous.id) ?? []) {
      const descendants = this.descendants.get(ancestor.id);
      if (descendants) descendants[ancestor.rank] = current;
    }
    if (previous.type === 'extension' && this.getChildren(previous.id).length > 0) {
      this.clips = null;
    }
    return rank;
  }
}

export function validateHierarchy(
  elements: ReadonlyMap<string, CanvasElement>,
  registry: ElementRegistry,
): void {
  const hierarchy = new ElementHierarchy(elements, registry, new Map());
  if (hierarchy.scene.length !== elements.size) {
    invalidHierarchy();
  }
}
