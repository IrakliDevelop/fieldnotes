# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Field Notes — a lightweight, framework-agnostic infinite canvas SDK for the web with first-class HTML element embedding. See `PROJECT.md` for full architecture, data model, API surface, and roadmap.

## Monorepo Layout

- `packages/core/` — `@fieldnotes/core`, vanilla TypeScript engine (zero framework deps)
- `packages/react/` — `@fieldnotes/react`, thin React wrapper
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
pnpm --filter @fieldnotes/core build      # build core
pnpm --filter @fieldnotes/core test       # test core
pnpm --filter @fieldnotes/core test:watch # test core in watch mode
pnpm --filter @fieldnotes/react build     # build react wrapper

# single test file
pnpm --filter @fieldnotes/core test -- src/path/to/file.test.ts
```

## Architecture

Hybrid rendering: HTML5 Canvas layer for strokes/shapes/arrows, DOM layer for notes/images/HTML embeds. A shared camera/viewport system keeps both layers in sync via CSS `translate3d` + `scale` transforms. Pointer Events API for unified input handling (mouse/touch/stylus).

**Key patterns**:

- **Strategy** for tools — `Tool` interface (`onPointerDown/Move/Up`, optional `renderOverlay`), swapped via `ToolManager`
- **Command** for undo/redo — `HistoryRecorder` auto-records `ElementStore` mutations; `InputHandler` wraps tool pointer lifecycles in `begin()`/`commit()` transactions so a full drag = one undo step
- **Observer** for events — typed `EventBus`; `ElementStore` emits `add`/`remove`/`update`
- **Discriminated unions** for element types and tool mode state machines

**Integration hub**: `Viewport` (`canvas/viewport.ts`) orchestrates everything — creates canvas + DOM layers, Camera, InputHandler, ElementStore, NoteEditor, HistoryStack, HistoryRecorder, and the render loop.

## Touch & Tablet Support

This SDK targets desktop (mouse), iPad (touch + Apple Pencil), Android tablets, and Surface devices. Touch/tablet is a core requirement, not an afterthought. Key rules:

- Always use Pointer Events API, never mouse-only APIs (`mousedown`, `mousemove`, etc.)
- Single pointer = active tool, two pointers = pan/zoom — always
- `touch-action: none` must be set on the interactive surface
- Tool input must handle cancellation when a second finger is added mid-stroke
- Pointer capture must be used during active tool input
- Pressure data (`PointerEvent.pressure`) must be passed through to tools
- Test pinch-to-zoom, two-finger pan, and stylus input in any input-related changes

## TypeScript / Lint Rules

- **Strict mode** with `noUncheckedIndexedAccess` — array access returns `T | undefined`, always guard before use
- **No non-null assertions** (`@typescript-eslint/no-non-null-assertion: error`) — use conditional checks instead of `!`
- **Consistent type imports** (`@typescript-eslint/consistent-type-imports: error`) — use `import type` for type-only imports
- **Consistent type definitions** — prefer `interface` over `type` for object shapes
- **Unused vars** — prefix with `_` to suppress (`argsIgnorePattern: '^_'`)
- Pre-commit hook (husky + lint-staged) runs eslint + prettier on staged files

## Testing

- Vitest with jsdom where DOM is needed (`// @vitest-environment jsdom` at top of test file)
- Tests co-located: `foo.ts` → `foo.test.ts`
- Run single test: `pnpm --filter @fieldnotes/core vitest run src/tools/select-tool.test.ts`

## Code Standards

**Minimal comments** — code should be self-explanatory. Only comment non-obvious "why", never "what".

**Principles**: KISS, DRY, SOLID. Prefer composition over inheritance. Use appropriate design patterns (Strategy for tools, Command for history, Observer for events) — but don't force patterns where they add complexity.

**Modularity** — small, focused files. Each file should have a single clear responsibility. Prefer splitting over growing files beyond ~150 lines.

**TDD** — write tests first or alongside code. Every public API method, every element type, every tool behavior needs tests. This is an SDK — correctness is non-negotiable.

**TypeScript strict mode** — no `any`, no type assertions unless absolutely necessary. Leverage discriminated unions for element types.

**No framework deps in core** — `@fieldnotes/core` must never import React, Vue, or any framework.
