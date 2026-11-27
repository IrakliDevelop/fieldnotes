---
title: Tabletop maps
description: By the end of this page you have a hex map with measuring, area templates and fog of war that the game master paints and players see as solid.
group: Guides
order: 7
---

`@fieldnotes/vtt` adds tabletop tools to a board: square and hex grids, a measuring tool, area templates and fog of war. [Open the tabletop scene](/playground/?scene=tabletop) in the playground to try them on a hex map.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/vtt
```

## Set up the table

::code{example="tabletop-maps" region="table"}

- `registerVttElementTypes()` registers the grid and template elements. Call it once per page, before a board loads a saved map. A second call throws.
- `MeasureTool` (`measure`) draws a ruler from press to release and reports the distance in cells and feet, at `feetPerCell` feet per cell (default 5). The ruler goes away on release and adds nothing to the board or to undo history. `onMeasurement(listener)` reports it while it changes.
- `TemplateTool` (`template`) places an area template: press at its origin and drag out its size. The shapes are `circle`, `cone`, `line`, `square` and `rectangle`, and `setOptions({ templateShape })` switches between them. A template is an element, so it saves and undoes with the board.
- `FogTool` (`fog`) paints the fog, as the next sections show.

## Add a grid

::code{example="tabletop-maps" region="grid"}

`GridController` keeps one grid on the board. `add` replaces any grid already there, `update` changes its type or cell size, and `remove` takes it away, each as one undo step. While a grid is on the board, the measure and template tools snap to it.

## Paint the fog

::code{example="tabletop-maps" region="fog"}

- `initialize` covers the area in fog (`base: 'covered'`) or leaves it clear (`'revealed'`), in cells of `cellSize` board units. On a shared board only the game master calls it, and players receive the fog from the relay.
- Fog is not drawn until `setViewMode` picks a view. `'editor'` draws it translucent, so the game master still sees the map, and `'player'` draws it solid.
- The game master paints with the fog tool. `operation` is `'reveal'` or `'conceal'`, and `shape` is `'brush'` (sized by `radius`), `'rectangle'` or `'polygon'`. `fogTool.setOptions({ operation: 'conceal' })` switches.
- The fog is saved with the board in `exportJSON()`, and an [export](/docs/export/) draws it as the current view shows it.

## Share the fog

::code{example="tabletop-maps" region="fog-sync"}

`createFogClientPlugin` from `@fieldnotes/vtt/sync` sends fog edits through the sync client, and `createFogServerPlugin` from `@fieldnotes/vtt/server` applies them on the relay. Its `authorize` decides who may change the fog, here only the game master. The plugin throws at startup without `authorize`, unless you pass `allowAnyWriter: true` to let every player change the fog. With Redis, the backend also takes `createFogBackendPlugin()` from `@fieldnotes/vtt/redis`.

By default, fog hides the map on screen only. Every client in the room receives the whole fog and the elements under it, and the player view draws the fog over them.

Pass `seesUnderFog(viewer, element)` to `createFogServerPlugin` and the relay stops sending an element that is fully under fog to a viewer, unless the hook returns `true` for that viewer and element. `seesUnderFog: (viewer, element) => viewer.role === 'gm' || element.ownerId === viewer.userId` lets the game master see everything and each player see their own tokens. The `ownerId` half is only safe when `createSyncServer` also gets an `authorize` hook, because only then does the relay set `ownerId` from the signed-in user. The relay needs `resolvePresenceAudience` too, and throws at startup without it. With several relay instances, upgrade every one to `@fieldnotes/sync-server` 0.33.0 before turning it on: an older instance sends gated elements to its own players.

- An element is fully covered when its bounds lie inside the fog bounds and every fog cell they touch is covered. Grids are never covered, an area template uses its template bounds, and a token's movement record follows the last point of its trail.
- When the game master reveals or conceals, the relay sends each player the elements they gained and removes the ones they lost.
- The relay still sends every player the fog itself, the map image and any element only partly under fog, presence (cursors and drags), the ids of deleted elements, and elements of custom extension types.

Give anything players must not receive at all, such as a trap or a secret door, an audience the relay's `canRead` denies them, as [Multiplayer](/docs/multiplayer/) shows. The relay then never sends those elements to them, and when `canReadLayer` hides their layer, they don't receive its name either.
