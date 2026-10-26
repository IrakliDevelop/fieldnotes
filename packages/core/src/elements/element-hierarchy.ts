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

export class ElementHierarchy {
  readonly scene: readonly CanvasElement[];
  private readonly children = new Map<string, readonly CanvasElement[]>();
  private readonly descendants = new Map<string, readonly CanvasElement[]>();
  private readonly ranks = new Map<string, number>();
  private clips: Map<string, Bounds | null | undefined> | null = null;

  constructor(
    private readonly elements: ReadonlyMap<string, CanvasElement>,
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
    for (const [id, children] of this.children) this.children.set(id, children.toSorted(compare));
    roots.sort((a, b) => {
      const layerA = layerOrder.get(a.layerId) ?? 0;
      const layerB = layerOrder.get(b.layerId) ?? 0;
      return layerA === layerB ? compare(a, b) : layerA - layerB;
    });
    const scene: CanvasElement[] = [];
    const add = (element: CanvasElement): CanvasElement[] => {
      const all: CanvasElement[] = [];
      scene.push(element);
      all.push(element);
      for (const child of this.children.get(element.id) ?? []) all.push(...add(child));
      this.descendants.set(element.id, all.slice(1));
      return all;
    };
    for (const root of roots) add(root);
    scene.forEach((element, rank) => this.ranks.set(element.id, rank));
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

  replace(previous: CanvasElement, current: CanvasElement): void {
    const rank = this.ranks.get(previous.id);
    if (rank === undefined) return;
    (this.scene as CanvasElement[])[rank] = current;
    const replace = (elements: readonly CanvasElement[]): readonly CanvasElement[] =>
      elements.map((element) => (element === previous ? current : element));
    const children = this.children.get(previous.id);
    if (children) this.children.set(previous.id, replace(children));
    const descendants = this.descendants.get(previous.id);
    if (descendants) this.descendants.set(previous.id, replace(descendants));
    if (previous.parentId !== undefined) {
      const siblings = this.children.get(previous.parentId);
      if (siblings) this.children.set(previous.parentId, replace(siblings));
    }
    for (const [id, all] of this.descendants) this.descendants.set(id, replace(all));
    if (previous.type === 'extension' && this.getChildren(previous.id).length > 0) {
      this.clips = null;
    }
  }
}

export function validateHierarchy(
  elements: ReadonlyMap<string, CanvasElement>,
  registry: ElementRegistry,
): void {
  const hierarchy = new ElementHierarchy(elements, registry, new Map());
  if (hierarchy.scene.length !== elements.size) {
    throw new Error(
      'Invalid hierarchy: missing, cyclic, cross-layer, full-canvas, or over-depth parent relationship',
    );
  }
}
