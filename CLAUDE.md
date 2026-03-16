# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Parchment Canvas — a lightweight, framework-agnostic infinite canvas SDK for the web with first-class HTML element embedding. See `PROJECT.md` for full architecture, data model, API surface, and roadmap.

## Monorepo Layout

- `packages/core/` — `@parchment-canvas/core`, vanilla TypeScript engine (zero framework deps)
- `packages/react/` — `@parchment-canvas/react`, thin React wrapper
- `demo/` — plain HTML dev playground
- pnpm workspaces for package management

## Commands

```bash
pnpm install                                    # install all dependencies
pnpm build                                      # build all packages
pnpm test                                       # run all tests
pnpm lint                                       # lint all packages
pnpm format                                     # format all files

# per-package
pnpm --filter @parchment-canvas/core build      # build core
pnpm --filter @parchment-canvas/core test       # test core
pnpm --filter @parchment-canvas/core test:watch # test core in watch mode
pnpm --filter @parchment-canvas/react build     # build react wrapper

# single test file
pnpm --filter @parchment-canvas/core test -- src/path/to/file.test.ts
```

## Architecture

Hybrid rendering: HTML5 Canvas layer for strokes/shapes/arrows, DOM layer for notes/images/HTML embeds. A shared camera/viewport system keeps both layers in sync via CSS `translate3d` + `scale` transforms. Pointer Events API for unified input handling (mouse/touch/stylus).

Core is structured around: state management, canvas renderer, element types, tool system (strategy pattern), and command-based undo/redo history.

## Code Standards

**Minimal comments** — code should be self-explanatory. Only comment non-obvious "why", never "what".

**Principles**: KISS, DRY, SOLID. Prefer composition over inheritance. Use appropriate design patterns (Strategy for tools, Command for history, Observer for events) — but don't force patterns where they add complexity.

**Modularity** — small, focused files. Each file should have a single clear responsibility. Prefer splitting over growing files beyond ~150 lines.

**TDD** — write tests first or alongside code. Every public API method, every element type, every tool behavior needs tests. This is an SDK — correctness is non-negotiable.

**TypeScript strict mode** — no `any`, no type assertions unless absolutely necessary. Leverage discriminated unions for element types.

**No framework deps in core** — `@parchment-canvas/core` must never import React, Vue, or any framework.
