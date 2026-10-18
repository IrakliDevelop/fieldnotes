# Performance Baseline

> Generated: 2026-10-18 against `@fieldnotes/core@0.88.1`
> Environment: Node 22, Linux (development machine)
> Run: `pnpm bench`

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
