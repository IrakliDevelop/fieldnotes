---
title: Saving and loading
description: By the end of this page you can store a board as JSON, load it back, and have it save itself to IndexedDB.
group: Start
order: 3
---

## Export the board

`viewport.exportJSON()` returns the board as one JSON string: its elements, layers, active layer, camera and plugin state. Undo history is not included. `exportState()` returns the same data as a `CanvasState` object.

::code{example="saving-and-loading" region="export"}

## Load a saved board

::code{example="saving-and-loading" region="load"}

`loadJSON` checks the data and upgrades boards saved by older versions of `@fieldnotes/core`. It throws on data it can't read, including a board saved by a newer version, and leaves the current board as it was. Loading replaces the whole board and clears undo history.

`loadState` takes a `CanvasState` object and skips the check, so give it only state your own code exported.

The board below opens a saved board with two strokes and a note.

::board{example="saving-and-loading"}

## Save automatically

`AutoSave` saves the board 1000ms after the last change to its elements, layers or camera. Set `debounceMs` to change the wait.

::code{example="saving-and-loading" region="autosave"}

- Without `adapter`, it saves to `localStorage` through `LocalStorageAdapter`. `IndexedDBAdapter` stores the board in IndexedDB, for boards too large for `localStorage`. `MemoryAdapter` keeps it in memory, for tests.
- Pass `layerManager`, or the saved board loses its layers. A board with plugins also passes `pluginStateManager: viewport.plugins`, or plugin state is left out.
- `load()` checks the saved board as `loadJSON` does, so its result can go to `loadState`. When it can't read the board, it returns `null`, passes the error to `onError` and saves nothing until a later `load()` succeeds or you call `clear()`. That way a board written by a newer version is not overwritten.
- Call `autoSave.stop()` before `viewport.destroy()`.
