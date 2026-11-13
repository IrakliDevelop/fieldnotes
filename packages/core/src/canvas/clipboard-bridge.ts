import type { Point } from '../core/types';
import type { ElementRegistry } from '../elements/element-registry';
import type { CanvasElement } from '../elements/types';
import type { KeyboardActions } from './keyboard-actions';
import { isPasteLink, normalizeLink } from '../elements/link';
import {
  decodeClipboard,
  encodeClipboard,
  FIELDNOTES_CLIPBOARD_TYPE,
  hasClipboardMarker,
} from './clipboard-codec';

/** The viewport side of a paste: the host hook and the inserters that place content. */
export interface ClipboardHost {
  elementRegistry: ElementRegistry;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- undefined keeps the host-owns-it contract
  onPaste?: (event: ClipboardEvent, world: Point) => boolean | void;
  claimsFile: (file: File, kind: 'paste') => boolean;
  insertElements: (elements: CanvasElement[], anchor: Point) => void;
  insertFiles: (files: File[], anchor: Point, kind: 'paste') => boolean;
  insertText: (text: string, anchor: Point, link?: string) => void;
}

export interface ClipboardBridgeDeps {
  keyboardActions: KeyboardActions;
  document: Document;
  canInsertNow: () => boolean;
  host: ClipboardHost;
}

/** Writes copied elements to the system clipboard through the native `copy` event. */
export class ClipboardBridge {
  private pending = false;

  constructor(private readonly deps: ClipboardBridgeDeps) {}

  /** True while `copy()` runs `execCommand('copy')`, so its event is handled from any target. */
  get pendingWrite(): boolean {
    return this.pending;
  }

  copy(): void {
    const ka = this.deps.keyboardActions;
    if (ka.copyableElements().length === 0) return;
    ka.copy();
    this.pending = true;
    try {
      // Missing or refused execCommand leaves the memory clipboard as the only copy.
      this.deps.document.execCommand?.('copy');
    } finally {
      this.pending = false;
    }
  }

  cut(): void {
    this.copy();
    this.deps.keyboardActions.deleteSelected();
  }

  handleCopy(event: ClipboardEvent, allowed: boolean, cut: boolean): boolean {
    if (!allowed && !this.pending) return false;
    const ka = this.deps.keyboardActions;
    const elements = ka.copyableElements();
    if (elements.length === 0) return false;
    const data = event.clipboardData;
    if (!data) return false;
    ka.copy();
    const payload = encodeClipboard(elements);
    data.setData(FIELDNOTES_CLIPBOARD_TYPE, payload.vendor);
    data.setData('text/html', payload.html);
    data.setData('text/plain', payload.text);
    event.preventDefault();
    if (cut) ka.deleteSelected();
    return true;
  }

  /** Routes a paste: envelope, image files, a link line, plain text, else the memory clipboard. */
  paste(event: ClipboardEvent, anchor: Point): void {
    const ka = this.deps.keyboardActions;
    const data = event.clipboardData;
    if (!data) {
      ka.paste();
      return;
    }
    const payload = {
      vendor: data.getData(FIELDNOTES_CLIPBOARD_TYPE),
      html: data.getData('text/html'),
      text: data.getData('text/plain'),
    };
    const files: File[] = [];
    for (const item of data.items) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (file) files.push(file);
    }
    const marker = hasClipboardMarker(payload);
    const line = payload.text.trim();
    const { host } = this.deps;
    const claimed = files.filter((f) => host.claimsFile(f, 'paste'));
    if (!marker && claimed.length === 0 && line.length === 0) {
      ka.paste();
      return;
    }
    if (host.onPaste && host.onPaste(event, anchor) !== false) return;
    event.preventDefault();
    if (!this.deps.canInsertNow()) return;
    if (marker) {
      // A marker ends the paste even when decoding fails: never reinterpret it as text.
      const elements = decodeClipboard(payload, host.elementRegistry);
      if (elements) host.insertElements(elements, anchor);
      return;
    }
    if (claimed.length > 0) {
      host.insertFiles(claimed, anchor, 'paste');
      return;
    }
    if (!line.includes('\n') && isPasteLink(line)) {
      host.insertText(line, anchor, normalizeLink(line) ?? undefined);
      return;
    }
    if (line.length > 0) host.insertText(payload.text, anchor);
  }

  /** Claims `beforecopy`/`beforecut` so WebKit fires the event without a DOM selection. */
  handleBeforeCopy(event: Event, allowed: boolean): void {
    if ((allowed || this.pending) && this.deps.keyboardActions.copyableElements().length > 0) {
      event.preventDefault();
    }
  }
}
