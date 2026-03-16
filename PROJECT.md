# Parchment Canvas

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

| Layer           | Technology                                   | Rationale                                          |
| --------------- | -------------------------------------------- | -------------------------------------------------- |
| Language        | TypeScript (strict)                          | Type safety, better DX, self-documenting API       |
| Core rendering  | HTML5 Canvas API                             | High-performance drawing, GPU-friendly             |
| HTML elements   | DOM nodes with CSS transforms                | Native interaction, no foreignObject quirks        |
| Viewport/camera | CSS `translate3d` + `scale`                  | GPU-composited transforms for smooth pan/zoom      |
| Pointer input   | Pointer Events API                           | Unified mouse/touch/stylus handling (iPad support) |
| Build tool      | tsup or Vite library mode                    | Fast builds, tree-shakeable ESM output             |
| Monorepo        | pnpm workspaces                              | Simple, fast, no extra tooling needed              |
| Testing         | Vitest                                       | Fast, TypeScript-native                            |
| Demo            | Plain HTML (dev), Next.js (integration test) | Minimal overhead during development                |

## Architecture

### Rendering Strategy: Hybrid Canvas + DOM

- **Canvas layer**: Freehand strokes, shapes, arrows, grid/background
- **DOM layer**: Sticky notes, images, embedded HTML components
- **Shared camera system**: Both layers transform in sync via a single viewport state

This hybrid approach gives us the performance of canvas for drawing-heavy operations while preserving full DOM interactivity for HTML elements.

### Package Structure

```
parchment-canvas/
├── packages/
│   ├── core/                  # @parchment-canvas/core — vanilla TS engine
│   │   ├── src/
│   │   │   ├── core/          # Parchment class, event bus, state management
│   │   │   ├── canvas/        # Canvas rendering, camera/viewport system
│   │   │   ├── elements/      # Element types (stroke, note, arrow, image, html)
│   │   │   ├── tools/         # Tool system (select, pencil, eraser, arrow, note)
│   │   │   ├── history/       # Undo/redo command stack
│   │   │   └── index.ts       # Public API entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── react/                 # @parchment-canvas/react — thin React wrapper
│       ├── src/
│       │   ├── ParchmentCanvas.tsx
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
const parchment = new Parchment(containerElement, {
  width: '100%',
  height: '100vh',
  tools: ['select', 'pencil', 'eraser', 'arrow', 'note'],
  background: 'dots', // 'dots' | 'grid' | 'lines' | 'none'
});

// Element manipulation
parchment.addElement(element);
parchment.removeElement(id);
parchment.updateElement(id, partialUpdate);
parchment.getElements();

// HTML embedding — the differentiator
parchment.addHTMLElement({
  position: { x: 300, y: 100 },
  size: { w: 250, h: 150 },
  dom: myCardElement,
});

// Tool control
parchment.setTool('pencil');
parchment.setToolOptions({ color: '#ff0000', width: 3 });

// Viewport
parchment.panTo(x, y);
parchment.zoomTo(level);
parchment.fitToContent();

// History
parchment.undo();
parchment.redo();
parchment.clearHistory();

// Serialization
const state = parchment.exportState(); // JSON-serializable
parchment.loadState(state);

// Events
parchment.on('change', callback);
parchment.on('select', callback);
parchment.on('tool:change', callback);

// Cleanup
parchment.destroy();
```

---

## Scope

### MVP (v0.1) — Core Canvas Experience

- [x] Project setup (monorepo, build, TypeScript)
- [ ] Infinite canvas with pan (drag) and zoom (scroll wheel / pinch)
- [ ] Background pattern (dots grid)
- [ ] Freehand pencil drawing with pressure sensitivity (if available)
- [ ] Stroke-level eraser
- [ ] Sticky notes (rectangle with editable text)
- [ ] Arrows (point-to-point)
- [ ] Image support (drag & drop onto canvas)
- [ ] HTML element embedding (add arbitrary DOM nodes as canvas elements)
- [ ] Select tool (click to select, drag to move)
- [ ] Multi-select (drag box)
- [ ] Undo / Redo
- [ ] State serialization (export/import JSON)
- [ ] Plain HTML demo page

### v0.2 — React Wrapper & Polish

- [ ] `@parchment-canvas/react` wrapper component
- [ ] Resize handles on elements
- [ ] Basic keyboard shortcuts (Ctrl+Z, Delete, etc.)
- [ ] Color picker for tools
- [ ] Stroke smoothing (point simplification)
- [ ] Touch gesture support (two-finger pan/zoom)
- [ ] Test in Next.js D&D app

### v0.3 — Enhanced Elements

- [ ] Arrow binding (snap arrows to elements)
- [ ] Shape tools (rectangle, ellipse)
- [ ] Text tool (standalone text on canvas)
- [ ] Snap-to-grid / alignment guides
- [ ] Minimap
- [ ] Layers panel

### v0.4 — SDK Maturity

- [ ] Plugin system for custom tools and elements
- [ ] Theming (dark/light, custom colors)
- [ ] Configurable keyboard shortcut system
- [ ] Accessibility (keyboard navigation, screen reader basics)
- [ ] npm publish: `@parchment-canvas/core`, `@parchment-canvas/react`
- [ ] Documentation site

### Future (post v1.0)

- [ ] Real-time collaboration (CRDT-based)
- [ ] Presentation mode
- [ ] Export to PNG/SVG/PDF
- [ ] Connectors (arrows that route around elements)
- [ ] Handwriting recognition (optional)

---

## Design Principles

1. **Vanilla first** — The core has zero framework dependencies. Always.
2. **Lightweight** — Bundle size matters. No kitchen sink.
3. **HTML is a first-class citizen** — Embedding DOM elements should feel native, not bolted on.
4. **Predictable state** — Single source of truth, serializable, inspectable.
5. **Progressive complexity** — Simple things are simple, complex things are possible.
6. **Pointer-first** — Built for mouse, touch, and stylus from day one.
