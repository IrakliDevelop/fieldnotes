export const MAX_BENCH = 20_000;

export function parseBenchCount(params: URLSearchParams): number {
  // Math.max(1, NaN) is NaN, so a missing or unparsable value falls back to 500.
  return params.has('bench')
    ? Math.min(MAX_BENCH, Math.max(1, parseInt(params.get('bench') ?? '', 10)) || 500)
    : 0;
}
