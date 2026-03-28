# Field Notes

A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding interactive HTML elements.

## Why Field Notes?

Existing infinite canvas solutions each have trade-offs:

- **Tldraw** — excellent features, but requires a commercial license
- **Excalidraw** — great drawing tool, but can't embed arbitrary HTML components
- **React Flow** — excellent for node graphs, but not a general-purpose canvas

Field Notes fills the gap: an open-source, zero-dependency canvas SDK that treats embedded HTML elements as first-class citizens alongside freehand drawing, shapes, and annotations.

## Packages

| Package                               | Description                                            |
| ------------------------------------- | ------------------------------------------------------ |
| [`@fieldnotes/core`](packages/core)   | Vanilla TypeScript canvas engine — zero framework deps |
| [`@fieldnotes/react`](packages/react) | React bindings — components, hooks, portal embedding   |

## Quick Start

```bash
npm install @fieldnotes/core
```

```typescript
import { Viewport, SelectTool, PencilTool, HandTool } from '@fieldnotes/core';

const viewport = new Viewport(document.getElementById('canvas'), {
  background: { pattern: 'dots' },
});

viewport.toolManager.register(new SelectTool());
viewport.toolManager.register(new PencilTool({ color: '#1a1a1a', width: 2 }));
viewport.toolManager.register(new HandTool());
viewport.toolManager.setTool('select', viewport.toolContext);
```

### Embed Interactive HTML

```typescript
const widget = document.createElement('div');
widget.innerHTML = '<h3>Interactive Card</h3>';

const button = document.createElement('button');
button.textContent = 'Click me';
button.addEventListener('click', () => console.log('It works!'));
widget.appendChild(button);

viewport.addHtmlElement(widget, { x: 100, y: 200 });
```

See [`@fieldnotes/core` README](packages/core/README.md) for the full API documentation.

### React

```bash
npm install @fieldnotes/core @fieldnotes/react
```

```tsx
import { FieldNotesCanvas, CanvasElement, useCamera } from '@fieldnotes/react';
import { SelectTool, PencilTool, HandTool } from '@fieldnotes/core';

function App() {
  return (
    <FieldNotesCanvas
      tools={[new SelectTool(), new PencilTool(), new HandTool()]}
      defaultTool="select"
      style={{ width: '100vw', height: '100vh' }}
    >
      <CanvasElement position={{ x: 100, y: 200 }} size={{ w: 300, h: 200 }}>
        <MyReactComponent />
      </CanvasElement>
      <CameraInfo />
    </FieldNotesCanvas>
  );
}

function CameraInfo() {
  const { x, y, zoom } = useCamera();
  return (
    <div>
      {zoom.toFixed(2)}x at ({x.toFixed(0)}, {y.toFixed(0)})
    </div>
  );
}
```

Embedded React components are fully interactive and pan/zoom with the canvas. See [`@fieldnotes/react` README](packages/react/README.md) for the full API.

## Features

- Infinite canvas with pan & zoom (scroll, pinch, two-finger drag)
- Freehand drawing with stroke smoothing and pressure-sensitive width
- Sticky notes, curved arrows, images, shapes (rectangle, ellipse)
- Square and hex grid overlays (D&D combat maps, alignment)
- Interactive HTML element embedding (double-click to interact)
- Layers with visibility, locking, ordering, and per-layer opacity
- Select, multi-select, move, resize
- Runtime tool configuration (color, width, smoothing)
- Undo / redo
- State serialization (JSON export/import)
- PNG export with scale, padding, and background options
- AutoSave (debounced localStorage persistence)
- Custom tool API
- Performance instrumentation (`getRenderStats()`, `logPerformance()`)
- Touch & tablet native (Pointer Events API)
- Zero dependencies, tree-shakeable ESM + CJS

## Development

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm test             # run all tests
pnpm dev              # start demo dev server (from demo/)
```

## Architecture

Hybrid rendering: Canvas API for strokes/shapes/arrows, DOM for notes/images/HTML embeds. A shared camera system keeps both layers in sync. See [PROJECT.md](PROJECT.md) for full architecture details.

## License

MIT
