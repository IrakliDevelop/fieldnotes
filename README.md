# Field Notes

A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding interactive HTML elements.

## Why Field Notes?

**tldraw — the leading canvas SDK — now requires a commercial license.** Field Notes is MIT-licensed, framework-agnostic, and treats embedded HTML elements as first-class citizens alongside freehand drawing, shapes, and annotations. It's the open canvas SDK you can actually ship on.

How it compares to the alternatives:

- **tldraw** — excellent features, but the SDK is now commercially licensed
- **Excalidraw** — great drawing tool, but can't embed arbitrary HTML components
- **React Flow** — excellent for node graphs, but not a general-purpose canvas

The `@fieldnotes/core` engine has zero framework dependencies and drops into any stack; the React bindings are a thin optional layer; and real-time collaboration ships as separate, opt-in packages you own end-to-end.

## Packages

| Package                                           | Description                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| [`@fieldnotes/core`](packages/core)               | Vanilla TypeScript canvas engine — zero framework deps               |
| [`@fieldnotes/react`](packages/react)             | React bindings — components, hooks, portal embedding                 |
| [`@fieldnotes/sync`](packages/sync)               | Real-time sync client — observe/apply ops over a pluggable transport |
| [`@fieldnotes/sync-server`](packages/sync-server) | Authoritative WebSocket relay — rooms, auth, write-authorization     |
| [`@fieldnotes/sync-redis`](packages/sync-redis)   | Redis persistence + cross-instance fan-out for the relay             |

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
viewport.setTool('select');
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

### Real-Time Collaboration

Keep multiple canvases in sync across devices. `@fieldnotes/sync` streams element operations over a pluggable transport; `@fieldnotes/sync-server` is an authoritative WebSocket relay that holds canonical per-room state, answers snapshot-on-join, and supports auth and write-authorization.

```typescript
import { Viewport } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport } from '@fieldnotes/sync';

const viewport = new Viewport(document.getElementById('canvas'));

const sync = new SyncClient({
  store: viewport.store,
  transport: new WebSocketTransport('ws://localhost:8080?room=my-room'),
});
sync.start(); // observe local edits, apply remote ones, resync on reconnect
```

```typescript
// the relay (its own process)
import { createSyncServer } from '@fieldnotes/sync-server';

createSyncServer({ port: 8080 });
```

The model is authoritative op-broadcast with last-write-wins (not CRDT). Add [`@fieldnotes/sync-redis`](packages/sync-redis) for restart-survival and cross-instance fan-out. See the [`@fieldnotes/sync-server` README](packages/sync-server/README.md) for auth, write-authorization, and heartbeat/reconnection.

## Features

- Infinite canvas with pan & zoom (scroll, pinch, two-finger drag, pan inertia)
- Freehand drawing with stroke smoothing and pressure-sensitive width
- Sticky notes, text, curved arrows (element-binding, labels), images, shapes (rectangle, ellipse, line)
- Square and hex grid overlays with snapping (D&D combat maps, alignment)
- AoE spell templates (circle / cone / line / square) with hex-cell queries
- Interactive HTML element embedding (custom renderer registry, double-click to interact)
- Real-time collaboration — multi-device sync via an authoritative relay (`@fieldnotes/sync`)
- Layers with visibility, locking, ordering, and per-layer opacity
- Select, multi-select, move, resize, rotate, group / ungroup
- Align, distribute, smart guides, and element-to-element snapping
- Minimap overview, laser pointer, fit-to-content, zoom presets
- Runtime tool configuration (color, width, smoothing)
- Undo / redo (one step per drag)
- State serialization (versioned JSON export/import)
- Pluggable persistence (IndexedDB / localStorage storage adapters)
- PNG and SVG export with scale, padding, and background options
- Custom tool API and HTML renderer registry (public extension points)
- Performance instrumentation (`getRenderStats()`, `logPerformance()`)
- Touch, tablet, and Apple Pencil native (Pointer Events API)
- Core has zero framework dependencies, tree-shakeable ESM + CJS

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
