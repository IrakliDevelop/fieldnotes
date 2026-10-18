---
name: fieldnotes-visual-tests
description: Playwright patterns for Field Notes e2e tests on the hybrid canvas and DOM surface, covering the demo fixture, state globals, touch and stylus helpers, scoped screenshot baselines, and readiness waits. Use when writing, debugging, or reviewing anything under packages/core/e2e.
---

# Field Notes visual and e2e tests

Anti-pattern table adapted from the Pollyroll skill (testdino `playwright-skill`); see
[../THIRD_PARTY.md](../THIRD_PARTY.md).

## Setup

- Config: `packages/core/e2e/playwright.config.ts`. Base URL `http://localhost:5173`; the web server
  is `pnpm --filter fieldnotes-demo dev` with `reuseExistingServer`.
- Projects: `desktop-chrome` and `ipad` (iPad Pro 11 viewport and touch on Chromium, so CDP touch
  helpers work). Every behavior test runs in both unless it is mouse- or touch-only by design.
- Tests import `test` and `expect` from `e2e/fixtures/canvas-page.ts`, whose `canvasPage` fixture has
  already navigated to the demo.

## Reading state

- `CanvasPage`: `selectTool(name)` clicks `#toolbar button[data-tool="<name>"]`; `getElementCount()`
  and `getElementsByType(type)` read `window.__fieldnotes_viewport.store`; `canvas()` and
  `wrapper()` (`#canvas > div`) are locators.
- `demo/main.ts` exposes more `window.__fieldnotes_*` globals (fog manager, grid controller, hit
  test, remote laser/ping/measure/path, awareness, focus). Read state through them with
  `page.evaluate`, not by parsing pixels.

## Input helpers

- `e2e/helpers/touch.ts`: `pinchGesture`, `singleFingerDraw`, `singleFingerHold`,
  `twoFingerTakeover`, `twoFingerPan`. `e2e/helpers/stylus.ts`: `stylusDraw` with per-point
  `pressure`.
- They send CDP `Input.dispatchTouchEvent`, which produces `pointerType: 'touch'` with force, never
  `'pen'`. Pen-only paths (palm rejection, pen hover) need unit tests.
- Mouse input uses `page.mouse` with `steps` so moves arrive as several pointer events.

## Screenshots

- Capture the canvas wrapper (`canvasPage.wrapper()`), never the full page.
- Hide panels first with `page.addStyleTag` (`visibility: hidden !important` on `#toolbar`, `#info`,
  and the other panels, as in `visual-regression.e2e.ts`).
- `toHaveScreenshot(name, { maxDiffPixelRatio: 0.01 })`. Baselines live in
  `<test>.e2e.ts-snapshots/` with one file per project and platform.
- Rendering is hybrid: DOM-embedded elements (notes, HTML) must sit inside the captured region, or
  the baseline misses a camera misalignment between the DOM layer and the canvas.

## Anti-patterns

| Don't                                         | Problem                                 | Instead                                        |
| --------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Assert exact RGB values                       | GPU and anti-aliasing variance          | `toHaveScreenshot` with `maxDiffPixelRatio`    |
| `waitForTimeout` before an assertion          | Too slow or too early                   | `page.waitForFunction` on a state predicate    |
| Full-page screenshots                         | Unrelated panels make baselines brittle | Scope to the wrapper locator                   |
| Regenerating baselines to make a failure pass | Hides regressions                       | State the intended visual change in the commit |
| Asserting canvas call sequences in unit tests | Couples tests to drawing internals      | Screenshot or state read in Playwright         |

## Known debt

`CanvasPage.goto()` waits a fixed 500 ms and `visual-regression.e2e.ts` waits 300 ms before the
screenshot. Do not copy these; new tests wait on state, for example
`page.waitForFunction(() => window.__fieldnotes_viewport.store.count === 1)`.

## Commands

```bash
pnpm --filter @fieldnotes/core e2e
pnpm --filter @fieldnotes/core e2e -- --project=ipad e2e/touch-input.e2e.ts
pnpm --filter @fieldnotes/core e2e:update   # only with a stated visual change
```

## Troubleshooting

| Symptom                                 | First check                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| Baseline differs only in CI             | Fonts; the platform suffix in the baseline name                   |
| Blurry or offset capture on one project | Device pixel ratio from the device preset                         |
| DOM element misaligned with the canvas  | Camera transform applied to one layer only                        |
| Empty canvas                            | Zero-size canvas path (see PR #219); wrapper size at capture time |
| Stale behavior after a source change    | A dev server reused from before the build (`reuseExistingServer`) |
