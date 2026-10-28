# Tiered delegation

Work on Field Notes is split by model tier. The tier that plans and judges is not the tier
that edits code. This page is tool-neutral; harness-specific mechanics live in the
subsections at the end.

## Tiers

| Tier          | Role                                                                                                        | Never                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Thinking      | Brainstorm, write the spec and the plan, adjudicate reviews, final merge verdict, roadmap and release notes | edit `packages/*/src`, tests, or `demo` |
| Advisory      | Read-only advice on unresolved material decisions before a task brief                                       | edit, implement, dispatch, or merge     |
| Review        | Per-task gate (spec compliance, then quality) from a diff file; whole-branch review before merge            | write code                              |
| Coding        | One task brief at a time: failing test first, smallest fix, focused test and package build, commit          | design decisions; it asks instead       |
| Transcription | Briefs that already contain the complete code: apply, run the listed commands, commit                       | anything needing judgment               |

The session model is the thinking tier. The cheapest tier never touches code.

## Flow per roadmap item

1. **Decide or skip.** Use the advisory tier only for an unresolved material product,
   architecture, compatibility, or release decision before a task brief. It is read-only and
   returns a selected option, rationale, rejected alternatives, downstream constraints, risks,
   and required tests; the thinking tier decides. A well-specified bug goes straight to a plan.
2. **Spec and plan** go to `docs/superpowers/specs/` and `docs/superpowers/plans/`
   (gitignored working context, like the root planning documents). A plan is a list of
   task briefs; each brief is self-contained (see template).
   Working files live under `.work/` (gitignored): briefs in `.work/briefs/task-N.md`,
   reports in `.work/reports/task-N.md`, diffs in `.work/diffs/task-N.diff` built from
   `git log --oneline BASE..HEAD`, `git diff --stat BASE..HEAD`, and `git diff -U10 BASE..HEAD`.
3. **Execute** one brief per fresh coding-tier agent. Record the base commit before
   dispatch. The agent gets the brief file and the handbook pages it names, never the
   conversation transcript.
4. **Review** each finished task with a review-tier agent that reads the brief, the
   implementer's report and a single diff file for `BASE..HEAD`. Critical and Important
   findings go back to a coding-tier agent; at most two fix rounds, then the thinking
   tier decides. Minor findings are appended to `.work/minor-findings.md`.
5. **Deslop** once every task passed: one coding-tier task runs the deslop pass from the
   `fieldnotes-concise-code` skill over `BASE..HEAD`, then a task review as usual.
6. **Branch review** by the review tier, which reads the spec, the plan, the branch diff
   file, and `.work/minor-findings.md`. The thinking tier reads the verdicts and
   `git diff --stat`, spot-checks the risk areas the reviews named, runs the verification
   matrix from [workflow.md](workflow.md), and for render, input, or demo changes runs the
   `fieldnotes-browser-check` skill and puts its evidence blocks in the PR. A PR that
   changes website copy, README prose, or docs pages also gets a copy review. Then it opens
   the PR and updates the roadmap progress log.

## Task brief template

```
# Task N: <name>
Base: <commit>          Branch: <name>
Handbook: docs/agents/architecture.md §..., docs/agents/workflow.md §...
Goal: <one sentence, observable behavior>
Files: <exact paths to create or edit; nothing else>
Test first: <test file, test name, what it asserts, why it fails today>
Change: <what to implement; interfaces and names decided here, no options left open>
Commands: <focused test> · <package test> · <package build>
Acceptance: <bullet list a reviewer can check from the diff>
Out of scope: <what not to touch>
Commit: <type(scope): subject> + <trailer>
Report to: <path>
```

## Report template (coding tier, final message)

```
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Commits: <sha> <subject>
Tests: <n>/<n> focused · package test ✓ · build ✓
Concerns: <none | one line each>
Report: <path>
```

## Token rules

- Briefs, not transcripts. A dispatch prompt describes one task; never paste prior-task
  summaries.
- Reviewers read one diff file, not the repository.
- Reports follow the templates; detail lives in the report file, not the reply.
- The thinking tier does not re-read whole source files after planning; it reads
  verdicts, stats, and the specific lines a review names.
- Fix loops are capped at two per task. A third failure is a plan problem.

## Worktrees

Parallel branches run in sibling git worktrees (`git worktree add ../<repo>-<name> -b <branch>
master`, then `pnpm install --frozen-lockfile --offline`). Sibling packages resolve through `dist`
at build and typecheck time, so a fresh worktree needs `pnpm build` (or the dependency packages
built in order) once before a package build succeeds; briefs for worktree tasks say so.

## Autonomous run

When the owner hands an approved spec and plan to an unattended session, there is no human
approval gate:

- The spec and plan are approved; do not reopen their decisions.
- A coding agent's NEEDS_CONTEXT goes to the thinking tier, which decides from the AGENTS.md
  invariants and the spec, records the decision in the PR body, and re-dispatches.
- Stop and leave a draft PR describing the blocker only if a decision would break an AGENTS.md
  invariant.
- Commit and push after each approved task so progress survives an interrupted session.

## Claude Code

Agent definitions live in `.claude/agents/` with pinned models and tool sets:

| Agent                      | Tier            | Model                            |
| -------------------------- | --------------- | -------------------------------- |
| `fn-implementer`           | Coding          | `claude-opus-5-5`                |
| `fn-transcriber`           | Transcription   | `claude-sonnet-5-5`              |
| `fn-task-reviewer`         | Review (task)   | `claude-opus-5-5`, no edit tools |
| `fn-branch-reviewer`       | Review (branch) | `claude-opus-5-5`, no edit tools |
| `fieldnotes-copy-reviewer` | Review (copy)   | `claude-opus-5-5`, no edit tools |
| `fn-decision-advisor`      | Advisory        | `claude-fable-5-1`, read-only    |

The session model is the thinking tier. Process skills: `superpowers:brainstorming` →
`superpowers:writing-plans` → `superpowers:subagent-driven-development`, dispatching the agents
above by name. Repository skills live in `.agents/skills/` and are linked into `.claude/skills/`;
the coding tier loads `fieldnotes-concise-code`, `fieldnotes-typescript`, and `fieldnotes-testing`
on every task. Only the session model uses Claude in Chrome. Edits to existing definitions load
within seconds; a session started before `.claude/agents/` existed must be restarted to see them.
Until then dispatch `general-purpose` with an explicit `model` and paste the definition body as
the prompt preamble.

## Codex

Codex maps the same tiers onto its own models and mechanisms; its configuration lives
outside `.claude/`.

| Agent                 | Tier     | Model                    |
| --------------------- | -------- | ------------------------ |
| `fn_decision_advisor` | Advisory | `gpt-6-astra`, read-only |
