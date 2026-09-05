# Field Notes Agent Wiki

This is the comprehensive knowledge base for AI agents working on the Field Notes codebase. It covers architecture, conventions, patterns, and workflows in an agent-agnostic way.

## Quick Start

If you're new to this codebase, read in this order:

1. **[Getting Started](getting-started.md)** — Setup, commands, and first steps
2. **[Architecture Overview](architecture.md)** — High-level system design and package relationships
3. **[Core Concepts](core-concepts.md)** — Viewport, ElementStore, Camera, Tools, History
4. **[Package Deep Dives](packages/)** — Detailed documentation per package
5. **[Development Guide](development.md)** — How to add features, tests, and follow conventions
6. **[Patterns & Gotchas](patterns.md)** — Common patterns, edge cases, and things to watch out for

## Existing Documentation

This wiki complements the existing agent handbook:

| Document                      | Purpose                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `AGENTS.md` (root)            | Mandatory short entry point with non-negotiable invariants |
| `docs/agents/architecture.md` | Workspace ownership and verification matrix                |
| `docs/agents/workflow.md`     | Implementation workflow and verification tiers             |
| `docs/agents/review.md`       | Code review playbook                                       |

The wiki provides deeper context and explanation; the handbook provides concise rules.

## Source of Truth Hierarchy

1. **Code and tests** — current behavior
2. **AGENTS.md and handbook** — durable engineering policy
3. **Package READMEs** — supported public APIs
4. **This wiki** — comprehensive context and explanation
5. **Root dated specs/plans** — working context, not durable instructions

When documentation disagrees with code, verify with tests or git history.
