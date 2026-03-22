# Shape Tools Design Spec

## Goal

Add rectangle and ellipse shape tools to the canvas SDK, built on an extensible `ShapeElement` type that makes adding future shapes (triangle, diamond, etc.) trivial.

## Data Model

A single `ShapeElement` type with a `shape` discriminator for the specific shape kind:

```typescript
type ShapeKind = 'rectangle' | 'ellipse';

interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string; // 'none' for transparent/no fill
}
```

- `type: 'shape'` joins the `CanvasElement` discriminated union.
- `ShapeKind` is the extension point — adding a new shape means adding a variant here plus a render function.
- Having `size` means shapes automatically get resize handles in SelectTool and are bindable by arrows.

## Rendering

Shapes are canvas-rendered (same layer as strokes and arrows). A new private `renderShape` method in `ElementRenderer` (called from `renderCanvasElement`'s switch) dispatches on `shape`:

- **Rectangle**: `ctx.fillRect()` + `ctx.strokeRect()`
- **Ellipse**: `ctx.ellipse()` + `ctx.fill()` + `ctx.stroke()`

Fill is drawn first, stroke on top. If `fillColor` is `'none'`, the fill call is skipped.

`DOM_ELEMENT_TYPES` is unchanged — shapes are not DOM elements.

## Hit Testing

Shapes have `size`, so the existing bounding-box hit test in SelectTool works automatically. For ellipses, the hit area is the bounding rectangle — slightly generous but consistent with how all other sized elements (notes, images) work.

## Arrow Binding

Add `'shape'` to `BINDABLE_TYPES` in `arrow-binding.ts`. Since shapes have `size`, all existing binding functions work automatically:

- `getElementBounds()` returns the shape's bounds
- `getElementCenter()` returns the shape's center
- `getEdgeIntersection()` computes where the arrow line meets the shape's bounding box

No changes needed to the binding logic itself.

## Tool

A single `ShapeTool` class parameterized by `ShapeKind`:

```typescript
interface ShapeToolOptions {
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}
```

### Interaction

- **Click-and-drag**: Press at one corner, drag to the opposite corner, release to create. All coordinates in the tool (start, end, renderOverlay) are in world space, consistent with all other tools.
- **Zero-drag guard**: If the user clicks without dragging (start equals end), no element is created — same guard as ArrowTool.
- **Shift-to-constrain**: Holding Shift constrains the shape to equal width/height (square for rectangle, circle for ellipse). Since `PointerState` does not carry modifier keys, the tool tracks Shift state via `keydown`/`keyup` listeners attached in `onActivate` and removed in `onDeactivate`.
- **Auto-switch**: After creation, switches to select tool (same as ArrowTool).
- **Preview**: `renderOverlay` draws the shape semi-transparently while dragging (world coordinates).

### Shape switching

To switch between rectangle and ellipse, call `setOptions({ shape: 'ellipse' })`. This is the same pattern as PencilTool for color/width changes. The `ToolName` union gets a single `'shape'` entry.

## Factory

One `createShape(input)` factory function:

```typescript
interface ShapeInput {
  position: Point;
  size: Size;
  shape?: ShapeKind;       // defaults to 'rectangle'
  strokeColor?: string;    // defaults to '#000000'
  strokeWidth?: number;    // defaults to 2
  fillColor?: string;      // defaults to 'none'
  zIndex?: number;
  locked?: boolean;
}
```

## Serialization

Add `'shape'` to `VALID_TYPES` in `state-serializer.ts`. No migration needed — this is a new element type. A `migrateElement` clause should default `shape` to `'rectangle'` if missing (defensive).

## Exports

From `packages/core/src/index.ts`:

- `ShapeTool` class and `ShapeToolOptions` type
- `createShape` factory function
- `ShapeElement` and `ShapeKind` types

## Version

Bump core to `0.4.0` — new element type is a minor version change.

## Files

### Modified
- `packages/core/src/elements/types.ts` — add `ShapeKind`, `ShapeElement`, update `CanvasElement` union
- `packages/core/src/elements/element-factory.ts` — add `ShapeInput`, `createShape()`
- `packages/core/src/elements/element-factory.test.ts` — tests for `createShape()`
- `packages/core/src/elements/element-renderer.ts` — add `renderShape()`, dispatch in `renderCanvasElement()`
- `packages/core/src/elements/arrow-binding.ts` — add `'shape'` to `BINDABLE_TYPES`
- `packages/core/src/tools/types.ts` — add `'shape'` to `ToolName`
- `packages/core/src/core/state-serializer.ts` — add `'shape'` to `VALID_TYPES`, migration clause
- `packages/core/src/index.ts` — exports, version bump
- `packages/core/src/index.test.ts` — version test
- `packages/core/package.json` — version bump

### Created
- `packages/core/src/tools/shape-tool.ts` — `ShapeTool` class
- `packages/core/src/tools/shape-tool.test.ts` — tool tests

## Extensibility

Adding a new shape (e.g., triangle) requires:
1. Add `'triangle'` to `ShapeKind` union
2. Add a `renderTriangle()` case in `ElementRenderer.renderShape()`
3. Done — factory, tool, binding, serialization, selection, resize all work automatically
