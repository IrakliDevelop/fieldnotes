# ADR-0005: Plugin Lifecycle & Installation

- **Status:** Decided
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0002](0002-render-surface-model.md) (render surfaces), [ADR-0003](0003-sync-plugin-ownership.md) (sync plugins)

## Context

The Viewport constructor performs ~27 initialization steps synchronously:

```
Viewport constructor order (packages/core/src/canvas/viewport.ts):
 1. Camera, Background, ElementStore, LayerManager, ToolManager
 2. Tool registration listener (onRegister → selection source attachment)
 3. ElementRenderer
 4. NoteEditor, ArrowLabelEditor
 5. HistoryStack, HistoryRecorder
 6. SelectionOps
 7. DOM structure (wrapper > canvas + paintStack + domLayer)
 8. ToolContext assembly (snapToGrid: false, gridSize, activeLayerId, ...)
 9. InputHandler
10. ContextMenu (optional)
11. FogManager, FogRenderer              ← VTT-specific
12. Minimap (optional) + setFogRenderer   ← VTT-specific
13. DomNodeManager
14. InteractMode, MarginViewport, LayerCache
15. RenderLoop (assembled with all deps including HybridRenderSurface)
16. Fog event wiring (change/view → fogRenderer, renderLoop, minimap)  ← VTT-specific
17. HtmlPainterRegistry change listener
18. Camera change listener
19. GridController                        ← VTT-specific
20. Store event listeners (add/remove/update/clear → grid sync, render, ...)
21. LayerManager change listener
22. ViewportInteractions (pointer/drag/drop)
23. Event listeners (pointerdown, pointerup, dragover, drop)
24. ResizeObserver started
25. syncCanvasSize()
26. renderLoop.start()                    ← first requestAnimationFrame scheduled
27. gridController.syncContext()           ← reads grid elements from store
```

Key observations:

- **Tools are registered externally** — the constructor does NOT register any tools. The host app calls `toolManager.register()` after construction.
- **First render** happens on the next animation frame after `renderLoop.start()` (step 26).
- **Fog is initialized at steps 11-12, 16** — before the first render but after core services.
- **`loadState()`** loads fog last: elements → layers → active layer → HTML content → **fog** → history → camera.

### Privacy constraint

Fog is privacy-critical: it masks hidden information (e.g., DM-placed fog of war). If the fog plugin installs _after_ the first render, there is a frame where hidden information is visible (an "unmasked frame"). RollKeeper's `battlemapSync.ts` explicitly handles snapshot/bootstrap ordering to avoid this.

Similarly, store subscription ordering matters: RollKeeper marks elements private before sync observes them. If plugins install in the wrong order, sync may observe elements before privacy markers are set.

### The problem

The original migration plan proposed `viewport.renderHooks.register()` as a post-construction API. But privacy-critical plugins (fog) must install _before_ the first render, _before_ `loadState()`, and _before_ sync connections. Post-construction registration creates a window where the system operates without critical plugins.

## Decision

**Constructor-time plugin installation** with deterministic ordering and idempotent disposal.

```typescript
const viewport = new Viewport({
  container: element,
  plugins: [
    fogPlugin, // Installed first — privacy-critical
    gridPlugin, // Installed second
    measurePlugin, // Installed third
  ],
  // ... other options
});
```

### Plugin interface

```typescript
interface ViewportPlugin {
  readonly name: string;
  readonly priority?: number; // Lower = installed first. Default: 0.

  // Called during Viewport construction, before first render.
  // Plugins receive the viewport's internal services and can register
  // hooks, tools, serialization handlers, etc.
  install(ctx: PluginInstallContext): void;

  // Called during Viewport disposal. Must clean up all registrations.
  dispose?(): void;
}

interface PluginInstallContext {
  viewport: Viewport; // Public API
  store: ElementStore;
  toolManager: ToolManager;
  renderHooks: RenderHooks;
  serialization: SerializationRegistry;
  // ... other internal services
}
```

### Installation order

1. Plugins are sorted by `priority` (ascending). Equal priority preserves array order.
2. Each plugin's `install()` is called synchronously, in order, during the Viewport constructor.
3. All plugins install **before** `renderLoop.start()` (before step 26 in the current constructor).
4. Fog plugin installs first (priority: -100 or similar) to ensure it's active before any render.

### Where plugins install in the constructor

```
Viewport constructor (revised):
 1-10. Core services (Camera, Store, ToolManager, etc.)
 11. **Plugin installation** ← NEW — sorted by priority, before any VTT services
 12-15. FogManager, Minimap, RenderLoop (now configured by plugins)
 16-25. Event wiring, store listeners, etc.
 26. renderLoop.start()
 27. gridController.syncContext()
```

Plugins can register fog-related hooks, tools, and serialization handlers. The core services that plugins depend on (store, toolManager, renderHooks) are already initialized (steps 1-10). The VTT-specific services (FogManager, GridController) are created _by_ the plugins during installation.

### Idempotent disposal

```typescript
// Disposing the viewport calls each plugin's dispose() in reverse order:
viewport.destroy();
// → measurePlugin.dispose()
// → gridPlugin.dispose()
// → fogPlugin.dispose()
```

Re-registering the same plugin (by name) is a no-op:

```typescript
// If a plugin with the same name is already installed, skip:
if (installedPlugins.has(plugin.name)) return;
```

### loadState ordering

Plugins can hook into `loadState()` to control their data loading order:

```typescript
interface ViewportPlugin {
  // ... install, dispose ...

  // Called during loadState(), after elements and layers are loaded.
  // Plugins load their own state (e.g., fog state from extensions field).
  loadState?(state: CanvasState): void;

  // Called during exportState(), to add plugin state to the export.
  exportState?(): Record<string, unknown>;
}
```

The `loadState()` order:

1. Elements loaded
2. Layers loaded
3. Active layer set
4. HTML content reattached
5. **Plugin `loadState()` called** ← plugins load their data
6. History cleared
7. Camera restored

This ensures fog state is loaded at the right point in the lifecycle — after elements (which fog may reference) but before the next render.

## Options Considered

### Option B: Lazy registration with readiness gate

Allow post-construction plugin registration, but gate rendering/sync/load until all required plugins are installed:

```typescript
const viewport = new Viewport({ container: element });
viewport.requirePlugin('fog'); // Mark as required
viewport.registerPlugin(fogPlugin); // Install later
viewport.ready(); // Signal all required plugins are installed
```

**Pros:** Flexible. Plugins can be added/removed at runtime.
**Cons:** Complex readiness protocol. The "unmasked frame" problem becomes a "unmasked until ready" problem. RollKeeper's bootstrap ordering is already fragile — adding a readiness gate makes it more so.

**Why rejected:** Privacy-critical plugins must be active before the first render. A readiness gate creates a window where the system is "not ready" but might still render. Constructor-time installation eliminates this window entirely.

### Option C: Separate initialization phase

Two-phase construction: create the viewport, then initialize it with plugins:

```typescript
const viewport = Viewport.create({ container: element });
await viewport.initialize({ plugins: [fogPlugin, gridPlugin] });
```

**Pros:** Clear separation. Async initialization is possible.
**Cons:** Breaking API change. Every consumer must adopt the two-phase pattern. The current synchronous constructor is well-established.

**Why rejected:** Breaking change. The synchronous constructor is used by all existing consumers. A two-phase pattern adds complexity for the common case (all plugins known at construction time).

## Consequences

### Positive

- **No unmasked frames:** Fog plugin is active before the first render. Privacy is preserved from frame zero.
- **Deterministic ordering:** Plugin installation order is explicit (priority + array order). No race conditions.
- **Clean disposal:** Reverse-order disposal ensures plugins clean up in the right sequence.
- **Idempotent:** Re-registering the same plugin is safe.
- **Familiar pattern:** Constructor-time configuration is the standard pattern for complex objects.

### Negative

- **Constructor complexity:** The Viewport constructor grows to accommodate plugin installation. More code in a single function.
- **Plugin API surface:** The `PluginInstallContext` exposes internal services. This is a large API surface that must be stable.
- **Testing:** Plugin installation order must be tested. Priority ordering, idempotency, and disposal all need test coverage.
- **Migration:** Existing consumers that create Viewport without plugins must continue to work. The `plugins` option is optional.

### Risks

- If a plugin's `install()` throws, the Viewport is in a partially-initialized state. Must handle this gracefully (dispose already-installed plugins, throw with clear error).
- Plugins that depend on each other (e.g., grid plugin depends on snap service from core) must have their dependencies available at install time. The install context must provide all necessary services.
- RollKeeper's existing bootstrap ordering (snapshot → fog → render) must be preserved through the plugin lifecycle. The `loadState()` hook gives plugins control, but the ordering must be correct.

## References

- `packages/core/src/canvas/viewport.ts` — constructor order (~27 steps), loadState, destroy
- `packages/core/src/canvas/render-loop.ts` — renderLoop.start(), first render
- `~/Projects/RollKeeper/src/lib/battlemapSync.ts:250` — snapshot/bootstrap ordering
- `~/Projects/RollKeeper/src/components/ui/campaign/location-map/fog/attachFogPersistence.ts:9` — fog event origins
- `MIGRATION_VTT_EXTRACTION.md` §Open Architectural Decisions → ADR-5
