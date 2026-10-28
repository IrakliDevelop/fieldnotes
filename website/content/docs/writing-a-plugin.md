---
title: Writing a plugin
description: By the end of this page you have your own element type on the board, a tool that places it, and one plugin that installs both.
group: Guides
order: 8
---

A plugin adds element types, tools, render hooks, actions and services to a board when its viewport is created. This page builds a first one: a marker element and a tool that places markers. [EXTENDING.md](https://github.com/IrakliDevelop/fieldnotes/blob/master/docs/EXTENDING.md) covers the rest of the extension API.

## Define an element type

::code{example="writing-a-plugin" region="definition"}

- The board stores your element as an envelope: `type: 'extension'`, your definition's `type` as `extensionType`, and your own fields in `data`, which must be JSON. `wrap` builds the envelope and `unwrap` reads your element back out of it. `pickBaseFields` copies the fields every element has, such as `id`, `position` and `layerId`.
- `validateData` checks `data` when a board is loaded and when an element arrives from another person.
- `bounds` returns the area the element covers, in board units. Culling, selection, the minimap and exports use it. An envelope with `size` gets resize handles from the select tool, so `bounds` must read `size`.
- `render` draws in board coordinates, with the camera already applied. It must depend only on its arguments, because the board caches each layer's drawing.
- `legacyTypes` lists older `type` strings the definition reads. A new type has none, so `decodeLegacy` is never called.
- An SVG export leaves the element out unless the definition has `emitSvg`.

## Add a tool

::code{example="writing-a-plugin" region="tool"}

- `ctx.camera.screenToWorld` turns the pointer position into board coordinates. `index: ''` puts the new element on top of its layer, and `version` starts at 1.
- Each pointer gesture is one history transaction, so whatever a tool changes between press and release undoes in one step.
- When a second finger turns the gesture into a pinch, the tool gets `onPointerCancel` if it has one, and `onPointerUp` if not. To keep a pinch from leaving a marker, remove it in `onPointerCancel`.

## Install it with a plugin

::code{example="writing-a-plugin" region="plugin"}

- `configure` runs while the viewport is created. The types and tools it registers belong to that viewport and are removed when it is destroyed.
- `name` must be unique on the viewport. A second plugin with the same name is skipped with a warning.
- A plugin that throws is rolled back with a warning, and the others carry on. With `required: true`, the viewport throws instead.
- `start(ctx)` gives a plugin the running board, and its returned handle can save plugin state with the board. EXTENDING.md section 6 has the details.

## Save and share markers

- `exportJSON`, `loadJSON`, `exportImage` and `exportSVG` on the viewport use its registry, so they know the marker type. The standalone `exportImage` and `exportSvg` functions need `elementRegistry: viewport.elementRegistry`.
- A board without the plugin keeps the markers in a saved board, logs a warning and doesn't check their data.
- [`SyncClient`](/docs/multiplayer/) runs `migrate` on incoming elements with an older `dataVersion` and keeps newer data as is. A peer on an older definition can still edit newer data in its old shape, so everyone in a room should run the same version of the definition. When `data` changes shape, raise `dataVersion` and add `migrate`, as EXTENDING.md section 4 shows.
