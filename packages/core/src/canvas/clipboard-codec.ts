import type { CanvasElement } from '../elements/types';
import type { ElementRegistry } from '../elements/element-registry';
import { getDefaultElementRegistry } from '../elements/default-registry';
import { escapePlainTextHtml, plainTextOf } from '../elements/note-sanitizer';
import { CANVAS_STATE_VERSION, parseElements } from '../core/state-serializer';

/** Clipboard MIME type and envelope `type` for Field Notes element payloads. */
export const FIELDNOTES_CLIPBOARD_TYPE = 'fieldnotes/clipboard';
export const CLIPBOARD_ENVELOPE_VERSION = 1;
export const MAX_CLIPBOARD_CHARS = 32 * 1024 * 1024;

/** The JSON document carried in every clipboard format. */
export interface ClipboardEnvelope {
  type: typeof FIELDNOTES_CLIPBOARD_TYPE;
  version: 1;
  stateVersion: number;
  elements: CanvasElement[];
}

/** The three clipboard formats: vendor JSON, `text/html` and `text/plain`. */
export interface ClipboardPayload {
  vendor: string;
  html: string;
  text: string;
}

/** Encodes elements into vendor, html and readable plain-text clipboard formats. */
export function encodeClipboard(elements: readonly CanvasElement[]): ClipboardPayload {
  const copied = elements
    .filter((el) => !(el.type === 'html' && el.transient === true))
    .map((el) => {
      const clone = structuredClone(el);
      // ownerId and audience are host fields outside the element types.
      for (const key of ['editor', 'ownerId', 'audience']) Reflect.deleteProperty(clone, key);
      return clone;
    });
  const readable = elements
    .flatMap((el) => (el.type === 'note' || el.type === 'text' ? [plainTextOf(el.text)] : []))
    .join('\n\n');
  const envelope: ClipboardEnvelope = {
    type: FIELDNOTES_CLIPBOARD_TYPE,
    version: CLIPBOARD_ENVELOPE_VERSION,
    stateVersion: CANVAS_STATE_VERSION,
    elements: copied,
  };
  const vendor = JSON.stringify(envelope);
  const html =
    '<div data-fieldnotes="' +
    escapePlainTextHtml(vendor) +
    '">' +
    escapePlainTextHtml(readable).replace(/\n/g, '<br>') +
    '</div>';
  return { vendor, html, text: readable || vendor };
}

/** Decodes an untrusted clipboard payload through full state validation; `null` if invalid. */
export function decodeClipboard(
  payload: Partial<ClipboardPayload>,
  registry?: ElementRegistry,
): CanvasElement[] | null {
  const { vendor, html, text } = payload;
  if (
    [vendor, html, text].some((field) => field !== undefined && field.length > MAX_CLIPBOARD_CHARS)
  ) {
    return null;
  }
  const candidate = vendor || (html && envelopeAttribute(html)) || text;
  if (!candidate) return null;
  let data: unknown;
  try {
    data = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (
    !isRecord(data) ||
    data['type'] !== FIELDNOTES_CLIPBOARD_TYPE ||
    typeof data['version'] !== 'number' ||
    data['version'] > CLIPBOARD_ENVELOPE_VERSION ||
    typeof data['stateVersion'] !== 'number' ||
    data['stateVersion'] > CANVAS_STATE_VERSION ||
    !Array.isArray(data['elements'])
  ) {
    return null;
  }
  try {
    return parseElements(
      data['elements'],
      data['stateVersion'],
      registry ?? getDefaultElementRegistry(),
    );
  } catch {
    return null;
  }
}

/** Whether a payload claims to carry a Field Notes envelope, valid or not. */
export function hasClipboardMarker(payload: Partial<ClipboardPayload>): boolean {
  const { vendor, html, text } = payload;
  if (vendor && vendor.length <= MAX_CLIPBOARD_CHARS) return true;
  if (html && html.length <= MAX_CLIPBOARD_CHARS && envelopeAttribute(html) !== null) return true;
  if (!text || text.length > MAX_CLIPBOARD_CHARS || !text.trimStart().startsWith('{')) return false;
  try {
    const data: unknown = JSON.parse(text);
    return isRecord(data) && data['type'] === FIELDNOTES_CLIPBOARD_TYPE;
  } catch {
    return false;
  }
}

// DOMParser documents are inert: no scripts run and no resources load.
function envelopeAttribute(html: string): string | null {
  return (
    new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector('[data-fieldnotes]')
      ?.getAttribute('data-fieldnotes') ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
