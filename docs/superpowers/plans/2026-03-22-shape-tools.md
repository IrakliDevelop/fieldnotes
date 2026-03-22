# Shape Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rectangle and ellipse shape tools with an extensible `ShapeElement` type, canvas rendering, arrow binding support, and click-and-drag creation with Shift-to-constrain.

**Architecture:** Single `ShapeElement` type with a `shape: ShapeKind` discriminator. One `ShapeTool` class handles all shape creation via click-and-drag. Shapes render on the canvas layer and are bindable by arrows.

**Tech Stack:** TypeScript (strict), Vitest, Canvas API

---

### Task 1: Data Model — Add ShapeElement type and factory

**Files:**
- Modify: `packages/core/src/elements/types.ts`
- Modify: `packages/core/src/elements/element-factory.ts`
- Modify: `packages/core/src/elements/element-factory.test.ts`

**Context:** Add `ShapeKind` type, `ShapeElement` interface, update `CanvasElement` union, and add `createShape()` factory function.

- [ ] **Step 1: Write tests for createShape**

Add to `packages/core/src/elements/element-factory.test.ts`:

```typescript
import { createShape } from './element-factory';

describe('createShape', () => {
  it('creates a rectangle with defaults', () => {
    const shape = createShape({ position: { x: 10, y: 20 }, size: { w: 100, h: 50 } });
    expect(shape.type).toBe('shape');
    expect(shape.shape).toBe('rectangle');
    expect(shape.position).toEqual({ x: 10, y: 20 });
    expect(shape.size).toEqual({ w: 100, h: 50 });
    expect(shape.strokeColor).toBe('#000000');
    expect(shape.strokeWidth).toBe(2);
    expect(shape.fillColor).toBe('none');
  });

  it('creates an ellipse with custom styles', () => {
    const shape = createShape({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 100 },
      shape: 'ellipse',
      strokeColor: '#ff0000',
      strokeWidth: 3,
      fillColor: '#00ff00',
    });
    expect(shape.shape).toBe('ellipse');
    expect(shape.strokeColor).toBe('#ff0000');
    expect(shape.strokeWidth).toBe(3);
    expect(shape.fillColor).toBe('#00ff00');
  });
});
```

- [ ] **Step 2: Add ShapeKind and ShapeElement to types.ts**

Add to `packages/core/src/elements/types.ts`:

```typescript
export type ShapeKind = 'rectangle' | 'ellipse';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
}
```

Update the `CanvasElement` union:

```typescript
export type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement;
```

- [ ] **Step 3: Add createShape factory function**

Add to `packages/core/src/elements/element-factory.ts`:

```typescript
import type { ShapeElement, ShapeKind } from './types';

interface ShapeInput extends BaseDefaults {
  position: Point;
  size: Size;
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}

export function createShape(input: ShapeInput): ShapeElement {
  return {
    id: createId('shape'),
    type: 'shape',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    shape: input.shape ?? 'rectangle',
    size: input.size,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 2,
    fillColor: input.fillColor ?? 'none',
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @fieldnotes/core vitest run src/elements/element-factory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/elements/types.ts packages/core/src/elements/element-factory.ts packages/core/src/elements/element-factory.test.ts
git commit -m "feat: add ShapeElement type and createShape factory"
```

---

### Task 2: Renderer — Canvas rendering for shapes

**Files:**
- Modify: `packages/core/src/elements/element-renderer.ts`

**Context:** Add a `renderShape` private method that dispatches on `shape.shape` to draw rectangles and ellipses. Wire it into the `renderCanvasElement` switch. Fill is drawn first (if not `'none'`), stroke on top.

- [ ] **Step 1: Add shape case to renderCanvasElement switch**

In `element-renderer.ts`, add the import and switch case:

```typescript
import type { CanvasElement, StrokeElement, ArrowElement, ShapeElement } from './types';

// In renderCanvasElement, add after the 'arrow' case:
case 'shape':
  this.renderShape(ctx, element);
  break;
```

- [ ] **Step 2: Add renderShape method**

Add to `ElementRenderer` class:

```typescript
private renderShape(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
  ctx.save();

  if (shape.fillColor !== 'none') {
    ctx.fillStyle = shape.fillColor;
    this.fillShapePath(ctx, shape);
  }

  if (shape.strokeWidth > 0) {
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.strokeWidth;
    this.strokeShapePath(ctx, shape);
  }

  ctx.restore();
}

private fillShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
  switch (shape.shape) {
    case 'rectangle':
      ctx.fillRect(shape.position.x, shape.position.y, shape.size.w, shape.size.h);
      break;
    case 'ellipse': {
      const cx = shape.position.x + shape.size.w / 2;
      const cy = shape.position.y + shape.size.h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, shape.size.w / 2, shape.size.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

private strokeShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
  switch (shape.shape) {
    case 'rectangle':
      ctx.strokeRect(shape.position.x, shape.position.y, shape.size.w, shape.size.h);
      break;
    case 'ellipse': {
      const cx = shape.position.x + shape.size.w / 2;
      const cy = shape.position.y + shape.size.h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, shape.size.w / 2, shape.size.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}
```

- [ ] **Step 3: Run tests and build**

Run: `pnpm --filter @fieldnotes/core test && pnpm build`
Expected: All pass, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/elements/element-renderer.ts
git commit -m "feat: canvas rendering for rectangle and ellipse shapes"
```

---

### Task 3: Arrow binding and serialization support

**Files:**
- Modify: `packages/core/src/elements/arrow-binding.ts`
- Modify: `packages/core/src/core/state-serializer.ts`

**Context:** Add `'shape'` to `BINDABLE_TYPES` so arrows can connect to shapes. Add `'shape'` to `VALID_TYPES` in the serializer and add a defensive migration clause.

- [ ] **Step 1: Add 'shape' to BINDABLE_TYPES**

In `arrow-binding.ts`, update:

```typescript
const BINDABLE_TYPES = new Set(['note', 'text', 'image', 'html', 'shape']);
```

- [ ] **Step 2: Add 'shape' to VALID_TYPES and migration**

In `state-serializer.ts`, update:

```typescript
const VALID_TYPES = new Set(['stroke', 'note', 'arrow', 'image', 'html', 'text', 'shape']);
```

Add a migration clause in `migrateElement`:

```typescript
if (obj['type'] === 'shape' && typeof obj['shape'] !== 'string') {
  obj['shape'] = 'rectangle';
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @fieldnotes/core test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/elements/arrow-binding.ts packages/core/src/core/state-serializer.ts
git commit -m "feat: arrow binding and serialization support for shapes"
```

---

### Task 4: ShapeTool — Click-and-drag shape creation

**Files:**
- Create: `packages/core/src/tools/shape-tool.ts`
- Create: `packages/core/src/tools/shape-tool.test.ts`
- Modify: `packages/core/src/tools/types.ts`

**Context:** A single `ShapeTool` class that handles click-and-drag creation for any shape kind. Tracks Shift key state for square/circle constraint via `keydown`/`keyup` listeners attached in `onActivate`. Auto-switches to select after creation. All coordinates are world space.

- [ ] **Step 1: Write tests**

Create `packages/core/src/tools/shape-tool.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ShapeTool } from './shape-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    switchTool: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('ShapeTool', () => {
  it('has name "shape"', () => {
    expect(new ShapeTool().name).toBe('shape');
  });

  it('creates a rectangle from drag', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerMove(pt(110, 120), ctx);
    tool.onPointerUp(pt(110, 120), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.shape).toBe('rectangle');
    expect(shapes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(shapes[0]?.size).toEqual({ w: 100, h: 100 });
  });

  it('creates an ellipse when shape option is set', () => {
    const tool = new ShapeTool({ shape: 'ellipse' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(200, 100), ctx);
    tool.onPointerUp(pt(200, 100), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.shape).toBe('ellipse');
  });

  it('does not create shape on zero-drag', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.store.getElementsByType('shape')).toHaveLength(0);
  });

  it('switches to select tool after creation', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    expect(ctx.switchTool).toHaveBeenCalledWith('select');
  });

  it('handles drag in any direction (normalizes negative width/height)', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    // Drag from bottom-right to top-left
    tool.onPointerDown(pt(200, 200), ctx);
    tool.onPointerMove(pt(100, 150), ctx);
    tool.onPointerUp(pt(100, 150), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.position).toEqual({ x: 100, y: 150 });
    expect(shapes[0]?.size).toEqual({ w: 100, h: 50 });
  });

  it('uses configured stroke and fill options', () => {
    const tool = new ShapeTool({
      strokeColor: '#ff0000',
      strokeWidth: 4,
      fillColor: '#0000ff',
    });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes[0]?.strokeColor).toBe('#ff0000');
    expect(shapes[0]?.strokeWidth).toBe(4);
    expect(shapes[0]?.fillColor).toBe('#0000ff');
  });

  it('updates shape kind via setOptions', () => {
    const tool = new ShapeTool();
    tool.setOptions({ shape: 'ellipse' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes[0]?.shape).toBe('ellipse');
  });
});
```

- [ ] **Step 2: Add 'shape' to ToolName**

In `packages/core/src/tools/types.ts`, update:

```typescript
export type ToolName =
  | 'hand'
  | 'select'
  | 'pencil'
  | 'eraser'
  | 'arrow'
  | 'note'
  | 'image'
  | 'text'
  | 'shape';
```

- [ ] **Step 3: Implement ShapeTool**

Create `packages/core/src/tools/shape-tool.ts`:

```typescript
import type { Point } from '../core/types';
import type { ShapeKind } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createShape } from '../elements/element-factory';

export interface ShapeToolOptions {
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}

export class ShapeTool implements Tool {
  readonly name = 'shape';
  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private end: Point = { x: 0, y: 0 };
  private shiftHeld = false;
  private shape: ShapeKind;
  private strokeColor: string;
  private strokeWidth: number;
  private fillColor: string;

  constructor(options: ShapeToolOptions = {}) {
    this.shape = options.shape ?? 'rectangle';
    this.strokeColor = options.strokeColor ?? '#000000';
    this.strokeWidth = options.strokeWidth ?? 2;
    this.fillColor = options.fillColor ?? 'none';
  }

  setOptions(options: ShapeToolOptions): void {
    if (options.shape !== undefined) this.shape = options.shape;
    if (options.strokeColor !== undefined) this.strokeColor = options.strokeColor;
    if (options.strokeWidth !== undefined) this.strokeWidth = options.strokeWidth;
    if (options.fillColor !== undefined) this.fillColor = options.fillColor;
  }

  onActivate(_ctx: ToolContext): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }
  }

  onDeactivate(_ctx: ToolContext): void {
    this.shiftHeld = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
    }
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.start = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = { ...this.start };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.end = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    const { position, size } = this.computeRect();
    if (size.w === 0 || size.h === 0) return;

    const shape = createShape({
      position,
      size,
      shape: this.shape,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fillColor: this.fillColor,
    });
    ctx.store.add(shape);
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;

    const { position, size } = this.computeRect();
    if (size.w === 0 && size.h === 0) return;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.strokeWidth;

    if (this.fillColor !== 'none') {
      ctx.fillStyle = this.fillColor;
    }

    switch (this.shape) {
      case 'rectangle':
        if (this.fillColor !== 'none') {
          ctx.fillRect(position.x, position.y, size.w, size.h);
        }
        ctx.strokeRect(position.x, position.y, size.w, size.h);
        break;
      case 'ellipse': {
        const cx = position.x + size.w / 2;
        const cy = position.y + size.h / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, size.w / 2, size.h / 2, 0, 0, Math.PI * 2);
        if (this.fillColor !== 'none') ctx.fill();
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  private computeRect(): { position: Point; size: { w: number; h: number } } {
    let x = Math.min(this.start.x, this.end.x);
    let y = Math.min(this.start.y, this.end.y);
    let w = Math.abs(this.end.x - this.start.x);
    let h = Math.abs(this.end.y - this.start.y);

    if (this.shiftHeld) {
      const side = Math.max(w, h);
      w = side;
      h = side;
      // Anchor from start point, constrain toward drag direction
      x = this.end.x >= this.start.x ? this.start.x : this.start.x - side;
      y = this.end.y >= this.start.y ? this.start.y : this.start.y - side;
    }

    return { position: { x, y }, size: { w, h } };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = false;
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @fieldnotes/core vitest run src/tools/shape-tool.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/shape-tool.ts packages/core/src/tools/shape-tool.test.ts packages/core/src/tools/types.ts
git commit -m "feat: add ShapeTool with click-and-drag creation"
```

---

### Task 5: Exports and version bump

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/package.json`

**Context:** Export the new shape types, factory, and tool from the package's public API. Bump version to 0.4.0.

- [ ] **Step 1: Add exports to index.ts**

Add `createShape` to the factory exports:

```typescript
export {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createHtmlElement,
  createText,
  createShape,
} from './elements/element-factory';
```

Add `ShapeElement` and `ShapeKind` to the type exports:

```typescript
export type {
  Binding,
  CanvasElement,
  ElementType,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
} from './elements/types';
```

Add `ShapeTool` export after the other tool exports:

```typescript
export { ShapeTool } from './tools/shape-tool';
export type { ShapeToolOptions } from './tools/shape-tool';
```

Update VERSION:

```typescript
export const VERSION = '0.4.0';
```

- [ ] **Step 2: Update version test**

In `packages/core/src/index.test.ts`:

```typescript
expect(VERSION).toBe('0.4.0');
```

- [ ] **Step 3: Update package.json version**

In `packages/core/package.json`:

```json
"version": "0.4.0",
```

- [ ] **Step 4: Run full test suite, build, and lint**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts packages/core/package.json
git commit -m "feat: export shape API, bump core to v0.4.0"
```
