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

Embedded React components are fully interactive — clicks, inputs, forms all work normally.

## Hooks

### `useViewport()`

Access the core `Viewport` instance for imperative operations:

```tsx
import { useViewport } from '@fieldnotes/react';

function Toolbar() {
  const viewport = useViewport();

  return <button onClick={() => viewport.undo()}>Undo</button>;
}
```

Must be used inside `<FieldNotesCanvas>`.

### `useActiveTool()`

Reactive current tool name — re-renders when the tool changes:

```tsx
import { useActiveTool, useViewport } from '@fieldnotes/react';

function ToolIndicator() {
  const tool = useActiveTool();
  const viewport = useViewport();

  return (
    <div>
      <span>Current: {tool}</span>
      <button onClick={() => viewport.toolManager.setTool('pencil', viewport.toolContext)}>
        Pencil
      </button>
    </div>
  );
}
```

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
