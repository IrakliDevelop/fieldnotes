# @fieldnotes/react Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin React wrapper (`@fieldnotes/react`) that lets React apps use the Field Notes canvas via components and hooks, with first-class support for embedding React components onto the canvas via portals.

**Architecture:** A `<FieldNotesCanvas>` component manages the `Viewport` lifecycle (create on mount, destroy on unmount). React hooks (`useViewport`, `useActiveTool`, `useCamera`) provide reactive access to canvas state via `useSyncExternalStore`. A `<CanvasElement>` component uses `createPortal` to render React content into DOM nodes managed by the core's HTML embedding system.

**Tech Stack:** React 18+, @fieldnotes/core (workspace dependency), React Portals, `useSyncExternalStore`, Vitest + jsdom for testing

---

## File Structure

| File                              | Responsibility                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `src/context.ts`                  | React context definition for Viewport                                               |
| `src/field-notes-canvas.tsx`      | Main `<FieldNotesCanvas>` component — mounts Viewport, registers tools, exposes ref |
| `src/canvas-element.tsx`          | `<CanvasElement>` — renders React children onto the canvas via portal               |
| `src/use-viewport.ts`             | `useViewport()` hook — access the Viewport instance from context                    |
| `src/use-active-tool.ts`          | `useActiveTool()` hook — reactive tool name via `useSyncExternalStore`              |
| `src/use-camera.ts`               | `useCamera()` hook — reactive camera position/zoom via `useSyncExternalStore`       |
| `src/index.ts`                    | Public API barrel export                                                            |
| `src/field-notes-canvas.test.tsx` | Tests for FieldNotesCanvas                                                          |
| `src/canvas-element.test.tsx`     | Tests for CanvasElement                                                             |
| `src/use-viewport.test.tsx`       | Tests for useViewport hook                                                          |
| `src/use-active-tool.test.tsx`    | Tests for useActiveTool hook                                                        |
| `src/use-camera.test.tsx`         | Tests for useCamera hook                                                            |

---

### Task 0: Install Test Dependencies

**Files:**

- Modify: `packages/react/package.json` (via pnpm add)

- [ ] **Step 1: Add @testing-library/react**

```bash
cd packages/react && pnpm add -D @testing-library/react
```

- [ ] **Step 2: Commit dependency addition**

```bash
git add packages/react/package.json pnpm-lock.yaml
git commit -m "chore(react): add @testing-library/react dev dependency"
```

---

### Task 1: Context

**Files:**

- Create: `packages/react/src/context.ts`

- [ ] **Step 1: Create the context file**

```typescript
// context.ts
import { createContext } from 'react';
import type { Viewport } from '@fieldnotes/core';

export const ViewportContext = createContext<Viewport | null>(null);
```

- [ ] **Step 2: Commit**

```bash
git add packages/react/src/context.ts
git commit -m "feat(react): add viewport context"
```

---

### Task 2: FieldNotesCanvas Component

**Files:**

- Create: `packages/react/src/field-notes-canvas.tsx`
- Test: `packages/react/src/field-notes-canvas.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// field-notes-canvas.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useContext } from 'react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { ViewportContext } from './context';
import { HandTool, SelectTool } from '@fieldnotes/core';

describe('FieldNotesCanvas', () => {
  afterEach(cleanup);

  it('renders a container div', () => {
    const { container } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div).not.toBeNull();
    expect(div.tagName).toBe('DIV');
  });

  it('creates a Viewport with canvas inside the container', () => {
    const { container } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.querySelector('canvas')).not.toBeNull();
  });

  it('provides Viewport via context', () => {
    let contextValue: unknown = 'not-set';
    function Consumer() {
      contextValue = useContext(ViewportContext);
      return null;
    }
    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(contextValue).not.toBeNull();
    expect(contextValue).not.toBe('not-set');
  });

  it('registers tools passed as props', () => {
    const onReady = vi.fn();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onReady={onReady}
      />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    const viewport = onReady.mock.calls[0][0];
    expect(viewport.toolManager.toolNames).toContain('hand');
    expect(viewport.toolManager.toolNames).toContain('select');
  });

  it('cleans up Viewport on unmount', () => {
    const { container, unmount } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.querySelector('canvas')).not.toBeNull();
    unmount();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('applies className and style to container', () => {
    const { container } = render(
      <FieldNotesCanvas className="my-canvas" style={{ border: '1px solid red' }} />,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.classList.contains('my-canvas')).toBe(true);
    expect(div.style.border).toBe('1px solid red');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @fieldnotes/react test -- src/field-notes-canvas.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FieldNotesCanvas**

```tsx
// field-notes-canvas.tsx
import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Viewport } from '@fieldnotes/core';
import type { ViewportOptions, Tool } from '@fieldnotes/core';
import { ViewportContext } from './context';

export interface FieldNotesCanvasProps {
  options?: ViewportOptions;
  tools?: Tool[];
  defaultTool?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onReady?: (viewport: Viewport) => void;
}

export interface FieldNotesCanvasRef {
  viewport: Viewport | null;
}

export const FieldNotesCanvas = forwardRef<FieldNotesCanvasRef, FieldNotesCanvasProps>(
  function FieldNotesCanvas(
    { options, tools, defaultTool, className, style, children, onReady },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<Viewport | null>(null);

    useImperativeHandle(ref, () => ({ viewport }), [viewport]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const vp = new Viewport(el, options);

      if (tools) {
        for (const tool of tools) {
          vp.toolManager.register(tool);
        }
      }

      if (defaultTool) {
        vp.toolManager.setTool(defaultTool, vp.toolContext);
      }

      setViewport(vp);
      onReady?.(vp);

      return () => {
        vp.destroy();
        setViewport(null);
      };
      // Only run on mount/unmount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div ref={containerRef} className={className} style={style}>
        {viewport && (
          <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
        )}
      </div>
    );
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fieldnotes/react test -- src/field-notes-canvas.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/field-notes-canvas.tsx packages/react/src/field-notes-canvas.test.tsx
git commit -m "feat(react): add FieldNotesCanvas component with context provider"
```

---

### Task 3: useViewport Hook

**Files:**

- Create: `packages/react/src/use-viewport.ts`
- Test: `packages/react/src/use-viewport.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// use-viewport.test.tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewport } from './use-viewport';

describe('useViewport', () => {
  it('throws when used outside FieldNotesCanvas', () => {
    expect(() => {
      renderHook(() => useViewport());
    }).toThrow('useViewport must be used inside <FieldNotesCanvas>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fieldnotes/react test -- src/use-viewport.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement useViewport**

```typescript
// use-viewport.ts
import { useContext } from 'react';
import type { Viewport } from '@fieldnotes/core';
import { ViewportContext } from './context';

export function useViewport(): Viewport {
  const viewport = useContext(ViewportContext);
  if (!viewport) {
    throw new Error('useViewport must be used inside <FieldNotesCanvas>');
  }
  return viewport;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fieldnotes/react test -- src/use-viewport.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/use-viewport.ts packages/react/src/use-viewport.test.tsx
git commit -m "feat(react): add useViewport hook"
```

---

### Task 4: useActiveTool Hook

**Files:**

- Create: `packages/react/src/use-active-tool.ts`
- Test: `packages/react/src/use-active-tool.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// use-active-tool.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { useActiveTool } from './use-active-tool';
import { HandTool, SelectTool } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

describe('useActiveTool', () => {
  afterEach(cleanup);

  it('returns the current tool name', () => {
    let toolName = '';
    function Consumer() {
      toolName = useActiveTool();
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool(), new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');
  });

  it('updates when tool changes', () => {
    let toolName = '';
    let vp: Viewport | null = null;
    function Consumer() {
      toolName = useActiveTool();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');

    act(() => {
      vp?.toolManager.setTool('hand', vp.toolContext);
    });
    expect(toolName).toBe('hand');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @fieldnotes/react test -- src/use-active-tool.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement useActiveTool**

Note: `ToolManager.onChange` expects `(name: string) => void` but `useSyncExternalStore` provides `() => void`. We wrap the callback to bridge the type mismatch.

```typescript
// use-active-tool.ts
import { useCallback, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

export function useActiveTool(): string {
  const viewport = useViewport();

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.toolManager.onChange(() => onStoreChange()),
    [viewport],
  );

  const getSnapshot = useCallback(() => viewport.toolManager.activeTool?.name ?? '', [viewport]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fieldnotes/react test -- src/use-active-tool.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/use-active-tool.ts packages/react/src/use-active-tool.test.tsx
git commit -m "feat(react): add useActiveTool hook with useSyncExternalStore"
```

---

### Task 5: useCamera Hook

**Files:**

- Create: `packages/react/src/use-camera.ts`
- Test: `packages/react/src/use-camera.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// use-camera.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { useCamera } from './use-camera';
import type { Viewport } from '@fieldnotes/core';

describe('useCamera', () => {
  afterEach(cleanup);

  it('returns initial camera state', () => {
    let state = { x: -1, y: -1, zoom: -1 };
    function Consumer() {
      state = useCamera();
      return null;
    }
    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.zoom).toBe(1);
  });

  it('updates when camera pans', () => {
    let state = { x: 0, y: 0, zoom: 1 };
    let vp: Viewport | null = null;
    function Consumer() {
      state = useCamera();
      return null;
    }
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      vp?.camera.pan(100, 50);
    });
    expect(state.x).toBe(100);
    expect(state.y).toBe(50);
  });

  it('updates when camera zooms', () => {
    let state = { x: 0, y: 0, zoom: 1 };
    let vp: Viewport | null = null;
    function Consumer() {
      state = useCamera();
      return null;
    }
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      vp?.camera.setZoom(2);
    });
    expect(state.zoom).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @fieldnotes/react test -- src/use-camera.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement useCamera**

We cache the snapshot in a ref and only return a new object when camera values actually change, preventing unnecessary re-renders from `useSyncExternalStore`'s `Object.is` comparison.

```typescript
// use-camera.ts
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function useCamera(): CameraState {
  const viewport = useViewport();
  const cachedRef = useRef<CameraState>({ x: 0, y: 0, zoom: 1 });

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.camera.onChange(onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): CameraState => {
    const { position, zoom } = viewport.camera;
    const cached = cachedRef.current;
    if (cached.x === position.x && cached.y === position.y && cached.zoom === zoom) {
      return cached;
    }
    const next = { x: position.x, y: position.y, zoom };
    cachedRef.current = next;
    return next;
  }, [viewport]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fieldnotes/react test -- src/use-camera.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/use-camera.ts packages/react/src/use-camera.test.tsx
git commit -m "feat(react): add useCamera hook with cached useSyncExternalStore"
```

---

### Task 6: CanvasElement Component (React Portals)

**Files:**

- Create: `packages/react/src/canvas-element.tsx`
- Test: `packages/react/src/canvas-element.test.tsx`

This is the key differentiator — embedding React components onto the infinite canvas via portals.

**How it works:**

1. On mount, `<CanvasElement>` calls `viewport.addHtmlElement()` with a container div
2. It renders children into that container via `createPortal`
3. On unmount, it removes the element from the store
4. A second effect syncs position/size prop changes via `store.update()`

- [ ] **Step 1: Write the failing tests**

```tsx
// canvas-element.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { CanvasElement } from './canvas-element';
import type { Viewport } from '@fieldnotes/core';

describe('CanvasElement', () => {
  afterEach(cleanup);

  it('adds an html element to the store on mount', () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <div>Hello</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    const elements = vp!.store.getElementsByType('html');
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('renders children via portal', () => {
    render(
      <FieldNotesCanvas>
        <CanvasElement position={{ x: 0, y: 0 }}>
          <span data-testid="portal-child">Portal Content</span>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    const child = document.querySelector('[data-testid="portal-child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe('Portal Content');
  });

  it('removes element from store on unmount', () => {
    let vp: Viewport | null = null;
    let showChild = true;

    function Inner() {
      if (!showChild) return null;
      return (
        <CanvasElement position={{ x: 0, y: 0 }}>
          <div>Remove me</div>
        </CanvasElement>
      );
    }

    const { rerender } = render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    expect(vp!.store.getElementsByType('html').length).toBe(1);

    showChild = false;
    rerender(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    expect(vp!.store.getElementsByType('html').length).toBe(0);
  });

  it('uses custom size when provided', () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 0, y: 0 }} size={{ w: 400, h: 300 }}>
          <div>Sized</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    const elements = vp!.store.getElementsByType('html');
    expect(elements[0]?.size).toEqual({ w: 400, h: 300 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @fieldnotes/react test -- src/canvas-element.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement CanvasElement**

```tsx
// canvas-element.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from './use-viewport';

export interface CanvasElementProps {
  position: { x: number; y: number };
  size?: { w: number; h: number };
  children: ReactNode;
}

export function CanvasElement({ position, size, children }: CanvasElementProps) {
  const viewport = useViewport();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const elementIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      width: '100%',
      height: '100%',
    });

    const id = viewport.addHtmlElement(container, position, size);
    elementIdRef.current = id;
    setPortalTarget(container);

    return () => {
      if (elementIdRef.current) {
        viewport.store.remove(elementIdRef.current);
        viewport.requestRender();
        elementIdRef.current = null;
      }
      setPortalTarget(null);
    };
    // Only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  useEffect(() => {
    const id = elementIdRef.current;
    if (!id) return;
    viewport.store.update(id, { position });
    if (size) {
      viewport.store.update(id, { size } as Partial<import('@fieldnotes/core').HtmlElement>);
    }
    viewport.requestRender();
  }, [viewport, position.x, position.y, size?.w, size?.h]);

  if (!portalTarget) return null;
  return createPortal(children, portalTarget);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fieldnotes/react test -- src/canvas-element.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/canvas-element.tsx packages/react/src/canvas-element.test.tsx
git commit -m "feat(react): add CanvasElement component with React portal embedding"
```

---

### Task 7: Barrel Export & Build

**Files:**

- Modify: `packages/react/src/index.ts`
- Remove: `packages/react/src/index.test.ts` (replaced by component/hook tests)

- [ ] **Step 1: Update barrel export**

Replace the existing `index.ts` (which only exports `VERSION`) with the full public API:

```typescript
// index.ts
export { FieldNotesCanvas } from './field-notes-canvas';
export type { FieldNotesCanvasProps, FieldNotesCanvasRef } from './field-notes-canvas';
export { CanvasElement } from './canvas-element';
export type { CanvasElementProps } from './canvas-element';
export { useViewport } from './use-viewport';
export { useActiveTool } from './use-active-tool';
export { useCamera } from './use-camera';
export type { CameraState } from './use-camera';
export { ViewportContext } from './context';
```

- [ ] **Step 2: Remove the old index.test.ts**

The old test only checked `VERSION` export which is no longer needed. All functionality is covered by the component and hook tests.

```bash
rm packages/react/src/index.test.ts
```

- [ ] **Step 3: Run all tests**

Run: `pnpm --filter @fieldnotes/react test`
Expected: All tests PASS

- [ ] **Step 4: Build the package**

Run: `pnpm --filter @fieldnotes/react build`
Expected: Build succeeds with ESM + CJS + .d.ts output

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/index.ts
git rm packages/react/src/index.test.ts
git commit -m "feat(react): complete public API barrel export"
```

---

### Task 8: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass across both packages

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: Both packages build successfully

- [ ] **Step 3: Verify exports are correct**

```bash
node -e "const pkg = require('./packages/react/dist/index.cjs'); console.log(Object.keys(pkg))"
```

Expected output should include: `FieldNotesCanvas`, `CanvasElement`, `useViewport`, `useActiveTool`, `useCamera`, `ViewportContext`

- [ ] **Step 4: Final commit if needed**

Only commit if there were any fixes needed from steps 1-3.
