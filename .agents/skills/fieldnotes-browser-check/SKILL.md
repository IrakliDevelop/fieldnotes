---
name: fieldnotes-browser-check
description: Verify a Field Notes change in a real browser and attach evidence, using Claude in Chrome for visual and console checks or a scratch Playwright probe for touch, stylus, iPad, and headless runs. Use after changes to rendering, input, tools, export, the demo, or examples, and before claiming such a change works.
---

# Field Notes browser check

Unit tests and Playwright baselines prove known behavior. This check looks at the changed behavior
running, and leaves evidence a reviewer can read.

## When

Rendering, input, tools, export, DOM-embedded elements, the demo, and examples. The session
(thinking) tier runs it before handoff. Playwright probes may be delegated to a coding-tier agent;
the Chrome channel may not.

## Start the target

1. Build what the target consumes from `dist`: `pnpm --filter @fieldnotes/core build`, then
   `@fieldnotes/vtt` and `@fieldnotes/sync` when the demo or example uses them.
2. Start the dev server in the background: the demo with `pnpm dev`; an example with
   `pnpm --filter fieldnotes-react-example dev` (or `fieldnotes-live-play-example`,
   `fieldnotes-extension-api-example`).
3. Read the `Local:` URL from the server output. Vite moves off 5173 when it is busy; never assume
   the port.
4. Stop the server when done.

## Channel A: Claude in Chrome

For mouse input, visual inspection, and console errors.

- Load the tools in one ToolSearch call: `tabs_context_mcp`, `tabs_create_mcp`, `navigate`,
  `computer`, `javascript_tool`, `read_console_messages`, `gif_creator` (all
  `mcp__claude-in-chrome__*`).
- Call `tabs_context_mcp`, open a new tab, and navigate to the local URL. Never reuse the owner's
  tabs.
- Screenshot, then drive with `computer`: click a tool (`#toolbar button[data-tool="shape"]`), drag
  on the canvas.
- Read state with `javascript_tool`, for example `window.__fieldnotes_viewport.store.count` or
  `window.__fieldnotes_viewport.camera.zoom`.
- Read errors with `read_console_messages` and a `pattern` such as `error|Error`.
- Record a GIF for multi-step flows, with extra frames before and after each action.
- Never trigger `alert` or `confirm` dialogs; they block the extension.
- Session model only. Never from subagents, never two sessions at once: there is one shared browser.
- If the extension lacks localhost permission or stops responding after two attempts, stop and ask
  the owner.

## Channel B: Playwright probe

For touch, stylus pressure, the iPad viewport, headless runs, and subagents. Write a throwaway
`probe.mjs` in the session scratch directory, never in the repository:

```js
import { createRequire } from 'node:module';
const require = createRequire('/ABS/PATH/fieldnotes/packages/core/package.json');
const { chromium, devices } = require('@playwright/test');

const url = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => Boolean(window.__fieldnotes_viewport));
// Drive input here; for touch, copy the CDP calls from packages/core/e2e/helpers/touch.ts.
const state = await page.evaluate(() => ({
  count: window.__fieldnotes_viewport.store.count,
  zoom: window.__fieldnotes_viewport.camera.zoom,
}));
await page.screenshot({ path: '/ABS/SCRATCH/probe.png' });
console.log(JSON.stringify({ state, errors }));
await browser.close();
```

The e2e helpers are TypeScript and cannot be imported from a plain `.mjs`; copy the
`Input.dispatchTouchEvent` calls you need instead.

## Limits

- The Chrome channel emits mouse input only.
- No channel emits `pointerType: 'pen'`. Pen paths need unit tests and, when it matters, a manual
  device check by the owner.
- Probe screenshots are evidence, not baselines. Baselines come from the `e2e:update` script
  with a stated visual change.

## Evidence

Put one block per channel in the handoff or PR body:

```
Browser check: <Chrome | Playwright probe> · <URL> · steps: <what was done>
Screenshot/GIF: <absolute path> · console errors: <n> · state: <key=value, ...>
```

## Promote

A probe that guards a real behavior becomes a committed `*.e2e.ts` through a coding-tier task that
follows `fieldnotes-visual-tests`.
