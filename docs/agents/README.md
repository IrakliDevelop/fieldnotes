# Agent handbook

This is the durable, tool-neutral knowledge base for AI-assisted work on Field Notes. `AGENTS.md` is
the mandatory short entry point; these pages provide detail on demand.

| Need                                  | Read                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Find the owning package or subsystem  | [Architecture map](architecture.md)                                       |
| Implement, test, refactor, or release | [Workflow and verification](workflow.md)                                  |
| Review a change or prepare a handoff  | [Review playbook](review.md)                                              |
| Invoke a reusable procedure           | [Field Notes skill](../../.agents/skills/fieldnotes-development/SKILL.md) |

## Source-of-truth hierarchy

1. Executable code, package manifests, and tests describe current behavior.
2. `AGENTS.md` and this handbook describe durable engineering policy.
3. Package READMEs describe supported public APIs and usage.
4. `PROJECT.md` provides broad context; verify details against code.
5. Root dated specs, plans, audits, and roadmaps are working context, not durable instructions.

When documentation disagrees with code, verify with tests or history, fix durable documentation when
in scope, and call out the discrepancy. Update this handbook when an invariant, command, package
boundary, or release rule changes. Run `pnpm agent:check` to catch stale references and broken links.
