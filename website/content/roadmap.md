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
- Self-hosted WebSocket sync server, with Redis for persistence and fan-out across instances
- Tabletop package with square and hex grids, fog of war, measuring and area templates

## Next

- I'm making starter templates on StackBlitz and CodeSandbox for a vanilla board and a React board.
- I'm bringing the React bindings up to the core API: hooks and props for autosave, export, camera control, shortcuts and presence.
- I'm adding parent and child elements with clipping, which frames need.
- I'm adding Angular bindings with the same components and helpers as the Vue and Svelte ones.

## Not built yet

- Frames that group and clip elements
- Find text on the board
- Command palette
- Elbow arrows that route around shapes
- Text inside shapes
