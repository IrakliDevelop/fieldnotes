# Extending Field Notes

This guide covers the extension API of `@fieldnotes/core` 0.91.0. Every name below is exported
from `@fieldnotes/core` unless stated otherwise. A runnable version of most snippets lives in
[`examples/extension-api`](../examples/extension-api/).

## 1. Overview

You can add element types, viewport plugins, render hooks on four surfaces, typed services,
actions, and tools. `@fieldnotes/core` owns all of these extension points; `@fieldnotes/sync`
carries extension elements over the wire, and `@fieldnotes/vtt` is a full domain package built on
them.

The model in five sentences:

1. An element type is an `ElementTypeDefinition` registered in an `ElementRegistry`; core stores
   its elements as `ExtensionElementEnvelope`s and calls the definition for bounds, hit-testing,
   rendering and validation.
2. Each `Viewport` owns a registry layered over the global default registry, so types can be
   registered for the whole page or for one viewport.
3. A `ViewportPlugin` is installed at construction: `configure` registers types, tools, hooks and
   actions; `start` gets runtime access and returns a handle that is disposed with the viewport.
4. Render hooks draw on the viewport, minimap, image export and SVG export, and can declare
   capabilities the host requires; a missing or failed capability fails closed.
5. Services are values that plugins publish under a typed `ServiceKey` for the host and other
   plugins.

## 2. Element types

### `ElementTypeDefinition<T>`

`T` is your typed element (`extends BaseElement`). Core never sees `T`; it sees the envelope.

| Field          | Required | Purpose                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------ |
| `type`         | yes      | Namespaced id stored as the envelope's `extensionType`, e.g. `'my-app:marker'`.            |
| `legacyTypes`  | yes      | Pre-v4 `type` strings this definition decodes; `[]` for new types.                         |
| `decodeLegacy` | yes      | Converts a pre-v4 element of a `legacyTypes` type to `T`; trivial for new types.           |
| `validateData` | yes      | Type guard for the envelope's `data`; runs on load and on sync receive.                    |
| `wrap`         | yes      | `T` to envelope.                                                                           |
| `unwrap`       | yes      | Envelope to `T`; only called on validated envelopes.                                       |
| `bounds`       | yes      | World-space axis-aligned `Bounds`, or `null`. Drives culling, selection, minimap, exports. |
| `hitTest`      | no       | Point-in-element test. Default: inside `bounds`.                                           |
| `render`       | no       | Draws on a world-space canvas context.                                                     |
| `emitSvg`      | no       | Returns an SVG fragment for `exportSvg`.                                                   |
| `renderMode`   | no       | `'canvas'` (default), `'hybrid'`, `'none'` all draw through `render`; `'dom'` throws.      |
| `fullCanvas`   | no       | Renders in a separate full-viewport pass (grids). Not hit-testable.                        |
| `interaction`  | no       | `ElementInteractionAdapter` for custom handles, selection drawing and rotation.            |
| `dataVersion`  | no       | Current version of `data`, positive integer, default 1. See section 4.                     |
| `migrate`      | no       | Upgrades older `data`; required when `dataVersion > 1`.                                    |
| `cloneRemap`   | no       | Rewrites ids inside `data` on paste and duplicate. See section 5.                          |

### The envelope

```typescript
interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string; // the definition's `type`
  readonly data: Record<string, unknown>; // your fields, JSON-serializable
  readonly dataVersion?: number; // absent means 1
  readonly size?: Size; // opts into core resize handles
}
```

`BaseElement` fields (`id`, `position`, `index`, `version`, `editor`, `locked`, `layerId`,
`groupId`, `rotation`) live on the envelope, not in `data`. `wrap` and `unwrap` move your fields in
and out of `data`; copy the base fields with `pickBaseFields` so new ones are never dropped:

```typescript
import { pickBaseFields } from '@fieldnotes/core';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  Size,
} from '@fieldnotes/core';

interface Marker extends BaseElement {
  type: 'my-app:marker';
  label: string;
  size: Size;
}

const markerDefinition: ElementTypeDefinition<Marker> = {
  type: 'my-app:marker',
  legacyTypes: [],
  decodeLegacy: (raw) => raw as unknown as Marker,
  validateData: (data) => typeof data['label'] === 'string',
  wrap: (el): ExtensionElementEnvelope => ({
    ...pickBaseFields(el),
    type: 'extension',
    extensionType: 'my-app:marker',
    size: el.size,
    data: { label: el.label },
  }),
  unwrap: (el) => ({
    ...pickBaseFields(el),
    type: 'my-app:marker',
    label: String(el.data['label']),
    size: el.size ?? { w: 40, h: 40 },
  }),
  bounds: (el) => ({ x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h }),
  render(ctx, el) {
    ctx.fillStyle = '#3498db';
    ctx.fillRect(el.position.x, el.position.y, el.size.w, el.size.h);
  },
};
```

`index` is a fractional order key: elements stack by layer, then `index` (plain string `<`), then
`id`. Pass `index: ''` to place a new element on top of its layer; use `generateKeyBetween` for a
specific slot. `version` starts at 1 and the store bumps it on every local update; `editor` is set
only by sync. Never write `version` or `editor` from a tool.

### Rendering

- `render(ctx, el, allElements, worldBounds?)` draws in world coordinates; the camera transform is
  already applied. `worldBounds` is passed only to `fullCanvas` types and is the visible world
  rectangle (`minX`, `minY`, `maxX`, `maxY`).
- `emitSvg(el, allElements, viewBox)` returns markup that is inserted verbatim, so escape any user
  text. `viewBox` is the export rectangle for `fullCanvas` types; other types receive a zero box.
- `renderMode`: `'canvas'`, `'hybrid'` and `'none'` all draw through `render`. `register` throws
  for `'dom'`; extension elements are never DOM elements.
- An element updated again within 250 ms (a drag, remote moves, an animation) on a layer at full
  opacity is drawn directly every frame instead of from its layer cache, until it has been idle for
  250 ms. `render` must therefore depend only on its arguments, which the layer cache already
  requires.

### Resize and the interaction adapter

When the envelope carries `size` and the element is not locked, the select tool shows the core
corner handles and resizes `position` and `size` as it does for notes. Your `bounds` must read
`size`, or culling and selection disagree with the handles. Core draws no rotation handle for
extension elements; rotation goes through `interaction.rotate`. A constrained move steps them by
the snapped pointer delta but does not snap their centre the way it does for sized core elements.

`interaction` adds custom behaviour:

| Member            | Called                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `hitTestHandle`   | On pointer down over a selected element; return `{ id, cursor }` or `null`.    |
| `updateHandle`    | On drag of a handle returned above; return the updated `T`.                    |
| `renderSelection` | While selected, in world space, with `{ zoom, selectedCount }`.                |
| `rotate`          | By `viewport.rotateSelection()`; return `T` rotated around `pivot` by `delta`. |

`hitTestHandle` and `updateHandle` receive an `ExtensionInteractionContext` (`zoom`, `shiftKey`,
`selectedCount`, `snap`). Adapter handles are hit-tested before the core corner handles and drawn
on top of them. `updateHandle` and `rotate` results are wrapped and merged over the existing `data`.
Use `HANDLE_SIZE` and `HANDLE_HIT_PADDING` to match core handle metrics (divide by `zoom`).

## 3. Registries

`ElementRegistry` methods: `register(def)` returns an `ElementTypeKey<T>` (`matches`, checked
`unwrap`, `wrap`, `validateData`); `unregister(type)`; `has(type)`; `getTypes()`.

`new ElementRegistry(parent?)` looks up types in itself, then in `parent`. A `Viewport` created
without `elementRegistry` uses `new ElementRegistry(getDefaultElementRegistry())`, available as
`viewport.elementRegistry`.

- Registering a type the registry already holds throws.
- Registering a type the parent holds shadows it and logs a warning.
- `unregister` touches only the registry itself.

Register **globally** (`getDefaultElementRegistry().register(def)`) when a type must be readable
everywhere: several viewports, or code that runs before any viewport exists. Register **through a
plugin** (`ctx.registerElementType(def)`) when the type belongs to that viewport; it is removed when
the viewport is destroyed, and other viewports are unaffected.

Plugin-registered types live only on `viewport.elementRegistry`. Pass that registry wherever state
is read or written outside the viewport:

```typescript
import { AutoSave, exportSvg } from '@fieldnotes/core';

const autoSave = new AutoSave(viewport.store, viewport.camera, {
  layerManager: viewport.layerManager,
  pluginStateManager: viewport.plugins,
  elementRegistry: viewport.elementRegistry,
});

const svg = await exportSvg(viewport.store, { elementRegistry: viewport.elementRegistry });
```

Without it, the standalone exports fall back to the global registry and skip plugin elements' bounds
and rendering. AutoSave defaults to the registry of the store it is given.
`viewport.loadJSON`, `viewport.exportState` and `viewport.exportImage`/`exportSVG` use the viewport
registry automatically. In `@fieldnotes/sync`, `SyncClient` uses the registry of the store it is
given, so `store: viewport.store` is enough; if you pass `elementRegistry` (also on
`createManagedSyncConnection`), pass `viewport.elementRegistry`.

## 4. Versioning data

```typescript
const definition: ElementTypeDefinition<Marker> = {
  ...markerDefinition,
  dataVersion: 2,
  migrate(data, fromVersion) {
    // v1 stored the label as `text`.
    return fromVersion < 2 ? { label: data['text'] } : data;
  },
};
```

- `register` throws when `dataVersion` is not a positive integer, or is above 1 without `migrate`.
- `migrate` runs once per element on `parseState`, `viewport.loadJSON`, `viewport.loadState` and
  `AutoSave.load` when the stored `dataVersion` (absent means 1) is lower than the current one. It
  must return a plain object; the result is validated with `validateData` on
  `parseState`/`loadJSON`/`AutoSave.load`; `loadState` trusts its input and only checks the result
  is a record. The envelope is stamped with the current version. A throw fails the load with the
  element id. Higher stored versions are left alone.
- Elements are stamped with the current `dataVersion` when added to a store whose registry knows
  the type, so saved and synced data always carries its version.
- Sync never migrates: elements in memory are always current. Every peer in a room should run the
  same definition version.

## 5. Paste and duplicate

`cloneRemap(el, idMap)` lets a type keep references between pasted elements. Core calls it for each
extension clone with the full source-to-clone id map of the paste or duplicate. Core keeps the
clone's own base fields (new `id`, position, layer) and replaces `data` with the `data` of your
result, so dropped keys stay dropped.

```typescript
interface Pin extends BaseElement {
  type: 'my-app:pin';
  targetId: string;
}

const pinRemap: ElementTypeDefinition<Pin>['cloneRemap'] = (el, idMap) => ({
  ...el,
  targetId: idMap.get(el.targetId) ?? el.targetId,
});
```

## 6. Plugins

```typescript
import type { ViewportPlugin } from '@fieldnotes/core';

const markerPlugin: ViewportPlugin = {
  name: 'my-app:markers',
  configure(ctx) {
    ctx.registerElementType(markerDefinition);
  },
  start(ctx) {
    const off = ctx.store.on('add', () => ctx.requestRender());
    return { dispose: off };
  },
};

const viewport = new Viewport(container, { plugins: [markerPlugin] });
```

| `ViewportPlugin` field | Meaning                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `name`                 | Unique per viewport; a duplicate is skipped with a warning.          |
| `priority`             | Ascending install order, default 0; ties keep array order.           |
| `required`             | A failure in `configure` or `start` disposes all plugins and throws. |
| `configure(ctx)`       | Registration phase, no runtime access.                               |
| `start(ctx)`           | Runtime phase; may return a `PluginHandle`.                          |

Phases: all plugins `configure`, core finishes wiring, all plugins `start`, then the host's
`requiredCapabilities` are checked (section 7). `viewport.destroy()` disposes in reverse order: the
handle's `dispose`, then start disposers, then configure registrations.

An optional plugin that throws is rolled back (its registrations, disposers and services are
removed) and a warning is logged; the other plugins continue.

`PluginConfigureContext`: `elementRegistry`, `toolManager`, `registerElementType`, `registerTool`,
`registerViewportHooks`, `registerMinimapHooks`, `registerImageExportHooks`,
`registerSvgExportHooks`, `registerAction`. Everything registered here is removed on rollback and
dispose.

`PluginStartContext`: `viewport`, `store`, `pushHistory(command)`, `requestRender()`,
`invalidateMinimap()`, `registerService(key, value)`, `addDisposer(fn)`,
`registerExtraBounds(provider)` (extends the minimap's world area; returns a disposer),
`onChange(listener)`, `notifyChange()` (tells `viewport.onStateChange` listeners, e.g. persistence,
that plugin state changed).

### Plugin state

A `PluginHandle` with `exportState` and `loadState` persists under
`CanvasState.extensions[plugin.name]` as `{ version, data }`.

| Member                  | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `exportState()`         | Returns JSON-serializable state; required when `loadState` exists. |
| `loadState(data)`       | Applies state; `undefined` when the saved state has no entry.      |
| `validateState(data)`   | Throws to reject the whole load.                                   |
| `stateVersion`          | Current version, default 1.                                        |
| `migrateState(data, v)` | Upgrades older state.                                              |

When the saved version differs and `migrateState` is missing or throws, that plugin's state is
dropped (loaded as `undefined`) and the viewport logs a warning. State of plugins not installed is
preserved and written back on export.

## 7. Render hooks

| Surface       | Register with              | Hooks and arguments                                                                                                           |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `viewport`    | `registerViewportHooks`    | `beforeElements`, `afterElements`, `overlay`, `afterAll`: `(ctx, camera, dims)`; `afterLayer`: `(ctx, camera, dims, layerId)` |
| `minimap`     | `registerMinimapHooks`     | `afterElements(mapping: MinimapMapping)`                                                                                      |
| `imageExport` | `registerImageExportHooks` | `afterElements(mapping: ImageExportMapping)`                                                                                  |
| `svgExport`   | `registerSvgExportHooks`   | `afterElements(mapping: SvgExportMapping)`, write with `appendSvg`                                                            |

One viewport frame paints in this order:

1. Background, then `beforeElements` (base canvas).
2. For each visible layer in layer order: the layer's elements, then `afterLayer(…, layerId)` (base
   canvas; called for empty layers too).
3. `fullCanvas` elements, then hybrid strata.
4. The `afterElements` stratum, above all canvas and DOM content.
5. The overlay stratum: `overlay` hooks, then the active tool's `renderOverlay`.
6. `afterAll`.

Every hook except `overlay` gets a context scaled for device pixels only, so it draws in CSS pixels
in screen space; use `camera.worldToScreen` or apply `camera.position` and `camera.zoom` yourself.
`overlay` draws in world space: the camera transform is already applied. `dims` is
`RenderSurfaceDimensions` (`width`, `height`, `dpr`). Canvas elements painted after the first DOM
element go to hybrid strata, so they are above all `afterLayer` drawing. `afterLayer` and `overlay`
run on the viewport only; the minimap and exports have no equivalent. Hooks get no store or layer
manager argument: capture `PluginStartContext.store` and `viewport.layerManager` in `start` and close
over them.

`afterLayer` draws between layers. This one darkens a map layer and everything below it, while
later layers such as tokens stay bright:

```typescript
// in configure(ctx); mapLayerId is the host's map layer id
ctx.registerViewportHooks({
  afterLayer(ctx2d, camera, dims, layerId) {
    if (layerId !== mapLayerId) return;
    ctx2d.fillStyle = 'rgba(0,0,0,0.3)';
    ctx2d.fillRect(0, 0, dims.width, dims.height);
  },
});
```

This `afterElements` hook satisfies a capability while `shadeOn` is true:

```typescript
let shadeOn = true;

// in configure(ctx)
ctx.registerViewportHooks(
  {
    afterElements(ctx2d, camera, dims) {
      const origin = camera.worldToScreen({ x: 0, y: 0 });
      ctx2d.fillStyle = 'rgba(0,0,0,0.5)';
      ctx2d.fillRect(origin.x, origin.y, dims.width, dims.height);
    },
  },
  { satisfies: ['my-app:shade'], enabled: () => shadeOn },
);
```

`HookRegistrationOptions`:

| Option      | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `slot`      | `ViewportSlot`; an ordering bucket, then `priority`, then registration order.           |
| `priority`  | Default 0; lower runs first within a slot.                                              |
| `required`  | A throw from this entry fails the surface closed.                                       |
| `satisfies` | Capability ids this entry provides.                                                     |
| `enabled`   | Predicate checked every call; when false the entry neither runs nor satisfies anything. |

Slots order entries; they do not move a hook to another point in the frame.

### Overlays and overlay-only repaints

The overlay stratum always sits above DOM content. `viewport.registerOverlay(draw)` registers an
`overlay` hook that wraps `draw` in `save`/`restore` and swallows its errors, so one faulty overlay
skips its own drawing for that frame and is never quarantined. It returns an idempotent disposer.

`viewport.requestOverlayRender()` and `ToolContext.requestOverlayRender()` repaint only the overlay
stratum. Use them when only overlay drawing changed; use `requestRender()` for anything else. The
overlay host interfaces (`RemoteCursorOverlayHost`, `LingerOverlayHost` and the others) accept an
optional `requestOverlayRender` and fall back to `requestRender` without it.

### Capabilities and fail-closed rendering

A host declares what each surface needs with `ViewportOptions.requiredCapabilities`
(`RequiredCapabilities`: an array for every surface, or an object keyed by `RenderSurfaceName`).
After plugins start, the constructor throws if a required capability has no registered satisfier.

At render time a capability counts only when a satisfying entry is registered, enabled, and not
quarantined. A surface fails closed when a required capability is not active, or when a
quarantined entry was `required` or satisfied a required capability:

| Surface                     | Fail-closed behaviour                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport                    | The other hooks run, then an opaque `#000` mask covers the `afterElements` stratum; overlays and `afterAll` still draw.                                               |
| Minimap                     | Draws no scene content.                                                                                                                                               |
| `exportImage` / `exportSvg` | Throws `Required render capabilities are missing on <surface>: a, b`, or `Required render hook failed on <surface>` when a fail-closed entry threw during the export. |

A hook that throws is quarantined: the error goes to `reportError` once (or `console.error` where
`reportError` is missing), and the entry is not called again until its registration is disposed and
made anew. Because disabled entries do not satisfy, a host requiring a capability sees the mask
whenever its hook is disabled.

The registries are reachable as `viewport.renderHooks` (`RenderHooks`, created by
`createRenderHooks()`); each is a `TypedHookRegistry` with `register`, `call`,
`getMissingCapabilities`, `isFailClosed` and `setRequiredCapabilities`.
`setRequiredCapabilities` and `clear` are public on `viewport.renderHooks`, so trusted host code can
lower the requirement.

## 8. Services, actions and tools

### Services

```typescript
import { createServiceKey } from '@fieldnotes/core';

export const MarkerCountKey = createServiceKey<{ readonly count: number }>('my-app:marker-count');

// in start(ctx)
ctx.registerService(MarkerCountKey, {
  get count() {
    return ctx.store.getAll().filter((el) => el.type === 'extension').length;
  },
});

// in the host
const count = viewport.getService(MarkerCountKey)?.count;
```

Keys compare by identity, not by name; export the key from your package. Services are removed when
the plugin rolls back or the viewport is destroyed.

### Actions

Actions ([ADR-0007](adr/0007-action-registry.md)) back shortcuts, the context menu and
`viewport.actions.run(id)`. Register them in `configure` with `ctx.registerAction(definition)`
(`ActionDefinition`: `id`, `label`, `perform`, optional `shortcut`, `menu`, `enabled`, …). A
duplicate id throws. See the Actions section of the
[core README](../packages/core/README.md#actions).

### Tools

A tool implements `Tool` (`name`, `onPointerDown`, `onPointerMove`, `onPointerUp`, and optional
`onPointerCancel`, `onHover`, `onKeyDown`, `onActivate`, `onDeactivate`, `renderOverlay`). Register
it with `ctx.registerTool(tool)` in `configure`, or `viewport.toolManager.register(tool)` from the
host, then `viewport.setTool(name)`. Tools in `ViewportOptions.tools` replace same-named plugin
tools.

Call `ctx.requestOverlayRender()` when only `renderOverlay` output changed: an in-progress preview,
hover feedback, a marquee. A full frame also repaints the overlay.

Each pointer gesture is one history transaction, so store mutations made between pointer down and
up undo as one step. `ToolContext.elementRegistry` is the viewport registry; use it to look up
adapters, and use your definition's `wrap` to create envelopes:

```typescript
onPointerDown(state, ctx) {
  const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
  ctx.store.add(
    markerDefinition.wrap({
      id: crypto.randomUUID(),
      type: 'my-app:marker',
      position: world,
      index: '', // '' = place on top of the layer
      version: 1,
      locked: false,
      layerId: ctx.activeLayerId ?? '',
      label: 'New',
      size: { w: 40, h: 40 },
    }),
  );
  ctx.requestRender();
},
```

Store mutations already schedule a full frame, so the `requestRender()` above is redundant but
harmless; `requestOverlayRender()` alone never repaints elements.

Implement `onPointerCancel` when a pinch or platform cancel must not count as input.

## 9. Exports

`viewport.exportImage(options)` and `viewport.exportSVG(options)` pass the viewport's registry and
render hooks. The standalone `exportImage(store, options, layerManager?)` and
`exportSvg(store, options, layerManager?)` take them as options:

| Option                 | Meaning                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `elementRegistry`      | Adapters for extension bounds, rendering and SVG. Default: the global registry.     |
| `renderHooks`          | `RenderHooks` whose `imageExport` or `svgExport` hooks run after elements.          |
| `requiredCapabilities` | Added to the registry's stored requirement; with no `renderHooks`, all are missing. |

## 10. Limits

Not yet available:

- Parent/child elements and clipping (frames).
- Camera constraint providers.
- Field schemas for generic property editing of extension data.
- `afterLayer` on the minimap, in exports, or above hybrid strata.
