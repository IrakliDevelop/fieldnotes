# Performance Baseline

> Generated: 2026-10-18 against `@fieldnotes/core@0.88.1`
> Environment: Node 22, Linux (development machine)
> Run: `pnpm bench`

## Browser performance gate (10,011 elements)

> Calibrated: 2026-10-26 on Linux x64, Node 22.22.0, Playwright Chromium.
> Command: `pnpm --filter @fieldnotes/core exec playwright test --config e2e/playwright.config.ts --project=desktop-chrome --retries=0 e2e/perf-gate.e2e.ts`

The nightly `Performance gate` workflow opens `/?bench=10000`, which contains 10,000 strokes, 10
notes, and one grid. It warms up 15 unrecorded one-world-unit stroke moves, then records
`getRenderStats().lastFrameMs` for 90 alternating moves. It measures render-loop work only, not
navigation, board seeding, or requestAnimationFrame scheduling.

| Calibration run | p95 frame time |
| --------------- | -------------- |
| 1               | 1,565.0 ms     |
| 2               | 1,549.8 ms     |
| 3               | 1,548.9 ms     |

The enforced p95 budget is **4,695 ms**: `max(25 ms, roundUpTo5(3 × 1,565.0 ms))`.
The test attaches its 90 samples and environment metadata as `performance-gate.json` on every pass
or assertion failure. It is intentionally scheduled separately from pull-request CI.

The tables below are Node microbenchmarks. They do not replace this browser render-loop gate.

## ElementStore spatial queries (500 elements)

| Benchmark                  | ops/s       | Mean (ms) | P99 (ms) |
| -------------------------- | ----------- | --------- | -------- |
| queryRect (viewport-sized) | ~265,000    | 0.0038    | 0.0061   |
| queryPoint (single point)  | ~380,000    | 0.0026    | 0.0042   |
| getAll (baseline linear)   | ~29,600,000 | 0.0000    | 0.0000   |

## getElementBounds

| Benchmark                       | ops/s       | Mean (ms) | P99 (ms) |
| ------------------------------- | ----------- | --------- | -------- |
| bounds for note (sized element) | ~12,200,000 | 0.0001    | 0.0009   |
| bounds for stroke (cached)      | ~18,500,000 | 0.0001    | 0.0001   |
| bounds for arrow (bezier)       | ~12,700,000 | 0.0001    | 0.0001   |

## boundsIntersect

| Benchmark        | ops/s       | Mean (ms) | P99 (ms) |
| ---------------- | ----------- | --------- | -------- |
| intersecting     | ~25,400,000 | 0.0000    | 0.0000   |
| non-intersecting | ~25,200,000 | 0.0000    | 0.0001   |

## Store mutations with spatial index

| Benchmark                 | ops/s  | Mean (ms) | P99 (ms) |
| ------------------------- | ------ | --------- | -------- |
| add 100 elements          | ~9,800 | 0.102     | 0.372    |
| loadSnapshot 500 elements | ~2,100 | 0.478     | 1.442    |

## RenderLoop frame

| Benchmark                                                          | ops/s  | Mean (ms) | P99 (ms) |
| ------------------------------------------------------------------ | ------ | --------- | -------- |
| 10,000 mixed elements over 4 layers                                | ~971   | 1.029     | 1.795    |
| drag one element in a 10k-element layer (per frame), 0.90.0 base   | ~948   | 1.055     | 3.255    |
| drag one element in a 10k-element layer (per frame), live elements | ~1,495 | 0.669     | 3.449    |

## Note creation

| Benchmark                   | ops/s | Mean (ms) | P99 (ms) |
| --------------------------- | ----- | --------- | -------- |
| createNote + store.add x100 | ~116  | 8.622     | 13.646   |

## Acceptance criteria

Per the migration plan: **no more than 5% performance degradation** from the pre-extension baseline.
The roadmap targets a 10,000-element perf gate (Phase 5); the store benches use 500 elements and the render-frame bench uses 10,000.
