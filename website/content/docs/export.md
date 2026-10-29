---
title: Export to PNG and SVG
description: By the end of this page you can download the board as a PNG or an SVG file, with your HTML elements drawn into it.
group: Guides
order: 5
---

## Export a PNG

`viewport.exportImage(options)` draws the board into a new canvas and resolves to a PNG `Blob`. It resolves to `null` when no element on a visible layer is left to draw and no `region` or `frameId` is set.

::code{example="export" region="png"}

The options:

- `scale`: pixels per board unit, default 2.
- `padding`: space around the elements, in board units, default 0.
- `background`: the fill colour. A board PNG defaults to `#ffffff`; a frame PNG defaults to
  transparent. JPEG defaults to opaque.
- `filter(element)`: return `false` to leave an element out.
- `region: { x, y, w, h }`: exports that rectangle of the board instead of the area the elements cover.
- `frameId`: exports one root frame's exact content rectangle. It includes only that frame's
  descendants and leaves out the frame title, border, padding chrome, and unrelated overlap. An
  empty frame still produces output at its exact size. It conflicts with raster `region`, so
  supplying both throws.
- `format: 'jpeg'`, with `quality` above 0 and up to 1, makes a JPEG. A JPEG has no transparency, so keep an opaque `background`.
- `maxDimension` (default 16,384px) and `maxPixels` (default 67,108,864) cap the output. A larger export throws a `RangeError`, unless `scaleMode: 'fit'` lowers the scale until it fits.

## Export an SVG

`viewport.exportSVG(options)` resolves to an SVG string. It takes the same `padding`, `filter`, and
`frameId` options. `frameId` selects one root frame's exact content rectangle and includes only its
descendants, without frame title, border, padding chrome, or unrelated overlap. An empty frame
produces an SVG at that size. SVG does not support `region`. Without `background` the SVG has
nothing behind the elements.

::code{example="export" region="svg"}

Strokes, shapes and arrows become SVG paths and shapes. Text, notes and HTML elements are embedded as PNG pictures at `rasterScale` (default 2), so their words can't be selected or searched in the file. Images are embedded as data URLs; one that can't be loaded keeps its original URL. An empty board gives a 0 by 0 SVG.

## What an export includes

- Elements on visible layers, at each layer's opacity. Elements on hidden layers are left out.
- Drawing that plugins register for exports, such as the fog on a [tabletop map](/docs/tabletop-maps/).
- Images from another origin, fetched with anonymous CORS. An image that fails to load, or takes longer than `imageTimeoutMs` (default 10 seconds), is left out of a PNG, and `onAssetError` receives its id, URL and reason.
- An explicit `background`, caller `filter`, HTML renderers or painters, image diagnostics, registry
  capabilities, and render hooks also apply to a frame export.

The selection, remote cursors and the board's background pattern are not drawn.

## HTML elements in an export

An export draws on a canvas, and an HTML element is a DOM node, so the export leaves it out unless you draw it. There are two ways:

- `renderHtml(element)` returns a canvas, an `ImageBitmap` or a loaded image for the element, or a promise of one. The export sizes, rotates and orders it like the element, at its layer's opacity. Field Notes doesn't turn DOM into pixels: draw the element from its `data`, as below, or use a DOM-to-image library.
- A canvas painter registered with `viewport.registerHtmlPainter(htmlType, painter)` draws every element of that `htmlType` in exports, without `renderHtml`. It also draws them on the board, which then shows no DOM node for them.

::code{example="export" region="render-html"}

`onHtmlError` reports each HTML element left out, with a reason such as `unsupported` when there is no `renderHtml`, `render` when it returns `null` or throws, and `timeout` after `htmlTimeoutMs` (default 10 seconds). The export goes on without that element.
