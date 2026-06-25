# @fieldnotes/react

React bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Embed React components directly onto an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/react
```

Requires React 18+.

## Quick Start

Full runnable example: `examples/react-app` — `pnpm --filter fieldnotes-react-example dev`

The canvas needs a container with a defined size — it fills whatever it's given:

```tsx
import { useState } from 'react';
import { FieldNotesCanvas } from '@fieldnotes/react';
import {
  HandTool,
  SelectTool,
  PencilTool,
  EraserTool,
  NoteTool,
  ShapeTool,
} from '@fieldnotes/core';

const TOOLS = [
  new HandTool(),
  new SelectTool(),
  new PencilTool(),
  new EraserTool(),
  new NoteTool(),
  new ShapeTool(),
];

export function App() {
  const [tool, setTool] = useState('select');

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <FieldNotesCanvas
        tools={TOOLS}
        tool={tool}
        onToolChange={setTool}
        style={{ width: '100%', height: '100%' }}
      >
        <Toolbar tool={tool} onSelect={setTool} />
      </FieldNotesCanvas>
    </div>
  );
}

function Toolbar({ tool, onSelect }: { tool: string; onSelect: (name: string) => void }) {
  const TOOL_LABELS: readonly (readonly [string, string])[] = [
    ['select', 'Select'],
    ['hand', 'Hand'],
    ['pencil', 'Pencil'],
    ['eraser', 'Eraser'],
    ['note', 'Note'],
    ['shape', 'Shape'],
  ];

  return (
    <div className="toolbar">
      {TOOL_LABELS.map(([name, label]) => (
        <button key={name} className={tool === name ? 'active' : ''} onClick={() => onSelect(name)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

## Prop Reactivity

Not all props are reactive — the canvas is stateful. Changing a mount-only prop after mount has no effect:

| Prop                               | Reactivity                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `options`                          | Mount-only — the canvas is stateful; construct with the right options               |
| `tools`                            | Reactive, append-only (tools cannot be unregistered). Hoist the array out of render |
| `tool` / `onToolChange`            | Reactive (controlled). Memoize the callback                                         |
| `defaultTool`                      | Mount-only (uncontrolled initial tool)                                              |
| `snapToGrid`                       | Reactive                                                                            |
| `className` / `style` / `children` | Reactive (plain React)                                                              |

Runtime changes beyond these go through the viewport — access it via `useViewport()` or the ref: `viewport.setSnapToGrid(...)`, `viewport.shortcuts.rebind(...)`, `viewport.fitToContent()`. The background pattern is constructor-only (`options.background`).

## Embedding React Components

The headline feature — render any React subtree as a canvas element that pans, zooms, and resizes with the canvas:

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

`position` is required; `size` is optional — omit it to let the element size to its content. Both props are reactive: updating them moves or resizes the element on the canvas.

## Undo / Redo

`useHistory` returns reactive undo/redo state and action callbacks:

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

## Why Is My Sidebar Re-rendering 60×/s?

`useElements()` with no arguments re-renders on every store mutation. For derived values, pass a selector — the hook only re-renders when the selected value changes:

```tsx
import { useCallback } from 'react';
import { useElements } from '@fieldnotes/react';
import type { CanvasElement } from '@fieldnotes/core';

export function Sidebar() {
  // Stable selector: useCallback with [] dependency or module-scope function
  const count = useElements(useCallback((els: CanvasElement[]) => els.length, []));
  const notes = useElements('note');

  return (
    <div className="sidebar">
      <p>{count} elements</p>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.text ? n.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)'}</li>
        ))}
      </ul>
    </div>
  );
}
```

Alternatively, hoist expensive rendering into a memoized child and pass elements as props — React's `memo` then does the comparison.

**Default comparator is one-level shallow**: arrays are compared by index, plain objects by key, primitives by `Object.is`. Selectors returning nested fresh objects (e.g. `els => els.map(e => ({ ...e.position }))`) still cause re-renders with the default comparator — pass a custom `isEqual` as the second argument:

```tsx
const positions = useElements(
  useCallback((els: CanvasElement[]) => els.map((e) => e.position), []),
  (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y),
);
```

## Selection & Styling

### `useSelection`

Returns the current selection as a reactive, referentially-stable `string[]` of element IDs. Re-renders only when the selection changes.

```tsx
import { useSelection } from '@fieldnotes/react';

function SelectionBadge() {
  const ids = useSelection();
  return <span>{ids.length} selected</span>;
}
```

### `useSelectionStyle`

Returns `[style, applyStyle]` — the shared style of the current selection and a stable callback to apply a style patch to it.

- `style` is an `ElementStyle` (`{ color?, fillColor?, strokeWidth?, opacity?, fontSize? }`) containing only properties that are identical across all selected elements. Properties that differ are omitted. `style` is `null` when nothing is selected.
- `applyStyle(patch)` applies the patch to the current selection in a single undo step.

```tsx
import { useSelectionStyle } from '@fieldnotes/react';

function StyleToolbar() {
  const [style, applyStyle] = useSelectionStyle();

  return (
    <div>
      <input
        type="color"
        value={style?.color ?? '#000000'}
        disabled={!style}
        onChange={(e) => applyStyle({ color: e.target.value })}
      />
      <input
        type="range"
        min={1}
        max={20}
        value={style?.strokeWidth ?? 2}
        disabled={!style}
        onChange={(e) => applyStyle({ strokeWidth: Number(e.target.value) })}
      />
    </div>
  );
}
```

### `useSelectionOps`

Returns reactive selection state plus group/ungroup/lock/align/distribute actions for the core selection operations. Re-renders only when the selection (or its derived predicates) changes.

- State: `selectedIds`, `selectedCount`, `canGroup`, `canUngroup`, `canAlign`, `canDistribute`, and `isLocked` (`true`/`false` when the selection is uniformly locked/unlocked, `null` when empty or mixed).
- Actions: `group()`, `ungroup()`, `toggleLock()`, `align(edge)`, `distribute(axis)` — each runs in a single undo step. Requires core `>=0.36.0`.

```tsx
import { useSelectionOps } from '@fieldnotes/react';

function SelectionToolbar() {
  const { selectedCount, canGroup, canUngroup, isLocked, group, ungroup, toggleLock, align, distribute } = useSelectionOps();

  return (
    <div>
      <button disabled={!canGroup} onClick={group}>Group</button>
      <button disabled={!canUngroup} onClick={ungroup}>Ungroup</button>
      <button disabled={selectedCount === 0} onClick={toggleLock}>{isLocked ? 'Unlock' : 'Lock'}</button>
      <button onClick={() => align('left')}>Align left</button>
      <button onClick={() => distribute('horizontal')}>Distribute</button>
    </div>
  );
}
```

See [core README](../core/README.md#styling-the-selection) for the full `ElementStyle` mapping table and the underlying `Viewport` methods.

## Save / Load

Access the viewport imperatively for export and import:

```tsx
import { useViewport } from '@fieldnotes/react';

export function SaveControls() {
  const viewport = useViewport();

  const save = () => {
    localStorage.setItem('fieldnotes-example', viewport.exportJSON());
  };
  const load = () => {
    const json = localStorage.getItem('fieldnotes-example');
    if (json) viewport.loadJSON(json);
  };

  return (
    <div>
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
    </div>
  );
}
```

For periodic auto-saving, use `AutoSave` from `@fieldnotes/core` — it debounces writes to `localStorage` and subscribes to the store and camera automatically:

```tsx
import { AutoSave } from '@fieldnotes/core';

// in onReady or a useEffect after useViewport():
const autoSave = new AutoSave(viewport.store, viewport.camera, {
  key: 'my-board',
  layerManager: viewport.layerManager,
});
autoSave.start();
// call autoSave.stop() on cleanup
```

Pass `layerManager` — without it, saved boards lose their layer structure.

## Custom Tools

Implement the `Tool` interface from `@fieldnotes/core` and register it via the `tools` prop. Hoist the array so instances are not recreated on every render:

```tsx
import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';
import { createNote } from '@fieldnotes/core';

export class StampTool implements Tool {
  readonly name = 'stamp';

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.store.add(
      createNote({
        position: { x: world.x - 50, y: world.y - 25 },
        size: { w: 100, h: 50 },
        text: 'stamp',
        layerId: ctx.activeLayerId ?? '',
      }),
    );
    ctx.requestRender();
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {}
  onPointerUp(_state: PointerState, _ctx: ToolContext): void {}
}
```

Register alongside the built-in tools:

```tsx
import { HandTool, SelectTool } from '@fieldnotes/core';
import { StampTool } from './StampTool';

// Hoisted — stable reference across renders
const TOOLS = [new HandTool(), new SelectTool(), new StampTool()];

function App() {
  const [tool, setTool] = useState('select');
  return (
    <FieldNotesCanvas tools={TOOLS} tool={tool} onToolChange={setTool} style={...}>
      <Toolbar tool={tool} onSelect={setTool} />
    </FieldNotesCanvas>
  );
}
```

## Events

### `onReady`

Fires once after the `Viewport` is created and tools are registered. Use it for imperative setup that can't wait for a child hook:

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  onReady={(viewport) => {
    const saved = localStorage.getItem('board');
    if (saved) viewport.loadJSON(saved);
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

### `onToolChange`

Fires whenever the active tool changes — from the keyboard, the API, or the controlled `tool` prop. Pair with `useState` and memoize with `useCallback` when the function body is non-trivial:

```tsx
const [tool, setTool] = useState('select');

<FieldNotesCanvas tool={tool} onToolChange={setTool} tools={TOOLS} style={...} />
```

### `options.onImageError`

Called when an image element fails to load. Receives `{ src: string; elementIds: string[] }` — the source URL and all element IDs that reference it:

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  options={{
    onImageError: ({ src, elementIds }) => {
      console.warn(`Image failed: ${src}`, elementIds);
    },
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

### `options.onDrop`

Fires for **every** drop event on the canvas surface. Providing this callback replaces the built-in image-drop handling entirely — if you want images to work, handle them yourself. Receives the original `DragEvent` and the world-space drop position:

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  options={{
    onDrop: (event, worldPosition) => {
      const url = event.dataTransfer?.getData('text/uri-list');
      if (url) {
        // add your own image element at worldPosition
      }
    },
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

## Escape Hatch

`useViewport()` returns the raw `Viewport` instance for anything not covered by the hooks above. A `ref` on `<FieldNotesCanvas>` gives the same access outside of child components:

```tsx
import { useRef } from 'react';
import { FieldNotesCanvas, type FieldNotesCanvasRef } from '@fieldnotes/react';

function App() {
  const canvasRef = useRef<FieldNotesCanvasRef>(null);

  return (
    <>
      <FieldNotesCanvas ref={canvasRef} style={{ width: '100vw', height: '100vh' }} />
      <button onClick={() => canvasRef.current?.viewport?.fitToContent()}>Fit to content</button>
    </>
  );
}
```

See the [core README](../core/README.md) for the full `Viewport` API — `exportJSON`/`loadJSON`, `fitToContent`, `shortcuts.rebind`, `setSnapToGrid`, and more.

## Versioning

`@fieldnotes/core` and `@fieldnotes/react` are versioned independently. The react
package's `peerDependencies` declare the compatible core range. Pre-1.0, minor
versions may contain breaking changes. The core peer range is bounded at the next major rather than per-minor; if a core minor
ever breaks the wrapper, a coordinated react release raises the lower bound.

## License

MIT
