# @fieldnotes/core

A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding interactive HTML elements.

## Features

- **Infinite canvas** — pan, zoom, pinch-to-zoom
- **Freehand drawing** — pencil tool with pressure support (Apple Pencil, Surface Pen)
- **Sticky notes** — editable text notes with customizable colors
- **Arrows** — curved bezier arrows with draggable control points
- **Images** — drag & drop or programmatic placement
- **HTML embedding** — add any DOM element as a fully interactive canvas citizen
- **Select & multi-select** — click, drag box, move, resize
- **Undo / redo** — full history stack with configurable depth
- **State serialization** — export/import JSON snapshots
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

HTML elements pan, zoom, and resize with the canvas while remaining fully interactive.

## Adding Images

```typescript
// Programmatic
viewport.addImage('https://example.com/photo.jpg', { x: 0, y: 0 });

// Drag & drop is handled automatically — drop images onto the canvas
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

## State Serialization

```typescript
// Save
const json = viewport.exportJSON();
localStorage.setItem('canvas', json);

// Load
viewport.loadJSON(localStorage.getItem('canvas'));
```

## Tool Switching

```typescript
viewport.toolManager.setTool('pencil', viewport.toolContext);
viewport.toolManager.setTool('hand', viewport.toolContext);

viewport.toolManager.onChange((toolName) => {
  console.log('switched to', toolName);
});
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
new PencilTool({ color: '#ff0000', width: 3 });
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
}
```

| Type     | Key Fields                             |
| -------- | -------------------------------------- |
| `stroke` | `points`, `color`, `width`, `opacity`  |
| `note`   | `size`, `text`, `backgroundColor`      |
| `arrow`  | `from`, `to`, `bend`, `color`, `width` |
| `image`  | `size`, `src`                          |
| `html`   | `size`                                 |

## Built-in Interactions

| Input                | Action          |
| -------------------- | --------------- |
| Scroll wheel         | Zoom            |
| Middle-click drag    | Pan             |
| Space + drag         | Pan             |
| Two-finger pinch     | Zoom            |
| Two-finger drag      | Pan             |
| Delete / Backspace   | Remove selected |
| Ctrl+Z / Cmd+Z       | Undo            |
| Ctrl+Shift+Z / Cmd+Y | Redo            |
| Double-click note    | Edit text       |

## Browser Support

Works in all modern browsers supporting Pointer Events API and HTML5 Canvas.

## License

MIT
