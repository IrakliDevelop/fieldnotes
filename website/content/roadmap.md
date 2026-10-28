# Roadmap

## Built

- Freehand pencil with pen pressure and stroke smoothing
- Eraser that splits a stroke or removes it whole
- Rectangles and ellipses with fill and stroke
- Sticky notes with editable text
- Standalone text with font size and alignment
- Images, placed by drag and drop or from code
- Arrows that bind to elements and carry labels
- Live HTML elements that pan, zoom and sit in layer order with the drawing
- Layers with visibility, locking and ordering
- Undo and redo
- Remappable keyboard shortcuts
- PNG and SVG export
- Save and load as JSON, with older saves migrated on load
- Autosave to IndexedDB, localStorage or memory
- Embedded boards that let a plain wheel and a one-finger swipe scroll the page
- React bindings: a canvas component and hooks
- Vue and Svelte bindings: a canvas component and helpers with the React hook names
- Angular bindings: a canvas component and signal helpers named after the React hooks, with `use` changed to `inject`
- Self-hosted WebSocket sync server, with Redis for persistence and fan-out across instances
- Tabletop package with square and hex grids, fog of war, measuring, area templates and per-turn movement tracking on token drags
- Parent and child elements with nested rectangular clipping across canvas, DOM, minimap, PNG and SVG export
- Camera constraints applied to camera mutations and animations
- A scheduled Chromium performance gate that records 90 render-loop samples on 10,011 elements against a checked-in p95 budget

## Next

- I'm making starter templates on StackBlitz and CodeSandbox for a vanilla board and a React board.
- I'm bringing the React bindings up to the core API: hooks and props for autosave, export, camera control, shortcuts and presence.
- Frames that group and clip elements

## Not built yet

- Find text on the board
- Command palette
- Elbow arrows that route around shapes
- Text inside shapes
