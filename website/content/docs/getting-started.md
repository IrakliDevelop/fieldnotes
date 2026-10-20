---
title: Getting started
description: By the end of this page you have a board in your app that you can draw on and that survives a reload.
group: Start
order: 1
---

## Install

```bash
npm install @fieldnotes/core
```

`@fieldnotes/core` has no runtime dependencies and needs no framework. It ships ES module and CommonJS builds with TypeScript types.

## Mount a board

Create a `Viewport` on any element. Passing `tools: 'default'` registers select, pencil, eraser, shapes, arrows, notes, text and pan, and starts on select.

:::margin
Give the container a height. A canvas with nothing to fill is 0 pixels tall.
:::

::code{example="getting-started" region="mount"}

::board{example="getting-started"}

## Save and restore

The whole board, including layers and camera, serialises to one JSON string. Store it anywhere that holds text.

:::margin
onStateChange fires on every camera move too. Debounce the save.
:::

::code{example="getting-started" region="save-debounced"}

[Saving and loading](/docs/saving-and-loading/) shows `AutoSave`, which debounces the save for you and can write to IndexedDB.

## Clean up

Call `viewport.destroy()` when the board leaves the page. It removes the board's DOM and listeners, stops the render loop and frees cached images.

::code{example="getting-started" region="cleanup"}
