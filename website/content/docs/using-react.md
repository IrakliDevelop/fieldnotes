---
title: Using React
description: By the end of this page you have a board in a React app that saves itself and a button that picks a tool.
group: Start
order: 2
---

## Install

```bash
npm install @fieldnotes/core @fieldnotes/react
```

`@fieldnotes/react` needs React 18 or 19 and `@fieldnotes/core` 0.105.0 or newer.

## Mount a board

`<FieldNotesCanvas>` creates the viewport when it mounts and destroys it when it unmounts. With no `tools` prop, and no tools registered in `onReady`, it registers the default tools and starts on select, as `tools: 'default'` does in [Getting started](/docs/getting-started/).

:::margin
`options` and `initialData` are read once, at mount. Changing them later does nothing.
:::

::code{example="using-react" region="app"}

`initialData` takes a saved board as a `CanvasState` or a JSON string. `onChange` receives `viewport.exportState()` 250ms after the last change; set `changeDebounceMs` to change the wait. Loading `initialData` does not call `onChange`, and a pending call runs on unmount, so the last edit is not lost.

Give `<FieldNotesCanvas>` a height through `style` or `className`. It renders one `div`, and the board fills it.

## Use the viewport from a component

Children of `<FieldNotesCanvas>` can call the hooks. `useActiveTool` returns the active tool's name and a setter:

::code{example="using-react" region="tool-button"}

`useViewport()` returns the `Viewport` itself, for anything the hooks don't cover. It throws outside `<FieldNotesCanvas>`. From outside, use the `onReady(viewport)` prop or a ref. `useHistory`, `useLayers`, `useSelection` and `useCamera` re-render the component when undo state, layers, the selection or the camera change. `useExport`, `useLoad`, `useCameraControls`, `useShortcuts`, `useCanvasSize`, `useElement`, `useTransaction` and `usePresence` cover export, loading, the camera, shortcuts, the canvas size, one element, undo grouping and who else is on the board.

## React components on the board

`<HostElement position={{ x, y }}>` renders its children on the board, where they pan and zoom with it. React owns the element: moving it creates no undo step, and `exportState()` leaves it out of the saved board. Older code can keep `CanvasElement` until 0.16.0.

The [`@fieldnotes/react` README](https://github.com/IrakliDevelop/fieldnotes/blob/master/packages/react/README.md#prop-reactivity) says which props are read only at mount, and covers custom tools and the selection hooks.

[`@fieldnotes/vue`](https://github.com/IrakliDevelop/fieldnotes/tree/master/packages/vue#readme), [`@fieldnotes/svelte`](https://github.com/IrakliDevelop/fieldnotes/tree/master/packages/svelte#readme) and [`@fieldnotes/angular`](https://github.com/IrakliDevelop/fieldnotes/tree/master/packages/angular#readme) export `FieldNotesCanvas`, `CanvasElement` and `Minimap`. React exports `HostElement` and keeps `CanvasElement` as an alias. Their helpers use the React hook names and give state as Vue refs, Svelte stores and Angular signals. Angular changes `use` to `inject` in the names (`injectCamera`).

## Save the board automatically

Use the `autoSave` prop for a board that restores and saves with its storage key.

::code{example="using-react" region="autosave"}

## Shortcuts and presence

`useShortcuts()` reads the current bindings. `usePresence()` connects a presence channel when the app provides one.

::code{example="using-react" region="shortcuts"}
