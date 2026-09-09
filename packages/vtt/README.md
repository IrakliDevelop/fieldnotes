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

Requires `@fieldnotes/core` `>=0.82.0` (peer dependency).

## Register element types

Before using grid or template elements, register their type definitions with the core serializer:

```typescript
import { registerVttElementTypes } from '@fieldnotes/vtt';

registerVttElementTypes();
```

## Fog of War

Tile-based fog of war with CRDT sync, undo/redo integration, and configurable rendering styles.

```typescript
import { Viewport } from '@fieldnotes/core';
import { createFogPlugin, FogManager, FogTool } from '@fieldnotes/vtt';

const container = document.querySelector('#canvas');
if (!(container instanceof HTMLElement)) throw new Error('Missing canvas container');
const fogManager = new FogManager();
fogManager.initialize({
  bounds: { x: 0, y: 0, w: 4096, h: 4096 },
  base: 'covered',
  cellSize: 32,
});
const fogPlugin = createFogPlugin({ manager: fogManager });
const viewport = new Viewport(container, { plugins: [fogPlugin] });

// Reveal/conceal with the fog tool
const fogTool = new FogTool(fogManager, { operation: 'reveal' });
viewport.toolManager.register(fogTool);
```

### Fog sync

Fog state syncs across clients through the generic sync plugin contract. The VTT client factory
encapsulates pending edits, offline capture, snapshot merge/replay, and rollback protection while
keeping `@fieldnotes/sync` domain-neutral.

```typescript
import { SyncClient } from '@fieldnotes/sync';
import { createFogClientPlugin } from '@fieldnotes/vtt/sync';

const client = new SyncClient({
  store,
  transport,
  clientId: 'client-1',
  plugins: [createFogClientPlugin({ manager: fogManager })],
});
```

Server and Redis deployments use `createFogServerPlugin()` from `@fieldnotes/vtt/server` and
`createFogBackendPlugin()` from `@fieldnotes/vtt/redis` respectively. These retain the v3
`fog-meta`/`fog-patch` wire format.

### Fog rendering

Fog supports solid and procedural rendering styles:

```typescript
import { FogRenderer, resolveFogStyle, renderFogStylePreview } from '@fieldnotes/vtt';
```

## Measure Tool

Distance measurement with ruler-style overlays and shared presence for collaborative measurement.

```typescript
import { MeasureTool, RemoteMeasureOverlay } from '@fieldnotes/vtt';

const measure = new MeasureTool({ feetPerCell: 5 });
measure.onMeasurement((emission) => console.log(emission?.feet));
viewport.toolManager.register(measure);
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

const template = new TemplateTool({ templateShape: 'cone', feetPerCell: 5 });
viewport.toolManager.register(template);
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
} from '@fieldnotes/vtt/redis';
```

## License

MIT
