# Parchment Canvas

A lightweight, framework-agnostic infinite canvas SDK for the web — with first-class support for embedding interactive HTML elements.

## Why Parchment?

Existing infinite canvas solutions each have trade-offs:

- **Tldraw** — excellent features, but requires a commercial license
- **Excalidraw** — great drawing tool, but can't embed arbitrary HTML components
- **React Flow** — excellent for node graphs, but not a general-purpose canvas

Parchment fills the gap: an open-source, zero-dependency canvas SDK that treats embedded HTML elements as first-class citizens alongside freehand drawing, shapes, and annotations.

## Packages

| Package                                   | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| [`@parchment-canvas/core`](packages/core) | Vanilla TypeScript canvas engine — zero framework deps |
| `@parchment-canvas/react`                 | React wrapper (coming soon)                            |

## Quick Start

```bash
npm install @parchment-canvas/core
```

```typescript
import { Viewport, SelectTool, PencilTool, HandTool } from '@parchment-canvas/core';

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

See [`@parchment-canvas/core` README](packages/core/README.md) for the full API documentation.

## Features

- Infinite canvas with pan & zoom (scroll, pinch, two-finger drag)
- Freehand drawing with pressure support (Apple Pencil, Surface Pen)
- Sticky notes, curved arrows, images
- Interactive HTML element embedding
- Select, multi-select, move, resize
- Undo / redo
- State serialization (JSON export/import)
- Custom tool API
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
