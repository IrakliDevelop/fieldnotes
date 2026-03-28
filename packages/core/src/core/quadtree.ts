import type { Bounds, Point } from './types';

interface Entry {
  id: string;
  bounds: Bounds;
}

const MAX_ITEMS = 8;
const MAX_DEPTH = 8;

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

class QuadNode {
  items: Entry[] = [];
  children: QuadNode[] | null = null;

  constructor(
    readonly bounds: Bounds,
    readonly depth: number,
  ) {}

  insert(entry: Entry): void {
    if (this.children) {
      const idx = this.getChildIndex(entry.bounds);
      if (idx !== -1) {
        const child = this.children[idx];
        if (child) child.insert(entry);
        return;
      }
      this.items.push(entry);
      return;
    }

    this.items.push(entry);

    if (this.items.length > MAX_ITEMS && this.depth < MAX_DEPTH) {
      this.split();
    }
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      return true;
    }

    if (this.children) {
      for (const child of this.children) {
        if (child.remove(id)) {
          this.collapseIfEmpty();
          return true;
        }
      }
    }

    return false;
  }

  query(rect: Bounds, result: string[]): void {
    if (!intersects(this.bounds, rect)) return;

    for (const item of this.items) {
      if (intersects(item.bounds, rect)) {
        result.push(item.id);
      }
    }

    if (this.children) {
      for (const child of this.children) {
        child.query(rect, result);
      }
    }
  }

  private getChildIndex(itemBounds: Bounds): number {
    const midX = this.bounds.x + this.bounds.w / 2;
    const midY = this.bounds.y + this.bounds.h / 2;

    const left = itemBounds.x >= this.bounds.x && itemBounds.x + itemBounds.w <= midX;
    const right =
      itemBounds.x >= midX && itemBounds.x + itemBounds.w <= this.bounds.x + this.bounds.w;
    const top = itemBounds.y >= this.bounds.y && itemBounds.y + itemBounds.h <= midY;
    const bottom =
      itemBounds.y >= midY && itemBounds.y + itemBounds.h <= this.bounds.y + this.bounds.h;

    if (left && top) return 0;
    if (right && top) return 1;
    if (left && bottom) return 2;
    if (right && bottom) return 3;

    return -1;
  }

  private split(): void {
    const { x, y, w, h } = this.bounds;
    const halfW = w / 2;
    const halfH = h / 2;
    const d = this.depth + 1;

    this.children = [
      new QuadNode({ x, y, w: halfW, h: halfH }, d),
      new QuadNode({ x: x + halfW, y, w: halfW, h: halfH }, d),
      new QuadNode({ x, y: y + halfH, w: halfW, h: halfH }, d),
      new QuadNode({ x: x + halfW, y: y + halfH, w: halfW, h: halfH }, d),
    ];

    const remaining: Entry[] = [];
    for (const item of this.items) {
      const idx = this.getChildIndex(item.bounds);
      if (idx !== -1) {
        const target = this.children[idx];
        if (target) target.insert(item);
      } else {
        remaining.push(item);
      }
    }
    this.items = remaining;
  }

  private collapseIfEmpty(): void {
    if (!this.children) return;
    let totalItems = this.items.length;
    for (const child of this.children) {
      if (child.children) return;
      totalItems += child.items.length;
    }
    if (totalItems <= MAX_ITEMS) {
      for (const child of this.children) {
        this.items.push(...child.items);
      }
      this.children = null;
    }
  }
}

export class Quadtree {
  private root: QuadNode;
  private _size = 0;
  private readonly worldBounds: Bounds;

  constructor(worldBounds: Bounds) {
    this.worldBounds = worldBounds;
    this.root = new QuadNode(worldBounds, 0);
  }

  get size(): number {
    return this._size;
  }

  insert(id: string, bounds: Bounds): void {
    this.root.insert({ id, bounds });
    this._size++;
  }

  remove(id: string): void {
    if (this.root.remove(id)) {
      this._size--;
    }
  }

  update(id: string, newBounds: Bounds): void {
    this.remove(id);
    this.insert(id, newBounds);
  }

  query(rect: Bounds): string[] {
    const result: string[] = [];
    this.root.query(rect, result);
    return result;
  }

  queryPoint(point: Point): string[] {
    return this.query({ x: point.x, y: point.y, w: 0, h: 0 });
  }

  clear(): void {
    this.root = new QuadNode(this.worldBounds, 0);
    this._size = 0;
  }
}
