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

## Mount a board

Create a `Viewport` on any element. Passing `tools: 'default'` registers select, pencil, eraser, shapes, arrows, notes, text and pan, and starts on select.

:::margin
Give the container a height. A canvas with nothing to fill is 0 pixels tall.
:::

::code{example="getting-started" region="mount"}

::board{example="getting-started"}

## Clean up

Call `viewport.destroy()` when the board leaves the page. It removes its listeners and stops the render loop. The [docs index](/docs/) lists the other guides.
