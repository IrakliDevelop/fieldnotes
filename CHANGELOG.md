# Changelog

All notable changes to Field Notes are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions refer to `@fieldnotes/core` unless noted.

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

- **Per-layer offscreen canvas caching** with "pan-is-free" optimization — each layer renders to an offscreen canvas, re-composited without re-rendering when only the camera moves
- **Quadtree spatial index** — O(log n) element queries for hit-testing and viewport culling, replacing full-array scans
- **Viewport culling** — skip off-screen elements in the render loop
- **Pencil tool optimization** — distance-based point subsampling and progressive simplification to reduce stroke complexity

### Added

- `RenderStats` instrumentation for frame timing, element counts, and cache hit rates
- `Quadtree` spatial index data structure
- `camera.getVisibleRect()` and `CameraChangeInfo` for culling support
- Universal `getElementBounds()` for all element types

### Fixed

- Layer cache clipping for elements far from world origin (camera translation in offscreen rendering)
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

- Cross-origin image URLs cache-busted to avoid tainted canvas on export

---

## [0.8.1] — 2026-03-23

### Fixed

- Cross-origin image export tainted canvas error

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
