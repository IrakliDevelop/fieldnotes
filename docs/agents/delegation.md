# Tiered delegation

Work on Field Notes is split by model tier. The tier that plans and judges is not the tier
that edits code. This page is tool-neutral; harness-specific mechanics live in the
subsections at the end.

## Tiers

| Tier          | Role                                                                                                        | Never                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Thinking      | Brainstorm, write the spec and the plan, adjudicate reviews, final merge verdict, roadmap and release notes | edit `packages/*/src`, tests, or `demo` |
| Review        | Per-task gate (spec compliance, then quality) from a diff file; whole-branch review before merge            | write code                              |
| Coding        | One task brief at a time: failing test first, smallest fix, focused test and package build, commit          | design decisions; it asks instead       |
| Transcription | Briefs that already contain the complete code: apply, run the listed commands, commit                       | anything needing judgment               |

The session model is the thinking tier. The cheapest tier never touches code.

## Flow per roadmap item

1. **Decide or skip.** Brainstorm only when a design decision is open. A well-specified
   bug goes straight to a plan.
2. **Spec and plan** go to `docs/superpowers/specs/` and `docs/superpowers/plans/`
   (gitignored working context, like the root planning documents). A plan is a list of
   task briefs; each brief is self-contained (see template).
3. **Execute** one brief per fresh coding-tier agent. Record the base commit before
   dispatch. The agent gets the brief file and the handbook pages it names, never the
   conversation transcript.
4. **Review** each finished task with a review-tier agent that reads the brief, the
   implementer's report and a single diff file for `BASE..HEAD`. Critical and Important
   findings go back to a coding-tier agent; at most two fix rounds, then the thinking
   tier decides. Minor findings are recorded for the branch review.
5. **Branch review** by the review tier once every task passed. The thinking tier reads
   the verdicts and `git diff --stat`, spot-checks the risk areas the reviews named, runs
   the verification matrix from [workflow.md](workflow.md), opens the PR, updates the
   roadmap progress log.

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

## Claude Code

Agent definitions live in `.claude/agents/` with pinned models and tool sets:
`fn-implementer` (coding, Opus 4.6 1M), `fn-transcriber` (Sonnet 5), `fn-task-reviewer`
and `fn-branch-reviewer` (Opus 5, no edit tools). The session runs Fable 5.1 as the
thinking tier. Process skills: `superpowers:brainstorming` → `superpowers:writing-plans`
→ `superpowers:subagent-driven-development`, dispatching the agents above by name. Edits to
existing definitions load within seconds; a session started before `.claude/agents/` existed
must be restarted to see them. Until then dispatch `general-purpose` with an explicit `model`
and paste the definition body as the prompt preamble.

## Codex

Codex maps the same tiers onto its own models and mechanisms; its configuration lives
outside `.claude/`. It reads this page and adds its mapping here when that content has
no home in its own config.
