# Roadmap

<!-- Built is in shipping order. Append a newly shipped item at the end; the page numbers the list and folds the oldest. -->

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
- Frames that group and clip elements
- Presentation mode that steps through frames fullscreen
- Laser pointer on the L key
- Command palette on Ctrl or ⌘+K to search and run actions
- Find text on the board: notes, text, arrow labels and frame titles, with the camera moved to the match
- Shortcuts help on the ? key, generated from the current bindings
- React props and hooks for autosave, export and load, camera control, shortcuts, element activation and presence
- Text inside shapes and arrow labels as text elements, with wrapping and auto-resize

## Next

- I'm adding elbow arrows that route around shapes.

## Not built yet

- Pasting text and links as elements, dropping files other than images, and reopening an exported PNG or SVG as an editable board
