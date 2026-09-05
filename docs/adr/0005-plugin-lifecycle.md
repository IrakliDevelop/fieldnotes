# ADR-0005: Plugin Lifecycle & Installation

- **Status:** Proposed
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

**Four-phase constructor-time plugin installation** with synchronous internal phases, per-instance handles, and deterministic ordering.

```typescript
const viewport = new Viewport({
  container: element,
  plugins: [
    fogPlugin, // Installed first — privacy-critical (required: true)
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
  readonly required?: boolean; // If true, viewport refuses to render without this plugin.

  // Phase 1: Configure — restricted context, before subsystems exist.
  // Plugins can register hooks, tools, serialization handlers.
  // Plugins CANNOT access viewport, renderLoop, minimap, fog (not yet created).
  configure?(ctx: PluginConfigureContext): void;

  // Phase 3: Start — full runtime, after all subsystems exist.
  // Returns a PluginHandle for per-instance cleanup.
  start?(ctx: PluginStartContext): PluginHandle;

  // State management (see loadState ordering below)
  validateState?(state: CanvasState): void;
  loadState?(state: CanvasState): void;
  exportState?(): Record<string, unknown>;
}

interface PluginHandle {
  dispose(): void; // Per-instance cleanup
}

interface PluginConfigureContext {
  elementRegistry: ElementRegistry;
  toolManager: ToolManager;
  renderHooks: RenderHooks;
  serializationRegistry: SerializationRegistry;
  snapServiceFactory?: SnapServiceFactory; // Domain-neutral slot
}

interface PluginStartContext {
  viewport: Viewport; // Fully constructed
  store: ElementStore;
  renderLoop: RenderLoop;
  // ... all services available
}
```

Key design points:

- **`configure()` and `start()` are separate.** A plugin definition can be safely reused across viewports because `start()` returns a per-instance `PluginHandle` — `dispose()` lives on the handle, not on the shared plugin definition.
- **`configure()` receives a restricted context.** The viewport, renderLoop, minimap, and fog do not exist yet. Plugins can only register hooks, tools, and serialization handlers.
- **`start()` receives the full runtime.** All subsystems are fully constructed. Plugins that need viewport access do their setup here.
- **Failed installation rolls back.** If `start()` throws, all registrations made by that plugin's `configure()` phase are rolled back.

### Required plugin enforcement

Plugins can be marked `required: true`. If a required plugin's `configure()` or `start()` fails, the Viewport constructor throws — the viewport cannot be created without its required plugins. This enforces privacy at construction time.

```typescript
const fogPlugin: ViewportPlugin = {
  name: 'fog',
  required: true, // Viewport refuses to render without this plugin
  priority: -100, // Installed first
  configure(ctx) {
    /* register fog hooks */
  },
  start(ctx) {
    /* initialize fog rendering */
  },
};
```

### Four-phase constructor order

```
Viewport constructor (revised):

Phase 1: Configure — plugins receive a restricted registry/service context
  1-10. Core services (Camera, Store, ToolManager, ElementRegistry, etc.)
  11. Sort plugins by priority (ascending). Equal priority preserves array order.
  12. For each plugin: plugin.configure(ctx) ← restricted context
      - Plugins register hooks, tools, serialization handlers
      - Plugins CANNOT access viewport, renderLoop, minimap, fog
      - If required plugin throws → constructor throws, no viewport created
      - If optional plugin throws → skip plugin, continue

Phase 2: Construct — core creates all subsystems using plugin registrations
  13. FogManager, FogRenderer (configured by plugin-registered hooks)
  14. Minimap (optional) + setFogRenderer
  15. DomNodeManager, InteractMode, MarginViewport, LayerCache
  16. RenderLoop (assembled with all deps including HybridRenderSurface)
  17. Event wiring, store listeners, ResizeObserver, syncCanvasSize()

Phase 3: Start — plugins receive the complete runtime
  18. For each plugin: plugin.start(ctx) ← full runtime context
      - Viewport is fully constructed, all services available
      - Returns PluginHandle with per-instance dispose()
      - If start() throws → roll back configure() registrations for this plugin
      - If required plugin throws → dispose all prior handles, constructor throws

Phase 4: Render — first frame
  19. renderLoop.start() ← first requestAnimationFrame scheduled
  20. gridController.syncContext()
```

### Idempotent disposal

```typescript
// Disposing the viewport calls each plugin handle's dispose() in reverse order:
viewport.destroy();
// → measureHandle.dispose()
// → gridHandle.dispose()
// → fogHandle.dispose()
```

Re-registering the same plugin (by name) is a no-op:

```typescript
// If a plugin with the same name is already installed, skip:
if (installedPlugins.has(plugin.name)) return;
```

### State export with namespaced keys

Plugin state is exported under namespaced keys to prevent collisions:

```typescript
interface ViewportPlugin {
  // Keys auto-namespaced by plugin name.
  // e.g., fog plugin exports { fog: {...} } → stored as extensions.fog
  exportState?(): Record<string, unknown>;
}
```

Collision handling: if two plugins export the same top-level key, throw at registration time (not at export time). This catches naming conflicts early.

### Two-phase loadState ordering

State loading uses a validate-then-apply pattern to ensure atomicity:

```
loadState() order:

Phase 1: Validate — all plugins validate their state before any mutations
  1. For each plugin: plugin.validateState?(state)
     - Plugins inspect their portion of CanvasState (e.g., extensions.fog)
     - If validation throws → entire load is aborted, no partial mutations

Phase 2: Apply — only after all validations pass
  2. Elements loaded
  3. Layers loaded
  4. Active layer set
  5. HTML content reattached
  6. Plugin loadState() called ← plugins load their data
  7. History cleared
  8. Camera restored
```

If any plugin's `validateState()` throws, the entire load is aborted — no partial mutations. This prevents the previous issue where elements and layers were already committed when a plugin's `loadState()` failed.

## Options Considered

### Option A (original): Single-phase install() with full context

The original proposal had a single `install(ctx: PluginInstallContext)` method called during construction, where `PluginInstallContext` included `viewport: Viewport`. This exposed a partially constructed Viewport — fog, render loop, and minimap did not exist yet at the point `install()` was called. The `dispose()` method lived on the plugin definition itself, making it unsafe for reuse across viewports.

**Why superseded:** Splitting into `configure()` (restricted) + `start()` (full runtime) with per-instance `PluginHandle` solves both problems: plugins never see partially constructed subsystems, and plugin definitions can be safely reused.

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
- **No partial Viewport exposure:** `configure()` receives only registries and managers — never the incomplete Viewport. Plugins cannot accidentally interact with subsystems that don't exist yet.
- **Safe plugin reuse:** Plugin definitions are stateless; per-instance state lives in `PluginHandle`. The same plugin definition can be installed across multiple viewports.
- **Deterministic ordering:** Plugin installation order is explicit (priority + array order). No race conditions.
- **Clean disposal:** Reverse-order handle disposal ensures plugins clean up in the right sequence. Per-instance handles prevent cross-viewport cleanup bugs.
- **Required plugin enforcement:** Privacy-critical plugins can be marked `required`, preventing viewport creation without them.
- **Atomic state loading:** Two-phase validate-then-apply prevents partial mutations when plugin state is invalid.
- **Idempotent:** Re-registering the same plugin is safe.
- **Rollback on failure:** If `start()` throws, `configure()` registrations are rolled back — no orphaned hooks or tools.

### Negative

- **Two-phase plugin API:** Plugins must implement `configure()` and `start()` separately instead of a single `install()`. Slightly more ceremony for plugin authors.
- **Constructor complexity:** The Viewport constructor grows to accommodate four phases. More code in a single function.
- **Plugin API surface:** The `PluginConfigureContext` and `PluginStartContext` expose internal services. This is a large API surface that must be stable.
- **Testing:** Plugin installation phases, ordering, rollback, required enforcement, and disposal all need test coverage.
- **Migration:** Existing consumers that create Viewport without plugins must continue to work. The `plugins` option is optional.

### Risks

- Plugins that depend on each other (e.g., grid plugin depends on snap service from core) must have their dependencies available at configure time. The `PluginConfigureContext` must provide all necessary services.
- RollKeeper's existing bootstrap ordering (snapshot → fog → render) must be preserved through the plugin lifecycle. The two-phase `validateState()` / `loadState()` pattern gives plugins control, but the ordering must be correct.
- Plugin name collisions in `exportState()` keys are caught at registration time, but this means plugin naming becomes part of the public contract — renaming a plugin is a breaking change for persisted state.

## Review Response

This revision addresses three review findings:

- **F8 (Plugin installation exposes partially constructed Viewport):** Resolved by splitting `install()` into `configure()` (restricted context, before subsystems) and `start()` (full runtime, after all subsystems). `start()` returns a per-instance `PluginHandle` so plugin definitions can be safely reused across viewports. Failed `start()` triggers rollback of `configure()` registrations.

- **F9 (Plugin state loading is not atomic):** Resolved by introducing two-phase state loading: `validateState()` runs first across all plugins before any mutations, then `loadState()` applies only after all validations pass. State export uses namespaced keys with collision detection at registration time.

- **F1 cross-cut (Plugin installation must enforce privacy):** Resolved by adding a `required` flag to `ViewportPlugin`. If a required plugin's `configure()` or `start()` fails, the Viewport constructor throws — the viewport cannot be created without its required plugins.

## References

- `packages/core/src/canvas/viewport.ts` — constructor order (~27 steps), loadState, destroy
- `packages/core/src/canvas/render-loop.ts` — renderLoop.start(), first render
- `~/Projects/RollKeeper/src/lib/battlemapSync.ts:250` — snapshot/bootstrap ordering
- `~/Projects/RollKeeper/src/components/ui/campaign/location-map/fog/attachFogPersistence.ts:9` — fog event origins
- `MIGRATION_VTT_EXTRACTION.md` §Open Architectural Decisions → ADR-5
