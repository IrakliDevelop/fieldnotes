---
title: Undo and history
description: By the end of this page you have undo and redo buttons, and changes your code makes undo in one step.
group: Guides
order: 4
---

Each thing a person does on the board is one undo step: a stroke, a drag, a resize, an erase. mod+Z undoes, and mod+Y or mod+Shift+Z redoes, where `mod` is Ctrl or ⌘.

## Undo and redo buttons

`viewport.undo()` and `viewport.redo()` return `false` when there is nothing to undo or redo. `viewport.history.canUndo` and `canRedo` say whether there is, and `history.onChange` fires when either may have changed:

::code{example="undo-and-history" region="buttons"}

The board keeps the last 100 undo steps. `loadJSON` and `loadState` clear them, and a saved board doesn't include them. The undo and redo keys do nothing while a pointer gesture is in progress.

## What counts as one step

- A pointer gesture that changes the board, from press to release, under any tool. A built-in tool whose gesture a second finger cancels leaves no step.
- A finished note or text edit, including the resize that fits the text. Leaving the editor without a change records nothing.
- A run of arrow-key nudges, each less than 400ms after the one before.
- Each call of a viewport method that changes elements: `addShape`, `addImage`, `addHtmlElement`, `removeElements`, `removeLayer`, `applyStyleToSelection`, `groupSelection`, `ungroupSelection`, `alignSelection`, `distributeSelection`, `rotateSelection` and `toggleLockSelection`, and the delete, duplicate and paste actions.
- Each layer change, as [Layers](/docs/layers/) lists.

A `store.add`, `store.update` or `store.remove` call outside a transaction is a step of its own.

## Group your own changes

Store and layer changes made inside `viewport.transaction(fn)` are one undo step, built-in methods included:

::code{example="undo-and-history" region="transaction"}

- Only changes made before `fn` returns count. Changes after an `await` inside it are outside the transaction.
- A transaction started inside another one, or during a pointer gesture, joins the open one.
- If `fn` throws, the changes it already made stay on the board as one undo step, and the error is thrown on.
- `transaction` returns what `fn` returns.

## Changes that skip undo

A store change whose `origin` is anything other than `'local'` is not recorded. Edits from other people on a shared board arrive this way, so mod+Z undoes only your own. Use an origin for changes your app applies from its own data:

::code{example="undo-and-history" region="origin"}

Store listeners receive `{ origin }` as their second argument, so your sync code can skip sending such changes back.
