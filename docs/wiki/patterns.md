# Patterns & Gotchas

This document covers common patterns, edge cases, and things to watch out for when working on Field Notes.

## Critical Invariants

These are **non-negotiable** rules. Violating them breaks the system.

### 1. Core Stays Framework-Free

**Never** import React, Vue, Angular, or any framework into `@fieldnotes/core`.

```typescript
// ✓ Correct — core is pure TypeScript
import type { CanvasElement } from './types';

// ✗ Wrong — framework dependency in core
import { useRef } from 'react';
```

React belongs in `@fieldnotes/react` only.

### 2. Preserve Input Modalities

All input uses **Pointer Events**. Mouse, touch, and stylus must work identically.

```typescript
// ✓ Correct — handle all pointer types
onPointerDown(event: PointerEvent) {
  const pressure = event.pressure;
  const pointerType = event.pointerType; // 'mouse' | 'touch' | 'pen'
}

// ✗ Wrong — mouse-only
onMouseDown(event: MouseEvent) {
  // ignores touch and stylus
}
```

**Multi-pointer:** One pointer operates the tool; two pointers navigate. Pointer capture matters.

### 3. One Gesture = One Undo Step

Tool mutations must stay inside **history transactions**.

```typescript
// ✓ Correct — transaction wraps gesture
viewport.beginTransact();
store.add(element);
store.update(id, props);
viewport.commit(); // single undo step

// ✗ Wrong — multiple undo steps for one gesture
store.add(element); // undo step 1
store.update(id, props); // undo step 2
```

### 4. Serialization Backward Compatibility

Persisted state and sync protocol are **public contracts**. Never break them.

```typescript
// ✓ Correct — add optional field
interface CanvasState {
  version: 3;
  elements: CanvasElement[];
  newField?: string; // optional, old clients ignore it
}

// ✗ Wrong — breaking change
interface CanvasState {
  version: 3;
  elements: CanvasElement[];
  newField: string; // required, old clients crash
}
```

**Version bumps:** If you must break compatibility, increment `version` and add migration logic.

### 5. No Incidental API Widening

Only export what's intentionally public. Internal helpers stay internal.

```typescript
// ✓ Correct — explicit exports in index.ts
export { Viewport } from './canvas/viewport';
export type { ViewportOptions } from './canvas/viewport';

// ✗ Wrong — internal helper accidentally exported
export { internalHelper } from './internal-module';
```

## Common Patterns

### Composition Root (Viewport)

The `Viewport` class coordinates all subsystems. Keep orchestration there; behavior belongs in narrow collaborators.

```typescript
// ✓ Correct — Viewport delegates to collaborators
class Viewport {
  addElement(element: CanvasElement) {
    this.store.add(element);
    this.historyRecorder.record();
    this.requestRender();
  }
}

// ✗ Wrong — Viewport does everything
class Viewport {
  addElement(element: CanvasElement) {
    // 200 lines of rendering, validation, sync, etc.
  }
}
```

### Event Bus Pattern

`ElementStore`, `Camera`, `HistoryStack` use `EventBus` for subscriptions.

```typescript
// Subscribe
const unsub = store.on('add', (element) => {
  console.log('Added:', element.id);
});

// Unsubscribe (important for cleanup!)
unsub();
```

**Always unsubscribe** in cleanup/dispose methods. Leaked subscriptions cause memory leaks and stale state.

### Spatial Indexing

`ElementStore` uses a **Quadtree** for fast hit testing and viewport culling.

```typescript
// Store maintains spatial index automatically
store.add(element); // updates quadtree
store.remove(id); // updates quadtree

// Query spatially
const candidates = store.spatialIndex.query(visibleBounds);
```

**Don't bypass the store** — direct quadtree manipulation breaks consistency.

### Transaction Recording

`HistoryRecorder` observes `ElementStore` during transactions and records commands.

```typescript
viewport.beginTransact();
// HistoryRecorder starts observing
store.add(element);
store.update(id, props);
viewport.commit();
// HistoryRecorder creates Command and pushes to HistoryStack
```

**Remote changes** use `origin: 'remote'` to skip recording:

```typescript
store.update(id, props, { origin: 'remote' });
// Not recorded to undo history
```

### Hybrid Rendering

Canvas handles drawing-heavy content; DOM handles interactive content.

```typescript
// Canvas-rendered (performance-critical)
- Strokes
- Shapes
- Arrows
- Fog

// DOM-rendered (interactive)
- Notes (rich text editing)
- HTML elements (iframes, widgets)
- Text labels
```

**Camera transforms** must align both layers. DOM elements use CSS transforms.

### Tool Lifecycle

Tools follow a strict lifecycle:

```typescript
onActivate()      // tool becomes active
  ↓
onPointerDown()   // user starts gesture
  ↓
onPointerMove()   // user drags (may fire many times)
  ↓
onPointerUp()     // user releases
  ↓
onDeactivate()    // tool becomes inactive
```

**Pointer capture:** The viewport captures the pointer on `down` to ensure consistent tracking even if the pointer leaves the canvas.

**Cancellation:** `onPointerCancel()` fires when a second pointer starts navigation (pinch/pan) or the platform cancels the gesture.

### Sync Conflict Resolution

Layers and fog use **versioned records** for conflict resolution.

```typescript
interface LayerRecord {
  id: string;
  version: number; // monotonic counter
  editor: string; // client ID
  definition?: Layer; // undefined = tombstone
}

// Higher version wins; ties broken by lexicographic editor ID
function isNewerLayerRecord(a: LayerRecord, b: LayerRecord): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.editor > b.editor;
}
```

**Never use wall-clock time** for conflict resolution — it's non-deterministic.

### Storage Adapter Pattern

`StorageAdapter` interface for persistence:

```typescript
interface StorageAdapter {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}
```

**Implementations:**

- `LocalStorageAdapter` — browser localStorage (~5MB limit)
- `IndexedDBAdapter` — browser IndexedDB (larger capacity)
- `MemoryAdapter` — in-memory (for testing)

**AutoSave** debounces saves and handles errors via `onError` callback.

## Gotchas & Edge Cases

### 1. localStorage Mock in Tests

Node.js 22+ has experimental localStorage that interferes with jsdom. The test-setup provides a mock:

```typescript
// packages/core/src/test-setup.ts
// Creates localStorage mock using Storage.prototype
// This ensures vi.spyOn(Storage.prototype, 'setItem') works
```

**Don't bypass this mock** — tests will fail on Node.js 22+.

### 2. Element Bounds Include Rotation

`getElementBounds()` returns the **axis-aligned bounding box (AABB)** in world space. For rotated elements, the AABB is larger than the element's local bounds.

```typescript
// Element at (0, 0), size 100x100, rotated 45°
// Local bounds: { x: 0, y: 0, w: 100, h: 100 }
// World AABB:   { x: -20.7, y: -20.7, w: 141.4, h: 141.4 }
```

**Use `getElementVisualBounds()`** for rendering bounds (includes stroke width, etc.).

### 3. Arrow Bindings Are Optional

Arrows can be free-floating or bound to elements. Bindings are optional:

```typescript
interface ArrowElement {
  from: Point;
  to: Point;
  fromBinding?: Binding; // optional
  toBinding?: Binding; // optional
}
```

**Always check for binding existence** before accessing `fromBinding.elementId`.

### 4. Fog Tiles Are Sparse

Fog state stores tiles in a **sparse map**, not a dense grid. Most tiles are empty (fully revealed).

```typescript
interface FogStateV1 {
  tiles: Record<string, FogTileV1>; // sparse, not array
}
```

**Tile key format:** `${x},${y}` where x/y are tile coordinates.

### 5. Sync Origin Tracking

Remote changes must use `origin: 'remote'` to prevent re-broadcast and undo recording:

```typescript
// ✓ Correct
store.update(id, props, { origin: 'remote' });

// ✗ Wrong — will be recorded to undo and re-broadcast
store.update(id, props);
```

### 6. Camera Transform Alignment

Both canvas and DOM layers must use the **same camera transform**. Misalignment causes visual glitches.

```typescript
// Canvas layer
ctx.setTransform(
  camera.zoom,
  0,
  0,
  camera.zoom,
  -camera.position.x * camera.zoom,
  -camera.position.y * camera.zoom,
);

// DOM layer
domLayer.style.transform = `scale(${camera.zoom}) translate(${-camera.position.x}px, ${-camera.position.y}px)`;
```

### 7. Render Dirty Flag

Rendering only happens when `needsRender = true`. Mutations must set the dirty flag:

```typescript
// ✓ Correct
store.add(element);
viewport.requestRender(); // sets dirty flag

// ✗ Wrong — render won't happen
store.add(element);
// forgot to call requestRender()
```

**Viewport methods** usually call `requestRender()` internally. Check before adding manual calls.

### 8. Dispose Cleanup

`Viewport.dispose()` tears down all subscriptions and DOM. **Always call it** on unmount.

```typescript
// React
useEffect(() => {
  const vp = new Viewport(container);
  return () => vp.dispose(); // cleanup on unmount
}, []);

// Vanilla JS
const viewport = new Viewport(container);
// later...
viewport.dispose();
```

**Leaked viewports** cause memory leaks and zombie event listeners.

### 9. Tool Context Is Read-Only

`ToolContext` provides access to viewport APIs, but tools shouldn't store references to it:

```typescript
// ✓ Correct — use ctx in the moment
onPointerDown(state, ctx) {
  ctx.store.add(element);
  ctx.requestRender();
}

// ✗ Wrong — storing ctx reference
class MyTool {
  private ctx: ToolContext;
  onActivate(ctx) {
    this.ctx = ctx; // stale reference risk
  }
}
```

### 10. Export Parity

Exports (PNG, JPEG, SVG) must match viewport rendering. Changes to rendering logic need export updates.

```typescript
// Rendering pipeline
viewport → renderLoop → canvas

// Export pipeline
viewport → exportImage/exportSvg → canvas (same rendering logic)
```

**Test exports** when changing rendering logic.

## Performance Considerations

### 1. Avoid Per-Frame Allocation

The render loop runs at 60fps. Avoid allocating objects in hot paths:

```typescript
// ✓ Correct — reuse objects
const tempPoint = { x: 0, y: 0 };
function render() {
  tempPoint.x = camera.position.x;
  tempPoint.y = camera.position.y;
  // use tempPoint
}

// ✗ Wrong — allocates every frame
function render() {
  const point = { x: camera.position.x, y: camera.position.y };
  // use point
}
```

### 2. Culling Is Critical

Only render elements intersecting the visible viewport:

```typescript
const visibleRect = camera.getVisibleRect();
const candidates = store.spatialIndex.query(visibleRect);
// only render candidates
```

**Don't iterate all elements** — use the spatial index.

### 3. Cache Invalidation

`LayerCache` caches rendered layers. Invalidate on element changes:

```typescript
store.on('update', () => {
  layerCache.invalidate(layerId);
});
```

**Don't over-invalidate** — cache hits are faster than re-rendering.

### 4. DOM Updates Are Expensive

DOM operations are slower than canvas drawing. Batch DOM updates:

```typescript
// ✓ Correct — batch updates
domNodeManager.updateAll(changedElements);

// ✗ Wrong — one-by-one
for (const el of changedElements) {
  domNodeManager.update(el);
}
```

### 5. Fog Rendering Is Bounded

Fog tiles are 128×128 pixels. Max 256 tiles per document. The `FogRenderer` caches decoded tiles.

**Don't exceed the tile cap** — validation rejects malformed state.

## Security Considerations

### 1. HTML Sanitization

Note text is HTML. **Always sanitize** before rendering:

```typescript
import { sanitizeNoteHtml } from './note-sanitizer';

const safeText = sanitizeNoteHtml(userInput);
```

**Never render unsanitized HTML** — XSS risk.

### 2. URL Validation

Image sources and HTML element URLs must be validated:

```typescript
// ✓ Correct — validate URL
if (!src.startsWith('https://')) {
  throw new Error('Invalid URL');
}

// ✗ Wrong — accept any URL
img.src = userInput; // could be javascript:alert(1)
```

### 3. Auth and Authorization

The sync server validates auth and filters elements per-viewer:

```typescript
// Server-side filtering
const canRead = (element, viewer) => {
  return element.audience === 'all' || element.audience === viewer.id;
};
```

**Hidden data must not be sent** — not merely hidden in the UI.

### 4. Resource Limits

The sync server enforces JSON depth and presence throttling:

```typescript
const maxJsonDepth = 10;
const presenceThrottleMs = 50;
```

**Don't bypass these limits** — they prevent DoS attacks.

## Testing Tips

### 1. Use Fake Timers for Debounce

`AutoSave` debounces saves. Use fake timers to test:

```typescript
vi.useFakeTimers();
store.add(element);
await vi.advanceTimersByTimeAsync(1000); // advance past debounce
expect(localStorage.getItem('key')).not.toBeNull();
vi.useRealTimers();
```

### 2. Mock Storage Errors

Test quota exceeded errors:

```typescript
vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
  throw new DOMException('quota', 'QuotaExceededError');
});
```

### 3. Test Spatial Index

Verify elements are found spatially:

```typescript
store.add(element);
const candidates = store.spatialIndex.query(bounds);
expect(candidates).toContain(element);
```

### 4. Test Sync Protocol

Validate envelopes and ops:

```typescript
const envelope = { from: 'client-1', op: { kind: 'upsert', element } };
expect(isValidEnvelope(envelope)).toBe(true);
```

### 5. E2E Tests for Browser Behavior

Playwright tests cover browser-specific behavior:

```bash
pnpm --filter @fieldnotes/core e2e
```

**Use E2E tests** for input handling, rendering, and export.

## Useful Commands

```bash
# Search for callers of a function
rg "functionName" packages/

# Find all exports from a package
rg "^export" packages/core/src/index.ts

# List all test files
rg --files packages/core/src/ | grep test.ts

# Check TypeScript errors
pnpm --filter @fieldnotes/core build

# Run specific test
pnpm --filter @fieldnotes/core test -- src/path/to/file.test.ts

# Watch mode
pnpm --filter @fieldnotes/core test:watch
```
