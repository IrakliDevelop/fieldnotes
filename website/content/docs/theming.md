---
title: Theming
description: By the end of this page your board has a dark or system theme, its own colour tokens, and exports drawn in the same theme.
group: Guides
order: 9
---

## Set a board theme

A theme sets the board colour and dot pattern, adapts element colours, and restyles the selection,
handles, minimap, note toolbar and command palette. It belongs to one viewport: saved boards and
sync messages don't change, and images, HTML elements, the laser pointer and remote cursors keep
their colours. The default is `'light'`. Pass `theme` in the viewport options, or change a running
viewport with `setTheme`. `getTheme` returns the resolved light or dark theme. `onThemeChange`
subscribes to changes in that resolved theme.

::code{example="theming" region="options"}

::code{example="theming" region="set-theme"}

## Follow the display

`'system'` follows the reader's `prefers-color-scheme` setting and switches the board when it
changes. `{ base: 'system', light, dark }` does the same with token overrides for each side.

::code{example="theming" region="system"}

## Tokens

Override tokens with `{ base: 'light' | 'dark', tokens }`, or for each side with
`{ base: 'system', light, dark }`. A `background.color` in the viewport options overrides the
`pattern` token in both themes, so set the dot colour as a token instead. The defaults are:

| Token                     | Light                            | Dark                            |
| ------------------------- | -------------------------------- | ------------------------------- |
| `board`                   | `transparent`                    | `#1e1f22`                       |
| `pattern`                 | `#d0d0d0`                        | `#3b3d42`                       |
| `selection`               | `#2196F3`                        | `#64b5f6`                       |
| `handleFill`              | `#ffffff`                        | `#1e1f22`                       |
| `snapGuide`               | `#FF4081`                        | `#ff79a8`                       |
| `labelPlate`              | `rgba(255,255,255,0.9)`          | `rgba(30,31,34,0.9)`            |
| `placeholderFill`         | `#eeeeee`                        | `#2a2b30`                       |
| `placeholderStroke`       | `#bdbdbd`                        | `#4b4b4b`                       |
| `placeholderText`         | `#9e9e9e`                        | `#9aa0a6`                       |
| `widgetPlaceholderStroke` | `#a1a1aa`                        | `#4b4b4b`                       |
| `widgetPlaceholderText`   | `#71717a`                        | `#9aa0a6`                       |
| `minimapBackground`       | `rgba(255,255,255,0.85)`         | `rgba(30,31,34,0.85)`           |
| `minimapBorder`           | `rgba(0,0,0,0.15)`               | `rgba(255,255,255,0.15)`        |
| `minimapViewport`         | `#3b82f6`                        | `#60a5fa`                       |
| `toolbarBackground`       | `#fff`                           | `#2a2b30`                       |
| `toolbarBorder`           | `#ccc`                           | `#4b4b4b`                       |
| `toolbarActive`           | `#e0e0e0`                        | `#3b3d42`                       |
| `chromeText`              | `''`                             | `#e8eaed`                       |
| `paletteBackground`       | `#fff`                           | `#2a2b30`                       |
| `paletteBorder`           | `#d1d5db`                        | `#4b4b4b`                       |
| `paletteText`             | `#1a1a1a`                        | `#e8eaed`                       |
| `paletteMuted`            | `#6b7280`                        | `#9aa0a6`                       |
| `paletteActive`           | `#e8f0fe`                        | `#1c3a5e`                       |
| `paletteShadow`           | `0 8px 24px rgba(0, 0, 0, 0.18)` | `0 8px 24px rgba(0, 0, 0, 0.6)` |

Colour tokens must be concrete CSS colour values, not `var(...)`: canvas drawing cannot resolve CSS
variables. If it cannot parse `board`, canvas fill and exports use the base theme's board colour.

::code{example="theming" region="custom"}

On a dark board, element colours flip lightness and keep their hue. A colour that would land within
`0.2` OKLab lightness of the board is lifted to `0.2` above it, so a custom dark `board` lighter
than `0.8` is not supported. Text on a sticky note or inside a filled shape is adjusted to at least
4.5:1 contrast with its background. Highlighters switch from multiply to screen blending. Stored
element colours are never rewritten.

The viewport wrapper has `data-fieldnotes-theme="light"` or `"dark"` for host CSS.
`--fieldnotes-palette-*` CSS variables set by the page override the `palette*` tokens.

::board{example="theming"}

## Export a themed board

Viewport exports follow the resolved board theme. Set `theme` on an [export](/docs/export/) to
`'light'`, `'dark'` or `{ base, tokens }` to override it; exports don't take `'system'`. An explicit
`background` wins even when it clashes with the chosen theme. Dark frame PNG and SVG exports stay
transparent with light ink. Dark PDFs fill the whole page.

::code{example="theming" region="export"}

## Theme-aware plugins

Renderers receive `context.theme`. Use `context.theme.tokens` for chrome colours and
`context.theme.adapt(color)` for element colours. Do not store or mutate the resolved theme.
The [extension contract](https://github.com/IrakliDevelop/fieldnotes/blob/master/docs/EXTENDING.md)
describes the renderer methods.
