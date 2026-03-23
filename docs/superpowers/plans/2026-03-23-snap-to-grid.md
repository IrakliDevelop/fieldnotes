# Snap-to-Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add toggle-able snap-to-grid that aligns element positions to the background grid during creation and dragging.

**Architecture:** A pure `snapPoint()` utility snaps coordinates to grid intersections. `ToolContext` gains `snapToGrid` and `gridSize` fields. Each tool applies snap conditionally. Viewport manages snap state and exposes a toggle API.

**Tech Stack:** TypeScript (strict), Vitest, Canvas API

---

### Task 1: Core snap utility

**Files:**
- Create: `packages/core/src/core/snap.ts`
- Create: `packages/core/src/core/snap.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/core/snap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { snapPoint } from './snap';

describe('snapPoint', () => {
  it('snaps to nearest grid intersection', () => {
    expect(snapPoint({ x: 37, y: 55 }, 24)).toEqual({ x: 36, y: 48 });
  });

  it('snaps exactly on grid points', () => {
    expect(snapPoint({ x: 48, y: 72 }, 24)).toEqual({ x: 48, y: 72 });
  });

  it('snaps negative coordinates', () => {
    expect(snapPoint({ x: -10, y: -37 }, 24)).toEqual({ x: -12, y: -36 });
  });

  it('rounds to nearest (not floor)', () => {
    expect(snapPoint({ x: 13, y: 11 }, 24)).toEqual({ x: 12, y: 12 });
  });

  it('works with different grid sizes', () => {
    expect(snapPoint({ x: 17, y: 33 }, 10)).toEqual({ x: 20, y: 30 });
  });
});
```

- [ ] **Step 2: Implement snapPoint**

Create `packages/core/src/core/snap.ts`:

```typescript
import type { Point } from './types';

export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @fieldnotes/core test -- src/core/snap.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/core/snap.ts packages/core/src/core/snap.test.ts
git commit -m "feat: add snapPoint grid utility"
```

---

### Task 2: ToolContext and Viewport snap integration

**Files:**
- Modify: `packages/core/src/tools/types.ts`
- Modify: `packages/core/src/canvas/viewport.ts`

**Context:** Add `snapToGrid` and `gridSize` to `ToolContext`. Wire them into Viewport with a `setSnapToGrid()` method. The `toolContext` object is created once in the constructor (line 71 of viewport.ts). Since it's a plain object, we mutate its fields in `setSnapToGrid()` — this is the simplest approach and consistent with how `toolContext` is used (always the same reference passed to tools).

- [ ] **Step 1: Add snap fields to ToolContext**

In `packages/core/src/tools/types.ts`, add to the `ToolContext` interface:

```typescript
export interface ToolContext {
  camera: Camera;
  store: ElementStore;
  requestRender: () => void;
  switchTool?: (name: string) => void;
  editElement?: (id: string) => void;
  setCursor?: (cursor: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
}
```

- [ ] **Step 2: Add snap state to Viewport**

In `packages/core/src/canvas/viewport.ts`:

Add a private field after the existing private fields:

```typescript
private _snapToGrid = false;
private readonly _gridSize: number;
```

In the constructor, after `this.background = new Background(options.background);` (line 53), store the grid size:

```typescript
this._gridSize = options.background?.spacing ?? 24;
```

In the `toolContext` object literal (line 71), add the snap fields:

```typescript
this.toolContext = {
  camera: this.camera,
  store: this.store,
  requestRender: () => this.requestRender(),
  switchTool: (name: string) => this.toolManager.setTool(name, this.toolContext),
  editElement: (id: string) => this.startEditingElement(id),
  setCursor: (cursor: string) => {
    this.wrapper.style.cursor = cursor;
  },
  snapToGrid: false,
  gridSize: this._gridSize,
};
```

Add public methods after the existing public methods:

```typescript
get snapToGrid(): boolean {
  return this._snapToGrid;
}

setSnapToGrid(enabled: boolean): void {
  this._snapToGrid = enabled;
  this.toolContext.snapToGrid = enabled;
}
```

- [ ] **Step 3: Run tests and build**

Run: `pnpm --filter @fieldnotes/core test && pnpm build`
Expected: All pass, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/types.ts packages/core/src/canvas/viewport.ts
git commit -m "feat: add snap-to-grid state to ToolContext and Viewport"
```

---

### Task 3: Snap in select tool (drag)

**Files:**
- Modify: `packages/core/src/tools/select-tool.ts`
- Modify: `packages/core/src/tools/select-tool.test.ts`

**Context:** The select tool calculates drag deltas in `onPointerMove` (lines 125-152). Both `lastWorld` (set in `onPointerDown`) and `world` (in `onPointerMove`) must be snapped so deltas are always between snapped positions.

- [ ] **Step 1: Write tests**

Add to `packages/core/src/tools/select-tool.test.ts`:

```typescript
describe('snap-to-grid dragging', () => {
  it('snaps element position when dragging with snap enabled', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    ctx.snapToGrid = true;
    ctx.gridSize = 24;

    // Place a note at (10, 10) — not on grid
    const note = createNote({ position: { x: 10, y: 10 }, size: { w: 200, h: 100 } });
    ctx.store.add(note);

    // Select and drag
    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(60, 60), ctx);
    tool.onPointerUp(pt(60, 60), ctx);

    const moved = ctx.store.getById(note.id);
    // lastWorld snaps (10,10) → (12,12), world snaps (60,60) → (60,60)
    // delta = (48, 48), new position = (10+48, 10+48) = (58, 58)
    expect(moved?.position).toEqual({ x: 58, y: 58 });
  });

  it('does not snap when snap is disabled', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    ctx.snapToGrid = false;

    const note = createNote({ position: { x: 10, y: 10 }, size: { w: 200, h: 100 } });
    ctx.store.add(note);

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(55, 55), ctx);
    tool.onPointerUp(pt(55, 55), ctx);

    const moved = ctx.store.getById(note.id);
    expect(moved?.position).toEqual({ x: 55, y: 55 });
  });
});
```

Note: `makeCtx` and `pt` helpers already exist in this test file. `createNote` needs to be imported from `../elements/element-factory`.

- [ ] **Step 2: Add snap to select tool**

In `packages/core/src/tools/select-tool.ts`, add the import at the top:

```typescript
import { snapPoint } from '../core/snap';
```

Add a helper method to the `SelectTool` class:

```typescript
private snap(point: Point, ctx: ToolContext): Point {
  return ctx.snapToGrid && ctx.gridSize ? snapPoint(point, ctx.gridSize) : point;
}
```

In `onPointerDown`, after `const world = ctx.camera.screenToWorld(...)` (line 65), snap `lastWorld`:

```typescript
const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
this.lastWorld = this.snap(world, ctx);
this.currentWorld = world;
```

In `onPointerMove`, in the dragging block (line 125-129), snap `world` before computing deltas:

```typescript
if (this.mode.type === 'dragging' && this._selectedIds.length > 0) {
  ctx.setCursor?.('move');
  const snapped = this.snap(world, ctx);
  const dx = snapped.x - this.lastWorld.x;
  const dy = snapped.y - this.lastWorld.y;
  this.lastWorld = snapped;
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @fieldnotes/core test -- src/tools/select-tool.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/select-tool.ts packages/core/src/tools/select-tool.test.ts
git commit -m "feat: snap-to-grid in select tool drag"
```

---

### Task 4: Snap in creation tools (shape, note, text, arrow)

**Files:**
- Modify: `packages/core/src/tools/shape-tool.ts`
- Modify: `packages/core/src/tools/shape-tool.test.ts`
- Modify: `packages/core/src/tools/note-tool.ts`
- Modify: `packages/core/src/tools/note-tool.test.ts`
- Modify: `packages/core/src/tools/text-tool.ts`
- Modify: `packages/core/src/tools/text-tool.test.ts`
- Modify: `packages/core/src/tools/arrow-tool.ts`
- Modify: `packages/core/src/tools/arrow-tool.test.ts`

**Context:** Each creation tool applies snap to the world coordinates it uses for element placement. Arrow tool only snaps when NOT binding to an element (binding already snaps to element centers).

- [ ] **Step 1: Write shape tool snap test**

Add to `packages/core/src/tools/shape-tool.test.ts`:

```typescript
it('snaps start and end points to grid', () => {
  const tool = new ShapeTool();
  const ctx = makeCtx();
  ctx.snapToGrid = true;
  ctx.gridSize = 24;

  tool.onPointerDown(pt(10, 10), ctx);
  tool.onPointerMove(pt(110, 85), ctx);
  tool.onPointerUp(pt(110, 85), ctx);

  const shapes = ctx.store.getElementsByType('shape');
  expect(shapes).toHaveLength(1);
  // (10,10) snaps to (12,12), (110,85) snaps to (108,84)
  expect(shapes[0]?.position).toEqual({ x: 12, y: 12 });
  expect(shapes[0]?.size).toEqual({ w: 96, h: 72 });
});
```

- [ ] **Step 2: Add snap to shape tool**

In `packages/core/src/tools/shape-tool.ts`, add import:

```typescript
import { snapPoint } from '../core/snap';
```

Add helper:

```typescript
private snap(point: Point, ctx: ToolContext): Point {
  return ctx.snapToGrid && ctx.gridSize ? snapPoint(point, ctx.gridSize) : point;
}
```

Snap points directly in `onPointerDown` and `onPointerMove` — both receive `ctx` as a parameter, so no stored field is needed:

In `onPointerDown`:

```typescript
onPointerDown(state: PointerState, ctx: ToolContext): void {
  this.drawing = true;
  const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
  this.start = this.snap(world, ctx);
  this.end = { ...this.start };
}
```

In `onPointerMove`:

```typescript
onPointerMove(state: PointerState, ctx: ToolContext): void {
  if (!this.drawing) return;
  const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
  this.end = this.snap(world, ctx);
  ctx.requestRender();
}
```

- [ ] **Step 3: Write note tool snap test**

Add to `packages/core/src/tools/note-tool.test.ts`:

```typescript
it('snaps placement position to grid', () => {
  const tool = new NoteTool();
  const ctx = makeCtx();
  ctx.snapToGrid = true;
  ctx.gridSize = 24;

  tool.onPointerDown(pt(37, 55), ctx);
  tool.onPointerUp(pt(37, 55), ctx);

  const note = ctx.store.getAll()[0] as NoteElement;
  expect(note.position).toEqual({ x: 36, y: 48 });
});
```

- [ ] **Step 4: Add snap to note tool**

In `packages/core/src/tools/note-tool.ts`, add import and snap the position in `onPointerUp`:

```typescript
import { snapPoint } from '../core/snap';

// In onPointerUp:
onPointerUp(state: PointerState, ctx: ToolContext): void {
  let world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
  if (ctx.snapToGrid && ctx.gridSize) {
    world = snapPoint(world, ctx.gridSize);
  }
  const note = createNote({
    position: world,
    // ... rest unchanged
```

- [ ] **Step 5: Write text tool snap test**

Add to `packages/core/src/tools/text-tool.test.ts`:

```typescript
it('snaps placement position to grid', () => {
  const tool = new TextTool();
  const ctx = makeCtx();
  ctx.snapToGrid = true;
  ctx.gridSize = 24;

  tool.onPointerDown(pt(37, 55), ctx);
  tool.onPointerUp(pt(37, 55), ctx);

  const text = ctx.store.getAll()[0];
  expect(text?.position).toEqual({ x: 36, y: 48 });
});
```

- [ ] **Step 6: Add snap to text tool**

Same pattern as note tool — import `snapPoint`, snap `world` in `onPointerUp` when `ctx.snapToGrid && ctx.gridSize`.

- [ ] **Step 7: Write arrow tool snap test**

Add to `packages/core/src/tools/arrow-tool.test.ts`:

```typescript
it('snaps start and end to grid when not binding', () => {
  const tool = new ArrowTool();
  const ctx = makeCtx();
  ctx.snapToGrid = true;
  ctx.gridSize = 24;

  tool.onPointerDown(pt(10, 10), ctx);
  tool.onPointerMove(pt(110, 85), ctx);
  tool.onPointerUp(pt(110, 85), ctx);

  const arrows = ctx.store.getElementsByType('arrow');
  expect(arrows).toHaveLength(1);
  // (10,10) → (12,12), (110,85) → (108,84)
  expect(arrows[0]?.from).toEqual({ x: 12, y: 12 });
  expect(arrows[0]?.to).toEqual({ x: 108, y: 84 });
});
```

- [ ] **Step 8: Add snap to arrow tool**

In `packages/core/src/tools/arrow-tool.ts`, add import:

```typescript
import { snapPoint } from '../core/snap';
```

In `onPointerDown`, snap the start when not binding:

```typescript
} else {
  this.start = ctx.snapToGrid && ctx.gridSize ? snapPoint(world, ctx.gridSize) : world;
  this.fromBinding = undefined;
  this.fromTarget = null;
}
```

In `onPointerMove`, snap the end when not binding:

```typescript
} else {
  this.end = ctx.snapToGrid && ctx.gridSize ? snapPoint(world, ctx.gridSize) : world;
  this.toTarget = null;
}
```

- [ ] **Step 9: Run all tests**

Run: `pnpm --filter @fieldnotes/core test`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/tools/shape-tool.ts packages/core/src/tools/shape-tool.test.ts packages/core/src/tools/note-tool.ts packages/core/src/tools/note-tool.test.ts packages/core/src/tools/text-tool.ts packages/core/src/tools/text-tool.test.ts packages/core/src/tools/arrow-tool.ts packages/core/src/tools/arrow-tool.test.ts
git commit -m "feat: snap-to-grid in shape, note, text, and arrow tools"
```

---

### Task 5: Exports, demo, and version bump

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/package.json`
- Modify: `demo/index.html`
- Modify: `demo/main.ts`

- [ ] **Step 1: Add exports**

In `packages/core/src/index.ts`, add:

```typescript
export { snapPoint } from './core/snap';
```

Update VERSION:

```typescript
export const VERSION = '0.5.0';
```

- [ ] **Step 2: Update version test**

In `packages/core/src/index.test.ts`:

```typescript
expect(VERSION).toBe('0.5.0');
```

- [ ] **Step 3: Update package.json**

In `packages/core/package.json`:

```json
"version": "0.5.0",
```

- [ ] **Step 4: Add snap toggle to demo HTML**

In `demo/index.html`, add a button in the toolbar after the redo button and its separator:

```html
<button id="snap-toggle">Snap: Off<span class="shortcut">G</span></button>
```

- [ ] **Step 5: Wire up snap toggle in demo**

In `demo/main.ts`, add after the redo button event listener:

```typescript
const snapBtn = document.getElementById('snap-toggle') as HTMLButtonElement | null;

snapBtn?.addEventListener('click', () => {
  viewport.setSnapToGrid(!viewport.snapToGrid);
  if (snapBtn) snapBtn.textContent = viewport.snapToGrid ? 'Snap: On' : 'Snap: Off';
});
```

Add `g` to the keyboard shortcut map to toggle snap:

In the `document.addEventListener('keydown', ...)` handler, add after the tool map check:

```typescript
if (e.key === 'g') {
  viewport.setSnapToGrid(!viewport.snapToGrid);
  if (snapBtn) snapBtn.textContent = viewport.snapToGrid ? 'Snap: On' : 'Snap: Off';
}
```

- [ ] **Step 6: Run full test suite, build, and lint**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts packages/core/package.json demo/index.html demo/main.ts
git commit -m "feat: export snapPoint, add demo toggle, bump to v0.5.0"
```
