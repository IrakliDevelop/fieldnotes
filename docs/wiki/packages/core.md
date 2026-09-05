# @fieldnotes/core

**Version:** 0.68.0
**Location:** `packages/core/`
**Description:** Framework-free infinite canvas engine

## Overview

The core package is the heart of Field Notes. It's a **pure TypeScript** canvas engine with zero framework dependencies. It works in any browser environment and provides:

- Element management (CRUD, spatial indexing)
- Tool system (hand, pencil, eraser, select, etc.)
- Rendering (hybrid canvas + DOM)
- History (undo/redo)
- Layers (organization, visibility, locking)
- Fog of war (reveal/conceal mask)
- Serialization (save/load state)
- Export (PNG, JPEG, SVG)
- Input handling (pointer, keyboard)

## Directory Structure

```
packages/core/src/
├── canvas/           # Viewport, camera, rendering, input, export
│   ├── viewport.ts          # Composition root
│   ├── camera.ts            # Pan/zoom transforms
│   ├── render-loop.ts       # Frame scheduling
│   ├── input-handler.ts     # Pointer/keyboard routing
│   ├── export-image.ts      # PNG/JPEG export
│   ├── export-svg.ts        # SVG export
│   └── ...
├── elements/         # Element types, store, geometry, editing
│   ├── types.ts             # Element type definitions
│   ├── element-store.ts     # Element CRUD + spatial index
│   ├── element-factory.ts   # createNote(), createStroke(), etc.
│   ├── element-bounds.ts    # Bounding box calculations
│   ├── element-renderer.ts  # Canvas rendering
│   ├── note-editor.ts       # Rich text editing
│   └── ...
├── tools/            # Tool implementations
│   ├── types.ts             # Tool interface
│   ├── tool-manager.ts      # Tool registry
│   ├── hand-tool.ts         # Pan canvas
│   ├── select-tool.ts       # Select/move/resize
│   ├── pencil-tool.ts       # Freehand drawing
│   ├── eraser-tool.ts       # Delete elements
│   ├── note-tool.ts         # Create notes
│   └── ...
├── history/          # Undo/redo
│   ├── types.ts             # Command interface
│   ├── history-stack.ts     # Undo/redo stacks
│   └── history-recorder.ts  # Transaction recording
├── layers/           # Layer management
│   ├── types.ts             # Layer interface
│   └── layer-manager.ts     # Layer CRUD
├── fog/              # Fog of war
│   ├── types.ts             # Fog types
│   ├── fog-manager.ts       # Fog state
│   ├── fog-renderer.ts      # Fog rendering
│   ├── fog-tool.ts          # Reveal/conceal tool
│   └── tile-codec.ts        # Tile encoding/decoding
├── core/             # Generic utilities
│   ├── types.ts             # Point, Bounds, etc.
│   ├── event-bus.ts         # Pub/sub
│   ├── quadtree.ts          # Spatial index
│   ├── state-serializer.ts  # JSON serialization
│   ├── auto-save.ts         # Debounced save
│   └── storage/             # Storage adapters
└── index.ts          # Public API exports
```

## Key Classes

### Viewport

The composition root. Coordinates all subsystems.

```typescript
const viewport = new Viewport(container, options);
viewport.setTool('select');
viewport.undo();
viewport.exportImage({ format: 'png' });
viewport.dispose();
```

### ElementStore

Element CRUD with spatial indexing.

```typescript
store.add(element);
store.remove(id);
store.update(id, props, { origin: 'remote' });
store.getById(id);
store.getAll();
```

### Camera

Pan/zoom transforms.

```typescript
camera.pan(dx, dy);
camera.zoom(factor, cx, cy);
camera.worldToScreen(point);
camera.screenToWorld(point);
```

### ToolManager

Tool registry and active tool.

```typescript
toolManager.register(new PencilTool());
toolManager.setActive('pencil');
```

### HistoryStack

Undo/redo stacks.

```typescript
history.push(command);
history.undo(store);
history.redo(store);
```

### LayerManager

Layer CRUD and state.

```typescript
layerManager.add({ id: 'layer-1', name: 'Background' });
layerManager.setVisible('layer-1', false);
layerManager.setLocked('layer-1', true);
```

### FogManager

Fog of war state.

```typescript
fogManager.addFog(definition);
fogManager.reveal(fogId, region);
fogManager.conceal(fogId, region);
fogManager.setViewMode('player');
```

## Element Types

Discriminated union of element types:

| Type       | Description                      |
| ---------- | -------------------------------- |
| `stroke`   | Freehand drawing                 |
| `note`     | Sticky note with rich text       |
| `arrow`    | Arrow with optional bindings     |
| `image`    | Embedded image                   |
| `html`     | Embedded HTML (iframes, widgets) |
| `text`     | Plain text label                 |
| `shape`    | Rectangle, ellipse, line         |
| `grid`     | Hex/square grid                  |
| `template` | Reusable template                |

## Tools

Built-in tools:

| Tool      | Description                   |
| --------- | ----------------------------- |
| `hand`    | Pan the canvas                |
| `select`  | Select, move, resize elements |
| `pencil`  | Freehand drawing              |
| `eraser`  | Delete elements               |
| `note`    | Create sticky notes           |
| `arrow`   | Create arrows                 |
| `text`    | Create text labels            |
| `image`   | Embed images                  |
| `shape`   | Create shapes                 |
| `measure` | Measure distances             |
| `path`    | Create movement paths         |
| `fog`     | Reveal/conceal fog            |
| `laser`   | Laser pointer (presence)      |
| `ping`    | Attention ping (presence)     |

## Public API

Exported from `packages/core/src/index.ts`:

```typescript
// Classes
export { Viewport } from './canvas/viewport';
export { Camera } from './canvas/camera';
export { ElementStore } from './elements/element-store';
export { ToolManager } from './tools/tool-manager';
export { HistoryStack } from './history/history-stack';
export { LayerManager } from './layers/layer-manager';
export { FogManager } from './fog/fog-manager';

// Factories
export { createNote, createStroke, createArrow, ... } from './elements/element-factory';

// Tools
export { HandTool, PencilTool, EraserTool, ... } from './tools/...';

// Types
export type { CanvasElement, ViewportOptions, Tool, ... } from './...';

// Utilities
export { exportImage } from './canvas/export-image';
export { exportSvg } from './canvas/export-svg';
export { AutoSave } from './core/auto-save';
```

## Testing

Tests are co-located with source files:

```bash
# Run all core tests
pnpm --filter @fieldnotes/core test

# Run specific test
pnpm --filter @fieldnotes/core test -- src/canvas/camera.test.ts

# Run with coverage
pnpm --filter @fieldnotes/core test:coverage

# Run E2E tests
pnpm --filter @fieldnotes/core e2e
```

**Test environment:** jsdom with localStorage mock in `test-setup.ts`.

## Build

Uses tsup for bundling:

```bash
pnpm --filter @fieldnotes/core build
```

**Output:**

- `dist/index.js` — ESM
- `dist/index.cjs` — CommonJS
- `dist/index.d.ts` — TypeScript declarations

## Dependencies

**Zero runtime dependencies.** All dependencies are dev dependencies:

- `tsup` — bundler
- `vitest` — test runner
- `@playwright/test` — E2E tests
- `jsdom` — DOM environment for tests
