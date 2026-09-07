# @fieldnotes/vtt

VTT domain tools and overlays for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes)
canvas SDK. Framework-free vanilla TypeScript.

This package provides tabletop-specific features that compose with `@fieldnotes/core` via the
Viewport plugin system: fog of war, measurement tools, grid snapping, and map templates. It also
owns the fog sync protocol types and CRDT logic used by `@fieldnotes/sync` for real-time fog
collaboration.

## Install

```bash
pnpm add @fieldnotes/vtt @fieldnotes/core
```

Requires `@fieldnotes/core` `>=0.75.0` (peer dependency).

## Register element types

Before using grid or template elements, register their type definitions with the core serializer:

```typescript
import { registerVttElementTypes } from '@fieldnotes/vtt';

registerVttElementTypes();
```

## Fog of War

Tile-based fog of war with CRDT sync, undo/redo integration, and configurable rendering styles.

```typescript
import { createFogPlugin, FogManager, FogTool } from '@fieldnotes/vtt';

const fogManager = new FogManager({
  definition: {
    /* ... */
  },
});
const fogPlugin = createFogPlugin({ manager: fogManager });
viewport.addPlugin(fogPlugin);

// Reveal/conceal with the fog tool
const fogTool = new FogTool({ manager: fogManager, mode: 'reveal' });
```

### Fog sync

Fog state syncs across clients via `FogSyncController`, which encapsulates the full CRDT state
machine — pending edit tracking, offline capture, snapshot merge/replay, and rollback protection.
The controller emits `sendOp` and `stateChange` events that the sync layer bridges to transport.

```typescript
import { FogSyncController } from '@fieldnotes/vtt';

const controller = new FogSyncController({
  clientId: 'client-1',
  manager: fogManager,
});

controller.on('sendOp', (op) => transport.send(op));
controller.on('stateChange', () => {
  /* fog state updated from remote */
});
```

The `FogLedger` class handles CRDT conflict resolution with `(version, editor)` LWW ordering and
generation-aware tile tracking. It is used internally by the controller and can also be used
standalone for server-side fog state.

### Fog rendering

Fog supports solid and procedural rendering styles:

```typescript
import { FogRenderer, resolveFogStyle, renderFogStylePreview } from '@fieldnotes/vtt';
```

## Measure Tool

Distance measurement with ruler-style overlays and shared presence for collaborative measurement.

```typescript
import { MeasureTool, RemoteMeasureOverlay } from '@fieldnotes/vtt';

const measure = new MeasureTool({ viewport });
measure.on('measure', (m) => console.log(m.distance));
```

## Grid

Grid snapping, constraint services, and distance metrics supporting square, hex, and custom grids.

```typescript
import { GridController, GridConstraintService, pathDistanceCells } from '@fieldnotes/vtt';
```

## Template

Map template placement tool for dropping pre-defined layouts onto the canvas.

```typescript
import { TemplateTool } from '@fieldnotes/vtt';

const template = new TemplateTool({
  viewport,
  template: {
    /* ... */
  },
});
```

## Fog Redis persistence

Lua scripts and preprocessing helpers for Redis-backed fog persistence, used by
`@fieldnotes/sync-redis`:

```typescript
import {
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  tileIntersectsDefinition,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
} from '@fieldnotes/vtt';
```

## License

MIT
