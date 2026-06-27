# How We Work — Workflow & Conventions

The way changes are shipped on this project. Follow this unless the user says otherwise.

## Shipping changes — one batch = one branch = one PR = one version

Every improvement ships as a **self-contained batch**: a single branch, a single PR, a single version
bump. Group related items into a batch; don't mix unrelated concerns in one PR. Branch off `master`.

Per-batch flow (the user expects this rhythm):

1. **Brainstorm → design + approval (HARD GATE).** Explore the relevant code first, then present the
   design with a clear recommendation and the genuine forks. Do NOT write implementation code before
   the user approves the design. Surface real decisions as explicit choices; recommend the lead option.
2. **Spec** — write a working doc (see below), self-review it, get the user's review.
3. **Plan** — a bite-sized implementation plan (working doc), self-reviewed against the spec.
4. **Execute subagent-driven** — a fresh subagent per task, then a **two-stage review** after each
   task: a **spec-compliance** reviewer, then a **code-quality** reviewer. Fix findings before moving
   on. After all tasks, a **final whole-branch review** before opening the PR.
5. **PR** — open against `master`. End the body with the Claude Code generated-with footer.

The user approves with short confirmations ("looks good", "merged, let's do X") and picks the
"Recommended"/lead option. When a review surfaces a genuine product fork (e.g. should notes shrink on
manual resize?), stop and ask rather than guessing.

## Working documents are NEVER committed

`SPEC_*.md` and `PLAN_*.md` are **untracked working documents** — created in the repo root, never
committed, and deleted after the batch merges (clean up the previous batch's docs at the start of the
next one). The audit/strategy docs (`UX_AUDIT_*`, `PRODUCT_GAPS_*`, `PRODUCT_VISION_*`, and
`TECH_DEBT_*` when present), plus `dump.txt` and scratch images, also stay **untracked**. When cleaning
up untracked docs, keep only what is unimplemented AND still relevant.

> Durable instructions (this file, `.claude/project.md`, `CLAUDE.md`) ARE tracked — that is the
> opposite of working docs. Don't confuse the two.

## Versioning — every PR bumps the version

npm version immutability + a per-PR release cadence means **every PR gets a version bump**, including
pure-internal refactors and docs-affecting-`dist` changes (a docs-only/instructions PR like this one is
the exception — no shippable code, no bump).

- **Patch** — bugfix or internal refactor (no public-API change).
- **Minor** — new public API (new exported tool/function/type, new `ViewportOptions`, new element field).
- The core VERSION lives in **three** places that must agree: `packages/core/src/index.ts` (`VERSION`),
  `packages/core/package.json`, and the assertion in `packages/core/src/index.test.ts`. Bump TDD-style:
  change the test's expected version first → red → set the source → green.
- `@fieldnotes/react` versions independently; raise its `@fieldnotes/core` peer-range floor when a new
  hook depends on a newer core method.
- Keep `CHANGELOG.md` (repo root) current per release — newest entry on top, dated, Keep-a-Changelog
  style; react entries are noted as such.

## Pure-refactor discipline

When the task is a behavior-preserving refactor (file decomposition, extraction):

- **Move bodies VERBATIM.** Only mechanical substitutions (`this.X` → a param / `this.deps.X`). No
  logic change, no rename of observable behavior, no "while I'm here" cleanup. If you spot a bug, leave
  it and **report** it — don't fix it in the refactor.
- **Correctness proof** (all must hold): existing behavioral tests pass UNCHANGED · `pnpm --filter
@fieldnotes/core build` is clean (ESM+CJS+**DTS**) · the e2e `canvas-with-shape` snapshot is
  **byte-identical** · the public `dist/index.d.ts` is unchanged except `VERSION` · lint clean.
- **Internal-surface guard:** new internal modules are NOT barrel-exported — add a representative name
  to the `removed` (not-exported) array in `index.test.ts`; genuinely-reusable helpers go in `kept`.
- Extraction pattern: a controller class constructed once with a deps object (the
  `ViewportInteractions`/`KeyboardHandler` pattern), or pure functions taking only the deps they use
  (the `select-hit.ts` / `elements/renderers/` pattern) — pick by dependency count; avoid a shared
  "god-object" context.

## Gotchas (learned the hard way)

- **`pnpm test` (vitest) does NOT catch unused-private `TS6133`** — the tsup **DTS build** does. Run
  `pnpm --filter @fieldnotes/core build` on **every** task, not just at the end.
- **e2e `canvas-with-shape` byte-identical** is the correctness proof for refactors and any non-render
  change. Before claiming it, confirm the fixture doesn't exercise the changed path (e.g. it has no
  text/note element). Never regenerate a baseline to make it pass without flagging.
- **Tests must be discriminating** — a regression/behavior test should FAIL on the pre-fix code. Verify
  by reverting the fix and re-running. The two-stage review has caught vacuous tests this way (a
  single-nudge test that coincidentally passed; a "round-trip" that only proved self-consistency).
- **When a test casts to a now-private/extracted method** (`as unknown as {...}`), migrate it to call
  the extracted function / reach the internal controller — do NOT add a public delegator (it widens the
  public surface, and a private one trips `TS6133`).
- **Watch scope blast-radius** — a shared helper may be reached from more than the path you're changing
  (e.g. `fitNoteHeight` is used by both edit-stop AND manual resize). Confirm every caller before
  changing shared behavior.
- **WSL2 husky/lint-staged flake:** if the pre-commit hook fails spuriously, run `pnpm lint` manually,
  then `git commit --no-verify`; drop any leftover backup stash.

## Subagents & git

- Subagents doing git should ONLY `git add` / `git commit` on the current branch — **no rebase / reset
  / pull / stash**. (A subagent once improvised a rebase from a confused tree state; keep git
  instructions tight and verify branch integrity vs `origin/master` if anything looks off.)
- Verify each merged batch: branch cleanly based on `origin/master`, the diff contains only the
  intended files (no working docs), gates green.

## The user

Plays D&D — Field Notes' primary motivation is a FreeForm replacement for tabletop maps/notes (see the
roadmap: `@fieldnotes/presets` and FreeForm PDF import). Values minimal comments, small focused files,
TDD, and SOLID/KISS/DRY. Trusts the batch workflow; wants recommendations with the trade-offs, not an
exhaustive survey.
