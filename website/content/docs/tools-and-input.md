---
title: Tools and input
description: By the end of this page you can choose a board's tools, drive them from your own toolbar, and know what mouse, touch, pen and each key do.
group: Guides
order: 1
---

## Choose the tools

`tools: 'default'` registers eight tools and starts on select. Each has a name for `setTool` and a key:

- `select` (V, `SelectTool`): selects, moves, resizes and rotates elements. A drag across empty board selects what the box touches, and Shift+click adds an element to the selection or takes it out.
- `hand` (H, `HandTool`): pans the board.
- `pencil` (P, `PencilTool`): draws smoothed freehand strokes.
- `eraser` (E, `EraserTool`): erases the part of a stroke it passes over and leaves other elements alone.
- `arrow` (A, `ArrowTool`): draws curved arrows that can attach to elements.
- `note` (N, `NoteTool`): places sticky notes.
- `text` (T, `TextTool`): places text.
- `shape` (S, `ShapeTool`): draws rectangles, ellipses and lines.

For a different set, pass a list. `createDefaultTools()` returns new instances of the eight, and `ImageTool` places images:

::code{example="tools-and-input" region="choose"}

`viewport.toolManager.register(tool)` adds a tool to a board that is already running.

## Switch tools from your toolbar

`viewport.setTool(name)` switches the tool. `toolManager.onChange` reports every switch, including one made with a key, so the toolbar can follow it:

::code{example="tools-and-input" region="switch"}

## Change tool options

Each tool takes options in its constructor, and `setOptions` changes them while the board runs. `getTool` finds a registered tool by name.

::code{example="tools-and-input" region="options"}

The highlighter is a second `PencilTool` under its own name, so `setTool('highlighter')` picks it. A tool whose name is not one of the eight above has no default key.

`EraserTool` takes `radius` in screen pixels (default 20), and `mode: 'stroke'` makes it delete whole strokes. Hold Shift while drawing a line to snap it to 45° steps.

## Mouse, touch and pen

The board reads Pointer Events, so mouse, touch and pen drive the same tools.

- One pointer drives the active tool. When a second finger lands, the tool's gesture is cancelled and two fingers pan and pinch-zoom the board. A stroke cut short this way leaves nothing behind.
- The mouse wheel zooms at the cursor. Middle-button drag, or Space and drag, pans. A pan that ends in a flick coasts; `panInertia: false` turns that off.
- A touch reaches the tool once it moves more than 3px or lifts. With the select tool, a 500ms long press opens the context menu.
- Pen pressure sets the stroke's width along its length, from 0.4 to 1.8 times the pencil's `width`. Input without pressure draws at 0.5.
- While a pen is down, touches are ignored, so a palm resting on the screen draws nothing.

A double click or double tap edits a note or text. Right-click, or the long press, opens a menu with cut, copy, paste, duplicate, delete, order, rotate and lock. `contextMenu: false` removes it.

For a board inside a scrolling page, [Boards in a scrolling page](/docs/html-elements/#boards-in-a-scrolling-page) shows `embedded`, which leaves the plain wheel and one-finger swipes to the page.

## Keyboard shortcuts

Shortcuts work while the board has focus, and a click on the board gives it focus. With `shortcuts: { scope: 'window' }` they work anywhere on the page. Keys typed into an input, a textarea, a select, editable content or a control on a live HTML element never reach the board.

`mod` is Ctrl or ⌘. Each shortcut runs a named action:

- Delete or Backspace: `edit.delete`
- Escape: `select.none`
- mod+Z: `edit.undo`
- mod+Y or mod+Shift+Z: `edit.redo`
- mod+A: `select.all`
- Tab and Shift+Tab: `select.cycle` and `select.cycle-reverse`
- mod+C, mod+X and mod+D: `edit.copy`, `edit.cut` and `edit.duplicate`
- mod+V pastes through the browser's paste event; `edit.paste` has no key
- `]` and `[`: `arrange.bring-forward` and `arrange.send-backward`
- mod+`]` and mod+`[`: `arrange.bring-to-front` and `arrange.send-to-back`
- mod+G and mod+Shift+G: `arrange.group` and `arrange.ungroup`
- mod+Shift+L: `arrange.toggle-lock`
- R and Shift+R: `arrange.rotate-cw` and `arrange.rotate-ccw`
- Arrow keys: `arrange.nudge-left`, `arrange.nudge-right`, `arrange.nudge-up` and `arrange.nudge-down`, 1 unit at a time or 10 with Shift
- Shift+1: `view.zoom-to-fit`
- mod+=, mod+- and mod+0: `view.zoom-in`, `view.zoom-out` and `view.zoom-reset`
- The tool keys above: `tool.select`, `tool.hand`, `tool.pencil`, `tool.eraser`, `tool.arrow`, `tool.note`, `tool.text` and `tool.shape`

Rebind keys with `shortcuts.bindings` in the options, or later with `viewport.shortcuts.rebind(action, keys)`. `null` as the keys, or `disable(action)`, turns a shortcut off. `reset()` restores the defaults, and `getBindings()` returns the current table for a settings screen.

::code{example="tools-and-input" region="shortcuts"}

On a board that sits in a page, disable `select.cycle` and `select.cycle-reverse` as above. Otherwise Tab moves between elements and keyboard users can't leave the board. `viewport.runAction(action)` runs any action from your own buttons.

## Write your own tool

A tool is an object with a `name`, `onPointerDown`, `onPointerMove` and `onPointerUp`; register it with `viewport.toolManager.register(tool)`. The store changes it makes from pointer down to pointer up are one undo step. When a second finger cancels the gesture, `onPointerCancel` must remove what the tool added, or it stays on the board as an undo step. The [core README](https://github.com/IrakliDevelop/fieldnotes/blob/master/packages/core/README.md#custom-tools) lists the whole `Tool` interface.
