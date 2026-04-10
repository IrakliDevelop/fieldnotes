# Field Notes

> A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding arbitrary HTML elements.

## Problem

Existing infinite canvas solutions each have significant trade-offs:

- **Tldraw** — Excellent feature set with HTML embedding support, but requires a commercial license
- **Excalidraw** — Great open-source drawing tool, but lacks the ability to embed arbitrary HTML/React components as first-class canvas elements
- **React Flow** — Excellent for node-graph UIs, but not a general-purpose drawing canvas

There is no lightweight, open-source SDK that combines freehand drawing, shapes, and **native HTML element embedding** on an infinite canvas.

## Goal

Build an open-source, vanilla TypeScript infinite canvas SDK that:

1. Has zero framework dependencies in its core
2. Supports freehand drawing, shapes, arrows, sticky notes, and images
3. Treats embedded HTML/DOM elements as first-class canvas citizens (drag, resize, interact)
4. Provides thin framework wrappers (React, etc.) as separate packages
5. Is lightweight and performant enough for hobby and indie projects
6. Is publishable to npm for the community

## Origin

This project started from a need in a D&D companion app where players use an iPad with Apple Freeform for session notes. The app already has rich text notes and HTML card components — this SDK will provide a canvas where those cards can live alongside freehand drawings, maps, and annotations.

---

## Tech Stack

| Layer           | Technology                                   | Rationale                                                 |
| --------------- | -------------------------------------------- | --------------------------------------------------------- |
| Language        | TypeScript (strict)                          | Type safety, better DX, self-documenting API              |
| Core rendering  | HTML5 Canvas API                             | High-performance drawing, GPU-friendly                    |
| HTML elements   | DOM nodes with CSS transforms                | Native interaction, no foreignObject quirks               |
| Viewport/camera | CSS `translate3d` + `scale`                  | GPU-composited transforms for smooth pan/zoom             |
| Pointer input   | Pointer Events API                           | Unified mouse/touch/stylus handling (iPad/tablet support) |
| Build tool      | tsup or Vite library mode                    | Fast builds, tree-shakeable ESM output                    |
| Monorepo        | pnpm workspaces                              | Simple, fast, no extra tooling needed                     |
| Testing         | Vitest                                       | Fast, TypeScript-native                                   |
| Demo            | Plain HTML (dev), Next.js (integration test) | Minimal overhead during development                       |

## Architecture

### Rendering Strategy: Hybrid Canvas + DOM

- **Canvas layer**: Freehand strokes, shapes, arrows, grid/background
- **DOM layer**: Sticky notes, text elements, images, embedded HTML components
- **Shared camera system**: Both layers transform in sync via a single viewport state

This hybrid approach gives us the performance of canvas for drawing-heavy operations while preserving full DOM interactivity for HTML elements.

### Rendering Performance

The render loop uses several layers of caching to minimize per-frame work:

- **Per-layer offscreen canvas caching** — each layer renders to an offscreen canvas; unchanged layers are re-composited without re-rendering. Camera movement invalidates all layer caches.
- **Grid offscreen canvas cache** — rendered grid is cached to a separate offscreen canvas, invalidated on camera change. Static-camera frames are served from a single `drawImage` (sub-0.1ms).
- **Tiled hex grid rendering** — hex grids render a small repeating tile once, then fill the viewport via `drawImage` tiling (~250x faster than per-hex rendering on large grids).
- **Stroke segment caching** — Catmull-Rom to Bezier segments and pressure widths are cached at commit time (onPointerUp) via WeakMap; strokes are immutable after commit.
- **Arrow control point caching** — `cachedControlPoint` is computed once in `createArrow()` and recomputed on update; eliminates per-frame trig.
- **Background pattern caching** — dot/grid background patterns are cached to an offscreen canvas, invalidated on camera change.
- **ImageBitmap pre-decoding** — async upgrade from HTMLImageElement to GPU-ready ImageBitmap after load.
- **Quadtree spatial index** — O(log n) element queries for hit-testing and viewport culling.
- **Viewport culling** — off-screen elements are skipped in the render loop.

### Input & Touch/Tablet Strategy

The input system is built around the Pointer Events API, which provides unified handling for mouse, touch, and stylus (Apple Pencil, Surface Pen, etc.) through a single event model. Key design decisions:

- **`touch-action: none`** on the canvas — prevents browser default gestures from interfering
- **`user-scalable=no`** on viewport meta — prevents double-tap zoom on tablets
- **Single pointer = tool** — one finger/pencil triggers the active tool (draw, erase, select, etc.)
- **Two pointers = viewport** — two-finger pinch-to-zoom and pan, regardless of active tool
- **Tool cancellation** — if a second finger is added mid-stroke, the stroke is cancelled and input switches to pan/zoom
- **Pointer capture** — active strokes capture the pointer to prevent losing input when finger drifts outside the canvas
- **Pressure data** — `PointerEvent.pressure` is passed through to tools for stylus-aware features (variable stroke width, etc.)

Target devices: desktop (mouse), iPad (touch + Apple Pencil), Android tablets, Surface devices. Not targeting smartphones (screen too small for canvas work).

### Package Structure

```
fieldnotes/
├── packages/
│   ├── core/                  # @fieldnotes/core — vanilla TS engine
│   │   ├── src/
│   │   │   ├── core/          # Core classes, event bus, state management, auto-save
│   │   │   ├── canvas/        # Canvas rendering, camera/viewport system, export
│   │   │   ├── elements/      # Element types, factory, renderer, arrow binding
│   │   │   ├── layers/        # LayerManager, Layer type
│   │   │   ├── tools/         # Tool system (select, pencil, eraser, arrow, note, text, shape, measure, template)
│   │   │   ├── history/       # Undo/redo command stack
│   │   │   └── index.ts       # Public API entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── react/                 # @fieldnotes/react — thin React wrapper
│       ├── src/
│       │   ├── FieldNotesCanvas.tsx
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── demo/                      # Plain HTML dev playground
│   └── index.html
│
├── PROJECT.md                 # This file
├── package.json               # Workspace root
└── pnpm-workspace.yaml
```

### Core Data Model

```typescript
type Point = { x: number; y: number };
type Size = { w: number; h: number };

interface BaseElement {
  id: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
}

interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: StrokePoint[]; // Relative to position; includes pressure
  color: string;
  width: number;
  opacity: number;
}

interface NoteElement extends BaseElement {
  type: 'note';
  size: Size;
  text: string;
  backgroundColor: string;
  textColor: string;
}

interface Binding {
  elementId: string;
}

interface ArrowElement extends BaseElement {
  type: 'arrow';
  from: Point;
  to: Point;
  bend: number; // Quadratic bezier control offset
  color: string;
  width: number;
  fromBinding?: Binding; // Snap tail to another element
  toBinding?: Binding; // Snap head to another element
  cachedControlPoint?: Point; // Derived from from/to/bend, safe to omit in serialized state
}

interface ImageElement extends BaseElement {
  type: 'image';
  size: Size;
  src: string; // URL or data URI
}

interface HtmlElement extends BaseElement {
  type: 'html';
  size: Size;
  domId?: string; // DOM node id for re-attaching across reloads
}

interface TextElement extends BaseElement {
  type: 'text';
  size: Size;
  text: string;
  fontSize: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

type ShapeKind = 'rectangle' | 'ellipse';

interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
}

type HexOrientation = 'pointy' | 'flat';

interface GridElement extends BaseElement {
  type: 'grid';
  gridType: 'square' | 'hex';
  hexOrientation: HexOrientation;
  cellSize: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

type TemplateShape = 'circle' | 'cone' | 'line' | 'square';

interface TemplateElement extends BaseElement {
  type: 'template';
  templateShape: TemplateShape;
  radius: number;
  angle: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  feetPerCell?: number; // Feet per grid cell (default 5)
  radiusFeet?: number; // Computed radius in feet
}

type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | GridElement
  | TemplateElement;
```

### Layer Model

```typescript
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
  opacity: number;
}
```

Every `CanvasElement` carries a `layerId` tying it to a `Layer`. Layers control visibility and locking for the elements they own. Arrow binding only connects arrows to elements on the same layer.

### Core API Surface

```typescript
// Instantiation
const canvas = new Viewport(containerElement, {
  background: { pattern: 'dots' },
});

// Element manipulation
canvas.store.add(element);
canvas.store.remove(id);
canvas.store.update(id, partialUpdate);
canvas.store.getAll();

// HTML embedding — the differentiator
// Captures dom.id as domId on the element for persistence across reloads
canvas.addHtmlElement(myCardElement, { x: 300, y: 100 }, { w: 250, h: 150 });

// Images
canvas.addImage('https://example.com/map.png', { x: 0, y: 0 }, { w: 800, h: 600 });

// Grid element (square or hex, for D&D maps etc.)
canvas.addGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 40 });
canvas.updateGrid({ cellSize: 50, strokeColor: '#aaaaaa' });
canvas.removeGrid();

// Tool control
canvas.toolManager.setTool('pencil', canvas.toolContext);

// D&D VTT tools — measure distances and place spell templates
// MeasureTool: drag to measure in feet, snaps to hex/square grid
canvas.toolManager.setTool('measure', canvas.toolContext);
const measure = canvas.toolManager.getTool('measure') as MeasureTool;
measure.setOptions({ feetPerCell: 5 });

// TemplateTool: place area-of-effect templates (circle, cone, line, square)
// On hex grids, templates fill actual hex cells (D&D PHB-style)
canvas.toolManager.setTool('template', canvas.toolContext);
const template = canvas.toolManager.getTool('template') as TemplateTool;
template.setOptions({
  templateShape: 'cone',
  fillColor: 'rgba(255, 87, 34, 0.2)',
  strokeColor: '#FF5722',
  feetPerCell: 5,
});

// Hex fill utilities (for custom hex-based features)
import { getHexCellsInRadius, getHexDistance, drawHexPath } from '@fieldnotes/core';
const cells = getHexCellsInRadius(center, radiusCells, cellSize, 'pointy');
const steps = getHexDistance(pointA, pointB, cellSize, 'pointy'); // integer hex steps

// Snap-to-grid
canvas.setSnapToGrid(true);

// Viewport
canvas.camera.panTo(x, y);
canvas.camera.setZoom(level);

// History
canvas.undo();
canvas.redo();

// Layers
canvas.layerManager.getLayers(); // Layer[]
canvas.layerManager.createLayer('Background'); // Layer
canvas.layerManager.removeLayer(id);
canvas.layerManager.setLayerVisible(id, false);
canvas.layerManager.setLayerLocked(id, true);
canvas.layerManager.setActiveLayer(id);
canvas.layerManager.renameLayer(id, 'New name');
canvas.layerManager.reorderLayer(id, newOrder);
canvas.layerManager.moveElementToLayer(elementId, layerId);
canvas.layerManager.on('change', callback);

// Serialization
const state = canvas.exportState(); // CanvasState (JSON-serializable, includes layers)
const json = canvas.exportJSON(); // string
canvas.loadState(state);
canvas.loadJSON(json);

// Image export — returns PNG as Blob, respects layer visibility
const blob = await canvas.exportImage({
  scale: 2, // pixel density multiplier (default 2)
  padding: 20, // world-space padding around content (default 0)
  background: '#fff', // fill color (default '#ffffff')
  filter: (el) => el.type !== 'html', // optional per-element filter
});

// AutoSave — debounced localStorage persistence
const autoSave = new AutoSave(canvas.store, canvas.camera, {
  key: 'my-canvas', // localStorage key (default 'fieldnotes-autosave')
  debounceMs: 1000, // save delay in ms (default 1000)
  layerManager: canvas.layerManager,
});
autoSave.start();
const saved = autoSave.load(); // CanvasState | null
autoSave.stop();
autoSave.clear();

// Performance monitoring
const stats = canvas.getRenderStats(); // { fps, avgFrameMs, p95FrameMs, lastGridMs, frameCount }
const stop = canvas.logPerformance(2000); // periodic console logging, returns stop fn

// Events
canvas.store.on('add', callback);
canvas.store.on('update', callback);
canvas.toolManager.onChange(callback);

// Cleanup
canvas.destroy();
```

### Standalone `exportImage` function

For use outside of a `Viewport` instance:

```typescript
import { exportImage } from '@fieldnotes/core';

const blob = await exportImage(store, options, layerManager);
```

`ExportImageOptions`:

```typescript
interface ExportImageOptions {
  scale?: number; // default 2
  padding?: number; // world-space padding, default 0
  background?: string; // CSS color, default '#ffffff'
  filter?: (element: CanvasElement) => boolean;
}
```

HTML elements are excluded from image exports (DOM cannot be rasterized to canvas). Grid elements render across the full export bounds regardless of position.

### Images & Storage

Images are stored in the canvas state as their `src` value. **Use URLs, not base64 data URLs**, for any non-trivial use case:

```typescript
// Good — lightweight, shareable, no storage bloat
canvas.addImage('https://cdn.example.com/maps/tavern.png', pos, size);
canvas.addImage('/assets/map.png', pos, size);

// Avoid — a single photo can be 2-5MB as base64, bloating serialized state
canvas.addImage('data:image/png;base64,iVBOR...', pos, size);
```

**Why this matters:**

- `exportState()` / `exportJSON()` includes image `src` values inline. Base64 data URLs make the serialized state enormous.
- `AutoSave` uses `localStorage` by default, which has a **~5MB limit** across all keys. One base64 image can exceed this.
- Sharing state (e.g., syncing canvas between users via JSON) becomes impractical with multi-MB payloads.

**Recommended approach for user-uploaded images:**

1. Upload the image to your server or a storage service (S3, Cloudflare R2, etc.)
2. Use the returned URL with `addImage()`
3. For offline/local-first apps, store image blobs in IndexedDB and reference them by object URL or a custom scheme

---

## Scope

### MVP (v0.1) — Core Canvas Experience

- [x] Project setup (monorepo, build, TypeScript)
- [x] Infinite canvas with pan (drag) and zoom (scroll wheel / pinch)
- [x] Background pattern (dots, grid, none)
- [x] Freehand pencil drawing (pressure data available for stylus)
- [x] Stroke-level eraser
- [x] Sticky notes (rectangle with text)
- [x] Arrows (point-to-point with arrowhead)
- [x] Select tool (click to select, drag to move, z-index aware)
- [x] Tool system (Strategy pattern: select, pencil, eraser, arrow, note)
- [x] Element store (CRUD, z-index ordering, type queries, snapshot/load)
- [x] Touch/tablet support (pinch-to-zoom, two-finger pan, tool cancellation)
- [x] Pointer capture and touch-action handling
- [x] Plain HTML demo page with toolbar and keyboard shortcuts
- [x] Image support (drag & drop onto canvas)
- [x] HTML element embedding (add arbitrary DOM nodes as canvas elements)
- [x] Multi-select (drag box)
- [x] Undo / Redo
- [x] State serialization (export/import JSON)

### v0.2 — React Wrapper & Polish

- [x] `@fieldnotes/react` wrapper component
- [x] Resize handles on elements
- [x] Basic keyboard shortcuts (Ctrl+Z, Delete, etc.)
- [x] Color picker for tools
- [x] Stroke smoothing (point simplification)
- [x] Pressure-sensitive stroke width (Apple Pencil / stylus)

### v0.3 — Enhanced Elements

- [x] **Text tool** — standalone text boxes on canvas (editable, styled, resizable)
- [x] Arrow binding — snap arrows to elements (same-layer only)
- [x] Shape tools — rectangle and ellipse
- [x] Snap-to-grid — `snapPoint()` utility, toggleable via `viewport.setSnapToGrid()`
- [x] Layers — `LayerManager` with visibility, locking, ordering, per-layer opacity
- [x] Note text color — `textColor` field on `NoteElement`
- [x] Grid element — square and hex grids for D&D maps (`GridElement`)
- [x] HTML element persistence — `domId` field on `HtmlElement` for re-attaching DOM nodes across reloads (note: `loadJSON`/`loadState` restores metadata but the app must re-attach DOM nodes via `domId` matching — no automatic DOM reconstruction)
- [x] AutoSave — debounced localStorage persistence with configurable interval
- [ ] Minimap

### v0.4 — SDK Maturity

- [ ] Plugin system for custom tools and elements
- [ ] Theming (dark/light, custom colors)
- [ ] Configurable keyboard shortcut system
- [ ] Copy/paste (elements within canvas, and between browser tabs)
- [ ] Accessibility (keyboard navigation, screen reader basics)
- [x] npm publish: `@fieldnotes/core`, `@fieldnotes/react`
- [ ] Live demo / playground (hosted, linkable — critical for adoption)
- [ ] `@fieldnotes/ui` — pre-built, customizable UI components (toolbar, text format panel, color picker, layers panel) as a separate package; `@fieldnotes/react` stays a thin binding layer
- [ ] Documentation site

### v0.5 — Import / Export

- [x] Export to PNG — `exportImage()` returns a PNG `Blob`, with scale, padding, background, and filter options
- [ ] Export to SVG (vector export of strokes, shapes, arrows)
- [ ] Export to PDF
- [ ] **FreeForm PDF import — Phase 1: Images** — extract embedded images with positions/sizes from Apple FreeForm PDF exports
- [ ] **FreeForm PDF import — Phase 2: Text** — extract text items with fonts, sizes, positions
- [ ] **FreeForm PDF import — Phase 3: Sticky notes** — detect colored rectangles as note elements
- [ ] JSON import/export improvements (versioned schema, migration support)

### v0.6 — Collaboration & Polish

- [ ] Real-time collaboration (CRDT-based, e.g. Yjs or Automerge)
- [ ] Presence indicators (cursors, selections)
- [ ] Presentation mode (slide-like navigation between canvas regions)
- [ ] Connectors (arrows that auto-route around elements)
- [ ] Grid/frame layout containers

### Future — `@fieldnotes/presets`

Domain-specific preset bundles that sit on top of the generic SDK, making it instantly useful for specific use cases.

**D&D / TTRPG preset (priority):**

- [ ] Map layer — auto-locked background image on Layer 1
- [ ] Grid overlay layer — hex or square grid with transparent background
- [ ] Token system — player tokens as HTML/React elements (avatar + name badge)
- [ ] DM annotations layer — notes, arrows, area markers
- [ ] Pre-built token component — avatar, name, health bar, status indicators
- [ ] Fog of war — hide/reveal areas of the map

**Other preset ideas:**

- [ ] Whiteboard / brainstorming — sticky notes, connectors, frames
- [ ] Mood board — image-heavy, freeform layout
- [ ] Wireframing — UI component stencils, grids, alignment guides

### Future — Cross-Tool Compatibility

Enable migration from other canvas tools by importing their export formats:

- [ ] **FreeForm migration tool** — bulk import existing Apple FreeForm boards (images, text, sticky notes, pencil strokes)
- [ ] **FreeForm PDF import — Phase 4: Pencil strokes** — reconstruct center-line strokes from FreeForm's filled vector outlines (complex: requires skeleton extraction or visual approximation)
- [ ] **Miro / FigJam import** — investigate JSON or API-based import from other popular whiteboard tools
- [ ] **Generic PDF import** — import annotated PDFs as canvas elements (images, text overlays)

### Future — Advanced SDK Features

- [ ] Handwriting recognition (optional, via ML model)
- [ ] Infinite zoom with level-of-detail rendering
- [ ] Canvas-to-canvas linking (nested infinite canvases)
- [ ] `diffAndApply(json)` — diff-based state update to avoid full rebuild flicker on polled sync
- [ ] Offline-first with sync (IndexedDB + conflict resolution)
- [ ] Mobile app wrapper (Capacitor / React Native WebView)

---

## Known Limitations / Open Gaps

- **No live demo** — no hosted playground for potential adopters to try before installing
- **No copy/paste** — no clipboard support for elements within or between canvases
- **No keyboard shortcut system** — shortcuts are hardcoded in the input handler, not configurable
- **HTML element restore** — `loadJSON`/`loadState` restores element metadata but the app must re-create and re-attach DOM nodes; there is no automatic DOM reconstruction from serialized state
- **Cross-origin images** — export uses `crossOrigin='anonymous'` with a cache-buster query param; this works when the image server sends CORS headers but will silently fail (skip image) if it doesn't

## Design Principles

1. **Vanilla first** — The core has zero framework dependencies. Always.
2. **Lightweight** — Bundle size matters. No kitchen sink.
3. **HTML is a first-class citizen** — Embedding DOM elements should feel native, not bolted on.
4. **Predictable state** — Single source of truth, serializable, inspectable.
5. **Progressive complexity** — Simple things are simple, complex things are possible.
6. **Pointer-first** — Built for mouse, touch, and stylus from day one. Every input path must work with Pointer Events, never mouse-only APIs.
7. **Tablet-native** — iPad and tablet support is not an afterthought. Pinch-to-zoom, two-finger pan, stylus pressure, and touch disambiguation are core requirements, not polish items.
