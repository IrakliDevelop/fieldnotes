---
name: fieldnotes-concise-code
description: Rules for short, plain code and sparse comments in Field Notes, plus the deslop pass over a branch diff. Use while writing any code, when reviewing a diff for verbosity or over-engineering, and as the cleanup task before branch review.
---

# Concise code

Adapted from the Pollyroll skill, which draws on Anthropic's overengineering guidance, the Karpathy
guidelines, and Cursor's `deslop` skill; see [../THIRD_PARTY.md](../THIRD_PARTY.md).

Write code a senior engineer would not call overcomplicated. If 200 lines could be 50, rewrite it.

## Scope

- Implement what the brief asks and nothing more. No features, options, or configurability nobody
  requested.
- Every changed line traces to the brief. Do not "improve" adjacent code, comments, or formatting.
- Remove imports, variables, and functions your change made unused. Leave pre-existing dead code to
  its own task.

## Structure

- No helpers, utilities, or abstractions for a single caller. Inline first; extract on the second
  real use.
- Plain functions and data over classes, factories, and option objects, except where an existing
  Field Notes pattern is the local idiom: a tool strategy, a `Viewport` collaborator, a plugin
  adapter. Follow the neighbor.
- Early returns over nested conditionals. Flat over deep.
- Readability wins over cleverness: no nested ternaries or dense one-liners to save a line.

## Defensive code

- No validation, fallbacks, or `try/catch` for states the types or internal callers rule out.
- Validate only at boundaries: `parseState` in `packages/core/src/core/state-serializer.ts`,
  `isValidEnvelope` in `packages/sync/src/protocol.ts`, inputs to the server `Authenticate` and
  `Authorize` hooks, public option objects, and DOM calls that can fail (`releasePointerCapture`).
- No casts to `any` or `as` chains to silence the type checker; fix the types.

## Comments

- Default is no comment. Names and types carry the meaning.
- A comment explains _why_: an invariant, a non-obvious constraint, a workaround, a tradeoff. One
  line, rarely two.
- Never: restating the code, narrating steps, describing history or the task
  (`// added for PR 12`), commented-out code, banner or divider comments, `TODO` without an owner.
- Required: a one-line doc comment on each public export.
- Tests: the test name states the behavior; no comments repeating it.

## Deslop pass

Run on `git diff BASE..HEAD` as its own coding-tier task after every TDD task passed and before
branch review, never inside the red-green loop:

- Remove extra comments that are unnecessary or inconsistent with local style.
- Remove defensive checks or `try/catch` blocks that are abnormal for trusted code paths.
- Remove casts to `any` used only to bypass type issues.
- Flatten deeply nested code with early returns.
- Fix other patterns inconsistent with the surrounding code.

Guardrails:

- Behavior unchanged: the owning packages' tests pass without edits.
- Minimal focused edits over broad rewrites. Never delete tests.
- Public declarations unchanged: for each touched package, run `pnpm --filter <pkg> build` before
  and after, keep the first `dist/**/*.d.ts` set in the scratch directory, and `diff -r` the two.
- No Playwright baseline changes.
