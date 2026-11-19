---
title: Theming
description: Light, dark or system board themes, token overrides, and exports that follow them.
group: Guides
order: 9
---

## Set a board theme

Themes change the board, element rendering and board chrome. They never change saved boards, sync,
images, embeds, laser pointers or remote cursors. Pass `theme` in the viewport options, or change a
running viewport with `setTheme`. `getTheme` returns the resolved light or dark theme.
`onThemeChange` subscribes to changes in that resolved theme.

::code{example="theming" region="options"}

Use `setTheme` when a board already exists.

::code{example="theming" region="set-theme"}

## Follow the display

`'system'` follows `prefers-color-scheme` while the viewport runs. It updates when the display
preference changes.

::code{example="theming" region="system"}

## Tokens

Use a fixed theme object to override chrome tokens. The defaults are:

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

::code{example="theming" region="custom"}

On a dark board, element colours flip lightness while keeping their hue. A `0.2` OKLab lightness
floor keeps adapted colours apart from the board. Sticky-note text stays at 4.5:1 contrast, and
highlighters use screen blending. Stored element colours are never rewritten.

The viewport wrapper has `data-fieldnotes-theme="light"` or `"dark"` for host CSS. Existing
`--fieldnotes-palette-*` CSS variables still take precedence over palette tokens.

::board{example="theming"}

## Export a themed board

Viewport exports follow the resolved board theme. Set `theme` on an export to override it. An
explicit `background` wins even when it clashes with the chosen theme. Dark frame PNG and SVG
exports stay transparent with light ink. Dark PDFs fill the whole page.

::code{example="theming" region="export"}

## Theme-aware plugins

Renderers receive `context.theme`. Use `context.theme.tokens` for chrome colours and
`context.theme.adapt(color)` for element colours. Do not store or mutate the resolved theme.
The [extension contract](https://github.com/IrakliDevelop/fieldnotes/blob/master/docs/EXTENDING.md)
describes the renderer methods.
