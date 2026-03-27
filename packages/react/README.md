# @fieldnotes/react

React bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Embed React components directly onto an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/react
```

Requires React 18+.

## Quick Start

```tsx
import { FieldNotesCanvas } from '@fieldnotes/react';
import { HandTool, SelectTool, PencilTool } from '@fieldnotes/core';

function App() {
  return (
    <FieldNotesCanvas
      tools={[new HandTool(), new SelectTool(), new PencilTool()]}
      defaultTool="select"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
```

Your container needs a defined size — the canvas fills it.

## Embedding React Components

The main feature — render any React component as a canvas element that pans, zooms, and resizes with the canvas:

```tsx
import { FieldNotesCanvas, CanvasElement } from '@fieldnotes/react';
import { SelectTool } from '@fieldnotes/core';

function App() {
  return (
    <FieldNotesCanvas
      tools={[new SelectTool()]}
      defaultTool="select"
      style={{ width: '100vw', height: '100vh' }}
    >
      <CanvasElement position={{ x: 100, y: 200 }} size={{ w: 300, h: 200 }}>
        <MyCard />
      </CanvasElement>

      <CanvasElement position={{ x: 500, y: 100 }}>
        <button onClick={() => console.log('clicked!')}>Interactive button on the canvas</button>
      </CanvasElement>
    </FieldNotesCanvas>
  );
}
```

Embedded components use a **two-mode interaction model**: by default they can be selected, dragged, and resized. **Double-click** to enter interact mode (clicks, inputs, forms work). **Escape** or click outside to exit.

## Hooks

All hooks must be used inside `<FieldNotesCanvas>`.

### `useActiveTool()`

Reactive tool name + setter — re-renders when the active tool changes:

```tsx
import { useActiveTool } from '@fieldnotes/react';

function Toolbar() {
  const [tool, setTool] = useActiveTool();

  return (
    <div>
      <span>Current: {tool}</span>
      <button onClick={() => setTool('pencil')}>Pencil</button>
      <button onClick={() => setTool('select')}>Select</button>
    </div>
  );
}
```

### `useToolOptions(toolName)`

Reactive tool options with two-way sync — read and write tool configuration:

```tsx
import { useActiveTool, useToolOptions } from '@fieldnotes/react';
import type { PencilToolOptions } from '@fieldnotes/core';

function PencilSettings() {
  const [tool, setTool] = useActiveTool();
  const [opts, setOpts] = useToolOptions<PencilToolOptions>('pencil');

  return (
    <div>
      <button onClick={() => setTool('pencil')}>Pencil</button>
      {tool === 'pencil' && opts && (
        <>
          <input
            type="color"
            value={opts.color}
            onChange={(e) => setOpts({ color: e.target.value })}
          />
          <input
            type="range"
            min={1}
            max={20}
            value={opts.width}
            onChange={(e) => setOpts({ width: Number(e.target.value) })}
          />
        </>
      )}
    </div>
  );
}
```

Returns `[null, noop]` for tools that don't support options (e.g., `HandTool`).

### `useLayers()`

Full layer management — reactive layer list with action callbacks:

```tsx
import { useLayers } from '@fieldnotes/react';

function LayersPanel() {
  const {
    layers,
    activeLayerId,
    createLayer,
    removeLayer,
    setVisible,
    setLocked,
    setOpacity,
    setActiveLayer,
  } = useLayers();

  return (
    <div>
      <button onClick={() => createLayer()}>Add Layer</button>
      {layers.map((layer) => (
        <div key={layer.id} onClick={() => setActiveLayer(layer.id)}>
          <span>
            {layer.name} {layer.id === activeLayerId ? '(active)' : ''}
          </span>
          <button onClick={() => setVisible(layer.id, !layer.visible)}>
            {layer.visible ? 'Hide' : 'Show'}
          </button>
          <button onClick={() => setLocked(layer.id, !layer.locked)}>
            {layer.locked ? 'Unlock' : 'Lock'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={layer.opacity}
            onChange={(e) => setOpacity(layer.id, Number(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
}
```

Also exposes: `renameLayer`, `reorderLayer`, `moveElement`.

### `useHistory()`

Reactive undo/redo state:

```tsx
import { useHistory } from '@fieldnotes/react';

function UndoRedo() {
  const { canUndo, canRedo, undo, redo } = useHistory();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>
        Undo
      </button>
      <button onClick={redo} disabled={!canRedo}>
        Redo
      </button>
    </div>
  );
}
```

### `useElements(type?)`

Reactive element list — re-renders when elements are added, removed, or updated:

```tsx
import { useElements } from '@fieldnotes/react';

function ElementCount() {
  const elements = useElements();
  const notes = useElements('note');

  return (
    <span>
      {notes.length} notes / {elements.length} total
    </span>
  );
}
```

Pass an element type (`'note'`, `'stroke'`, `'arrow'`, etc.) to filter.

### `useCamera()`

Reactive camera state (position + zoom) — re-renders on pan/zoom:

```tsx
import { useCamera } from '@fieldnotes/react';

function CameraInfo() {
  const { x, y, zoom } = useCamera();

  return (
    <span>
      {zoom.toFixed(2)}x at ({x.toFixed(0)}, {y.toFixed(0)})
    </span>
  );
}
```

### `useViewport()`

Access the core `Viewport` instance for imperative operations not covered by the hooks above:

```tsx
import { useViewport } from '@fieldnotes/react';

function ExportButton() {
  const viewport = useViewport();

  return <button onClick={() => viewport.exportImage()}>Export PNG</button>;
}
```

## Component API

### `<FieldNotesCanvas>`

| Prop          | Type                           | Description                             |
| ------------- | ------------------------------ | --------------------------------------- |
| `options`     | `ViewportOptions`              | Camera and background config            |
| `tools`       | `Tool[]`                       | Tools to register on mount              |
| `defaultTool` | `string`                       | Tool to activate on mount               |
| `className`   | `string`                       | CSS class for the container div         |
| `style`       | `CSSProperties`                | Inline styles for the container div     |
| `onReady`     | `(viewport: Viewport) => void` | Called after Viewport is created        |
| `children`    | `ReactNode`                    | Child components (have access to hooks) |
| `ref`         | `Ref<FieldNotesCanvasRef>`     | Exposes `{ viewport }`                  |

### `<CanvasElement>`

| Prop       | Type                       | Default              | Description                        |
| ---------- | -------------------------- | -------------------- | ---------------------------------- |
| `position` | `{ x: number; y: number }` | required             | World-space position               |
| `size`     | `{ w: number; h: number }` | `{ w: 200, h: 150 }` | Element size in world-space pixels |
| `children` | `ReactNode`                | required             | React content to render on canvas  |

Position and size updates are reactive — change the props and the element moves/resizes on the canvas.

## Accessing the Viewport Directly

For advanced use cases, use a ref:

```tsx
import { useRef } from 'react';
import { FieldNotesCanvas, type FieldNotesCanvasRef } from '@fieldnotes/react';

function App() {
  const canvasRef = useRef<FieldNotesCanvasRef>(null);

  const exportState = () => {
    const json = canvasRef.current?.viewport?.exportJSON();
    console.log(json);
  };

  return (
    <>
      <FieldNotesCanvas ref={canvasRef} style={{ width: '100vw', height: '100vh' }} />
      <button onClick={exportState}>Export</button>
    </>
  );
}
```

## License

MIT
