---
name: fieldnotes-development
description: Implement, debug, refactor, test, or review changes in the Field Notes TypeScript monorepo. Use for work involving @fieldnotes/core canvas/input/rendering/history/serialization, React bindings, real-time sync client/server/Redis packages, public APIs, examples, releases, or repository code review.
---

# Field Notes development

Read `AGENTS.md` from the repository root. Then read only the relevant handbook page:

- Use `docs/agents/architecture.md` to locate ownership and contracts.
- Use `docs/agents/workflow.md` for implementation, refactoring, releases, and verification.
- Use `docs/agents/review.md` for code review or pre-handoff self-review.

## Execute

1. Inspect `git status --short`, the owning package manifest, nearby tests, exports, and every caller
   of changed shared code. Preserve unrelated and untracked user files.
2. State the behavioral contract and risks. Honor requested design/spec approval gates before editing.
3. Add or identify a discriminating test. Keep core framework-free, persisted and wire formats
   compatible, pointer modalities equivalent, and each gesture within one history transaction.
4. Implement the smallest coherent diff using existing local patterns.
5. Run a focused test, owning package tests and build, then the verification matrix from the workflow
   page. Build declarations; tests alone do not catch all TypeScript failures.
6. Review the final diff with the review playbook. Report exact verification and residual gaps.

Use `rg` and `rg --files` for discovery. Do not edit generated `dist`, coverage, snapshots, or release
versions unless the requested change requires them. Do not regenerate a visual baseline merely to
silence a failure.
