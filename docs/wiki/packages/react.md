# @fieldnotes/react

**Version:** 0.11.0
**Location:** `packages/react/`
**Description:** React bindings for Field Notes canvas SDK

## Overview

The React package provides **thin React wrappers** over the core canvas engine. It's a pure adapter layer — all logic lives in core.

**Key principle:** React bindings manage lifecycle and provide idiomatic React APIs (hooks, context, components). They don't add features.

## Directory Structure

```
packages/react/src/
├── field-notes-canvas.tsx    # Main canvas component
├── canvas-element.tsx        # Canvas element wrapper
├── minimap.tsx               # Minimap component
├── context.ts                # ViewportContext
├── hooks/                    # React hooks
│   ├── index.ts              # Hook exports
│   ├── use-viewport.ts       # Access viewport
│   ├── use-camera.ts         # Camera state
│   ├── use-elements.ts       # Element list
│   ├── use-selection.ts      # Selection state
│   ├── use-history.ts        # Undo/redo
│   ├── use-layers.ts         # Layer state
│   ├── use-active-tool.ts    # Active tool
│   ├── use-tool-options.ts   # Tool options
│   ├── use-selection-ops.ts  # Selection operations
│   ├── use-selection-style.ts # Selection styling
│   └── use-element-rects.ts  # Element rectangles
└── index.ts                  # Public API exports
```

## Components

### FieldNotesCanvas

Main canvas component. Creates and manages a `Viewport` instance.

```tsx
import { FieldNotesCanvas } from '@fieldnotes/react';

function App() {
  return (
    <FieldNotesCanvas
      options={{ toolbar: true, minimap: true }}
      tools={[new PencilTool(), new EraserTool()]}
      defaultTool="hand"
      onReady={(viewport) => console.log('Ready!', viewport)}
    />
  );
}
```

**Props:**

- `options?: ViewportOptions` — constructor options (ignored after mount)
- `tools?: Tool[]` — tools to register (append-only)
- `defaultTool?: string` — initial tool
- `tool?: string` — controlled active tool
- `onToolChange?: (name: string) => void` — tool change callback
- `snapToGrid?: boolean` — grid snapping
- `onReady?: (viewport: Viewport) => void` — called after mount
- `className?: string` — CSS class
- `style?: CSSProperties` — inline styles
- `children?: ReactNode` — overlay content

**Ref:**

```tsx
const ref = useRef<FieldNotesCanvasRef>(null);
ref.current?.viewport?.undo();
```

### CanvasElement

Wrapper for rendering React components as HTML elements on the canvas.

```tsx
import { CanvasElement } from '@fieldnotes/react';

<CanvasElement elementId={element.id} viewport={viewport}>
  <MyCustomWidget />
</CanvasElement>;
```

### Minimap

Overview minimap with tap/drag-to-navigate.

```tsx
import { Minimap } from '@fieldnotes/react';

<Minimap viewport={viewport} width={200} height={150} />;
```

## Hooks

### useViewport

Access the viewport instance.

```tsx
function MyComponent() {
  const viewport = useViewport();

  const handleUndo = () => viewport?.undo();

  return <button onClick={handleUndo}>Undo</button>;
}
```

### useCamera

Reactive camera state.

```tsx
function CameraInfo() {
  const { zoom, position } = useCamera();

  return (
    <div>
      Zoom: {zoom.toFixed(2)}
      <br />
      Position: ({position.x.toFixed(0)}, {position.y.toFixed(0)})
    </div>
  );
}
```

### useElements

Reactive element list.

```tsx
function ElementCount() {
  const elements = useElements();
  return <div>Elements: {elements.length}</div>;
}
```

### useSelection

Reactive selection state.

```tsx
function SelectionInfo() {
  const { selectedIds, selectedElements } = useSelection();
  return <div>Selected: {selectedIds.length}</div>;
}
```

### useHistory

Undo/redo state and operations.

```tsx
function HistoryControls() {
  const { canUndo, canRedo, undo, redo } = useHistory();

  return (
    <>
      <button onClick={undo} disabled={!canUndo}>
        Undo
      </button>
      <button onClick={redo} disabled={!canRedo}>
        Redo
      </button>
    </>
  );
}
```

### useLayers

Layer state and operations.

```tsx
function LayerPanel() {
  const { layers, activeLayerId, setActiveLayer, toggleVisibility } = useLayers();

  return (
    <ul>
      {layers.map((layer) => (
        <li key={layer.id}>
          <button onClick={() => setActiveLayer(layer.id)}>{layer.name}</button>
          <button onClick={() => toggleVisibility(layer.id)}>{layer.visible ? '👁' : '🚫'}</button>
        </li>
      ))}
    </ul>
  );
}
```

### useActiveTool

Active tool name.

```tsx
function ToolIndicator() {
  const activeTool = useActiveTool();
  return <div>Tool: {activeTool}</div>;
}
```

### useToolOptions

Tool-specific options.

```tsx
function PencilOptions() {
  const [options, setOptions] = useToolOptions('pencil');

  return (
    <input
      type="range"
      value={options.width}
      onChange={(e) => setOptions({ width: Number(e.target.value) })}
    />
  );
}
```

### useSelectionOps

Selection operations (align, distribute, etc.).

```tsx
function SelectionToolbar() {
  const { align, distribute, group, ungroup } = useSelectionOps();

  return (
    <>
      <button onClick={() => align('left')}>Align Left</button>
      <button onClick={() => distribute('horizontal')}>Distribute</button>
      <button onClick={group}>Group</button>
    </>
  );
}
```

### useElementRects

Element rectangle tracking (for overlays, tooltips, etc.).

```tsx
function ElementOverlay() {
  const rects = useElementRects({ elementIds: selectedIds });

  return (
    <>
      {rects.map((rect) => (
        <div
          key={rect.elementId}
          style={{
            position: 'absolute',
            left: rect.rect.x,
            top: rect.rect.y,
            width: rect.rect.w,
            height: rect.rect.h,
          }}
        />
      ))}
    </>
  );
}
```

## Context

### ViewportContext

React context for viewport access. Used internally by hooks.

```tsx
import { ViewportContext } from '@fieldnotes/react';

// Usually you don't need this — use useViewport() instead
const viewport = useContext(ViewportContext);
```

## Lifecycle Management

The React package handles viewport lifecycle automatically:

1. **Mount:** `FieldNotesCanvas` creates a `Viewport` instance
2. **Update:** Props changes update viewport state (tool, snap, etc.)
3. **Unmount:** `viewport.dispose()` is called automatically

**Important:** Don't create viewports manually in React — use `FieldNotesCanvas`.

## Peer Dependencies

- `@fieldnotes/core` >= 0.63.0 < 1.0.0
- `react` >= 18 < 20
- `react-dom` >= 18 < 20

## Testing

```bash
# Run all React tests
pnpm --filter @fieldnotes/react test

# Run specific test
pnpm --filter @fieldnotes/react test -- src/hooks/use-camera.test.tsx
```

**Test environment:** jsdom with `@testing-library/react`.

## Build

```bash
pnpm --filter @fieldnotes/react build
```

**Output:**

- `dist/index.js` — ESM
- `dist/index.cjs` — CommonJS
- `dist/index.d.ts` — TypeScript declarations
