import type { HtmlElement } from '../elements/types';

export type HtmlExportRenderer = (
  element: HtmlElement,
) => CanvasImageSource | null | Promise<CanvasImageSource | null>;

export type HtmlExportErrorReason = 'unsupported' | 'timeout' | 'render' | 'encode';

export interface HtmlExportError {
  elementId: string;
  htmlType?: string;
  reason: HtmlExportErrorReason;
  cause?: unknown;
}

export interface HtmlExportOptions {
  /** Converts an application-owned HTML embed into a ready canvas image source. */
  renderHtml?: HtmlExportRenderer;
  /** Maximum wait for each HTML renderer. Defaults to 10 seconds. */
  htmlTimeoutMs?: number;
  /** Called when an HTML embed cannot be rendered or encoded. The export continues. */
  onHtmlError?: (error: HtmlExportError) => void;
}

const DEFAULT_HTML_TIMEOUT_MS = 10_000;
const TIMEOUT = Symbol('html-export-timeout');

export function validateHtmlExportOptions(options: HtmlExportOptions): number {
  const timeoutMs = options.htmlTimeoutMs ?? DEFAULT_HTML_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('htmlTimeoutMs must be a finite number greater than 0');
  }
  return timeoutMs;
}

export async function renderHtmlElements(
  elements: HtmlElement[],
  options: HtmlExportOptions,
): Promise<Map<string, CanvasImageSource>> {
  const timeoutMs = validateHtmlExportOptions(options);
  const sources = new Map<string, CanvasImageSource>();

  await Promise.all(
    elements.map(async (element) => {
      if (!options.renderHtml) {
        options.onHtmlError?.({
          elementId: element.id,
          htmlType: element.htmlType,
          reason: 'unsupported',
        });
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<typeof TIMEOUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
        });
        const result = await Promise.race([Promise.resolve(options.renderHtml(element)), timeout]);
        if (result === TIMEOUT) {
          options.onHtmlError?.({
            elementId: element.id,
            htmlType: element.htmlType,
            reason: 'timeout',
          });
          return;
        }
        if (!result) {
          options.onHtmlError?.({
            elementId: element.id,
            htmlType: element.htmlType,
            reason: 'render',
          });
          return;
        }
        sources.set(element.id, result);
      } catch (cause) {
        options.onHtmlError?.({
          elementId: element.id,
          htmlType: element.htmlType,
          reason: 'render',
          cause,
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  );

  return sources;
}
