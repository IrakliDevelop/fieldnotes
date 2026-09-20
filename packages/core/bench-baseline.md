# Performance Baseline

> Generated: 2026-09-20 against `@fieldnotes/core@0.83.0`
> Environment: Node 22, Linux (development machine)
> Run: `pnpm bench`

## ElementStore spatial queries (500 elements)

| Benchmark                  | ops/s       | Mean (ms) | P99 (ms) |
| -------------------------- | ----------- | --------- | -------- |
| queryRect (viewport-sized) | ~424,000    | 0.0024    | 0.0028   |
| queryPoint (single point)  | ~507,000    | 0.0020    | 0.0025   |
| getAll (baseline linear)   | ~39,200,000 | 0.0000    | 0.0000   |

## getElementBounds

| Benchmark                       | ops/s       | Mean (ms) | P99 (ms) |
| ------------------------------- | ----------- | --------- | -------- |
| bounds for note (sized element) | ~23,100,000 | 0.0000    | 0.0001   |
| bounds for stroke (cached)      | ~23,300,000 | 0.0000    | 0.0000   |
| bounds for arrow (bezier)       | ~16,200,000 | 0.0001    | 0.0001   |

## boundsIntersect

| Benchmark        | ops/s       | Mean (ms) | P99 (ms) |
| ---------------- | ----------- | --------- | -------- |
| intersecting     | ~31,600,000 | 0.0000    | 0.0001   |
| non-intersecting | ~30,200,000 | 0.0000    | 0.0000   |

## Store mutations with spatial index

| Benchmark                 | ops/s   | Mean (ms) | P99 (ms) |
| ------------------------- | ------- | --------- | -------- |
| add 100 elements          | ~15,800 | 0.063     | 0.080    |
| loadSnapshot 500 elements | ~3,100  | 0.322     | 0.673    |

## Acceptance criteria

Per the migration plan: **no more than 5% performance degradation** from the pre-extension baseline.
The roadmap targets a 10,000-element perf gate (Phase 5); the current bench uses 500 elements.
