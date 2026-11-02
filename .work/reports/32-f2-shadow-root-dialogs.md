# Task F2: shadow-root dialog events

Status: DONE

## Change

- Attach the dialog shell's capture Escape and deferred outside-pointer listeners to the container's root node.
- Remove both listeners from that same root during disposal.
- Add closed-shadow-root palette regression coverage, plus open- and closed-shadow-root dialog shell coverage.

## Red/green evidence

Red: `pnpm --filter @fieldnotes/core exec vitest run src/canvas/dialog-shell.test.ts src/canvas/command-palette.test.ts` failed before the implementation: the closed-shadow-root palette row `pointerdown` closed the palette (`expected false to be true`).

Green: the same command passed after the listener-root change: 2 files, 46 tests passed.

## Checks

- `pnpm --filter @fieldnotes/core exec vitest run src/canvas/dialog-shell.test.ts src/canvas/command-palette.test.ts` — 46/46 passed.
- `pnpm --filter @fieldnotes/core test` — 3701/3701 passed across 155 files. The suite emitted existing jsdom `HTMLCanvasElement.getContext()` not-implemented notices.
- `pnpm --filter @fieldnotes/core build` — passed, including DTS.
- `git diff --check` — passed.

## Scope

Only the three brief-listed core files and this report are included. No P3 or later parent-brief items were changed.
