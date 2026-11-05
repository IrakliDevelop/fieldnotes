# Final typecheck fix

The initial core typecheck failed with 69 errors across the brief's listed files. The repair adds literal-preserving overloads to `createShape`, which lets fixtures retain their concrete rectangle, ellipse, and line shape types without broad casts. It also narrows stored element unions, removes obsolete arrow-label editor test setup, types canvas mocks, and makes the optional layer-lock callback safe.

Verification passed: core typecheck, core tests (3,888), core build, lint, format check, and `git diff --check`.

`element-factory.ts` was changed because its existing broad return type was the shared source of the concrete bound-text fixture errors; the overloads preserve runtime behavior while accurately exposing the literal shape accepted by `createBoundText`.
