# Text Tool Design

## Overview

Add a standalone text tool to `@fieldnotes/core` — click-to-place text boxes on the infinite canvas with element-level styling (fontSize, color, textAlign). Text elements are "naked" (no background/border) and auto-grow vertically as content is typed.

## Decisions

| Decision      | Choice                                            | Rationale                                                                          |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Placement     | Click-to-place with default width                 | Most common in whiteboard tools (FreeForm, Miro). Drag-to-size can be added later. |
| Styling scope | Element-level only (fontSize, color, textAlign)   | Rich text is a rabbit hole; start minimal, extend later.                           |
| Visual style  | Naked text, dashed border on select/edit only     | Standard for text tools; clear distinction from sticky notes.                      |
| Edit trigger  | Double-click (match notes), auto-edit on creation | Consistency with existing note editing UX.                                         |
| Architecture  | New `TextElement` type + `TextTool`               | Clean separation from notes; independent evolution.                                |

## Element Type

```typescript
interface TextElement extends BaseElement {
  type: 'text';
  size: Size;
  text: string;
  fontSize: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}
```

Added to `CanvasElement` discriminated union. Defaults: `fontSize: 16`, `color: '#1a1a1a'`, `textAlign: 'left'`, `size: { w: 200, h: 28 }`.

## TextTool

Follows `NoteTool` pattern:

- `onPointerUp`: screen→world coords, create `TextElement` via factory, add to store, switch to select tool, auto-enter edit mode
- No `onPointerDown`/`onPointerMove` logic (instant placement)
- Configurable via constructor + `setOptions()`: `fontSize`, `color`, `textAlign`
- `onActivate`: call `ctx.setCursor?.('text')` to show text cursor
- `onDeactivate`: call `ctx.setCursor?.('default')` to reset cursor

## Element Factory

`createText(input: TextInput): TextElement` in `element-factory.ts`. Generates unique ID, applies defaults.

## DOM Rendering

In `viewport.ts`'s `renderDomContent()`, new `'text'` case:

- No background, no border, no shadow
- Minimal padding (2px) for cursor comfort
- `fontSize`, `color`, `textAlign` applied as CSS
- `wordWrap: break-word`, `whiteSpace: pre-wrap`
- `overflow: visible` for vertical auto-grow
- `userSelect: none` by default (enabled during editing)
- `pointerEvents: auto` — same as notes, allows click-to-select via DOM hit testing
- Selected state: subtle dashed outline via CSS

## Inline Editing

Reuse `NoteEditor` with targeted modifications:

### Viewport changes

- Rename `startEditingNote` → `startEditingText` (or generalize) and update the type guard from `element.type !== 'note'` to accept both `'note'` and `'text'` types
- In `onDblClick` handler: add `element.type === 'text'` check alongside the existing `element.type === 'note'` check in the first branch (before the HTML interact fallthrough), so text elements enter edit mode rather than interact mode

### NoteEditor changes

- Add an `onStop` callback parameter to `stopEditing()` (or emit via the editing lifecycle) that fires _before_ the node reference is cleared. This allows the viewport to measure `scrollHeight` and update `size.h` for text elements.
- Alternative: the viewport reads the DOM node from `this.domNodes.get(id)` and measures height after calling `stopEditing()`, since the DOM node itself persists in the viewport's node map even after the editor releases its reference.

### Known limitation

`textContent` (used by `NoteEditor.stopEditing()`) strips line breaks that `innerText` preserves. Multi-line text entered with Enter key may lose line breaks. This is an existing limitation for notes as well. Can be addressed in a follow-up by switching to `innerText`.

## Auto-Height

After edit stop, the viewport measures the DOM node's `scrollHeight` (via `this.domNodes.get(id)`) and calls `store.update(id, { size: { w, h: measuredHeight } })` to persist the auto-grown height.

On resize via select tool handles: the select tool updates both `w` and `h` simultaneously. Auto-height adjustment on width-only resize is deferred — users manually resize both dimensions for now. Can be improved later with a post-resize render callback.

## Empty Text Cleanup

If user exits edit mode with no text content, remove the element. This removal must be wrapped in a history transaction (`historyRecorder.begin()` / `commit()`) so it pairs correctly with the element creation in the undo stack. The viewport handles this check in its post-edit callback.

## Select Tool Integration

Text elements are DOM elements — existing select tool features work automatically:

- Click to select, drag to move, resize handles, Delete to remove

## Serialization

`state-serializer.ts` must be updated: add `'text'` to the `VALID_TYPES` set so text elements pass validation on `loadJSON`. Export/import is otherwise automatic since `TextElement` is a standard `CanvasElement`.

## Touch & Tablet

- Single tap places text (via `onPointerUp`) — works with Pointer Events
- Double-tap triggers edit mode (browser fires `dblclick` after two quick taps)
- On-screen keyboard will appear on mobile/tablet when entering edit mode via `contentEditable`

## Files to Create/Modify

### New files

- `packages/core/src/tools/text-tool.ts` — TextTool implementation
- `packages/core/src/tools/text-tool.test.ts` — TextTool tests

### Modified files

- `packages/core/src/elements/types.ts` — add `TextElement` to union
- `packages/core/src/elements/element-factory.ts` — add `createText()` factory
- `packages/core/src/elements/element-factory.test.ts` — tests for `createText()`
- `packages/core/src/elements/element-renderer.ts` — add `'text'` to `DOM_ELEMENT_TYPES`
- `packages/core/src/canvas/viewport.ts` — DOM rendering for text, double-click edit, empty cleanup, height measurement
- `packages/core/src/core/state-serializer.ts` — add `'text'` to `VALID_TYPES`
- `packages/core/src/tools/types.ts` — add `'text'` to `ToolName` union
- `packages/core/src/index.ts` — export `TextTool` and `TextElement`
