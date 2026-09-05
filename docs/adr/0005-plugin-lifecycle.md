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

### Typed service keys

Service registration and retrieval use opaque `ServiceKey<T>` tokens instead of string keys. The key carries the service type, eliminating unchecked casts.

```typescript
// Opaque typed key — the key carries the service type
declare const ServiceKeyBrand: unique symbol;
interface ServiceKey<T> {
  readonly [ServiceKeyBrand]: T;
  readonly name: string; // For debugging
}

// Factory function to create typed keys
function createServiceKey<T>(name: string): ServiceKey<T> {
  return { name } as ServiceKey<T>;
}
```

VTT packages export typed service keys:

```typescript
export const FogManagerKey = createServiceKey<FogManager>('fog');
export const GridControllerKey = createServiceKey<GridController>('grid');
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
}

interface PluginHandle {
  dispose(): void;
  // State management moved here — per-instance, not shared.
  // Each method receives/returns only this plugin's state slice (see "State storage per plugin").
  validateState?(data: unknown): void;
  loadState?(data: unknown): void;
  exportState?(): unknown;
}

interface PluginConfigureContext {
  elementRegistry: ElementRegistry;
  toolManager: ToolManager;
  renderHooks: RenderHooks;
  serializationRegistry: SerializationRegistry;
  constraintServiceFactory?: ConstraintServiceFactory; // Domain-neutral (see ADR-0006)

  // All registrations within configure() are scoped to a transaction.
  // If the plugin throws during configure(), all its registrations are rolled back.
  // If an optional plugin throws during start(), its configure() registrations are also rolled back.
}

interface PluginStartContext {
  viewport: Viewport; // Fully constructed
  store: ElementStore;
  renderLoop: RenderLoop;
  // ... all services available

  // Register a typed service accessible to the host via viewport.getService()
  registerService<T>(key: ServiceKey<T>, service: T): void;

  // Register a disposer that will be called if start() fails
  // or when the plugin is disposed
  addDisposer(dispose: () => void): void;
}
```

State management methods (`validateState`, `loadState`, `exportState`) live on `PluginHandle`, not on the shared `ViewportPlugin` definition. State is per-viewport instance. The shared plugin definition is stateless and reusable. Moving state methods to `PluginHandle` ensures each viewport instance manages its own state independently.

Key design points:

- **`configure()` and `start()` are separate.** A plugin definition can be safely reused across viewports because `start()` returns a per-instance `PluginHandle` — `dispose()` lives on the handle, not on the shared plugin definition.
- **`configure()` receives a restricted context.** The viewport, renderLoop, minimap, and fog do not exist yet. Plugins can only register hooks, tools, and serialization handlers.
- **`start()` receives the full runtime.** All subsystems are fully constructed. Plugins that need viewport access do their setup here.
- **`configure()` registration is transactional.** The configure context tracks all registrations made during `configure()`. If the plugin throws (during configure or during start), the viewport rolls back all registrations made by that plugin's configure phase. This is implemented by the viewport wrapping each plugin's configure call in a try/catch that tracks and reverses registrations.
- **Failed installation rolls back.** If `start()` throws, the viewport:
  1. Calls all disposers registered via `ctx.addDisposer()` during this plugin's `start()` call (in reverse order)
  2. Rolls back all `configure()` registrations made by this plugin
  3. Removes any services registered via `ctx.registerService()` during this plugin's `start()` call

  This ensures no partial state survives a failed `start()`. The transaction scope covers both `configure()` and `start()` phases.

### Required plugin enforcement

There are two enforcement points, operating at different stages:

1. **Construction time:** After ALL plugin phases complete — Phase 1 (Configure), Phase 2 (Construct), Phase 3 (Start) including any rollbacks from failed optional plugins — the viewport checks that all `requiredCapabilities` are satisfied by the remaining registered hooks. If any capability is unsatisfied after all rollbacks, the viewport calls `dispose()` on all successfully started plugin handles, calls all registered disposers, then throws.

2. **Render time:** If a `required: true` hook throws during rendering, the surface falls back to masked rendering. This is consistent with ADR-0002's fail-closed design: missing capabilities produce masked surfaces, not errors.

```typescript
interface ViewportOptions {
  // ... existing options ...
  requiredCapabilities?:
    | string[]
    | {
        viewport?: string[];
        minimap?: string[];
        imageExport?: string[];
        svgExport?: string[];
      };
}
```

When `requiredCapabilities` is an array, it applies to all surfaces. When it is an object, each surface declares its own requirements. This matches ADR-0002's surface-qualified capability model.

```typescript
// Two enforcement points:
// 1. Construction time: requiredCapabilities checked after all phases (including rollbacks)
//    → constructor throws if any capability is unsatisfied
// 2. Render time: required: true hook throws during rendering
//    → surface falls back to masked rendering (consistent with ADR-0002)

const viewport = new Viewport({
  container: element,
  requiredCapabilities: ['vtt:fog'], // Host declares what it needs (all surfaces)
  plugins: [
    fogPlugin, // satisfies 'vtt:fog' via hook registration
  ],
});

// Or with per-surface requirements:
const viewport2 = new Viewport({
  container: element,
  requiredCapabilities: {
    viewport: ['vtt:fog', 'vtt:grid'],
    minimap: ['vtt:fog'],
  },
  plugins: [fogPlugin, gridPlugin],
});
```

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

### Plugin service registry

Plugins that provide services accessible to the host application (e.g., FogManager, GridController) register them during `start()` via `ctx.registerService()` using typed `ServiceKey<T>` tokens. The host application retrieves them via `viewport.getService()`. This replaces direct property access (e.g., `viewport.fog`) with a type-safe, plugin-mediated service registry.

```typescript
interface Viewport {
  // Typed service retrieval — T is inferred from the ServiceKey<T>
  getService<T>(key: ServiceKey<T>): T | undefined;

  // ... existing methods ...
}
```

Plugins register services during `start()` using typed keys:

```typescript
// VTT package exports typed service keys:
export const FogManagerKey = createServiceKey<FogManager>('fog');
export const GridControllerKey = createServiceKey<GridController>('grid');

// Fog plugin registers FogManager with typed key:
start(ctx) {
  const fogManager = new FogManager(/* ... */);
  ctx.registerService(FogManagerKey, fogManager);
  return { dispose() { fogManager.dispose(); } };
}
```

The host application and other consumers retrieve services through the registry — `T` is inferred from the key, no cast needed:

```typescript
// RollKeeper accesses plugin-owned services — T is inferred:
const fogManager = viewport.getService(FogManagerKey); // FogManager | undefined
const gridController = viewport.getService(GridControllerKey); // GridController | undefined

// Replace direct property access:
// Before: viewport.fog.setStyle(...)
// After: viewport.getService(FogManagerKey)?.setStyle(...)

// Autosave accesses fog state through the service registry:
const fog = viewport.getService(FogManagerKey);
const fogState = fog?.exportState();
```

> **Note:** `ServerOpContext.backendPlugin<T>()` in ADR-0003 uses the same `ServiceKey<T>` pattern for type-safe backend plugin access.

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
  13. FogManager, FogRenderer (configured by plugin-registered hooks) ← TEMPORARY: moves to plugin in Phase 3
  14. Minimap (optional) + setFogRenderer                               ← TEMPORARY: moves to plugin
  15. DomNodeManager, InteractMode, MarginViewport, LayerCache
  16. RenderLoop (assembled with all deps including HybridRenderSurface)
  17. Event wiring, store listeners, ResizeObserver, syncCanvasSize()

Steps marked TEMPORARY exist during the migration window. After VTT extraction, these subsystems are created by the fog plugin's `start()` phase, not by the core constructor. The core constructor creates only domain-agnostic subsystems.

Phase 3: Start — plugins receive the complete runtime
  18. For each plugin: plugin.start(ctx) ← full runtime context
      - Viewport is fully constructed, all services available
      - ctx.addDisposer() tracks cleanup callbacks
      - ctx.registerService() tracks registered services
      - Returns PluginHandle with per-instance dispose()
      - If start() throws:
        a. Call all disposers registered during this start() call (reverse order)
        b. Remove all services registered during this start() call
        c. Roll back configure() registrations for this plugin
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

### State storage per plugin

Each plugin's state is stored as a single opaque value at `extensions[plugin.name]`:

```typescript
interface CanvasState {
  // ... existing fields ...
  extensions: Record<string, unknown>; // Keyed by plugin name
}
```

The `PluginHandle` receives only its own state slice:

```typescript
interface PluginHandle {
  // Receives only this plugin's state slice
  validateState?(data: unknown): void;
  loadState?(data: unknown): void;
  // Returns this plugin's state (stored at extensions[plugin.name])
  exportState?(): unknown;
}
```

Since each plugin's state is stored at `extensions[plugin.name]`, collisions are impossible by construction — plugin names are unique (enforced by the idempotent registration check). There is no need for collision detection on export keys.

### Four-phase loadState ordering

State loading uses a validate-snapshot-apply-restore pattern. During Phase 3 (Apply), the viewport suspends ALL observer notifications across all subsystems via a viewport-wide event barrier. No observers receive events during the apply phase. This prevents any subsystem from observing partial mutations. After all apply steps complete successfully, the viewport resumes notifications, flushing batched events. All observers see the complete new state, not intermediate mutations.

```typescript
interface Viewport {
  // Suspend all observer notifications across all subsystems
  // Returns a resume function that flushes batched notifications
  suspendNotifications(): () => void;
}
```

If Phase 4 (Restore) is triggered because an apply step threw, the viewport calls `resume()` to re-enable notifications, then restores the snapshot from Phase 2. However, some effects cannot be fully retracted:

- DOM mutations may have already occurred (the DOM is restored, but any DOM observers have already fired).
- Plugin `loadState()` may have side effects that cannot be undone (e.g., network requests, timers).

The restore is best-effort for these cases. The viewport logs a warning if restore encounters errors. The system may be in an inconsistent state after a failed restore — this is documented as a known limitation.

```
loadState() order (revised):

Phase 1: Validate — all plugins validate before any mutations
  1. For each plugin: handle.validateState?(state)
     - If any throws → entire load aborted, no partial mutations

Phase 2: Snapshot — capture current state for rollback
  2. Snapshot current elements, layers, plugin state, active layer, camera, history

Phase 3: Apply — viewport-wide event barrier, apply mutations
  3. Call viewport.suspendNotifications() — this suspends:
     - Store change notifications (add/remove/update/clear)
     - Layer manager change notifications
     - Camera change notifications
     - History change notifications
     - Plugin state change notifications
     All observers are queued but not fired.
  4. Elements loaded
  5. Layers loaded
  6. Active layer set
  7. HTML content reattached
  8. Plugin handle.loadState() called
  9. History cleared
  10. Camera restored
  11. Call resume() — this flushes batched notifications:
      - Single batched store notification covering all element changes
      - Single layer manager notification
      - Single camera notification
      - Single history notification
      Observers see the complete new state, not intermediate mutations.

Phase 4: On failure — restore snapshot (best-effort)
  If any step in Phase 3 throws:
  - Call resume() to re-enable notifications (flushing whatever changes occurred)
  - Restore snapshot from Phase 2
  - Re-notify observers of restored state (single batch)
  - Log warning if restore encounters errors
  - System may be in inconsistent state (documented limitation)
```

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

### Positive (additions)

- **Viewport-wide atomicity:** The event barrier ensures ALL observers (store, layers, camera, history, plugins) see the complete new state or the restored snapshot — never partial mutations. This replaces the store-only notification suppression which left layer-sync observers, camera listeners, and plugin persistence able to observe partial state.

### Positive

- **No unmasked frames:** Fog plugin is active before the first render. Privacy is preserved from frame zero.
- **No partial Viewport exposure:** `configure()` receives only registries and managers — never the incomplete Viewport. Plugins cannot accidentally interact with subsystems that don't exist yet.
- **Safe plugin reuse:** Plugin definitions are stateless; per-instance state lives in `PluginHandle`. The same plugin definition can be installed across multiple viewports.
- **Deterministic ordering:** Plugin installation order is explicit (priority + array order). No race conditions.
- **Clean disposal:** Reverse-order handle disposal ensures plugins clean up in the right sequence. Per-instance handles prevent cross-viewport cleanup bugs.
- **Required plugin enforcement:** Privacy-critical plugins can be marked `required`, and the host can declare `requiredCapabilities` — both prevent viewport creation without essential functionality.
- **Safe state loading:** Four-phase validate-snapshot-apply-restore with notification suppression prevents autosave and sync from observing partial mutations. Restore is best-effort — some side effects (DOM observers, plugin side effects) cannot be fully retracted.
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
- RollKeeper's existing bootstrap ordering (snapshot → fog → render) must be preserved through the plugin lifecycle. The four-phase `validateState()` / snapshot / `loadState()` / restore pattern gives plugins control, but the ordering must be correct.
- Plugin name collisions in `exportState()` keys are caught at registration time, but this means plugin naming becomes part of the public contract — renaming a plugin is a breaking change for persisted state.
- The service registry uses typed `ServiceKey<T>` tokens. Service keys (e.g., `FogManagerKey`, `GridControllerKey`) become part of the public contract — renaming or removing a service key is a breaking change for consumers.
- State restore after a failed `loadState()` is best-effort. DOM observer firings and plugin side effects (network requests, timers) cannot be retracted. The system may be in an inconsistent state after a failed restore.
- The event barrier must cover ALL observable subsystems. If a new subsystem is added that has its own observers, it must participate in the barrier. Missing a subsystem re-introduces the partial-state observation problem.

## Review Response

### Second review

- **F8 (Plugin installation exposes partially constructed Viewport):** Resolved by splitting `install()` into `configure()` (restricted context, before subsystems) and `start()` (full runtime, after all subsystems). `start()` returns a per-instance `PluginHandle` so plugin definitions can be safely reused across viewports. Failed `start()` triggers rollback of `configure()` registrations.

- **F9 (Plugin state loading is not atomic):** Resolved by introducing two-phase state loading: `validateState()` runs first across all plugins before any mutations, then `loadState()` applies only after all validations pass. State is stored per plugin at `extensions[plugin.name]` (see F13 fourth review).

- **F1 cross-cut (Plugin installation must enforce privacy):** Resolved by adding a `required` flag to `ViewportPlugin`. If a required plugin's `configure()` or `start()` fails, the Viewport constructor throws — the viewport cannot be created without its required plugins.

### Third review

- **F1 (Missing "required" hooks cannot be detected):** The `required: true` flag on a plugin only enforces that the plugin must succeed _if provided_. If the host forgets to pass the plugin entirely, nothing declares the requirement. Resolved by adding host-declared `requiredCapabilities` to the Viewport constructor. After all plugin phases complete (including rollbacks from failed optional plugins), the viewport checks that all `requiredCapabilities` are satisfied by remaining registered hooks. If any capability is unsatisfied, the viewport constructor throws. This is the lifecycle-level enforcement mechanism for the render-surface capability system described in ADR-0002.

- **F8 (Plugin reuse, rollback, and state atomicity are incomplete):** Three sub-issues resolved:
  - **(A) State methods on wrong interface:** `loadState()`, `exportState()`, and `validateState()` lived on the stateless shared `ViewportPlugin` definition rather than the per-viewport `PluginHandle`. Moved to `PluginHandle` so each viewport instance manages its own state independently.
  - **(B) Non-transactional configure():** An optional plugin that throws after registering one hook left partial registrations behind. Resolved by making `configure()` registration transactional — the `PluginConfigureContext` tracks all registrations, and if the plugin throws during `configure()` or `start()`, all its registrations are rolled back.
  - **(C) Non-atomic loadState apply phase:** Validating before applying did not make loading atomic if a core mutation or plugin `loadState()` subsequently threw. Resolved by adding a snapshot/restore pattern: Phase 2 captures current state, Phase 3 applies mutations with notifications suppressed (emitting a single batch notification on success), Phase 4 restores the snapshot (best-effort) if any apply step throws.

- **F10 (Lifecycle text still describes VTT construction inside core):** Two issues resolved:
  - Phase 2 steps 13–14 (FogManager, FogRenderer, Minimap + setFogRenderer) are now labeled as TEMPORARY migration stages. After VTT extraction, these subsystems are created by the fog plugin's `start()` phase, not by the core constructor.
  - `PluginConfigureContext` field renamed from `snapServiceFactory` to `constraintServiceFactory` — the domain-neutral name per ADR-0006.

### Fourth review

- **F4 (Render hook and fail-closed contracts contradict ADR-0002):** ADR-0002 says missing capabilities produce masked surfaces, while ADR-0005 said the constructor throws. Clarified two enforcement points: (1) construction time — after ALL plugin phases complete including Phase 3 rollbacks, if a required capability is unsatisfied, the constructor throws; (2) render time — if a `required: true` hook throws during rendering, the surface falls back to masked rendering. Updated `ViewportOptions` to support surface-qualified requirements (matching ADR-0002's revised design): when an array, applies to all surfaces; when an object, each surface declares its own requirements.

- **F9 (Plugin state loading is not atomic as claimed):** The apply phase changes the active layer, DOM content, history, and camera. Store mutations emit events that autosave and sync observers can already consume. Replaced the "Four-phase loadState ordering" section with a more honest description: (1) notifications are suppressed during Phase 3 (Apply), with a single batch notification emitted after all apply steps succeed; (2) Phase 4 (Restore) is best-effort — DOM observer firings and plugin side effects cannot be fully retracted; (3) the snapshot now includes active layer, camera, and history in addition to elements, layers, and plugin state.

- **F10 (RollKeeper cannot access plugin-owned fog and grid services):** Once FogManager and GridController move to plugins, the application has no supported way to obtain them. Added a typed service-key registry on Viewport: plugins register services during `start()` via `ctx.registerService()`, the host retrieves them via `viewport.getService<T>()`. This replaces direct property access (e.g., `viewport.fog`) with a typed, plugin-mediated service registry. Autosave and sync also use the service registry to access plugin-owned state.

- **F13 (Plugin-state namespacing cannot work as documented):** `exportState()` returns keys only at export time, so collisions cannot be detected "at registration time." Replaced the namespaced key approach with a simpler model: each plugin's state is stored as a single opaque value at `extensions[plugin.name]`. The `PluginHandle` receives only its own state slice (`validateState(data: unknown)`, `loadState(data: unknown)`, `exportState(): unknown`). Collisions are impossible by construction since plugin names are unique (enforced by the idempotent registration check).

### Fifth review — F7, F8, F9

- **F7 (Typed service registry):** Replaced string-keyed `getService<T>(key: string)` with opaque `ServiceKey<T>` tokens. `createServiceKey<T>(name)` creates a typed key that carries the service type through registration and retrieval. `registerService(key, service)` and `getService(key)` are type-safe — no unchecked casts. VTT package exports typed keys (`FogManagerKey`, `GridControllerKey`). Same pattern applied to ADR-0003's `backendPlugin<T>()`.

- **F8 (start() partial state):** Extended transaction scope to cover `start()` in addition to `configure()`. Added `ctx.addDisposer()` to `PluginStartContext` — tracks cleanup callbacks during start. If `start()` throws: (1) all disposers called in reverse order, (2) all services registered during start removed, (3) configure registrations rolled back. No partial state survives a failed start.

- **F9 (loadState atomicity):** Replaced store-only notification suppression with viewport-wide event barrier (`viewport.suspendNotifications()`). ALL observers are suspended during apply: store, layers, camera, history, plugins. On success, resume flushes batched notifications. On failure, resume re-enables notifications, then restore + re-notify. Every subsystem participates in the barrier — no partial-state observation possible.

## References

- `packages/core/src/canvas/viewport.ts` — constructor order (~27 steps), loadState, destroy
- `packages/core/src/canvas/render-loop.ts` — renderLoop.start(), first render
- `~/Projects/RollKeeper/src/lib/battlemapSync.ts:250` — snapshot/bootstrap ordering
- `~/Projects/RollKeeper/src/components/ui/campaign/location-map/fog/attachFogPersistence.ts:9` — fog event origins
- `MIGRATION_VTT_EXTRACTION.md` §Open Architectural Decisions → ADR-5
