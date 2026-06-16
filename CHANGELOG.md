# Changelog

All notable changes to Field Notes are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions refer to `@fieldnotes/core` unless noted.

## [0.27.0] — 2026-06-16

### Added

- **Selection-aware styling.** A normalized `ElementStyle` (`{ color, fillColor, strokeWidth, opacity, fontSize }`) maps across element types; `styleToPatch` / `getElementStyle` convert to and from each type's real fields (e.g. a note's `color` is its text color, `fillColor` its background). `Viewport` gains `applyStyleToSelection(style)` (applies to the current selection in one undo step), `getSelectionStyle()` (shared values across the selection, omitting properties that differ), `getSelectedIds()` (a referentially-stable array), and `onSelectionChange(listener)`. `SelectTool` now emits a selection-change event.
- **@fieldnotes/react 0.6.0** — `useSelection()` (reactive selected ids) and `useSelectionStyle()` (`[style, applyStyle]`). Requires core `>=0.27.0`.

### Changed

- **Demo:** the color / stroke-width / font-size / fill controls now apply to the current selection when one exists (and reflect its style), falling back to setting new-element defaults when nothing is selected — fixing the previous behavior where the color picker changed every tool globally. Adds shape-selection styling.

---

## [0.26.0] — 2026-06-14

### Added

- **Zoom presets** — `Ctrl/Cmd` `=` zooms in, `Ctrl/Cmd` `-` zooms out (1.2× steps), `Ctrl/Cmd` `0` resets to 100%. All zoom about the viewport center and respect the camera's min/max clamp. New rebindable shortcut actions `zoom-in` / `zoom-out` / `zoom-reset` (via `ViewportOptions.shortcuts`). The demo's zoom readout is now clickable to reset to 100%.

### Changed

- **Paste at cursor** — when the pointer is over the canvas, paste positions the clipboard so its bounding-box center lands at the cursor. Pasting without a recent pointer position (e.g. the pointer has left the canvas) keeps the previous diagonal +20px cascade.

### Fixed

- **Notes no longer clip text** — a note's height auto-grows to fit its content at edit-stop and after a resize. You can still drag a note taller than its content, but narrowing it (or adding text) grows the height instead of silently hiding the overflow.
- **One undo step per text edit** — finishing a note or text edit (text change plus any height auto-fit) now records a single history entry, so one Ctrl+Z fully reverts the edit. Previously the text and height changes could land as two separate undo steps.

---

## [0.25.0] — 2026-06-14

### Removed (breaking)

- **Public surface trimmed before 1.0.** Internal machinery is no longer exported from `@fieldnotes/core` — none of it was supported API; all in-repo usage flows through `Viewport` and the documented helpers. Removed classes: `ElementRenderer`, `InputHandler`, `InputFilter`, `DoubleTapDetector`, `NoteEditor`, `NoteToolbar`, `Background`, `EventBus`, `Quadtree`, `HistoryRecorder`, and the concrete history command classes (`AddElementCommand`, `RemoveElementCommand`, `UpdateElementCommand`, `BatchCommand`, `CreateLayerCommand`, `RemoveLayerCommand`, `UpdateLayerCommand` — the `Command` interface is retained for custom undo). Removed functions: the arrow-binding engine (`isBindable`, `getElementCenter`, `getEdgeIntersection`, `findBindTarget`, `findBoundArrows`, `updateBoundArrow`, `clearStaleBindings`, `unbindArrow`), plus `createId`, `sanitizeNoteHtml`, `isNoteContentEmpty`, `DEFAULT_FONT_SIZE_PRESETS`. Removed types: `InputHandlerOptions`, `DoubleTapDetectorOptions`, `FilteredEvent`, `FilteredUpEvent`, `FilterAction`, `NoteEditorOptions`, `StyledRun`.
- **Module-level `exportState` / `parseState` are no longer exported.** Use the `Viewport` methods instead.

### Changed (breaking)

- **State serialization is now Viewport-only.** Persist with `viewport.exportJSON()` / `viewport.loadJSON()` (strings — canonical), or `viewport.exportState()` / `viewport.loadState()` (in-memory `CanvasState` objects, no JSON round-trip).

### Retained

- Reusable helpers stay public for custom tools and presets: hex-fill (`getHexCellsInRadius`, `drawHexPath`, …), arrow geometry (`getArrowControlPoint`, `getArrowBounds`, …), `snapPoint` / `smartSnap` / `snapToHexCenter`, note formatting (`toggleBold`, …), and bounds helpers (`getElementBounds`, `getElementsBoundingBox`, …). The `Viewport` subsystem accessors (`camera`, `store`, `layerManager`, `toolManager`, `history`) and their classes are unchanged.

---

## [0.24.0] — 2026-06-13

### Fixed

- **No phantom undo step** — exiting a note/text edit without changing the content no longer records an empty history entry (a wasted Ctrl+Z)
- **`mod+ctrl` / `mod+meta` shortcut bindings now throw at parse** instead of silently ignoring the redundant modifier (`mod` already means Ctrl or Cmd)
- **`InputHandler.destroy()`** restores the `tabindex`/`outline` it set in focus scope, leaving a host-supplied element clean

### Changed

- **`viewport.setTool(name)`** warns when no tool is registered under that name (was a silent no-op)
- **`onImageError`** payload gains an optional `cause` — the raw error `Event` from the failed image load
- Internal: `paste`/`duplicate` guard active-tool input first (consistent with the other shortcuts); `distSqToSegment` consolidated into `core/geometry` (shared by stroke hit-testing and arrow geometry)

---

## [0.23.0] — 2026-06-13

### Performance

- **Pan-time cache reuse** — layer caches and the grid cache now render a 256px margin beyond the viewport (configurable via `ViewportOptions.panBufferMargin`; `0` opts out). A pan within the margin re-composites the cached bitmaps at an offset instead of re-rasterizing every layer and re-tiling the grid each frame. On the bench board (strokes + a hex grid), continuous panning dropped average frame time ~78% at 500 strokes (15.0ms → 3.3ms) and ~83% at 2000 strokes (29.8ms → 5.1ms); per-frame grid re-tile and layer re-raster cost fall to ~0 on the reuse frames, with the full cost paid only on the periodic recenter when the pan exceeds the margin. Zoom still re-rasterizes (content scale changes)

---

## [0.22.0] — 2026-06-13

### Performance

- **Width-bucketed Path2D stroke rendering** — strokes render as a few cached `Path2D` objects grouped by 0.25px-quantized width instead of rebuilding bezier paths per segment each frame. Opaque strokes are pixel-identical; the win shows mainly in tail latency on dense boards (≈10% p95 frame-time improvement panning a 2,000-stroke board). Note: semi-transparent strokes (`opacity < 1`) now composite once per width bucket rather than once per segment, which removes cap double-blending at segment joints (slightly lighter joints; opaque strokes unaffected)
- **Intrinsic arrow geometry cache** — control point and tangent angles are computed once per arrow object instead of up to 3× per frame. Arrows loaded from JSON no longer recompute their control point on every frame
- **Cache warming & coherence** — `loadSnapshot` pre-computes stroke geometry and restores arrow control points at load time (matching the draw-commit caching policy); color- and position-only updates transfer stroke geometry caches instead of discarding them
- **Per-subsystem render stats** — `getRenderStats()` now reports `layersMs` / `backgroundMs` / `compositeMs` / `overlayMs` alongside the existing timers; the demo gains a deterministic `?bench=N` board. (These revealed that grid re-tiling and layer compositing dominate the pan frame — the target of a follow-up pass.)

---

## [react 0.5.0] — 2026-06-12

### Added

- **Controlled tool prop** — `<FieldNotesCanvas tool={tool} onToolChange={setTool}>`; `defaultTool` remains for uncontrolled use
- **Reactive props** — `snapToGrid` toggles live; `tools` registers newly added tools (append-only); `options` documented as mount-only
- **`useElements(selector, isEqual?)`** — derived values re-render only when the selected value changes (shallow-equal default; fixes sidebars re-rendering on every drag frame)
- **`examples/react-app`** — runnable reference app (toolbar, undo/redo, selector sidebar, save/load, custom tool)

### Changed

- `useActiveTool` and `defaultTool` use the `viewport.setTool` facade internally
- README rewritten around recipes with a prop-reactivity table; TSDoc on the full public surface

---

## [0.21.0] — 2026-06-12

### Added

- **`onImageError`** — `ViewportOptions.onImageError?: ({ src, elementIds }) => void` fires when an image fails to load; failed images render a gray placeholder instead of disappearing. `console.warn` fallback when unset

### Performance

- **Segment-based stroke hit-testing** — select and eraser now test against cached smoothed segments with a bounding-box early-out instead of scanning every raw point; drag-erasing across a board of long strokes no longer does per-point distance math for off-stroke moves

### Fixed

- Fast/sparse strokes are now reliably selectable and erasable between their sample points (raw-point scanning missed the gaps)

---

## [0.20.0] — 2026-06-12

### Added

- **Editing placeholder** — ghost "Type…" while a note/text is empty during editing; configurable via `ViewportOptions.placeholder` / `NoteEditorOptions.placeholder`
- **Hover outline** — faint highlight on the hovered selectable element while the select tool is active
- **`isNoteContentEmpty(html)`** — exported markup-aware emptiness helper

### Changed

- Notes emptied during editing are now auto-removed on edit exit (one undo step) — same behavior text elements already had
- Demo: first-run empty-canvas hint; auto-save failures now surface as a dismissible toast

---

## [0.19.0] — 2026-06-11

### Added

- **Configurable keyboard shortcuts** — new `ShortcutMap` with remappable bindings: `ViewportOptions.shortcuts.bindings` seeds the table, `viewport.shortcuts.rebind/disable/reset/getBindings` mutate it at runtime. Binding grammar: `"mod+d"`, `"shift+1"`, `"["`, `"v"` (`mod` = Ctrl or Cmd)
- **Tool-switch keys** — `V` select, `H` hand, `P` pencil, `E` eraser, `A` arrow, `N` note, `T` text, `S` shape, `M` measure, `G` template. Generic `tool:<name>` action ids work for custom tools
- **Focus-scoped shortcuts** — the canvas only handles keys while focused (click it once); `shortcuts: { scope: 'window' }` restores page-wide handling. Fixes the SDK swallowing Ctrl+D/Ctrl+A across the host page

### Changed

- Shortcut matching now requires exact modifiers: `Ctrl+Escape`, `Ctrl+Delete`, and `Ctrl/Alt+Arrow` no longer trigger deselect/delete/nudge; `Backspace` on the focused canvas now calls `preventDefault` (no browser back-navigation)
- react 0.4.2: core peer range widened to `>=0.18.0 <1.0.0` (bounded at major, not per-minor)

---

## [0.18.0] — 2026-06-11

### Added

- **`viewport.setTool(name)`** — tool switching without passing `toolContext` back in
- **`HistoryRecorder.currentTransactionId`** — transaction-ownership token; nudge coalescing now commits only its own transaction
- **`InputHandlerOptions` export**

### Fixed

- **EventBus listener isolation** — a throwing consumer listener no longer halts the emit chain (logged via `console.error`, remaining listeners still run)
- **Mid-gesture shortcuts** — delete/undo/redo/z-order are ignored while a pointer gesture is in flight

### Packaging (react 0.4.1)

- LICENSE files shipped in both npm tarballs; `sideEffects: false` for tree-shaking; react peer ranges tightened; core sourcemaps enabled; versioning policy documented

---

## [0.17.0] — 2026-06-10

### Added

- **Keyboard & selection quick wins** — `Escape` deselect, `mod+A` select all (visible/unlocked layers only), `mod+D` duplicate (+20px offset, arrow bindings remapped), arrow-key nudge (1 unit; `Shift` = one grid cell, coalesced into a single undo step), `Shift+1` zoom-to-fit
- **`viewport.fitToContent(padding?)`** — frame all content on visible layers; demo toolbar ⛶ button
- **`KeyboardActions`** — keyboard action logic extracted from `InputHandler` (groundwork for 0.19.0's ShortcutMap)

---

## [0.16.0] — 2026-05-30

### Added

- **`onHtmlElementMount` callback** — fires during `loadState()` for HTML elements whose content couldn't be restored via `domId` lookup. Lets host apps dynamically provide content (React components, iframes) after save/load
- **`updateHtmlElement(id, newContent)`** — swaps the DOM content of an existing HTML element without changing its position, size, or store data
- **`onDrop` callback** — external drop zone API. When provided in `ViewportOptions`, replaces default image-drop behavior. Receives the raw `DragEvent` and computed world-space coordinates for custom drop handling (D&D tokens, text, HTML snippets)
- **Layer undo** — all layer operations (create, remove, rename, reorder, visibility, lock, opacity) now participate in undo history. Layer commands batch with element commands in transactions. `removeLayer` undo restores both the layer and its element assignments

---

## [0.15.0] — 2026-05-29

### Added

- **Shift-constrain resize** — hold Shift while dragging a resize handle to lock the element's aspect ratio. Works with all four corner handles (NW, NE, SW, SE). Aspect ratio captured at resize start
- **Z-order controls** — `ElementStore.bringToFront()`, `.sendToBack()`, `.bringForward()`, `.sendBackward()` for reordering elements within a layer. Keyboard shortcuts: `]` (forward), `[` (backward), `Ctrl+]` / `Cmd+]` (to front), `Ctrl+[` / `Cmd+[` (to back)
- **`ElementStore.getVersion(id)`** — returns a monotonically increasing version number for an element, useful for dirty-checking optimizations

### Performance

- **syncDomNode dirty tracking** — DOM element style updates now skip unchanged elements using a generation counter. Reduces unnecessary DOM writes from 1200+/sec to near-zero for static scenes with 20+ notes

### Added (Testing)

- **Viewport roundtrip integration test** — full save/load cycle covering all element types, camera state, arrow bindings, multi-layer configurations, and grid elements

---

## [0.14.0] — 2026-05-29

### Fixed

- **Pen hover during touch contact** — Apple Pencil hover preview now works even when a finger is touching the screen. Only pen-type pointers get the hover exemption; finger hover remains suppressed during multi-touch
- **Toolbar button touch targets** — format buttons and font size selector increased from 24px to 44px minimum, meeting Apple HIG touch target requirements. Toolbar height increased from 32px to 52px
- **Double-tap to edit on touch devices** — replaced unreliable `dblclick` DOM events with pointer-event-based `DoubleTapDetector` for notes, text elements, and HTML interaction toggle. Consistent behavior across iPad Safari, Android, and desktop

### Added

- **`DoubleTapDetector`** — reusable utility class for detecting double-tap gestures via pointer events. Configurable timeout (default 300ms) and distance threshold (default 20px). Exported from `@fieldnotes/core`

---

## [0.13.0] — 2026-05-29

### Added

- **`Camera.fitToContent()`** — frame all elements in the viewport by computing optimal zoom and pan. Accepts a `Bounds` (bounding box), canvas dimensions, and optional padding (default 40). Clamps zoom to camera min/max. No-op for empty/zero-size content
- **`getElementsBoundingBox()`** — utility that computes the union bounding box of an array of elements. Returns `null` for empty arrays. Exported from `@fieldnotes/core`
- **`activeLayerId` persistence** — `CanvasState` now includes an optional `activeLayerId` field. `exportState()` accepts it; `Viewport.loadState()` restores the active layer selection. Falls back to first layer for old states or invalid IDs
- **`AutoSave.onError` callback** — `AutoSaveOptions.onError` fires when a save fails (e.g. localStorage quota exceeded). Receives the `Error` object. `console.warn` still fires alongside for dev-tools visibility
- **`HtmlElement.interactive` flag** — set `interactive: true` on HTML elements to enable pointer events (`pointerEvents: 'auto'`). Non-interactive elements (default) keep `pointerEvents: 'none'`. Opt-in — interactive elements capture pointer events, blocking canvas pan/select over that area

---

## [0.12.0] — 2026-05-28

### Added

- **Shift+click multi-select** — hold Shift and click to add/remove elements from the selection. Works with all element types. Shift+click then drag moves the entire multi-selection
- **Copy/paste (Ctrl+C / Ctrl+V)** — copies selected elements to an in-memory clipboard and pastes with new IDs. Successive pastes cascade position offset (+20px each). Arrow bindings are remapped when both arrow and target are copied. Entire paste is one undo step
- **`shiftKey` in `PointerState`** — tools now receive `shiftKey: boolean` for keyboard-modifier-aware input handling
- **`SelectTool.setSelection(ids)`** — programmatically set the selection from application code

---

## [0.11.3] — 2026-05-28

### Fixed

- **Note HTML sanitized on creation and update** — `sanitizeNoteHtml()` now runs in `createNote()` and `store.update()`, not just during deserialization. Prevents XSS via `innerHTML` when consumers pass unsanitized text
- **`loadSnapshot` emits events** — `loadSnapshot()` now emits `clear` followed by per-element `add` events. Listeners (history recorder, auto-save, React hooks via `onChange`) are notified of state changes

### Changed

- **`getAll()` caches sorted array** — `ElementStore.getAll()` now caches the sorted result and invalidates on mutation, eliminating O(n log n) sort per frame

---

## [0.11.2] — 2026-05-28

### Added

- **`InputFilter` middleware** — new class sits between raw PointerEvents and tool dispatch, classifying events as `dispatch`, `suppress`, or `defer`
- **Palm rejection** — when a pen (Apple Pencil, Surface Pen) is active, all touch events are suppressed. Clears automatically on pen lift
- **Touch debounce** — touch `pointerdown` is deferred until the pointer moves beyond a 3px threshold (drag) or `pointerup` fires (confirmed tap). Prevents accidental element creation from palm contact
- **`pointerType` in `PointerState`** — tools now receive `'mouse' | 'touch' | 'pen'` via the `pointerType` field, enabling input-type-aware behavior
- **Exported** `InputFilter`, `FilteredEvent`, `FilteredUpEvent`, `FilterAction` from `@fieldnotes/core`

---

## [0.11.1] — 2026-05-28

### Fixed

- **`releasePointerCapture` on pointer up** — wrapped in try/catch to prevent `InvalidStateError` when `pointercancel` fires first
- **Touch/pen button validation** — tool dispatch now accepts `pointerType === 'touch'` and `pointerType === 'pen'` regardless of `e.button` value (Apple Pencil and touch report non-zero button)
- **`overscroll-behavior: none`** on viewport wrapper — prevents browser pull-to-refresh and elastic scroll on touch devices
- **`-webkit-user-select: none`** on viewport wrapper — prevents text selection on iOS Safari during canvas interactions
- **Cached arrow geometry stripped from exports** — `exportState()` now removes `cachedControlPoint` from serialized arrow elements
- **Cursor restore on space release** — dispatches tool hover or resets cursor to `default` when spacebar is released

---

## [0.11.0] — 2026-05-03

### Added

- **`viewport.getGridInfo()`** — query current grid dimensions: returns `GridInfo` with `gridType`, `hexOrientation`, `cellSize`, and `cellRadius` (inscribed radius for fitting tokens). Returns `null` when no grid is present
- **`viewport.onGridChange(cb)`** — subscribe to grid changes (add, update, remove, clear). Callback receives `GridInfo | null`. Returns an unsubscribe function
- **`GridInfo` type** — exported from `@fieldnotes/core` for SDK consumers building grid-aware features (e.g. D&D token sizing)

---

## [0.10.0] — 2026-04-20

### Added

- **Note rich text formatting** — inline bold, italic, underline, and strikethrough in sticky notes via `contentEditable` + `document.execCommand`
- **Floating formatting toolbar** — appears above the note during editing with B/I/U/S buttons and a font size dropdown. Uses `pointerdown` + `preventDefault` to avoid stealing focus — works on iPad/stylus
- **Font size presets** — Small (14px), Normal (18px), Large (24px), Heading (32px) with named dropdown. Configurable via `ViewportOptions.fontSizePresets` or `NoteToolbar` constructor
- **Keyboard shortcuts** — Ctrl/Cmd+B (bold), Ctrl/Cmd+I (italic), Ctrl/Cmd+U (underline) while editing notes
- **HTML sanitizer** — `sanitizeNoteHtml()` strips disallowed tags/attributes using DOMParser allowlist. Runs on save and deserialization to prevent XSS
- **Styled run parser** — `parseStyledRuns()` converts HTML to flat `StyledRun[]` array for canvas export rendering with mixed formatting
- **Canvas export rich text** — `renderNoteOnCanvas` handles bold/italic/underline/strikethrough with word wrapping across styled runs
- **Smart toolbar positioning** — toolbar positioned above note by default, flips below when insufficient space
- **`DEFAULT_NOTE_FONT_SIZE`** constant (18px) — shared across factory, tools, renderer, and export
- **`FontSizePreset`** type and **`DEFAULT_FONT_SIZE_PRESETS`** — SDK users can customize the toolbar dropdown presets
- **`NoteEditorOptions`** — configure font size presets via `NoteEditor` constructor
- **Headless formatting API** — `toggleBold()`, `toggleItalic()`, `toggleUnderline()`, `toggleStrikethrough()`, `setFontSize(size)`, `getActiveFormats()` for SDK users building custom toolbar UI
- **`toolbar` option** — set `toolbar: false` on `ViewportOptions` or `NoteEditorOptions` to disable the built-in toolbar and use the formatting API with custom UI
- Font size control in demo note panel

### Changed

- `NoteElement.text` field now stores HTML (was plain text). Plain text without tags renders identically — fully backward compatible, no migration needed
- Default note base font size increased from 14px to 18px
- `DomNodeManager` renders notes via `innerHTML` instead of `textContent`

### Fixed

- Toolbar font size dropdown closing the editing session (blur handler now checks `FocusEvent.relatedTarget`)
- `range.surroundContents()` crash on partial element selections (fallback to `extractContents` + `insertNode`)
- Toolbar not following note during pan/zoom (wired `updateToolbarPosition` to camera change handler)
- Redundant per-frame HTML sanitization in render path removed (data pre-sanitized at write time)

---

## [0.9.0] — 2026-04-10

### Added

- **MeasureTool** — drag to measure distances in feet on the canvas. Snaps to hex/square grid centers when a grid element is present. Configurable `feetPerCell` (default 5)
- **TemplateTool** — place area-of-effect templates for D&D spells. Four shapes: circle, cone, line, square. Configurable fill/stroke color, opacity, and feet-per-cell
- **D&D hex-filled templates** — on hex grids, templates fill actual hex cells (PHB-style) instead of drawing geometric shapes. Cone follows the 1-2-3 triangular D&D pattern; line alternates 1-2-1-2 symmetrically
- **Hex distance measurement** — `getHexDistance()` computes cube coordinate distance (integer hex steps) for accurate diagonal measurement on hex grids
- **Hex fill utilities** — `getHexCellsInRadius`, `getHexCellsInCone`, `getHexCellsInLine`, `getHexCellsInSquare`, `drawHexPath` for enumerating and rendering hex cell patterns
- **Template element** — `TemplateElement` type with `templateShape`, `radius`, `angle`, `fillColor`, `strokeColor`, `opacity`, `feetPerCell`, `radiusFeet`
- **Template resize** — drag SE handle on selected templates to resize; radius snaps to hex/square cell spacing
- **Origin marker** — all template shapes highlight the origin hex with the stroke color for clear positioning
- **Image center-snapping** — images placed on hex/square grids snap their center to the nearest cell center

### Fixed

- **Canvas not clearing between frames** — skipping background render for grid elements also skipped its `clearRect`, causing frame stacking
- **Measure/template snapping to dot grid** — tools now always snap to hex/square grid centers when a grid element exists, independent of the global snap toggle

---

## [0.8.11] — 2026-03-28

### Fixed

- **Images not visible until pan/zoom** — async image loads called `requestRender()` but didn't invalidate the layer cache, so the stale (empty) cached layer was reused until the camera moved

---

## [0.8.10] — 2026-03-28

### Fixed

- **Hex grid swimming during pan/zoom** — grid offscreen cache was composited at `scale(dpr)` instead of identity, causing the grid to drift relative to elements on high-DPI displays

---

## [0.8.9] — 2026-03-28

### Performance

- **Tiled hex grid rendering** — render a small repeating hex tile once, fill the viewport via `drawImage` tiling. Reduces hex grid from O(rows×cols) to near-constant regardless of zoom level (~250x faster on large grids: 4 fps → 1000+ fps)
- **Precomputed trig offsets** for hex grid — eliminate per-hex cos/sin calls and array allocations
- **Grid offscreen canvas cache** — static-camera frames served from a cached `drawImage` (sub-0.1ms)

### Added

- `viewport.getRenderStats()` — returns `RenderStatsSnapshot` with fps, avgFrameMs, p95FrameMs, lastGridMs, frameCount
- `viewport.logPerformance(intervalMs?)` — starts periodic console logging of render stats, returns stop function

### Fixed

- Grid now renders on top of images and other layer elements (was behind them)

---

## [0.8.8] — 2026-03-28

### Performance

- **Stroke segment caching** — WeakMap cache for Catmull-Rom to Bezier segments and pressure widths, computed at commit time (onPointerUp). Strokes are immutable after commit so the cache never invalidates.
- **Arrow control point caching** — `cachedControlPoint` on ArrowElement, computed in `createArrow()` and recomputed post-spread in `store.update()`. Eliminates per-frame sqrt + perpendicular vector math.
- **Background pattern caching** — Offscreen canvas cache for dot/grid patterns, invalidated on camera change. Skips re-rendering hundreds of dots/lines during static-camera scenarios (drawing).
- **ImageBitmap pre-decoding** — Async upgrade from HTMLImageElement to GPU-ready ImageBitmap after image load. Falls back to HTMLImageElement for cross-origin without CORS.

### Added

- `cachedControlPoint` optional field on `ArrowElement` type (derived, safe to omit in serialized state)
- `stroke-cache.ts` module with `computeStrokeSegments()` and `getStrokeRenderData()`
- Integration tests for cross-cutting cache invalidation audit (`geometry-cache.test.ts`)

---

## [0.8.7] — 2026-03-28

### Performance

- **Per-layer offscreen canvas caching** — each layer renders to an offscreen canvas; unchanged layers are re-composited without re-rendering
- **Quadtree spatial index** — O(log n) element queries for hit-testing and viewport culling, replacing full-array scans
- **Viewport culling** — skip off-screen elements in the render loop
- **Pencil tool optimization** — distance-based point subsampling and progressive simplification to reduce stroke complexity

### Added

- `RenderStats` instrumentation for frame timing, element counts, and cache hit rates
- `Quadtree` spatial index data structure
- `camera.getVisibleRect()` and `CameraChangeInfo` for culling support
- Universal `getElementBounds()` for all element types

### Fixed

- Layer cache clipping for elements far from world origin (camera translation in offscreen rendering). Note: initial "pan-is-free" optimization (reuse cached layer on pan without re-rendering) was removed as part of this fix — panning now invalidates all layer caches. Multi-layer caching still applies (unchanged layers skip re-rendering).
- Grid elements render directly to main canvas, bypassing layer cache
- Compounding progressive simplification on pencil strokes
- Source layer marked dirty when element moves between layers
- SelectTool hit-test query inflated by hit radius for strokes/arrows

---

## [0.8.6] — 2026-03-25

### Changed

- **Viewport decomposition** — extracted `RenderLoop`, `DomNodeManager`, and `InteractMode` from monolithic Viewport class into focused modules

---

## [0.8.5] — 2026-03-24

### Changed

- Dropped source maps from published package to reduce npm bundle size

### Fixed

- Type declaration exports for all `moduleResolution` modes (bundler, node, node16)

---

## [0.8.4] — 2026-03-23

### Fixed

- Cross-origin image URLs cache-busted to avoid tainted canvas on export (completes the fix started in 0.8.1 — that initial fix set `crossOrigin='anonymous'` but the browser cache could still serve the tainted pre-CORS response; this adds a `_cors=1` cache-buster to force a fresh CORS request)

---

## [0.8.1] — 2026-03-23

### Fixed

- Cross-origin image export tainted canvas error (partial — see 0.8.4 for the complete fix)

---

## [0.8.0] — 2026-03-22

### Added

- **Export canvas as PNG** — `exportImage()` returns a PNG Blob with scale, padding, background, and filter options
- Standalone `exportImage` function for use outside of Viewport

---

## [0.7.0] — 2026-03-21

### Added

- **Grid element** — square and hex grids for D&D combat maps (`GridElement`)
- HTML element persistence — `domId` field on `HtmlElement` for re-attaching DOM nodes across reloads
- Arrow binding restricted to same-layer elements

---

## [0.6.1] — 2026-03-20

### Fixed

- localStorage quota handling for AutoSave

---

## [0.6.0] — 2026-03-19

### Added

- **Layer system** — `LayerManager` with visibility, locking, ordering, per-layer opacity
- **Snap-to-grid** — `snapPoint()` utility, toggleable via `viewport.setSnapToGrid()`
- Note text color — `textColor` field on `NoteElement`

---

## [0.5.0] — 2026-03-18

### Added

- **Text tool** — standalone text boxes on canvas (editable, styled, resizable)
- **Arrow binding** — snap arrows to elements
- **Shape tools** — rectangle and ellipse
- `@fieldnotes/react` — `useSyncExternalStore` hooks for all core features (useActiveTool, useCamera, useElements, useHistory, useLayers, useToolOptions)

---

## [0.4.0] — 2026-03-15

### Added

- React hooks overhaul — `useElements`, `useHistory`, `useLayers`, `useToolOptions`, upgraded `useActiveTool`
- `ElementStore.onChange` and `LayerManager.setLayerOpacity`
- Tool options API — `getOptions()` / `onOptionsChange()` on Tool interface

---

## [0.3.0] — 2026-03-12

### Added

- Stroke smoothing (Catmull-Rom to cubic Bezier)
- Pressure-sensitive stroke width (Apple Pencil / stylus)
- Runtime color configuration for tools
- Brush size slider in demo

---

## [0.2.0] — 2026-03-10

### Added

- **AutoSave** — debounced localStorage persistence
- `addImage()` returns element ID

---

## [0.1.0] — 2026-03-08

### Added

- Initial release — infinite canvas SDK with HTML embedding
- Pan (drag) and zoom (scroll wheel / pinch)
- Background patterns (dots, grid, none)
- Freehand pencil drawing with pressure data
- Stroke-level eraser
- Sticky notes, arrows, images
- Select tool with multi-select (drag box)
- Undo/redo
- State serialization (JSON export/import)
- Touch/tablet support (pinch-to-zoom, two-finger pan, tool cancellation)
- `@fieldnotes/react` wrapper component
