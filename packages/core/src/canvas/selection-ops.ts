import type { ElementStore } from '../elements/element-store';
import type { HistoryRecorder } from '../history/history-recorder';
import { updateArrowsBoundToElements } from '../elements/arrow-binding';
import { translateElementPatch } from '../elements/translate';
import { getElementBounds } from '../elements/element-bounds';
import { createId } from '../elements/create-id';
import { styleToPatch, getElementStyle } from '../elements/element-style';
import type { ElementStyle } from '../elements/element-style';
import type { CanvasElement } from '../elements/types';
import type { Bounds } from '../core/types';

export type AlignEdge = 'left' | 'center-x' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

function unionBounds(list: Bounds[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function sharedValue<T>(values: (T | undefined)[]): T | undefined {
  const present = values.filter((v): v is T => v !== undefined);
  if (present.length === 0) return undefined;
  const first = present[0];
  return present.every((v) => v === first) ? first : undefined;
}

export interface SelectionOpsDeps {
  store: ElementStore;
  recorder: HistoryRecorder;
  getSelectedIds: () => string[];
  requestRender: () => void;
}

export class SelectionOps {
  constructor(private readonly deps: SelectionOpsDeps) {}

  getStyle(): ElementStyle | null {
    const ids = this.deps.getSelectedIds();
    if (ids.length === 0) return null;
    const styles: ElementStyle[] = [];
    for (const id of ids) {
      const el = this.deps.store.getById(id);
      if (el) styles.push(getElementStyle(el));
    }
    if (styles.length === 0) return null;
    const result: ElementStyle = {};
    const color = sharedValue(styles.map((s) => s.color));
    if (color !== undefined) result.color = color;
    const fillColor = sharedValue(styles.map((s) => s.fillColor));
    if (fillColor !== undefined) result.fillColor = fillColor;
    const strokeWidth = sharedValue(styles.map((s) => s.strokeWidth));
    if (strokeWidth !== undefined) result.strokeWidth = strokeWidth;
    const opacity = sharedValue(styles.map((s) => s.opacity));
    if (opacity !== undefined) result.opacity = opacity;
    const fontSize = sharedValue(styles.map((s) => s.fontSize));
    if (fontSize !== undefined) result.fontSize = fontSize;
    const strokeStyle = sharedValue(styles.map((s) => s.strokeStyle));
    if (strokeStyle !== undefined) result.strokeStyle = strokeStyle;
    return result;
  }

  applyStyle(style: ElementStyle): void {
    const ids = this.deps.getSelectedIds();
    if (ids.length === 0) return;
    this.deps.recorder.begin();
    for (const id of ids) {
      const el = this.deps.store.getById(id);
      if (!el) continue;
      const patch = styleToPatch(el, style);
      if (Object.keys(patch).length > 0) {
        this.deps.store.update(id, patch);
      }
    }
    this.deps.recorder.commit();
  }

  group(): void {
    const ids = this.deps.getSelectedIds();
    if (ids.length < 2) return;
    const groupId = createId('group');
    this.deps.recorder.begin();
    for (const id of ids) {
      if (this.deps.store.getById(id)) this.deps.store.update(id, { groupId });
    }
    this.deps.recorder.commit();
  }

  ungroup(): void {
    const ids = this.deps.getSelectedIds();
    if (ids.length === 0) return;
    this.deps.recorder.begin();
    for (const id of ids) {
      const el = this.deps.store.getById(id);
      if (el && el.groupId !== undefined) this.deps.store.update(id, { groupId: undefined });
    }
    this.deps.recorder.commit();
  }

  toggleLock(): void {
    const ids = this.deps.getSelectedIds();
    if (ids.length === 0) return;
    const anyUnlocked = ids.some((id) => {
      const el = this.deps.store.getById(id);
      return el ? !el.locked : false;
    });
    this.deps.recorder.begin();
    for (const id of ids) {
      const el = this.deps.store.getById(id);
      if (el && el.locked !== anyUnlocked) this.deps.store.update(id, { locked: anyUnlocked });
    }
    this.deps.recorder.commit();
  }

  align(edge: AlignEdge): void {
    const bounded = this.boundedSelection();
    if (bounded.length < 2) return;
    const B = unionBounds(bounded.map((e) => e.bounds));
    this.deps.recorder.begin();
    const moved: string[] = [];
    for (const { id, el, bounds: b } of bounded) {
      if (!this.isMovable(el)) continue;
      let dx = 0;
      let dy = 0;
      switch (edge) {
        case 'left':
          dx = B.x - b.x;
          break;
        case 'right':
          dx = B.x + B.w - (b.x + b.w);
          break;
        case 'center-x':
          dx = B.x + B.w / 2 - (b.x + b.w / 2);
          break;
        case 'top':
          dy = B.y - b.y;
          break;
        case 'bottom':
          dy = B.y + B.h - (b.y + b.h);
          break;
        case 'middle':
          dy = B.y + B.h / 2 - (b.y + b.h / 2);
          break;
      }
      if (dx === 0 && dy === 0) continue;
      this.deps.store.update(id, translateElementPatch(el, dx, dy));
      moved.push(id);
    }
    updateArrowsBoundToElements(moved, this.deps.store);
    this.deps.recorder.commit();
    this.deps.requestRender();
  }

  distribute(axis: DistributeAxis): void {
    const bounded = this.boundedSelection();
    if (bounded.length < 3) return;
    const center = (b: Bounds) => (axis === 'horizontal' ? b.x + b.w / 2 : b.y + b.h / 2);
    const sorted = [...bounded].sort((p, q) => center(p.bounds) - center(q.bounds));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) return;
    const c0 = center(first.bounds);
    const cN = center(last.bounds);
    const n = sorted.length;
    this.deps.recorder.begin();
    const moved: string[] = [];
    for (let i = 1; i < n - 1; i++) {
      const item = sorted[i];
      if (!item || !this.isMovable(item.el)) continue;
      const target = c0 + (i * (cN - c0)) / (n - 1);
      const delta = target - center(item.bounds);
      if (delta === 0) continue;
      const [dx, dy] = axis === 'horizontal' ? [delta, 0] : [0, delta];
      this.deps.store.update(item.id, translateElementPatch(item.el, dx, dy));
      moved.push(item.id);
    }
    updateArrowsBoundToElements(moved, this.deps.store);
    this.deps.recorder.commit();
    this.deps.requestRender();
  }

  private boundedSelection(): { id: string; el: CanvasElement; bounds: Bounds }[] {
    const out: { id: string; el: CanvasElement; bounds: Bounds }[] = [];
    for (const id of this.deps.getSelectedIds()) {
      const el = this.deps.store.getById(id);
      if (!el) continue;
      const bounds = getElementBounds(el);
      if (bounds) out.push({ id, el, bounds });
    }
    return out;
  }

  private isMovable(el: CanvasElement): boolean {
    if (el.locked) return false;
    if (el.type === 'arrow' && (el.fromBinding ?? el.toBinding)) return false;
    return true;
  }
}
