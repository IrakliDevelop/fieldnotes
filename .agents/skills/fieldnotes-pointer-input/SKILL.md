---
name: fieldnotes-pointer-input
description: Invariants, mandatory tests, and review checks for Field Notes pointer, touch, stylus, keyboard, and gesture-to-history handling in packages/core canvas input, tools, and history. Use when changing or reviewing InputHandler, InputFilter, tools, keyboard routing, element activation, or history transactions.
---

# Field Notes pointer input

Mouse, touch, and stylus must behave equivalently, and one gesture is one undo step. These rules
describe the current code; if the code disagrees, the code wins and this skill gets fixed.

## Scope

`packages/core/src/canvas/input-handler.ts`, `input-filter.ts`, `keyboard-handler.ts`,
`shortcut-map.ts`, `element-activation.ts`, `packages/core/src/tools/` (`types.ts`,
`tool-manager.ts`, each tool), and `packages/core/src/history/history-recorder.ts`.

## Invariants

- **Cancel commits.** `dispatchToolDown` calls `HistoryRecorder.begin()`, `dispatchToolUp` calls
  `commit()`, and `dispatchToolCancel` also calls `commit()`, not `rollback()`. A tool's
  `onPointerCancel` must revert its own partial mutations, or they become an undo step.
- One pointer drives the tool. When a second pointer goes down, `InputHandler` runs `startPinch`
  then `cancelToolIfActive`: the tool is cancelled and navigation takes over. The pinch baseline
  resets whenever pointer membership changes while two or more pointers remain.
- `toolPointerId` owns the gesture. An up, cancel, or leave from any other pointer never ends it
  (`finishPointer` ignores foreign ends).
- `setPointerCapture` runs on every down. `onLostPointerCapture` cancels only while the pointer is
  still active. `pointerleave` commits like an up.
- Window `blur` and document `visibilitychange` call `abandonGestures`.
- `touchAction` on the canvas element stays `'none'`.
- Palm rejection (`InputFilter`): while a pen is down (`activePenId`), touch is suppressed. A touch
  down is deferred until it moves more than `MIN_MOVE_DISTANCE` (3 px) or lifts.
- A pen that is not pressed routes to the tool's `onHover` (`dispatchToolHover`).
- Pressure: `pressure === 0` means `DEFAULT_PRESSURE` in `pencil-tool.ts`; width comes from
  `pressureToWidth`.
- Touch long press (`LONG_PRESS_MS`) opens the context menu, with the select tool only.
- Keyboard (`KeyboardHandler`): events from contentEditable, `INPUT`, `TEXTAREA`, and `SELECT` are
  ignored. Scope is `'focus'` or `'window'` (`ShortcutMap`). The active tool's `onKeyDown` runs
  before shortcuts.
- `ElementActivation` is a passive observer: passive listeners, no `preventDefault`, no
  `stopPropagation`, no capture. Hidden layers do not activate; locked layers do.

## Mandatory tests

An input change covers every category that applies:

1. Mouse path (`canvas/input-handler.test.ts` or the tool's `tools/*.test.ts`).
2. Touch path, including deferred touch down (`canvas/input-filter.test.ts`).
3. Pen path, as a unit test: e2e cannot emit `pointerType: 'pen'`.
4. Second-pointer takeover cancels the tool and starts navigation (`e2e/touch-input.e2e.ts`).
5. Cancel and lost capture leave no history entry and no partial element
   (`history/history-recorder.test.ts`, `e2e/history.e2e.ts`).
6. Blur and visibility change abandon the gesture.
7. Exactly one undo step per completed gesture.
8. Keys typed in an editable target are ignored (`e2e/focus.e2e.ts`).

## Review checklist

- Each invariant above, line by line, against the diff.
- New listeners are removed in `InputHandler.destroy()` or `ElementActivation.dispose()`.
- Every new tool mutation happens between `begin()` and `commit()`, and `onPointerCancel` reverts it.
- No `pointerType` branch that gives touch or pen less behavior than mouse without a stated reason.
