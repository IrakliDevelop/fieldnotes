# @fieldnotes/core

A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding interactive HTML elements.

## Features

- **Infinite canvas** — pan, zoom, pinch-to-zoom
- **Freehand drawing** — pencil tool with stroke smoothing and pressure-sensitive width
- **Sticky notes** — editable text notes with customizable colors
- **Arrows** — curved bezier arrows with element binding
- **Shapes** — rectangles, ellipses with fill and stroke
- **Text** — standalone text elements with font size and alignment
- **Images** — drag & drop or programmatic placement (canvas-rendered for proper layer ordering)
- **HTML embedding** — add any DOM element as a fully interactive canvas citizen
- **Layers** — named layers with visibility, locking, and absolute ordering
- **Select & multi-select** — click, drag box, move, resize (layer-aware)
- **Undo / redo** — full history stack with configurable depth
- **State serialization** — export/import JSON snapshots with automatic migration
- **Grids** — square and hex grid overlays for D&D maps and alignment
- **Export** — PNG export with scale, padding, background, and element filter options
- **Performance instrumentation** — `getRenderStats()` and `logPerformance()` for frame timing
- **Touch & tablet** — Pointer Events API, pinch-to-zoom, two-finger pan, stylus pressure
- **Zero dependencies** — vanilla TypeScript, no framework required
- **Tree-shakeable** — ESM + CJS output

## Install

```bash
npm install @fieldnotes/core
```

## Quick Start

```typescript
import {
  Viewport,
  HandTool,
  SelectTool,
  PencilTool,
  EraserTool,
  ArrowTool,
  NoteTool,
} from '@fieldnotes/core';

// Mount on any container element
const viewport = new Viewport(document.getElementById('canvas'), {
  background: { pattern: 'dots', spacing: 24 },
});

// Register tools
viewport.toolManager.register(new HandTool());
viewport.toolManager.register(new SelectTool());
viewport.toolManager.register(new PencilTool({ color: '#1a1a1a', width: 2 }));
viewport.toolManager.register(new EraserTool());
viewport.toolManager.register(new ArrowTool({ color: '#1a1a1a', width: 2 }));
viewport.toolManager.register(new NoteTool());

// Activate a tool
viewport.toolManager.setTool('select', viewport.toolContext);

// Clean up when done
viewport.destroy();
```

Your container element needs a defined size (width/height). The canvas fills its container.

## Embedding HTML Elements

The main differentiator — embed any DOM node as a fully interactive canvas element:

```typescript
const card = document.createElement('div');
card.innerHTML = '<h3>My Card</h3><button>Click me</button>';

// Buttons, inputs, links — everything works
card.querySelector('button').addEventListener('click', () => {
  console.log('Clicked inside the canvas!');
});

const elementId = viewport.addHtmlElement(card, { x: 100, y: 200 }, { w: 250, h: 150 });
```

HTML elements pan, zoom, and resize with the canvas. They use a **two-mode interaction model**:

- **Default** — the element can be selected, dragged, and resized like any other element
- **Double-click** — enters interact mode, making buttons, inputs, and links work
- **Escape** or **click outside** — exits interact mode

You can also exit interact mode programmatically:

```typescript
viewport.stopInteracting();
```

## Adding Images

```typescript
// Programmatic
viewport.addImage('https://example.com/photo.jpg', { x: 0, y: 0 });
viewport.addImage('/assets/map.png', { x: 0, y: 0 }, { w: 800, h: 600 });

// Drag & drop is handled automatically — drop images onto the canvas
```

> **Important: Use URLs, not base64 data URLs.** Images are stored inline in the serialized state. A single base64-encoded photo can be 2-5MB, which will blow past the `localStorage` ~5MB quota and make JSON exports impractical. Upload images to your server or CDN and use the URL. For offline/local-first apps, store blobs in IndexedDB and reference them by URL.

## Grids

Add square or hex grid overlays — useful for D&D combat maps, alignment, or graph paper backgrounds. Grids always render on top of images and other layer elements.

```typescript
// Add a hex grid
viewport.addGrid({
  gridType: 'hex',
  hexOrientation: 'pointy', // 'pointy' | 'flat'
  cellSize: 40,
  strokeColor: '#cccccc',
  strokeWidth: 1,
  opacity: 0.5,
});

// Update grid properties
viewport.updateGrid({ cellSize: 50, strokeColor: '#aaaaaa' });

// Remove grid
viewport.removeGrid();
```

## Image Export

Export the canvas as a PNG image:

```typescript
const blob = await viewport.exportImage({
  scale: 2, // pixel density (default 2)
  padding: 20, // world-space padding around content (default 0)
  background: '#fff', // fill color (default '#ffffff')
  filter: (el) => el.type !== 'html', // optional per-element filter
});
```

HTML elements are excluded from image exports (DOM cannot be rasterized to canvas). Cross-origin images are handled automatically via CORS cache-busting.

## Performance Monitoring

```typescript
// Get a snapshot of render stats
const stats = viewport.getRenderStats();
// { fps, avgFrameMs, p95FrameMs, lastGridMs, frameCount }

// Log stats to console every 2 seconds (returns stop function)
const stop = viewport.logPerformance(2000);
// [FieldNotes] fps=60 frame=1.2ms p95=2.1ms grid=0.1ms
stop(); // stop logging
```

## Camera Control

```typescript
const { camera } = viewport;

camera.pan(100, 50); // pan by offset
camera.moveTo(0, 0); // jump to position
camera.setZoom(2); // set zoom level
camera.zoomAt(1.5, { x: 400, y: 300 }); // zoom toward screen point

const world = camera.screenToWorld({ x: e.clientX, y: e.clientY });
const screen = camera.worldToScreen({ x: 0, y: 0 });

camera.onChange(() => {
  /* camera moved */
});
```

## Element Store

Direct access to canvas elements:

```typescript
const { store } = viewport;

const all = store.getAll(); // sorted by zIndex
const el = store.getById('some-id');
const strokes = store.getElementsByType('stroke');

store.update('some-id', { locked: true });
store.remove('some-id');

store.on('add', (el) => console.log('added', el));
store.on('remove', (el) => console.log('removed', el));
store.on('update', ({ previous, current }) => {
  /* ... */
});
```

## Undo / Redo

```typescript
viewport.undo();
viewport.redo();

viewport.history.canUndo; // boolean
viewport.history.canRedo; // boolean
viewport.history.onChange(() => {
  /* update UI */
});
```

## Layers

Organize elements into named layers with visibility, lock, and ordering controls. All elements on a higher layer render above all elements on a lower layer, regardless of individual z-index.

```typescript
const { layerManager } = viewport;

// Create layers
const background = layerManager.activeLayer; // "Layer 1" exists by default
layerManager.renameLayer(background.id, 'Map');
const tokens = layerManager.createLayer('Tokens');
const notes = layerManager.createLayer('Notes');

// Set active layer — new elements are created on the active layer
layerManager.setActiveLayer(tokens.id);

// Visibility and locking
layerManager.setLayerVisible(background.id, false); // hide
layerManager.setLayerLocked(background.id, true); // prevent selection/editing

// Move elements between layers
layerManager.moveElementToLayer(elementId, notes.id);

// Reorder layers
layerManager.reorderLayer(tokens.id, 5); // higher order = renders on top

// Query
layerManager.getLayers(); // sorted by order
layerManager.isLayerVisible(id);
layerManager.isLayerLocked(id);

// Listen for changes
layerManager.on('change', () => {
  /* update UI */
});
```

Locked layers prevent selection, erasing, and arrow binding on their elements. Hidden layers are invisible and non-interactive. The active layer cannot be hidden or locked — if you try, it automatically switches to the next available layer.

## State Serialization

```typescript
// Save
const json = viewport.exportJSON();
localStorage.setItem('canvas', json);

// Load
viewport.loadJSON(localStorage.getItem('canvas'));
```

> **Note:** Serialized state includes all layers and element `layerId` assignments. States saved before layers were introduced are automatically migrated — elements are placed on a default "Layer 1".

## Tool Switching

```typescript
viewport.toolManager.setTool('pencil', viewport.toolContext);
viewport.toolManager.setTool('hand', viewport.toolContext);

viewport.toolManager.onChange((toolName) => {
  console.log('switched to', toolName);
});
```

## Changing Tool Options at Runtime

All drawing tools support `setOptions()` for changing color, width, and other settings without re-creating the tool:

```typescript
// Get a tool by name (type-safe with generics)
const pencil = viewport.toolManager.getTool<PencilTool>('pencil');
const arrow = viewport.toolManager.getTool<ArrowTool>('arrow');
const note = viewport.toolManager.getTool<NoteTool>('note');

// Change colors
pencil?.setOptions({ color: '#ff0000' });
arrow?.setOptions({ color: '#ff0000' });
note?.setOptions({ backgroundColor: '#e8f5e9' });

// Change stroke width
pencil?.setOptions({ width: 5 });
arrow?.setOptions({ width: 3 });
```

### Stroke Smoothing

The pencil tool automatically smooths freehand strokes using Ramer-Douglas-Peucker point simplification and Catmull-Rom curve fitting. You can control the smoothing tolerance:

```typescript
new PencilTool({
  smoothing: 1.5, // default — higher = smoother, lower = more detail
});

// Or at runtime
pencil?.setOptions({ smoothing: 3 });
```

### Pressure-Sensitive Width

When using a stylus (Apple Pencil, Surface Pen), stroke width varies based on pressure automatically. The `width` option sets the **maximum** width at full pressure. Mouse input uses a default pressure of 0.5 for consistent-width strokes.

Stroke points include pressure data in the `StrokePoint` type:

```typescript
interface StrokePoint {
  x: number;
  y: number;
  pressure: number; // 0-1
}
```

## Custom Tools

Implement the `Tool` interface to create your own tools:

```typescript
import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';

const myTool: Tool = {
  name: 'my-tool',

  onPointerDown(state: PointerState, ctx: ToolContext) {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    // state.pressure is available for stylus input (0-1)
  },

  onPointerMove(state: PointerState, ctx: ToolContext) {
    // called during drag
  },

  onPointerUp(state: PointerState, ctx: ToolContext) {
    // finalize action
    ctx.store.add(myElement);
    ctx.requestRender();
  },

  // Optional
  onActivate(ctx) {
    ctx.setCursor?.('crosshair');
  },
  onDeactivate(ctx) {
    ctx.setCursor?.('default');
  },
  renderOverlay(canvasCtx) {
    /* draw preview on canvas */
  },
};

viewport.toolManager.register(myTool);
viewport.toolManager.setTool('my-tool', viewport.toolContext);
```

## Configuration

### Viewport Options

```typescript
new Viewport(container, {
  camera: {
    minZoom: 0.1, // default: 0.1
    maxZoom: 10, // default: 10
  },
  background: {
    pattern: 'dots', // 'dots' | 'grid' | 'none' (default: 'dots')
    spacing: 24, // grid spacing in px (default: 24)
    color: '#d0d0d0', // dot/line color (default: '#d0d0d0')
  },
});
```

### Tool Options

```typescript
new PencilTool({ color: '#ff0000', width: 3, smoothing: 1.5 });
new EraserTool({ radius: 30 });
new ArrowTool({ color: '#333', width: 2 });
new NoteTool({ backgroundColor: '#fff9c4', size: { w: 200, h: 150 } });
new ImageTool({ size: { w: 400, h: 300 } });
```

## Element Types

All elements share a base shape:

```typescript
interface BaseElement {
  id: string;
  type: string;
  position: { x: number; y: number };
  zIndex: number;
  locked: boolean;
  layerId: string;
}
```

| Type     | Key Fields                                                                             |
| -------- | -------------------------------------------------------------------------------------- |
| `stroke` | `points: StrokePoint[]`, `color`, `width`, `opacity`                                   |
| `note`   | `size`, `text`, `backgroundColor`, `textColor`                                         |
| `arrow`  | `from`, `to`, `bend`, `color`, `width`, `fromBinding`, `toBinding`                     |
| `image`  | `size`, `src`                                                                          |
| `shape`  | `size`, `shape` (`rectangle` \| `ellipse`), `strokeColor`, `fillColor`                 |
| `text`   | `size`, `text`, `fontSize`, `color`, `textAlign`                                       |
| `grid`   | `gridType` (`square` \| `hex`), `hexOrientation`, `cellSize`, `strokeColor`, `opacity` |
| `html`   | `size`                                                                                 |

## Built-in Interactions

| Input                | Action              |
| -------------------- | ------------------- |
| Scroll wheel         | Zoom                |
| Middle-click drag    | Pan                 |
| Space + drag         | Pan                 |
| Two-finger pinch     | Zoom                |
| Two-finger drag      | Pan                 |
| Delete / Backspace   | Remove selected     |
| Ctrl+Z / Cmd+Z       | Undo                |
| Ctrl+Shift+Z / Cmd+Y | Redo                |
| Double-click note    | Edit text           |
| Double-click HTML    | Enter interact mode |
| Escape               | Exit interact mode  |

## Browser Support

Works in all modern browsers supporting Pointer Events API and HTML5 Canvas.

## License

MIT
