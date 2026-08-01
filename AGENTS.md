# Field Notes agent guide

This is the canonical entry point for every coding agent. Read it before changing the repository,
then open only the handbook pages relevant to the task.

## Start here

1. Inspect `git status --short`; untracked root planning documents belong to the user.
2. Read `docs/agents/architecture.md` for code changes.
3. Read `docs/agents/workflow.md` before implementation or release work.
4. Read `docs/agents/review.md` when reviewing or before handoff.
5. Use `.agents/skills/fieldnotes-development/SKILL.md` when repository-local skills are supported.

## Non-negotiable invariants

- `@fieldnotes/core` stays framework-free. React belongs in `@fieldnotes/react`.
- Preserve mouse, touch, and stylus behavior. Input uses Pointer Events; one pointer operates the
  tool, two pointers navigate, and pressure, cancellation, and pointer capture matter.
- Keep the public API intentional: exports come from each package's `src/index.ts`; internal helpers
  do not become exports incidentally.
- Keep serialization backward-compatible and versioned. Treat persisted canvas state and the sync
  protocol as public contracts.
- A user gesture is one undo step. Keep tool mutations inside history transactions.
- Avoid `any`, non-null assertions, and unchecked indexed access. Use type-only imports.
- Co-locate focused Vitest tests with source. Add a discriminating regression test for behavior
  changes; do not update snapshots merely to make a failure disappear.
- Do not modify generated `dist/`, coverage, or test-result artifacts by hand.
- Do not touch unrelated or untracked files. Never commit root `SPEC_*`, `PLAN_*`, audit, roadmap,
  `dump.txt`, or scratch artifacts unless the user explicitly changes that policy.

## Fast command loop

```bash
pnpm agent:check
pnpm --filter @fieldnotes/core test -- src/path/file.test.ts
pnpm --filter @fieldnotes/core build
pnpm lint
pnpm format:check
```

Use the narrowest relevant package while iterating. Before handoff, run the change-class matrix in
`docs/agents/workflow.md` and report exactly what ran, what did not, and why.

## Instruction precedence

User instructions override this guide. More-specific `AGENTS.md` files override it for their subtree.
Current durable project policy lives under `docs/agents/`; provider files such as `CLAUDE.md` should
point there instead of duplicating policy.
