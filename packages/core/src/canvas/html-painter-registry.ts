import type { HtmlElement } from '../elements/types';
import type { Size } from '../core/types';

export interface HtmlPaintContext {
  /** Translated to the element origin, rotated about its centre, clipped, save()d.
   *  Layer opacity is NOT applied here — each surface owns that boundary. */
  ctx: CanvasRenderingContext2D;
  element: Readonly<HtmlElement>;
  size: Readonly<Size>;
  /** CSS pixels per world unit for THIS surface (screen | minimap | export). */
  zoom: number;
}

export type HtmlPainter = (paint: HtmlPaintContext) => void;
export type HtmlRouting = 'dom' | 'canvas' | 'missing';

export class HtmlPainterMissingError extends Error {
  readonly elementId: string;
  readonly htmlType: string | undefined;
  constructor(elementId: string, htmlType: string | undefined) {
    super(`[fieldnotes] no painter registered for canvas-backed htmlType "${htmlType ?? ''}"`);
    this.name = 'HtmlPainterMissingError';
    this.elementId = elementId;
    this.htmlType = htmlType;
  }
}

interface PainterEntry {
  token: symbol;
  painter: HtmlPainter;
}

export class HtmlPainterRegistry {
  private readonly painters = new Map<string, PainterEntry[]>();
  private readonly declared = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private _version = 0;

  get version(): number {
    return this._version;
  }

  get canvasTypes(): ReadonlySet<string> {
    const types = new Set<string>(this.declared.keys());
    for (const [type, stack] of this.painters) {
      if (stack.length > 0) types.add(type);
    }
    return types;
  }

  expect(htmlTypes: Iterable<string>): () => void {
    const claimed = [...htmlTypes];
    let changed = false;
    for (const type of claimed) {
      const count = this.declared.get(type) ?? 0;
      if (count === 0) changed = true;
      this.declared.set(type, count + 1);
    }
    if (changed) this.bump();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      let releaseChanged = false;
      for (const type of claimed) {
        const count = this.declared.get(type) ?? 0;
        if (count <= 1) {
          this.declared.delete(type);
          releaseChanged = true;
        } else {
          this.declared.set(type, count - 1);
        }
      }
      if (releaseChanged) this.bump();
    };
  }

  register(htmlType: string, painter: HtmlPainter): () => void {
    const entry: PainterEntry = { token: Symbol('html-painter'), painter };
    const stack = this.painters.get(htmlType) ?? [];
    stack.push(entry);
    this.painters.set(htmlType, stack);
    this.bump(); // pushing always changes the active entry

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.painters.get(htmlType);
      if (!current) return;
      const index = current.findIndex((candidate) => candidate.token === entry.token);
      if (index === -1) return;
      const wasActive = index === current.length - 1;
      current.splice(index, 1);
      if (current.length === 0) this.painters.delete(htmlType);
      if (wasActive) this.bump();
    };
  }

  getActivePainter(htmlType: string): HtmlPainter | undefined {
    const stack = this.painters.get(htmlType);
    return stack && stack.length > 0 ? stack[stack.length - 1]?.painter : undefined;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this._version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Listener faults must not break registration for siblings.
      }
    }
  }
}

export function resolveHtmlRouting(
  el: Readonly<HtmlElement>,
  registry: HtmlPainterRegistry | null,
  expectedCanvasTypes?: ReadonlySet<string>,
): HtmlRouting {
  const htmlType = el.htmlType;
  if (htmlType === undefined) return 'dom';
  const expected =
    (registry?.canvasTypes.has(htmlType) ?? false) || (expectedCanvasTypes?.has(htmlType) ?? false);
  if (!expected) return 'dom';
  return registry?.getActivePainter(htmlType) ? 'canvas' : 'missing';
}
