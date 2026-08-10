export type HtmlRenderTarget = 'screen' | 'minimap' | 'export';

export interface HtmlPaintDiagnostic {
  kind: 'missing-painter' | 'painter-threw' | 'degenerate-size';
  elementId: string;
  htmlType?: string;
  target: HtmlRenderTarget;
  error?: unknown;
}

/**
 * Painters run every frame, so an unfiltered diagnostic would flood the host.
 * The element version is part of the key so a fail -> repair -> fail-again
 * sequence reports twice instead of being suppressed forever.
 */
export class HtmlPaintDiagnosticDeduper {
  private readonly seen = new Map<string, Set<string>>();
  constructor(private readonly sink: (d: HtmlPaintDiagnostic) => void) {}

  emit(
    diagnostic: HtmlPaintDiagnostic,
    keyParts: { registryVersion: number; elementVersion: number },
  ): void {
    const key = `${diagnostic.target}|${diagnostic.kind}|${keyParts.registryVersion}|${keyParts.elementVersion}`;
    const forElement = this.seen.get(diagnostic.elementId) ?? new Set<string>();
    if (forElement.has(key)) return;
    forElement.add(key);
    this.seen.set(diagnostic.elementId, forElement);
    this.sink(diagnostic);
  }

  forget(elementId: string): void {
    this.seen.delete(elementId);
  }

  reset(): void {
    this.seen.clear();
  }
}
