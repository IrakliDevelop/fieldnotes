# Workflow and verification

## Work loop

1. Establish scope: inspect status, branch, nearby source, tests, exports, and callers.
2. For substantive product changes, honor design/spec/plan approval gates requested by the user.
3. Write or identify a test that distinguishes old from desired behavior.
4. Make the smallest coherent change; avoid unrelated cleanup.
5. Run the narrow test, then the affected package build. DTS builds catch errors Vitest misses.
6. Review the diff, public surface, generated artifacts, docs, and version implications.
7. Run the appropriate verification tier and provide an evidence-based handoff.

Pure refactors move behavior mechanically. Do not combine a refactor and behavior fix. Existing tests
must remain unchanged; compare public declarations and relevant visual output when applicable.

## Verification matrix

| Change class           | Required minimum                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Docs/agent tooling     | `pnpm agent:check`, `pnpm agent:format:check`                                                 |
| One package internals  | focused test, package test/build, lint, format check                                          |
| Core public API/model  | core tests/build, export assertions, affected wrapper/sync builds                             |
| Rendering/input/export | core tests/build, relevant Playwright test; manual device smoke if automation cannot cover it |
| Sync protocol/client   | sync tests/build plus server tests/build                                                      |
| Server/auth/filtering  | server tests/build plus shared sync tests and adversarial authorization cases                 |
| Redis adapter          | redis tests/build; state if Redis integration was unavailable                                 |
| React binding          | react tests/build plus core build and React example build                                     |
| Cross-cutting/release  | `pnpm verify`, then relevant e2e/integration environments                                     |

```bash
pnpm agent:check
pnpm --filter @fieldnotes/core test -- src/canvas/camera.test.ts
pnpm --filter @fieldnotes/core test
pnpm --filter @fieldnotes/core build
pnpm --filter @fieldnotes/core e2e
pnpm verify
```

Never claim a check passed unless it ran in the current worktree. Never regenerate a baseline without
explaining the intended visual change.

## Public API and releases

Every shippable PR receives a version bump; instruction-only changes are exempt. Patch releases cover
fixes/refactors; minor releases add public API. For core, synchronize `packages/core/package.json`,
`VERSION` in `packages/core/src/index.ts`, and its assertion in `packages/core/src/index.test.ts`.
Update `CHANGELOG.md` for releases. Raise peer dependency floors when wrappers require a newer API.
Do not hand-edit `dist`; builds produce it.

## Handoff format

State the outcome, key files and decisions, checks actually run, anything unverified, and risks or one
useful next step. Mention unrelated worktree changes only when they affect safety.
