---
name: fieldnotes-typescript
description: Clean, readable TypeScript standards for Field Notes covering type design, trust boundaries, package dependency direction, error handling, and code smells. Use when writing or reviewing any .ts or .tsx file in this repository.
---

# Field Notes TypeScript standards

Adapted from the Pollyroll skill (Cursor pstack `typescript-best-practices`, mattpocock/skills
`code-review` and `codebase-design`, Anthropic `pr-review-toolkit`); see
[../THIRD_PARTY.md](../THIRD_PARTY.md). Pair with `fieldnotes-concise-code`.

## Types

| Rule                  | Summary                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discriminated unions  | Model variants with a literal discriminant so impossible states can't be represented. Elements use `type` (`packages/core/src/elements/types.ts`). |
| Branded types         | Brand primitives that share a type but differ in meaning (a layer id versus an element id) and validate once at the boundary.                      |
| Constructive modeling | Build the shape so the illegal value can't be constructed (`[T, ...T[]]` for non-empty).                                                           |
| Simplest total type   | Keep `T[]` while every operation stays total; strengthen only where the loose type forces `!`, a cast, or a "never happens" throw.                 |
| `unknown` over `any`  | External data is `unknown` until parsed.                                                                                                           |
| No `as` casts         | Cast only after validation. `satisfies` over `as` for literals.                                                                                    |
| Narrowing order       | Discriminant switch > `in` > `typeof`/`instanceof` > type guard > `as`.                                                                            |
| Honest guards         | A type guard (`isX`) checks everything it claims. A lying guard is worse than a cast.                                                              |
| Exhaustiveness        | `const _exhaustive: never = x;` in default arms.                                                                                                   |
| Derived types         | `Pick`/`Omit`/`ReturnType`/`typeof` before declaring a parallel interface.                                                                         |
| Object args           | Objects over long positional lists for public APIs. Hot paths (render loop, hit testing, stroke smoothing) keep positional args.                   |
| Readonly at the edge  | Public inputs and returned data are `readonly`; internal hot-path buffers stay mutable.                                                            |

The test for a loose type: if a comment is needed to explain which field combinations are valid,
split it into a union.

## Boundaries

- Persisted state and wire frames are `unknown` until validated (`parseState`, `isValidEnvelope`);
  inside, trust the type.
- Type-only imports (`consistent-type-imports` is an ESLint error). `noUncheckedIndexedAccess` is
  on: handle the `undefined`, never silence it with `!`.
- Dependency direction from `docs/agents/architecture.md`: `@fieldnotes/core` imports no framework;
  React and VTT depend on core; runtime code in `@fieldnotes/sync`, `sync-server`, and `sync-redis`
  never imports `@fieldnotes/vtt` (tests may, to exercise the plugins).
- Collapse pass-through layers. Deletion test: if deleting a module makes complexity vanish rather
  than move, it was a pass-through. One implementation of an interface is a hypothetical seam.

## Errors

- Fail loudly at boundaries with a typed error or a rejected parse.
- No empty `catch`, no catch-and-continue, no default value hiding a failure, no `?.` that silently
  skips work that must happen, no fallback chain without a stated reason.
- Deliberate exception: `InputHandler` wraps `releasePointerCapture` in `try/catch` because the
  browser may already have released the pointer.
- No `console.*` in shipped code.

## Smells to fix on sight

- **Data clumps:** the same fields travel together; make one type.
- **Primitive obsession:** a raw number or string stands for a domain concept; brand it or give it a
  small type.
- **Repeated switches:** the same switch on the same union in several places; share one lookup table.
- **Speculative generality:** parameters, hooks, or abstractions the spec doesn't need; delete.
- **Middle man:** a function that only forwards; call the target directly.
- **Long function:** a function that needs section comments; split at those seams, unless it is the
  render loop where the split costs performance.
