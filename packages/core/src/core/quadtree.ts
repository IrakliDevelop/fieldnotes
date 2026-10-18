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

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y >= outer.y &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

class QuadNode {
  items: Entry[] = [];
  children: QuadNode[] | null = null;

  constructor(
    readonly bounds: Bounds,
    readonly depth: number,
    readonly parent: QuadNode | null,
    private readonly owners: Map<string, QuadNode>,
  ) {}

  insert(entry: Entry): void {
    if (this.children) {
      const idx = this.getChildIndex(entry.bounds);
      if (idx !== -1) {
        const child = this.children[idx];
        if (child) child.insert(entry);
        return;
      }
      this.push(entry);
      return;
    }

    this.push(entry);

    if (this.items.length > MAX_ITEMS && this.depth < MAX_DEPTH) {
      this.split();
    }
  }

  private push(entry: Entry): void {
    this.items.push(entry);
    this.owners.set(entry.id, this);
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

  collect(result: Entry[]): void {
    result.push(...this.items);
    if (this.children) {
      for (const child of this.children) {
        child.collect(result);
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
      new QuadNode({ x, y, w: halfW, h: halfH }, d, this, this.owners),
      new QuadNode({ x: x + halfW, y, w: halfW, h: halfH }, d, this, this.owners),
      new QuadNode({ x, y: y + halfH, w: halfW, h: halfH }, d, this, this.owners),
      new QuadNode({ x: x + halfW, y: y + halfH, w: halfW, h: halfH }, d, this, this.owners),
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

  collapseIfEmpty(): void {
    if (!this.children) return;
    let totalItems = this.items.length;
    for (const child of this.children) {
      if (child.children) return;
      totalItems += child.items.length;
    }
    if (totalItems <= MAX_ITEMS) {
      for (const child of this.children) {
        for (const item of child.items) this.push(item);
      }
      this.children = null;
    }
  }
}

export class Quadtree {
  private root: QuadNode;
  private _size = 0;
  private readonly worldBounds: Bounds;
  private readonly owners = new Map<string, QuadNode>();

  constructor(worldBounds: Bounds) {
    this.worldBounds = worldBounds;
    this.root = new QuadNode(worldBounds, 0, null, this.owners);
  }

  get size(): number {
    return this._size;
  }

  insert(id: string, bounds: Bounds): void {
    this.remove(id);
    this.expandToFit(bounds);
    this.root.insert({ id, bounds });
    this._size++;
  }

  remove(id: string): void {
    const node = this.owners.get(id);
    if (!node) return;
    const index = node.items.findIndex((e) => e.id === id);
    if (index === -1) return;
    this.owners.delete(id);
    node.items.splice(index, 1);
    this._size--;
    for (let n = node.parent; n; n = n.parent) n.collapseIfEmpty();
  }

  update(id: string, newBounds: Bounds): void {
    const current = this.owners.get(id)?.items.find((e) => e.id === id)?.bounds;
    if (
      current &&
      current.x === newBounds.x &&
      current.y === newBounds.y &&
      current.w === newBounds.w &&
      current.h === newBounds.h
    ) {
      return;
    }
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
    this.owners.clear();
    this.root = new QuadNode(this.worldBounds, 0, null, this.owners);
    this._size = 0;
  }

  private expandToFit(bounds: Bounds): void {
    const current = this.root.bounds;
    if (contains(current, bounds)) return;

    const currentRight = current.x + current.w;
    const currentBottom = current.y + current.h;
    const requiredWidth =
      Math.max(currentRight, bounds.x + bounds.w) - Math.min(current.x, bounds.x);
    const requiredHeight =
      Math.max(currentBottom, bounds.y + bounds.h) - Math.min(current.y, bounds.y);
    const width = Math.max(current.w * 2, requiredWidth);
    const height = Math.max(current.h * 2, requiredHeight);
    const x = bounds.x < current.x ? currentRight - width : current.x;
    const y = bounds.y < current.y ? currentBottom - height : current.y;

    const entries: Entry[] = [];
    this.root.collect(entries);
    this.root = new QuadNode({ x, y, w: width, h: height }, 0, null, this.owners);
    for (const entry of entries) {
      this.root.insert(entry);
    }
  }
}
