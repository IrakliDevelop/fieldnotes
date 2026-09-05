# Core Concepts

This document explains the fundamental building blocks of the Field Notes canvas engine.

## Viewport

**Location:** `packages/core/src/canvas/viewport.ts`

The `Viewport` is the **composition root** — the central coordinator that owns and connects all subsystems. It's the primary public API for embedding a canvas.

```typescript
const viewport = new Viewport(containerElement, {
  camera: { zoom: 1, position: { x: 0, y: 0 } },
  background: { pattern: 'grid' },
  toolbar: true,
  contextMenu: true,
  minimap: false,
  fog: { mode: 'editor' },
});
```

**What Viewport owns:**

- `camera: Camera` — pan/zoom state and transforms
- `store: ElementStore` — all canvas elements
- `toolManager: ToolManager` — active tool and tool registry
- `history: HistoryStack` — undo/redo
- `layerManager: LayerManager` — layer state
- `fogManager: FogManager` — fog of war state (if enabled)

**Key methods:**

- `setTool(name)` — switch active tool
- `undo()` / `redo()` — history navigation
- `beginTransact()` / `commit()` / `rollback()` — history transactions
- `exportImage()` / `exportSvg()` — render exports
- `registerHtmlRenderer()` — register custom HTML element renderers
- `dispose()` — cleanup (call on unmount!)

**Lifecycle:**

1. Constructor creates DOM structure (wrapper, canvas, DOM layer)
2. Subsystems initialize and subscribe to each other
3. `RenderLoop` starts on first dirty flag
4. `dispose()` tears down all subscriptions and DOM

## ElementStore

**Location:** `packages/core/src/elements/element-store.ts`

The `ElementStore` is the **single source of truth** for all canvas elements. It provides:

- **CRUD operations:** `add()`, `remove()`, `update()`, `getById()`, `getAll()`
- **Spatial indexing:** Quadtree for fast hit testing and viewport culling
- **Event bus:** `on('add')`, `on('remove')`, `on('update')`, `on('clear')`
- **Versioning:** Per-element version counter for sync conflict resolution
- **Layer ordering:** Sorts elements by layer then zIndex

```typescript
store.add(element);
store.remove(elementId);
store.update(elementId, { text: 'new text' }, { origin: 'remote' });
```

**Origin tracking:** The `origin` parameter in `update()` marks changes as local or remote:

- `undefined` or `'local'` → recorded to undo history, broadcast to sync
- `'remote'` → NOT recorded to undo, NOT re-broadcast

## Camera

**Location:** `packages/core/src/canvas/camera.ts`

The `Camera` manages **pan and zoom transforms** between world space and screen space.

```typescript
camera.pan(dx, dy); // translate by delta
camera.zoom(factor, cx, cy); // zoom around point
camera.worldToScreen(p); // transform world → screen
camera.screenToWorld(p); // transform screen → world
camera.getVisibleRect(); // current viewport bounds in world space
```

**Key concepts:**

- **World space** — infinite canvas coordinates (elements live here)
- **Screen space** — pixel coordinates (DOM/canvas rendering)
- **Zoom** — scale factor (1 = 100%)
- **Position** — world coordinate at the center of the viewport

**Events:** `onChange` fires when camera state changes (pan, zoom, animate).

## Elements

**Location:** `packages/core/src/elements/types.ts`

Elements are the **building blocks** of the canvas. They form a discriminated union:

```typescript
type CanvasElement =
  | StrokeElement // freehand drawing
  | NoteElement // sticky note with rich text
  | ArrowElement // arrow with optional bindings
  | ImageElement // embedded image
  | HtmlElement // embedded HTML (iframes, widgets)
  | TextElement // plain text label
  | ShapeElement // rectangle, ellipse, line
  | GridElement // hex/square grid
  | TemplateElement; // reusable template
```

**Common properties (BaseElement):**

```typescript
interface BaseElement {
  id: string;
  type: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
  groupId?: string; // group membership
  rotation?: number; // radians, clockwise
}
```

**Element factory:** `packages/core/src/elements/element-factory.ts` provides `createNote()`, `createStroke()`, `createArrow()`, etc.

**Element bounds:** `getElementBounds()` returns the axis-aligned bounding box (AABB) in world space.

## Tools

**Location:** `packages/core/src/tools/`

Tools handle **user input** and translate it into element mutations. Each tool implements the `Tool` interface:

```typescript
interface Tool {
  readonly name: string;
  onPointerDown(state: PointerState, ctx: ToolContext): void;
  onPointerMove(state: PointerState, ctx: ToolContext): void;
  onPointerUp(state: PointerState, ctx: ToolContext): void;
  onPointerCancel?(state: PointerState, ctx: ToolContext): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  renderOverlay?(ctx: CanvasRenderingContext2D): void;
}
```

**Built-in tools:**

- `HandTool` — pan the canvas
- `SelectTool` — select, move, resize elements
- `PencilTool` — freehand drawing
- `EraserTool` — delete elements
- `NoteTool` — create sticky notes
- `ArrowTool` — create arrows
- `TextTool` — create text labels
- `ImageTool` — embed images
- `ShapeTool` — create shapes (rectangle, ellipse, line)
- `MeasureTool` — measure distances
- `PathTool` — create movement paths
- `FogTool` — reveal/conceal fog
- `LaserTool` — laser pointer (presence)
- `PingTool` — attention ping (presence)

**Tool lifecycle:**

1. `onActivate()` — tool becomes active
2. `onPointerDown()` — user starts gesture
3. `onPointerMove()` — user drags
4. `onPointerUp()` — user releases
5. `onDeactivate()` — tool becomes inactive

**ToolContext:** Provides access to camera, store, and viewport APIs:

```typescript
interface ToolContext {
  camera: Camera;
  store: ElementStore;
  requestRender: () => void;
  switchTool?: (name: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  activeLayerId?: string;
  // ...
}
```

## History (Undo/Redo)

**Location:** `packages/core/src/history/`

The history system provides **undo/redo** via a command pattern.

**HistoryStack:** Manages undo/redo stacks of `Command` objects.

**Command interface:**

```typescript
interface Command {
  undo(store: ElementStore): void;
  redo(store: ElementStore): void;
}
```

**Transaction model:**

```typescript
viewport.beginTransact(); // start transaction
store.add(element); // mutation
store.update(id, props); // more mutations
viewport.commit(); // record as single undo step
// or viewport.rollback(); // discard
```

**Key principle:** One user gesture = one undo step. Tools wrap their mutations in transactions.

**HistoryRecorder:** Automatically records transactions by observing `ElementStore` changes during a transaction.

## Layers

**Location:** `packages/core/src/layers/`

Layers provide **organizational grouping** for elements. Each element belongs to exactly one layer.

**Layer properties:**

```typescript
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
}
```

**LayerManager:** Manages layer CRUD and state. Elements are sorted by layer order then zIndex.

**Sync:** Layers sync via versioned records (`LayerRecord`). Higher version wins; ties broken by editor ID.

## Fog of War

**Location:** `packages/core/src/fog/`

Fog of war provides a **reveal/conceal mask** over the canvas. Useful for GM screens, exploration games, etc.

**FogManager:** Manages fog state (definitions, tiles, view mode).

**Fog state structure:**

```typescript
interface FogStateV1 {
  version: 1;
  definitions: FogDefinitionV1[]; // fog layers
  tiles: Record<string, FogTileV1>; // sparse tile storage
}
```

**Tile codec:** 128×128 one-bit tiles, base64-encoded. Max 256 tiles per document.

**View modes:**

- `'off'` — no fog rendering
- `'editor'` — fog visible with reveal/conceal tools
- `'player'` — fog opaque, hidden areas not rendered

**FogRenderer:** Renders fog as a compositing stratum above all content.

**Sync:** Fog syncs via `FogMetaRecord` (definition) and `FogTileRecord` (tiles) with versioned conflict resolution.

## Rendering

**Location:** `packages/core/src/canvas/render-loop.ts`

The `RenderLoop` schedules and executes frame rendering.

**Render pipeline:**

1. Clear canvas
2. Apply camera transform
3. Draw background (grid, pattern)
4. For each visible layer:
   - Draw canvas-rendered elements (strokes, shapes, arrows)
   - Update DOM-rendered elements (notes, HTML, text)
5. Draw fog mask (if enabled)
6. Draw tool overlays
7. Draw registered overlay renderers

**Dirty flag:** Rendering only happens when `needsRender = true`. Mutations set the dirty flag; the next animation frame renders.

**Culling:** `MarginViewport` calculates visible bounds with margin. Only elements intersecting visible bounds are rendered.

**Caching:** `LayerCache` caches rendered layers to avoid redundant work. Cache invalidated on element changes.

**Hybrid rendering:**

- **Canvas** — strokes, shapes, arrows, fog (performance-critical)
- **DOM** — notes, HTML elements, text (interactive, accessible)

Both layers share the same camera transform. DOM elements positioned via CSS transforms.

## Input Handling

**Location:** `packages/core/src/canvas/input-handler.ts`

The `InputHandler` routes **pointer and keyboard events** to the active tool.

**Pointer events:**

- `onPointerDown` → tool.onPointerDown()
- `onPointerMove` → tool.onPointerMove()
- `onPointerUp` → tool.onPointerUp()
- `onPointerCancel` → tool.onPointerCancel()

**Multi-pointer:** One pointer operates the tool; two pointers navigate (pan/zoom). Pointer capture ensures consistent tracking.

**Keyboard events:** Routed through shortcut map. Tools can intercept via `onKeyDown()`.

**Pressure and modality:** `PointerState` includes `pressure` and `pointerType` (mouse/touch/pen). Tools can adapt behavior.

## Serialization

**Location:** `packages/core/src/core/state-serializer.ts`

State serialization converts the canvas to/from JSON.

**CanvasState structure:**

```typescript
interface CanvasState {
  version: 3;
  elements: CanvasElement[];
  layers?: Layer[];
  fog?: FogStateV1;
}
```

**Versioning:** The serializer handles backward compatibility. Older versions (1, 2) still parse.

**Storage adapters:** `StorageAdapter` interface for persistence:

- `LocalStorageAdapter` — browser localStorage (simple, ~5MB limit)
- `IndexedDBAdapter` — browser IndexedDB (larger capacity)
- `MemoryAdapter` — in-memory (for testing)

**AutoSave:** `AutoSave` class debounces saves to a storage adapter. Subscribes to `ElementStore` and `Camera` changes.

## Sync Protocol

**Location:** `packages/sync/src/protocol.ts`

The wire protocol defines how clients and servers communicate.

**SyncEnvelope:**

```typescript
interface SyncEnvelope {
  from: string; // client ID
  op: SyncOp;
}
```

**SyncOp types:**

- `upsert` — create/update element
- `remove` — delete element
- `clear` — clear all elements
- `snapshot` — full state snapshot
- `presence` — cursor/selection data
- `layer-upsert` / `layer-remove` — layer changes
- `fog-meta` / `fog-patch` — fog changes

**Validation:** `isValidEnvelope()`, `isValidElement()`, etc. validate incoming messages.

**Protocol versions:**

- `LAYER_SYNC_PROTOCOL_VERSION = 1`
- `FOG_SYNC_PROTOCOL_VERSION = 1`

**Conflict resolution:** Layers and fog use versioned records. Higher version wins; ties broken by lexicographic editor ID.
