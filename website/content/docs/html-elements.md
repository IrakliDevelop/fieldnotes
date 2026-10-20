---
title: HTML elements
description: By the end of this page you have buttons and links that work on the board, HTML elements that come back after a reload, and a board that sits in a scrolling page.
group: Guides
order: 2
---

## Add an element

`viewport.addHtmlElement(node, position, size, options)` puts a DOM node on the board and returns the element's id. The node pans and zooms with the board, is drawn in layer order with the other elements, and is selected, moved, resized and rotated like a note. Without `size` it is 200 by 150 board units.

::code{example="html-elements" region="live-card"}

## Live elements

`interactive: true` makes the element live:

- A press on a control goes to the control, under every tool and from mouse, touch or pen. The board draws nothing, selects nothing and records no undo step.
- A press on any other part selects and moves the element, as on a note. An element made only of controls can't be selected or moved, so give it padding, as the card above has.
- When the element is selected, its resize and rotate handles take presses before the controls under them.
- While a control has focus, board shortcuts are off, Escape, Delete and undo included.
- Controls keep working on a locked layer.

The controls are `a[href]`, `button`, `input`, `select`, `textarea`, `label`, `summary`, editable content, `audio[controls]`, `video[controls]` and `iframe`.

The board below starts on the pencil. A click on Next turn goes to the button and draws nothing.

::board{example="html-elements"}

Without `interactive`, a press anywhere on the element selects and drags it. A double click or double tap enters interact mode, where its controls work, and Escape or a press outside the element leaves it. `viewport.stopInteracting()` leaves it from code.

## Controls and drag areas

Two attributes change what counts as a control:

- `data-fn-control` makes any element a control, such as a custom slider that handles its own pointer events.
- `data-fn-drag` makes an area move the element, even inside a control.

The attribute nearest the pressed node wins. This card is a link from edge to edge, so only its Move grip drags it:

::code{example="html-elements" region="link-card"}

## Keep elements after a reload

A saved board keeps each HTML element's position, size, `htmlType`, `data` and `interactive`. The DOM node is not saved. Register a renderer for the `htmlType` before you load, and the board builds the node again from `data`. The renderer also runs when another person on a shared board adds the element, and when an undo brings a deleted one back.

::code{example="html-elements" region="renderer"}

`addHtmlElement` keeps the node you pass it and doesn't call the renderer. An element with no node and no renderer shows a placeholder named after its `htmlType`, such as "initiative widget".

On a shared board, `data` and `interactive` come from other people too. Build nodes with `textContent`, and check any URL from `data` before it goes into `href` or `src`.

## Boards in a scrolling page

`embedded: true` makes the board share the page's scrolling:

- A plain wheel scrolls the page. Ctrl+wheel or ⌘+wheel zooms at the cursor.
- Touch is ignored until your page engages the board, so a one-finger swipe scrolls the page. Mouse and pen always work.
- While engaged, the board takes touch as before. Escape anywhere on the page disengages it, unless focus is in a text field or editable content.

The viewport reads `embedded` once, when it is created. `setEmbeddedEngaged(engaged)` engages or disengages the board, `isEmbeddedEngaged()` reads the state, and `onEmbeddedEngagedChange(listener)` reports each change, Escape included. Disengaging cancels touch gestures in progress without an undo step and keeps the selection.

`onWheelPassThrough(listener)` fires for every plain wheel the board leaves to the page, for a "Hold Ctrl to zoom" hint. It is not throttled.

:::margin
Disable `select.cycle` and `select.cycle-reverse`, or Tab moves between elements and never leaves the board.
:::

::code{example="html-elements" region="embedded"}

A board without `embedded` reports `true` from `isEmbeddedEngaged()`, ignores `setEmbeddedEngaged` and never calls the listeners. The boards in these docs are embedded; on a touch screen, Draw on this board engages one.

Disengaged touch still reaches the minimap, `setActivation`, `PingInput` and `CameraAnimator`. Two parts have only unit tests: the guard that stops a disengaged Apple Pencil or Android stylus from scrolling the page has not been checked on a device, and wheel and gesture handling has not been run in Safari.
