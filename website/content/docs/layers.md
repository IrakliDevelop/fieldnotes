---
title: Layers
description: By the end of this page you can put elements on named layers, hide and lock them, and show the layer list in your own UI.
group: Guides
order: 3
---

Every board starts with one layer, "Layer 1". New elements go on the active layer. Every element on a higher layer is drawn above every element on a lower one, whatever their order within each layer.

## Create and lock layers

`viewport.layerManager` holds the layers. `createLayer(name)` adds a layer above the others. This code renames the first layer to Map, adds a Tokens layer above it for new elements, and locks the map:

::code{example="layers" region="create"}

- A hidden layer is not drawn, can't be selected or erased, and is left out of PNG and SVG exports.
- A locked layer is still drawn, but its elements can't be selected, erased or used as arrow ends. Controls on live HTML elements keep working.
- The active layer can't be hidden or locked. Hiding or locking it first makes the top visible, unlocked layer active. When there is none, `setLayerVisible` and `setLayerLocked` return `false` and change nothing.
- `setLayerOpacity(id, opacity)` fades the whole layer, from 0 to 1, on screen and in exports.
- `reorderLayer(id, order)` moves a layer; a higher `order` is drawn on top. `renameLayer(id, name)` renames it.

A layer lock differs from an element lock (`arrange.toggle-lock`, mod+Shift+L): a locked element can still be selected, but it can't be moved, resized or rotated.

## Move elements between layers

`moveElementToLayer(elementId, layerId)` moves one element. Wrapped in a transaction, a batch of moves is one undo step:

::code{example="layers" region="move"}

`viewport.removeLayer(id)` removes a layer and moves its elements to the active layer, in one undo step. Removing the active layer first makes the top remaining layer active. Removing the last layer throws.

## Show the layer list

`getLayers()` returns copies of the layers, bottom first. `layerManager.on('change', listener)` fires after every layer change, a new active layer included:

::code{example="layers" region="list"}

Creating, removing, renaming, reordering, hiding, locking and fading a layer are undo steps. Choosing the active layer is not. The layers and the active layer are saved with the board, as [Saving and loading](/docs/saving-and-loading/) shows. In React, `useLayers` from [Using React](/docs/using-react/) re-renders a component when the layers change.
