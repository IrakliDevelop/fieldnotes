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
- **DOM layer**: Sticky notes, images, embedded HTML components
- **Shared camera system**: Both layers transform in sync via a single viewport state

This hybrid approach gives us the performance of canvas for drawing-heavy operations while preserving full DOM interactivity for HTML elements.

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
│   │   │   ├── core/          # Core classes, event bus, state management
│   │   │   ├── canvas/        # Canvas rendering, camera/viewport system
│   │   │   ├── elements/      # Element types (stroke, note, arrow, image, html)
│   │   │   ├── tools/         # Tool system (select, pencil, eraser, arrow, note)
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

type BaseElement = {
  id: string;
  position: Point;
  zIndex: number;
  locked: boolean;
};

type StrokeElement = BaseElement & {
  type: 'stroke';
  points: Point[]; // Relative to position
  color: string;
  width: number;
  opacity: number;
};

type NoteElement = BaseElement & {
  type: 'note';
  size: Size;
  text: string;
  backgroundColor: string;
};

type ArrowElement = BaseElement & {
  type: 'arrow';
  from: Point;
  to: Point;
  color: string;
  width: number;
};

type ImageElement = BaseElement & {
  type: 'image';
  size: Size;
  src: string; // URL or data URI
};

type HTMLElement = BaseElement & {
  type: 'html';
  size: Size;
  domNode: HTMLElement; // Consumer provides the actual DOM node
};

type CanvasElement = StrokeElement | NoteElement | ArrowElement | ImageElement | HTMLElement;
```

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
canvas.addHtmlElement(myCardElement, { x: 300, y: 100 }, { w: 250, h: 150 });

// Tool control
canvas.toolManager.setTool('pencil', canvas.toolContext);

// Viewport
canvas.camera.panTo(x, y);
canvas.camera.setZoom(level);

// History
canvas.undo();
canvas.redo();

// Serialization
const state = canvas.exportState(); // JSON-serializable
canvas.loadState(state);

// Events
canvas.store.on('add', callback);
canvas.store.on('update', callback);
canvas.toolManager.onChange(callback);

// Cleanup
canvas.destroy();
```

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

- [ ] **Text tool** — standalone text boxes on canvas (editable, styled, resizable)
- [ ] Arrow binding (snap arrows to elements)
- [ ] Shape tools (rectangle, ellipse)
- [ ] Snap-to-grid / alignment guides
- [ ] Minimap
- [ ] Layers panel

### v0.4 — SDK Maturity

- [ ] Plugin system for custom tools and elements
- [ ] Theming (dark/light, custom colors)
- [ ] Configurable keyboard shortcut system
- [ ] Accessibility (keyboard navigation, screen reader basics)
- [x] npm publish: `@fieldnotes/core`, `@fieldnotes/react`
- [ ] `@fieldnotes/ui` — pre-built, customizable UI components (toolbar, text format panel, color picker, layers panel) as a separate package; `@fieldnotes/react` stays a thin binding layer
- [ ] Documentation site

### v0.5 — Import / Export

- [ ] Export to PNG (rasterize canvas region)
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
- [ ] Offline-first with sync (IndexedDB + conflict resolution)
- [ ] Mobile app wrapper (Capacitor / React Native WebView)

---

## Design Principles

1. **Vanilla first** — The core has zero framework dependencies. Always.
2. **Lightweight** — Bundle size matters. No kitchen sink.
3. **HTML is a first-class citizen** — Embedding DOM elements should feel native, not bolted on.
4. **Predictable state** — Single source of truth, serializable, inspectable.
5. **Progressive complexity** — Simple things are simple, complex things are possible.
6. **Pointer-first** — Built for mouse, touch, and stylus from day one. Every input path must work with Pointer Events, never mouse-only APIs.
7. **Tablet-native** — iPad and tablet support is not an afterthought. Pinch-to-zoom, two-finger pan, stylus pressure, and touch disambiguation are core requirements, not polish items.
