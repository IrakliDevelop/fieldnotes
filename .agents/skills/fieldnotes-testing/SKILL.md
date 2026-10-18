---
name: fieldnotes-testing
description: Test-quality rules for Field Notes covering naming the break, independent expected values, mocking only real boundaries, compatibility tests, golden-value discipline, and flake prevention. Use when writing, changing, or reviewing any Vitest or Playwright test.
---

# Field Notes testing

Adapted from the Pollyroll skill (obra/superpowers `writing-good-tests`, Cursor pstack
`principle-test-behavior-not-implementation`, mattpocock/skills `tdd`); see
[../THIRD_PARTY.md](../THIRD_PARTY.md). Domain test categories live in `fieldnotes-pointer-input`,
`fieldnotes-sync-security`, and `fieldnotes-visual-tests`.

## Name the break

Before writing a test body, name the production change that should make it fail, and check that
change is a bug, not a decision.

- Cannot name one: test an observable behavior instead.
- Only intentional decisions fail it (a constant's value, exact message text): it is a change
  detector; test the behavior that depends on the decision.
- Would it still pass if every imported function returned `undefined`? Then it observes nothing.
- Weak assertions alone (`toBeDefined`, `toBeTruthy`, `not.toThrow`, `toBeGreaterThan(0)`) do not
  count.

## Expected values

- Derive expectations independently: literals and hand-checked fixtures. Table-driven `it.each`
  with literal expected values is the preferred shape.
- Never compute the expected value with the code under test or its helpers.
- Test names state the behavior: `parseState rejects a state newer than CANVAS_STATE_VERSION`, not
  `parseState works`.

## Mocks and fakes

- Mock only real boundaries: the canvas 2D context, `requestAnimationFrame`, `ResizeObserver`,
  `WebSocket`, the Redis client, and time (`vi.useFakeTimers`).
- Never mock Field Notes modules. Use the real `ElementStore`, `HistoryRecorder`, and `ToolManager`.
- A fake mirrors the real structure completely; a partial fake hides integration failures.
- Assert behavior, never that a mock exists or was called; when the call is the contract, assert
  its arguments.
- Rendering is verified in Playwright, not by asserting canvas call sequences.
- Test-only cleanup lives in test utilities, never as production methods.

## Compatibility tests

- Old persisted state still parses through `migrateState` and `parseState`.
- Old peers drop new op kinds. Model: the "old clients drop them" case in
  `packages/sync/src/protocol.test.ts`.

## Golden values

Playwright baselines (`packages/core/e2e/*-snapshots/`, one per project: `desktop-chrome`, `ipad`)
and persisted-state fixtures change only with a stated visual or format change in the same commit.
A golden value that changes in an unrelated commit is a bug.

## Flake prevention

- No real timers, `Date.now`, `Math.random`, or network in unit tests.
- No fixed waits in new e2e tests; use `page.waitForFunction` on a state predicate.
- Tests do not depend on execution order or shared mutable state.

## Property tests

Optional. Use them only when a task explicitly adds `fast-check` as a dev dependency; it is not
installed today.

## Test anti-patterns

- **Tautological:** the assertion recomputes the expected value the way the code does, so it passes
  by construction.
- **Implementation-coupled:** the test reaches into internals and breaks on a behavior-preserving
  refactor. Test at the public seams: each package's `src/index.ts` exports and the collaborators
  named in `docs/agents/architecture.md`.
- **Horizontal slicing:** writing every test first, then every implementation. Work in vertical
  slices: one failing test, the code that passes it, repeat.

## Mutation check

Before finishing, mentally mutate the code; at least one test fails for each: wrong constant or
argument; wrong branch; missing state change; empty or default return; missing validation for zero,
empty, or malformed input.
