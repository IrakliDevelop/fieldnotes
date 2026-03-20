# FreeForm PDF Import — Feasibility & Reference

This document captures findings from analyzing Apple FreeForm PDF exports, with the goal of reconstructing FreeForm canvases in Field Notes.

## PDF Structure Overview

FreeForm exports its infinite canvas as a **single massive PDF page**. The canvas dimensions map to PDF points (1 point = 1/72 inch). A typical board exports as ~11841 x 6645 points (164" x 92").

**Producer:** `pdf-lib` — FreeForm uses the pdf-lib JavaScript library to generate PDFs.

**Content stream:** Compressed with FlateDecode (zlib). Requires a proper PDF parser (pdf.js) to decompress and interpret operators.

## Extractable Content Types

### 1. Pasted Images — Fully Extractable

Images are stored as **separate, discrete PDF image objects** with their own compression. They are NOT rasterized into the page — each is an independent object that can be extracted individually.

**Format breakdown:**

- **JPEG images** (`/DCTDecode` filter) — extract directly as `.jpg` files, no conversion needed
- **Raw pixel data** (`/FlateDecode` filter) — zlib-compressed raw RGB/RGBA pixels, need decoding to PNG
- **Image + alpha mask pairs** — each image with transparency has two objects: the RGB content image and a `/DeviceGray` alpha mask at the same dimensions. These appear consecutively in the PDF and share the same placement coordinates (offset by ~3 points for a shadow effect)

**Coordinate extraction:** Each image placement has a full transformation matrix from the content stream, giving:

- **Position:** `tx`, `ty` in page-space points
- **Rendered size:** Derived from the matrix scale components `a`, `d`
- **Rotation:** Derivable from the matrix `b`, `c` components (if non-zero)

Example from test data:

```
img_p0_1: pos=(4695.1, 3658.1), size=(1467.4 x 1735.8)
img_p0_2: pos=(4698.1, 3663.1), size=(1461.4 x 1729.8)  ← same image, offset = shadow
```

The position difference between paired images (~3pt offset) is FreeForm's drop shadow effect.

**Image count:** The test file (a D&D character board) contained 68 image placements (34 unique images, each with an alpha mask). Content includes: character art, spell cards, item descriptions, character sheets — all screenshots pasted into FreeForm.

### 2. Typed Text — Fully Extractable

Text entered via FreeForm's text tool is stored as **native PDF text operators**, not rasterized. This means:

- Text strings are directly readable
- Font name and size are available
- **Exact position** (x, y) in page-space points is available via the text matrix
- Character spacing is preserved

Example from test data (D&D spell list):

```
pos=(3226.1, 6277.4), size=18.0, "Guidance"
pos=(3244.1, 6256.4), size=18.0, "Light"
pos=(3211.5, 6235.4), size=18.0, "Sacred flame"
```

The test file contained **956 text items** with 20 different fonts (all TrueType).

**Important:** Text that appears _inside pasted screenshots_ is NOT extractable as text — it's part of the image pixels. Only text typed directly in FreeForm is available as text operators.

### 3. Sticky Notes — Identifiable via Colored Rectangles

FreeForm sticky notes export as:

1. A **colored rectangle** (the note background) — drawn via the `rectangle` path operator with a specific fill color
2. **Text items** positioned within the rectangle bounds

**How to identify sticky notes:**

- Look for colored filled rectangles (not white, not black)
- Match text items whose coordinates fall within the rectangle bounds
- FreeForm uses specific pastel colors for its sticky notes (yellow, pink, green, blue, etc.)

**Current finding:** In the test file, rectangles were detected but all had no fill color set at the detection level — the fill may be applied via graphics state (`ExtGState`) with opacity. Further investigation needed on the specific mechanism FreeForm uses for sticky note backgrounds.

**Workaround:** Even without explicit color detection, sticky notes can be differentiated from images because:

- Images are extracted as image objects (via `paintImageXObject`)
- Sticky notes are rectangles + text (no image object involved)
- Any text not associated with an image placement is likely a sticky note or free text

### 4. Pencil/Apple Pencil Strokes — Partially Extractable

Handwritten content from Apple Pencil is stored as **vector paths** using PDF path operators:

- `moveTo` (m) — start a new subpath
- `lineTo` (l) — straight line segment
- `curveTo` (c) — cubic Bezier curve (two control points + endpoint)

**What we get:**

- Path geometry (points and curves) — reconstructable as canvas strokes
- Stroke color (via `setStrokeRGBColor`)
- Line width (via `setLineWidth`)
- Transformation matrix for coordinate mapping

**What we lose:**

- **Pressure data** — Apple Pencil pressure is NOT stored in the PDF. All strokes have uniform width
- **Tilt/azimuth** — stylus orientation data is lost
- Variable-width strokes are likely rendered as filled shapes (outlines) rather than center-line strokes with pressure

**Current finding:** The test file had 6 fill paths and 0 stroke paths with curves, suggesting FreeForm may export pencil strokes as **filled outlines** (the stroke outline shape) rather than center-line paths. This makes sense for variable-width pencil strokes — the outline preserves the visual appearance but loses the original stroke data.

**Reconstruction approach:**

- For filled-outline strokes: Could extract as images, or attempt center-line extraction (complex)
- For simple strokes: Map bezier curves to our `StrokeElement` point arrays
- Color and approximate width are recoverable

### 5. Shapes & Lines — Extractable

FreeForm shapes (rectangles, circles, lines, arrows) export as PDF path operations:

- Rectangles: `rectangle` operator with position, size, fill/stroke colors
- Lines/arrows: `moveTo` + `lineTo` paths with stroke properties
- The test file had 119 `constructPath` operations and 104 `setLineWidth` calls

### 6. Canvas Layout — Extractable

The coordinate system preserves spatial relationships:

- All positions are in a single page-space coordinate system (points)
- Transform matrices are composable — nested transforms are trackable
- 717 `save`/`restore` pairs in the test file indicate deeply nested graphics states, each wrapping an element's placement

## Coordinate System

PDF coordinates use **bottom-left origin** (y increases upward), while Field Notes uses **top-left origin** (y increases downward). Conversion:

```
fieldnotes_x = pdf_tx
fieldnotes_y = page_height - pdf_ty
```

All coordinates are in **points** (1/72 inch). For pixel mapping at screen resolution:

```
pixels = points * (screen_dpi / 72)
```

At 144 DPI (Retina): 1 point = 2 pixels.

## Implementation Roadmap

### Phase 1: Image Import (Simplest)

1. Extract all JPEG images directly (they're valid files as-is)
2. Decode FlateDecode RGB images to PNG
3. Pair images with their alpha masks
4. Map positions using transformation matrices
5. Place as `ImageElement` on our canvas

### Phase 2: Text Import

1. Extract text items with positions and font sizes
2. Group nearby text items into logical blocks
3. Place as `NoteElement` or `HtmlElement` on canvas

### Phase 3: Shape Import

1. Parse rectangle operations → could map to note backgrounds or shape elements
2. Parse line/arrow paths → map to `ArrowElement`
3. Identify sticky notes by matching colored rects with contained text

### Phase 4: Pencil Stroke Import (Hardest)

1. Determine if strokes are center-line or filled-outline
2. For center-line: convert bezier curves to point arrays for `StrokeElement`
3. For filled-outline: either render as images, or attempt center-line extraction
4. Map colors and approximate widths

## Prerequisites (Field Notes Features Needed)

Before full import is feasible, Field Notes needs:

- [ ] Shape elements (rectangles, circles, lines) — for FreeForm shapes
- [ ] Text element improvements — font size, multi-line, styled text
- [ ] Grouped elements — FreeForm groups content visually
- [ ] Import/export pipeline — file picker, parsing, batch element creation

## Tools

Two reusable scripts in `scripts/`:

```bash
# Basic parse — metadata, image extraction, object summary
node scripts/parse-pdf.mjs <pdf-path> [--extract-images <output-dir>]

# Deep parse — coordinates, text positions, stroke analysis, sticky note detection
node scripts/parse-pdf-deep.mjs <pdf-path>
```

## Test Data

- `test_data/Russel McKenzie.pdf` — D&D character board from FreeForm
  - 68 image placements (34 unique + 34 alpha masks)
  - 956 text items across 20 fonts
  - 119 path operations, 6 fill paths
  - Content: character sheets, spell lists, item cards, character art
